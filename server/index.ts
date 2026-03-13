import cors from 'cors'
import dotenv from 'dotenv'
import express from 'express'
import solc from 'solc'
import OpenAI from 'openai'
import {
  AgentMode,
  HederaAIToolkit,
  coreAccountPluginToolNames,
  coreAccountQueryPluginToolNames,
  coreConsensusPluginToolNames,
  coreConsensusQueryPluginToolNames,
  coreEVMPluginToolNames,
  coreEVMQueryPluginToolNames,
  coreMiscQueriesPluginsToolNames,
  coreTokenPluginToolNames,
  coreTokenQueryPluginToolNames,
  coreTransactionQueryPluginToolNames,
} from 'hedera-agent-kit'
import {
  AccountCreateTransaction,
  Client,
  ContractCreateFlow,
  ContractExecuteTransaction,
  ContractFunctionParameters,
  ContractId,
  Hbar,
  PrivateKey,
  TransferTransaction,
} from '@hashgraph/sdk'
import { z } from 'zod'
import { initMasterKey } from './crypto.js'
import * as db from './db.js'
import { initAuth, generateChallenge, consumeChallenge, verifyAccountExists, issueToken } from './auth.js'
import { authMiddleware, requireAuth, type AuthRequest } from './middleware.js'
import { deployLimiter, chatLimiter, toolLimiter, readLimiter, authLimiter } from './rateLimiter.js'
import { startSchedule, stopSchedule, stopAllSchedules, validateCron, acquireAgentLock, releaseAgentLock } from './scheduler.js'
import { startPoller, stopPoller } from './eventPoller.js'

dotenv.config()
initMasterKey()
initAuth()

// ─── Global Error Handlers ─────────────────────────
process.on('unhandledRejection', (reason) => {
  console.error('[Aivy] Unhandled rejection:', reason)
})
process.on('uncaughtException', (err) => {
  console.error('[Aivy] Uncaught exception:', err)
  // Give the process a moment to flush logs, then exit
  setTimeout(() => process.exit(1), 1000)
})

const config = {
  port: Number(process.env.SERVER_PORT ?? process.env.PORT ?? 3001),
  network: process.env.HEDERA_NETWORK ?? 'testnet',
  operatorAccountId: process.env.HEDERA_ACCOUNT_ID ?? process.env.ACCOUNT_ID ?? '',
  operatorPrivateKey: process.env.HEDERA_PRIVATE_KEY ?? process.env.PRIVATE_KEY ?? '',
  mirrorNodeUrl:
    process.env.HEDERA_MIRROR_NODE_URL ??
    'https://testnet.mirrornode.hedera.com/api/v1',
}

const capabilityGroupIds = [
  'accounts',
  'accountQueries',
  'consensus',
  'consensusQueries',
  'tokens',
  'tokenQueries',
  'contracts',
  'contractQueries',
  'networkQueries',
  'transactionQueries',
] as const

type CapabilityGroupId = (typeof capabilityGroupIds)[number]
type ActivityTone = 'system' | 'success' | 'vault'

type DeploymentRecord = {
  id: string
  userId: string
  templateId: string
  name: string
  room: string
  guardrail: string
  vaultProtected: boolean
  capabilityGroups: CapabilityGroupId[]
  status: 'deploying' | 'guarded' | 'active' | 'paused'
  lastAction: string
  executions: number
  createdAt: string
  topicId: string | null
  contractId: string | null
  contractAddress: string | null
  deploymentTxId: string | null
  vaultCapHbar: number
  agentAccountId: string | null
  agentPrivateKey: string | null
  walletType: 'platform' | 'dedicated'
}

type ToolResponse = {
  raw?: Record<string, unknown>
  humanMessage?: string
}

type ToolCatalogGroup = {
  id: CapabilityGroupId
  label: string
  description: string
  tone: 'teal' | 'amber' | 'blue' | 'rose'
  tools: string[]
}

type ToolCatalogEntry = {
  name: string
  label: string
  groupId: CapabilityGroupId
  description: string
  parameterHints: string[]
  example: Record<string, unknown>
  kind: 'query' | 'mutation'
  form?: ToolFormDefinition
}

type ToolFormField = {
  id: string
  label: string
  input:
    | 'text'
    | 'number'
    | 'textarea'
    | 'boolean'
    | 'select'
    | 'lineList'
    | 'hbarTransfers'
  required?: boolean
  placeholder?: string
  help?: string
  options?: Array<{ label: string; value: string }>
}

type ToolFormDefinition = {
  fields: ToolFormField[]
}

type ToolWorkflow = {
  id: string
  title: string
  description: string
  toolName: string
  params: Record<string, unknown>
}

type ResultReference = {
  type: 'transaction' | 'topic' | 'contract' | 'token' | 'account' | 'address'
  label: string
  value: string
  url: string
}

const capabilityGroupSchema = z.enum(capabilityGroupIds)

const VALID_TEMPLATE_IDS = ['treasury-sentinel', 'yield-router', 'compliance-clerk', 'governance-relay'] as const

const deploymentSchema = z.object({
  templateId: z.enum(VALID_TEMPLATE_IDS),
  name: z.string().min(2).max(80),
  room: z.string().min(1).max(120),
  guardrail: z.string().min(1).max(500),
  vaultProtected: z.boolean(),
  vaultCapHbar: z.number().min(0).max(100000).optional(),
  launchNote: z.string().max(240).optional(),
  capabilityGroups: z.array(capabilityGroupSchema).min(1),
  walletType: z.enum(['platform', 'dedicated']).optional().default('platform'),
  initialFundingHbar: z.number().min(1).max(1000).optional(),
  fundingSource: z.enum(['platform', 'wallet']).optional().default('platform'),
})

const runAgentSchema = z.object({
  action: z.string().min(2).max(120).optional(),
  amountHbar: z.number().min(0).max(500).optional(),
  targetAccountId: z.string().min(3).max(50).optional(),
})

const pauseSchema = z.object({
  paused: z.boolean(),
})

const invokeToolSchema = z.object({
  params: z.record(z.string(), z.unknown()).default({}),
})

const AIVY_VAULT_SOURCE = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract AivyVault {
    address public owner;
    string public agentName;
    string public hederaAccountId;
    uint256 public spendingCapTinybar;
    bool public paused;
    string public policyLabel;

    event VaultProvisioned(string agentName, string hederaAccountId, uint256 spendingCapTinybar, string policyLabel);
    event GuardrailsUpdated(uint256 spendingCapTinybar, bool paused, string policyLabel);
    event ExecutionLogged(string action, uint256 amountTinybar, string targetAccountId, string note);

    modifier onlyOwner() {
        require(msg.sender == owner, "owner only");
        _;
    }

    constructor(
        string memory _agentName,
        string memory _hederaAccountId,
        uint256 _spendingCapTinybar,
        string memory _policyLabel
    ) payable {
        owner = msg.sender;
        agentName = _agentName;
        hederaAccountId = _hederaAccountId;
        spendingCapTinybar = _spendingCapTinybar;
        policyLabel = _policyLabel;
        emit VaultProvisioned(_agentName, _hederaAccountId, _spendingCapTinybar, _policyLabel);
    }

    function updateGuardrails(
        uint256 _spendingCapTinybar,
        bool _paused,
        string calldata _policyLabel
    ) external onlyOwner {
        spendingCapTinybar = _spendingCapTinybar;
        paused = _paused;
        policyLabel = _policyLabel;
        emit GuardrailsUpdated(_spendingCapTinybar, _paused, _policyLabel);
    }

    function logExecution(
        string calldata action,
        uint256 amountTinybar,
        string calldata targetAccountId,
        string calldata note
    ) external onlyOwner {
        require(!paused, "vault paused");
        require(amountTinybar <= spendingCapTinybar, "cap exceeded");
        emit ExecutionLogged(action, amountTinybar, targetAccountId, note);
    }

    receive() external payable {}
}
`

// Migrate old JSON deployments to SQLite on first run
db.migrateFromJson()
const startupDeployments = db.getAllDeployments()
console.log(`[Aivy] ${startupDeployments.length} agent(s) loaded from database.`)

// ─── Chat (OpenAI) ───────────────────────────────
const chatEnabled = !!process.env.OPENAI_API_KEY
const openai = chatEnabled ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null

const templateMissions: Record<string, { tagline: string; mission: string }> = {
  'treasury-sentinel': {
    tagline: 'Treasury Management Agent',
    mission: 'Monitor treasury balances, transfer HBAR safely, and log every action through the vault.',
  },
  'yield-router': {
    tagline: 'DeFi & Token Agent',
    mission: 'Create and manage tokens, route liquidity, and handle ERC20/ERC721 contracts on Hedera.',
  },
  'compliance-clerk': {
    tagline: 'Audit & Compliance Agent',
    mission: 'Inspect transactions, verify account activity, and ensure policy compliance through read-only queries.',
  },
  'governance-relay': {
    tagline: 'Governance & Coordination Agent',
    mission: 'Manage HCS topics, coordinate proposals, and handle scheduled transactions for governance flows.',
  },
}

function buildAgentSystemPrompt(deployment: DeploymentRecord, userAccountId?: string): string {
  const tmpl = templateMissions[deployment.templateId] ?? {
    tagline: 'Hedera AI Agent',
    mission: 'Help the user interact with the Hedera blockchain.',
  }

  const agentWalletLines = deployment.walletType === 'dedicated' && deployment.agentAccountId
    ? [
        `Agent Wallet: ${deployment.agentAccountId} (this agent's own Hedera account)`,
        'This agent operates with its own dedicated wallet and balance.',
      ]
    : []

  const accountLines = userAccountId
    ? [
        `User's Connected Wallet: ${userAccountId} (use for "my" queries — balance, tokens, account info)`,
        `Backend Operator: ${config.operatorAccountId} (used for signing transactions)`,
        ...agentWalletLines,
        '',
        `IMPORTANT: When the user asks about "my balance", "my tokens", or "my account", always use the user's connected wallet: ${userAccountId}.`,
        `For any tool that requires an accountId parameter, default to "${userAccountId}" unless the user specifies a different account.`,
      ]
    : [
        `Operator Account: ${config.operatorAccountId}`,
        ...agentWalletLines,
        '',
        'IMPORTANT: When the user asks about "my balance" or "my account", always use the operator account ID above.',
        `For any tool that requires an accountId parameter, use "${config.operatorAccountId}" unless the user specifies a different account.`,
      ]

  return [
    `You are ${deployment.name}, a ${tmpl.tagline} deployed on the Hedera blockchain via Aivy.`,
    '',
    `Mission: ${tmpl.mission}`,
    `Guardrail: ${deployment.guardrail}`,
    deployment.vaultProtected
      ? `Vault: Protected with a ${deployment.vaultCapHbar} HBAR spending cap`
      : 'Vault: No vault contract (direct execution)',
    ...accountLines,
    deployment.topicId ? `Audit Topic: ${deployment.topicId}` : '',
    deployment.contractId ? `Vault Contract: ${deployment.contractId}` : '',
    '',
    'You have access to Hedera blockchain tools. Use them to help the user with on-chain operations.',
    'Always explain what you are doing and why. If a tool execution fails, explain the error clearly.',
    '',
    '## SPENDING CAP ENFORCEMENT',
    deployment.vaultProtected
      ? [
          `Your vault spending cap is ${deployment.vaultCapHbar} HBAR.`,
          'Before executing ANY transfer or token operation that costs HBAR:',
          `1. Check if the amount exceeds ${deployment.vaultCapHbar} HBAR`,
          '2. If it does, REFUSE the operation and warn the user: "This exceeds my vault spending cap of X HBAR. Please reduce the amount or adjust the cap."',
          '3. For borderline amounts (>80% of cap), warn the user but proceed if they confirm.',
          'This is a hard security boundary — never bypass it.',
        ].join('\n')
      : 'No spending cap enforced (vault not active).',
    '',
    'Be concise but informative. Format amounts clearly (e.g., "142.5 HBAR").',
    'When you return tool results, summarize them in a human-friendly way.',
    `For any tool that requires a topicId, use "${deployment.topicId ?? 'none yet'}" unless specified.`,
  ]
    .filter(Boolean)
    .join('\n')
}

function inferJsonSchema(example: Record<string, unknown>): Record<string, unknown> {
  const properties: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(example)) {
    if (Array.isArray(value)) {
      if (value.length > 0 && typeof value[0] === 'object' && value[0] !== null) {
        properties[key] = {
          type: 'array',
          description: `Array of ${key} items`,
          items: { type: 'object', properties: inferJsonSchema(value[0] as Record<string, unknown>) },
        }
      } else {
        properties[key] = {
          type: 'array',
          description: `Array of ${key}`,
          items: { type: typeof (value[0] ?? 'string') },
        }
      }
    } else if (typeof value === 'number') {
      properties[key] = { type: 'number', description: key }
    } else if (typeof value === 'boolean') {
      properties[key] = { type: 'boolean', description: key }
    } else if (typeof value === 'object' && value !== null) {
      properties[key] = {
        type: 'object',
        description: key,
        properties: inferJsonSchema(value as Record<string, unknown>),
      }
    } else {
      properties[key] = { type: 'string', description: key }
    }
  }
  return properties
}

function buildOpenAITools(agentTools: ToolCatalogEntry[], userAccountId?: string): OpenAI.ChatCompletionTool[] {
  const defaultAccount = userAccountId || config.operatorAccountId

  return agentTools.map((tool) => {
    const schema = Object.keys(tool.example).length > 0
      ? inferJsonSchema(tool.example)
      : {}

    // Use parameterHints as additional property descriptions
    for (const hint of tool.parameterHints) {
      const colonIdx = hint.indexOf(':')
      if (colonIdx > 0) {
        const paramName = hint.slice(0, colonIdx).trim().replace(/[()]/g, '').replace(/\s+/g, '_')
        const paramDesc = hint.slice(colonIdx + 1).trim()
        if (schema[paramName] && typeof schema[paramName] === 'object') {
          (schema[paramName] as Record<string, unknown>).description = paramDesc
        }
      }
    }

    // Inject the correct default account into accountId descriptions
    if (schema['accountId'] && typeof schema['accountId'] === 'object') {
      const accountLabel = userAccountId ? "user's connected wallet" : 'operator account'
      ;(schema['accountId'] as Record<string, unknown>).description =
        `Hedera account ID (format: 0.0.XXXX). The ${accountLabel} is ${defaultAccount}. Use this when the user refers to "my account" or "my balance".`
    }

    // Inject real context into topicId descriptions
    if (schema['topicId'] && typeof schema['topicId'] === 'object') {
      (schema['topicId'] as Record<string, unknown>).description =
        `Hedera Consensus Service topic ID (format: 0.0.XXXX). Check the system prompt for the agent's audit topic.`
    }

    return {
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description.slice(0, 1024),
        parameters: {
          type: 'object',
          properties: schema,
        },
      },
    }
  })
}

const allAccountTools = Object.values(coreAccountPluginToolNames)
const allAccountQueryTools = Object.values(coreAccountQueryPluginToolNames)
const allConsensusTools = Object.values(coreConsensusPluginToolNames)
const allConsensusQueryTools = Object.values(coreConsensusQueryPluginToolNames)
const allTokenTools = Object.values(coreTokenPluginToolNames)
const allTokenQueryTools = Object.values(coreTokenQueryPluginToolNames)
const allEvmTools = Object.values(coreEVMPluginToolNames)
const allEvmQueryTools = Object.values(coreEVMQueryPluginToolNames)
const allMiscQueryTools = Object.values(coreMiscQueriesPluginsToolNames)
const allTransactionQueryTools = Object.values(coreTransactionQueryPluginToolNames)

const capabilityGroups: ToolCatalogGroup[] = [
  {
    id: 'accounts',
    label: 'Accounts',
    description: 'HBAR transfers, allowances, account lifecycle, and scheduled signatures.',
    tone: 'amber',
    tools: allAccountTools,
  },
  {
    id: 'accountQueries',
    label: 'Account Queries',
    description: 'Balances, account profiles, and token balances.',
    tone: 'blue',
    tools: allAccountQueryTools,
  },
  {
    id: 'consensus',
    label: 'Consensus',
    description: 'Create, update, delete, and publish to HCS topics.',
    tone: 'teal',
    tools: allConsensusTools,
  },
  {
    id: 'consensusQueries',
    label: 'Consensus Queries',
    description: 'Inspect topic info and recent messages.',
    tone: 'blue',
    tools: allConsensusQueryTools,
  },
  {
    id: 'tokens',
    label: 'Tokens',
    description: 'Create, mint, airdrop, associate, transfer, and update HTS assets.',
    tone: 'teal',
    tools: allTokenTools,
  },
  {
    id: 'tokenQueries',
    label: 'Token Queries',
    description: 'Check token details and pending airdrops.',
    tone: 'blue',
    tools: allTokenQueryTools,
  },
  {
    id: 'contracts',
    label: 'Contracts',
    description: 'Create ERC contracts and transfer EVM assets.',
    tone: 'rose',
    tools: allEvmTools,
  },
  {
    id: 'contractQueries',
    label: 'Contract Queries',
    description: 'Inspect contract information on Hedera.',
    tone: 'blue',
    tools: allEvmQueryTools,
  },
  {
    id: 'networkQueries',
    label: 'Network Queries',
    description: 'Check exchange rates and network-side reference data.',
    tone: 'blue',
    tools: allMiscQueryTools,
  },
  {
    id: 'transactionQueries',
    label: 'Transaction Queries',
    description: 'Inspect transaction records after execution.',
    tone: 'blue',
    tools: allTransactionQueryTools,
  },
]

const defaultCapabilityGroupsByTemplate: Record<string, CapabilityGroupId[]> = {
  'treasury-sentinel': [
    'accounts',
    'accountQueries',
    'consensus',
    'consensusQueries',
    'transactionQueries',
    'networkQueries',
  ],
  'yield-router': [
    'accounts',
    'accountQueries',
    'tokens',
    'tokenQueries',
    'contracts',
    'contractQueries',
    'transactionQueries',
    'networkQueries',
  ],
  'compliance-clerk': [
    'accountQueries',
    'consensusQueries',
    'tokenQueries',
    'contractQueries',
    'transactionQueries',
    'networkQueries',
  ],
  'governance-relay': [
    'accounts',
    'accountQueries',
    'consensus',
    'consensusQueries',
    'transactionQueries',
    'networkQueries',
  ],
}

const suggestedToolsByTemplate: Record<string, string[]> = {
  'treasury-sentinel': [
    coreAccountPluginToolNames.TRANSFER_HBAR_TOOL,
    coreAccountQueryPluginToolNames.GET_HBAR_BALANCE_QUERY_TOOL,
    coreConsensusPluginToolNames.CREATE_TOPIC_TOOL,
    coreConsensusPluginToolNames.SUBMIT_TOPIC_MESSAGE_TOOL,
  ],
  'yield-router': [
    coreTokenPluginToolNames.CREATE_FUNGIBLE_TOKEN_TOOL,
    coreTokenPluginToolNames.MINT_FUNGIBLE_TOKEN_TOOL,
    coreEVMPluginToolNames.CREATE_ERC20_TOOL,
    coreEVMPluginToolNames.TRANSFER_ERC20_TOOL,
  ],
  'compliance-clerk': [
    coreAccountQueryPluginToolNames.GET_ACCOUNT_QUERY_TOOL,
    coreTransactionQueryPluginToolNames.GET_TRANSACTION_RECORD_QUERY_TOOL,
    coreConsensusQueryPluginToolNames.GET_TOPIC_MESSAGES_QUERY_TOOL,
  ],
  'governance-relay': [
    coreConsensusPluginToolNames.CREATE_TOPIC_TOOL,
    coreConsensusPluginToolNames.UPDATE_TOPIC_TOOL,
    coreAccountPluginToolNames.SIGN_SCHEDULE_TRANSACTION_TOOL,
    coreAccountPluginToolNames.SCHEDULE_DELETE_TOOL,
  ],
}

const toolNameToGroup = new Map<string, CapabilityGroupId>(
  capabilityGroups.flatMap((group) => group.tools.map((tool) => [tool, group.id] as const)),
)

const allToolNames = capabilityGroups.flatMap((group) => group.tools)
const queryGroupIds = new Set<CapabilityGroupId>([
  'accountQueries',
  'consensusQueries',
  'tokenQueries',
  'contractQueries',
  'networkQueries',
  'transactionQueries',
])

const toolExampleMap: Record<string, Record<string, unknown>> = {
  transfer_hbar_tool: {
    transfers: [{ accountId: '0.0.1234', amount: 1 }],
  },
  create_account_tool: {
    initialBalance: 1,
    accountMemo: 'Aivy managed account',
  },
  create_topic_tool: {
    topicMemo: 'Aivy workflow topic',
  },
  submit_topic_message_tool: {
    topicId: '0.0.1234',
    message: 'Hello from Aivy',
  },
  get_hbar_balance_query_tool: {
    accountId: '0.0.1234',
  },
  get_account_query_tool: {
    accountId: '0.0.1234',
  },
  get_account_token_balances_query_tool: {
    accountId: '0.0.1234',
  },
  create_fungible_token_tool: {
    tokenName: 'Aivy Credit',
    tokenSymbol: 'AIVY',
    initialSupply: 1000,
    decimals: 2,
  },
  mint_fungible_token_tool: {
    tokenId: '0.0.1234',
    amount: 250,
  },
  create_non_fungible_token_tool: {
    tokenName: 'Aivy Pass',
    tokenSymbol: 'PASS',
  },
  mint_non_fungible_token_tool: {
    tokenId: '0.0.1234',
    metadata: ['https://example.com/metadata/1.json'],
  },
  airdrop_fungible_token_tool: {
    tokenId: '0.0.1234',
    transfers: [{ accountId: '0.0.5678', amount: 25 }],
  },
  associate_token_tool: {
    accountId: '0.0.1234',
    tokenIds: ['0.0.5678'],
  },
  update_topic_tool: {
    topicId: '0.0.1234',
    topicMemo: 'Updated topic memo',
  },
  get_topic_info_query_tool: {
    topicId: '0.0.1234',
  },
  get_token_info_query_tool: {
    tokenId: '0.0.1234',
  },
  create_erc20_tool: {
    tokenName: 'Aivy ERC20',
    tokenSymbol: 'N20',
    initialSupply: 1000,
  },
  create_erc721_tool: {
    tokenName: 'Aivy ERC721',
    tokenSymbol: 'N721',
    baseURI: 'https://example.com/nft/',
  },
  mint_erc721_tool: {
    contractId: '0.0.1234',
    metadata: ['https://example.com/nft/1.json'],
  },
  transfer_erc20_tool: {
    contractId: '0.0.1234',
    toAddress: '0.0.5678',
    amount: 10,
  },
  transfer_erc721_tool: {
    contractId: '0.0.1234',
    toAddress: '0x44f7769bfb6e872f491ccf0b655bee8c06a640a0',
    tokenId: 1,
  },
  get_contract_info_query_tool: {
    contractId: '0.0.1234',
  },
  get_exchange_rate_tool: {},
  get_transaction_record_query_tool: {
    transactionId: `${config.operatorAccountId}@1234567890.000000000`,
  },
}

const visualFormMap: Record<string, ToolFormDefinition> = {
  transfer_hbar_tool: {
    fields: [
      {
        id: 'transfers',
        label: 'Transfers',
        input: 'hbarTransfers',
        required: true,
        help: 'Add one or more recipients and amounts in HBAR.',
      },
      {
        id: 'sourceAccountId',
        label: 'Source account',
        input: 'text',
        placeholder: 'Defaults to backend operator',
      },
      {
        id: 'transactionMemo',
        label: 'Transaction memo',
        input: 'text',
      },
    ],
  },
  get_hbar_balance_query_tool: {
    fields: [
      {
        id: 'accountId',
        label: 'Account ID',
        input: 'text',
        placeholder: '0.0.1234',
      },
    ],
  },
  get_account_query_tool: {
    fields: [
      {
        id: 'accountId',
        label: 'Account ID',
        input: 'text',
        placeholder: '0.0.1234',
      },
    ],
  },
  get_account_token_balances_query_tool: {
    fields: [
      {
        id: 'accountId',
        label: 'Account ID',
        input: 'text',
        required: true,
        placeholder: '0.0.1234',
      },
    ],
  },
  create_account_tool: {
    fields: [
      {
        id: 'initialBalance',
        label: 'Initial balance',
        input: 'number',
        placeholder: '0',
      },
      {
        id: 'accountMemo',
        label: 'Account memo',
        input: 'text',
      },
      {
        id: 'maxAutomaticTokenAssociations',
        label: 'Max token associations',
        input: 'number',
        placeholder: '-1',
      },
    ],
  },
  create_topic_tool: {
    fields: [
      {
        id: 'topicMemo',
        label: 'Topic memo',
        input: 'text',
      },
      {
        id: 'transactionMemo',
        label: 'Transaction memo',
        input: 'text',
      },
      {
        id: 'isSubmitKey',
        label: 'Require submit key',
        input: 'boolean',
      },
    ],
  },
  update_topic_tool: {
    fields: [
      {
        id: 'topicId',
        label: 'Topic ID',
        input: 'text',
        required: true,
      },
      {
        id: 'topicMemo',
        label: 'Topic memo',
        input: 'text',
      },
      {
        id: 'transactionMemo',
        label: 'Transaction memo',
        input: 'text',
      },
    ],
  },
  submit_topic_message_tool: {
    fields: [
      {
        id: 'topicId',
        label: 'Topic ID',
        input: 'text',
        required: true,
        placeholder: '0.0.1234',
      },
      {
        id: 'message',
        label: 'Message',
        input: 'textarea',
        required: true,
      },
      {
        id: 'transactionMemo',
        label: 'Transaction memo',
        input: 'text',
      },
    ],
  },
  get_topic_messages_query_tool: {
    fields: [
      {
        id: 'topicId',
        label: 'Topic ID',
        input: 'text',
        required: true,
      },
    ],
  },
  get_topic_info_query_tool: {
    fields: [
      {
        id: 'topicId',
        label: 'Topic ID',
        input: 'text',
        required: true,
      },
    ],
  },
  create_fungible_token_tool: {
    fields: [
      {
        id: 'tokenName',
        label: 'Token name',
        input: 'text',
        required: true,
      },
      {
        id: 'tokenSymbol',
        label: 'Symbol',
        input: 'text',
      },
      {
        id: 'initialSupply',
        label: 'Initial supply',
        input: 'number',
      },
      {
        id: 'decimals',
        label: 'Decimals',
        input: 'number',
      },
      {
        id: 'supplyType',
        label: 'Supply type',
        input: 'select',
        options: [
          { label: 'Finite', value: 'finite' },
          { label: 'Infinite', value: 'infinite' },
        ],
      },
      {
        id: 'treasuryAccountId',
        label: 'Treasury account',
        input: 'text',
      },
      {
        id: 'isSupplyKey',
        label: 'Use supply key',
        input: 'boolean',
      },
    ],
  },
  mint_fungible_token_tool: {
    fields: [
      {
        id: 'tokenId',
        label: 'Token ID',
        input: 'text',
        required: true,
      },
      {
        id: 'amount',
        label: 'Amount',
        input: 'number',
        required: true,
      },
    ],
  },
  airdrop_fungible_token_tool: {
    fields: [
      {
        id: 'tokenId',
        label: 'Token ID',
        input: 'text',
        required: true,
      },
      {
        id: 'transfers',
        label: 'Recipients',
        input: 'hbarTransfers',
        required: true,
        help: 'Add one or more recipient rows with token amounts.',
      },
    ],
  },
  create_non_fungible_token_tool: {
    fields: [
      {
        id: 'tokenName',
        label: 'Collection name',
        input: 'text',
        required: true,
      },
      {
        id: 'tokenSymbol',
        label: 'Symbol',
        input: 'text',
        required: true,
      },
      {
        id: 'supplyType',
        label: 'Supply type',
        input: 'select',
        options: [
          { label: 'Finite', value: 'finite' },
          { label: 'Infinite', value: 'infinite' },
        ],
      },
      {
        id: 'maxSupply',
        label: 'Max supply',
        input: 'number',
      },
      {
        id: 'treasuryAccountId',
        label: 'Treasury account',
        input: 'text',
      },
      {
        id: 'isSupplyKey',
        label: 'Use supply key',
        input: 'boolean',
      },
    ],
  },
  mint_non_fungible_token_tool: {
    fields: [
      {
        id: 'tokenId',
        label: 'Token ID',
        input: 'text',
        required: true,
      },
      {
        id: 'metadata',
        label: 'Metadata entries',
        input: 'lineList',
        required: true,
        help: 'Paste one metadata URI or blob per line.',
      },
    ],
  },
  associate_token_tool: {
    fields: [
      {
        id: 'accountId',
        label: 'Account ID',
        input: 'text',
        required: true,
      },
      {
        id: 'tokenIds',
        label: 'Token IDs',
        input: 'lineList',
        required: true,
        help: 'Paste one token ID per line.',
      },
    ],
  },
  get_token_info_query_tool: {
    fields: [
      {
        id: 'tokenId',
        label: 'Token ID',
        input: 'text',
        required: true,
      },
    ],
  },
  create_erc20_tool: {
    fields: [
      {
        id: 'tokenName',
        label: 'Token name',
        input: 'text',
        required: true,
      },
      {
        id: 'tokenSymbol',
        label: 'Symbol',
        input: 'text',
        required: true,
      },
      {
        id: 'initialSupply',
        label: 'Initial supply',
        input: 'number',
      },
      {
        id: 'decimals',
        label: 'Decimals',
        input: 'number',
      },
    ],
  },
  create_erc721_tool: {
    fields: [
      {
        id: 'tokenName',
        label: 'Collection name',
        input: 'text',
        required: true,
      },
      {
        id: 'tokenSymbol',
        label: 'Symbol',
        input: 'text',
        required: true,
      },
      {
        id: 'baseURI',
        label: 'Base URI',
        input: 'text',
      },
    ],
  },
  mint_erc721_tool: {
    fields: [
      {
        id: 'contractId',
        label: 'Contract ID',
        input: 'text',
        required: true,
      },
      {
        id: 'metadata',
        label: 'Metadata entries',
        input: 'lineList',
        required: true,
        help: 'Paste one metadata URI or blob per line.',
      },
    ],
  },
  transfer_erc20_tool: {
    fields: [
      {
        id: 'contractId',
        label: 'Contract ID',
        input: 'text',
        required: true,
      },
      {
        id: 'toAddress',
        label: 'Recipient address',
        input: 'text',
        required: true,
      },
      {
        id: 'amount',
        label: 'Amount',
        input: 'number',
        required: true,
      },
      {
        id: 'fromAddress',
        label: 'Source address',
        input: 'text',
      },
    ],
  },
  transfer_erc721_tool: {
    fields: [
      {
        id: 'contractId',
        label: 'Contract ID',
        input: 'text',
        required: true,
      },
      {
        id: 'toAddress',
        label: 'Recipient address',
        input: 'text',
        required: true,
      },
      {
        id: 'tokenId',
        label: 'Token ID',
        input: 'number',
        required: true,
      },
      {
        id: 'fromAddress',
        label: 'Source address',
        input: 'text',
      },
    ],
  },
  get_contract_info_query_tool: {
    fields: [
      {
        id: 'contractId',
        label: 'Contract ID',
        input: 'text',
        required: true,
      },
    ],
  },
  get_exchange_rate_tool: {
    fields: [],
  },
  get_transaction_record_query_tool: {
    fields: [
      {
        id: 'transactionId',
        label: 'Transaction ID',
        input: 'text',
        required: true,
      },
    ],
  },
}

const workflowsByTemplate: Record<string, ToolWorkflow[]> = {
  'treasury-sentinel': [
    {
      id: 'treasury-balance',
      title: 'Check treasury balance',
      description: 'Inspect the operator treasury HBAR balance.',
      toolName: 'get_hbar_balance_query_tool',
      params: {
        accountId: '{{operatorAccountId}}',
      },
    },
    {
      id: 'treasury-transfer',
      title: 'Send HBAR',
      description: 'Prepare a treasury transfer with one recipient row.',
      toolName: 'transfer_hbar_tool',
      params: {
        transfers: [{ accountId: '', amount: 1 }],
      },
    },
    {
      id: 'treasury-note',
      title: 'Publish audit note',
      description: 'Write a treasury note to the current agent topic.',
      toolName: 'submit_topic_message_tool',
      params: {
        topicId: '{{selectedAgent.topicId}}',
        message: 'Treasury note',
      },
    },
  ],
  'yield-router': [
    {
      id: 'yield-ft-create',
      title: 'Create reward token',
      description: 'Create a fungible HTS token for rewards or routing.',
      toolName: 'create_fungible_token_tool',
      params: {
        tokenName: 'Yield Credit',
        tokenSymbol: 'YLD',
        initialSupply: 1000,
        decimals: 2,
        supplyType: 'finite',
      },
    },
    {
      id: 'yield-ft-mint',
      title: 'Mint supply',
      description: 'Mint more supply into an existing fungible token.',
      toolName: 'mint_fungible_token_tool',
      params: {
        tokenId: '',
        amount: 250,
      },
    },
    {
      id: 'yield-erc20',
      title: 'Deploy ERC20',
      description: 'Create an EVM-compatible ERC20 liquidity rail.',
      toolName: 'create_erc20_tool',
      params: {
        tokenName: 'Yield Rail',
        tokenSymbol: 'YR',
        initialSupply: 1000,
      },
    },
  ],
  'compliance-clerk': [
    {
      id: 'compliance-account',
      title: 'Inspect account',
      description: 'Review an account record before an operation.',
      toolName: 'get_account_query_tool',
      params: {
        accountId: '{{operatorAccountId}}',
      },
    },
    {
      id: 'compliance-topic',
      title: 'Read topic messages',
      description: 'Inspect the most recent consensus messages.',
      toolName: 'get_topic_messages_query_tool',
      params: {
        topicId: '{{selectedAgent.topicId}}',
      },
    },
    {
      id: 'compliance-tx',
      title: 'Review transaction',
      description: 'Load a transaction record for audit.',
      toolName: 'get_transaction_record_query_tool',
      params: {
        transactionId: '{{selectedAgent.deploymentTxId}}',
      },
    },
  ],
  'governance-relay': [
    {
      id: 'governance-topic',
      title: 'Create proposal topic',
      description: 'Open a new governance topic for a proposal thread.',
      toolName: 'create_topic_tool',
      params: {
        topicMemo: 'Proposal topic',
        transactionMemo: 'Aivy governance launch',
      },
    },
    {
      id: 'governance-message',
      title: 'Publish proposal note',
      description: 'Submit a governance update into the agent topic.',
      toolName: 'submit_topic_message_tool',
      params: {
        topicId: '{{selectedAgent.topicId}}',
        message: 'Proposal opened for review',
      },
    },
    {
      id: 'governance-lookup',
      title: 'Lookup execution record',
      description: 'Inspect the most recent execution record.',
      toolName: 'get_transaction_record_query_tool',
      params: {
        transactionId: '{{selectedAgent.deploymentTxId}}',
      },
    },
  ],
}

const formatTimestamp = (date = new Date()) =>
  new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date)

const pushActivity = (label: string, tone: ActivityTone) => {
  const id = `evt-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
  db.pushActivity(id, label, tone, formatTimestamp())
}

const isConfigured = Boolean(config.operatorAccountId && config.operatorPrivateKey)
const demoMode = !isConfigured

// ─── Validation Helper ────────────────────────────
function flattenZodError(zodError: z.ZodError): string {
  const issues = zodError.issues.map((i) => `${i.path.join('.')}: ${i.message}`)
  return issues.join('; ') || 'Validation failed.'
}

// ─── Ownership Helper ─────────────────────────────
// Checks that the authenticated user owns the agent (or it's a shared demo/legacy agent)
const SHARED_USER_IDS = new Set(['demo', 'legacy', 'anonymous'])

function assertAgentOwnership(
  deployment: { userId: string },
  req: import('express').Request,
): boolean {
  if (SHARED_USER_IDS.has(deployment.userId)) return true
  const authReq = req as AuthRequest
  return authReq.userId === deployment.userId
}

const createClient = () => {
  if (!isConfigured) {
    throw new Error('Hedera credentials are missing.')
  }

  const client =
    config.network === 'mainnet' ? Client.forMainnet() : Client.forTestnet()

  const privateKey = config.operatorPrivateKey.startsWith('0x')
    ? PrivateKey.fromStringECDSA(config.operatorPrivateKey)
    : config.operatorPrivateKey.startsWith('302e')
      ? PrivateKey.fromStringECDSA(config.operatorPrivateKey)
      : PrivateKey.fromString(config.operatorPrivateKey)

  client.setOperator(config.operatorAccountId, privateKey)

  return client
}

const client = isConfigured ? createClient() : null

/** Create a brand-new Hedera account funded from the operator for a dedicated agent. */
const createAgentAccount = async (initialHbar = 1): Promise<{ accountId: string; privateKey: string }> => {
  if (!client) throw new Error('Hedera client is not configured.')

  const agentKey = PrivateKey.generateECDSA()
  const tx = await new AccountCreateTransaction()
    .setKey(agentKey.publicKey)
    .setInitialBalance(new Hbar(initialHbar))
    .setTransactionMemo('Aivy agent account')
    .execute(client)

  const receipt = await tx.getReceipt(client)
  const accountId = receipt.accountId?.toString()
  if (!accountId) throw new Error('Account creation receipt missing accountId.')

  return { accountId, privateKey: agentKey.toStringRaw() }
}

/** Build a Hedera Client configured with a per-agent key pair. */
const createAgentClient = (accountId: string, privateKey: string): Client => {
  const agentClient = config.network === 'mainnet' ? Client.forMainnet() : Client.forTestnet()
  let key: PrivateKey
  try {
    key = PrivateKey.fromStringECDSA(privateKey)
  } catch (err) {
    const hint = privateKey.includes(':')
      ? ' The stored key appears to be encrypted — check that MASTER_ENCRYPTION_KEY in .env matches the key used when the agent was created.'
      : ''
    throw new Error(
      `Failed to parse private key for agent account ${accountId}.${hint} (${err instanceof Error ? err.message : String(err)})`,
    )
  }
  agentClient.setOperator(accountId, key)
  return agentClient
}

const compileVault = () => {
  const input = {
    language: 'Solidity',
    sources: {
      'AivyVault.sol': {
        content: AIVY_VAULT_SOURCE,
      },
    },
    settings: {
      outputSelection: {
        '*': {
          '*': ['abi', 'evm.bytecode.object'],
        },
      },
    },
  }

  const output = JSON.parse(solc.compile(JSON.stringify(input))) as {
    contracts?: {
      'AivyVault.sol'?: {
        AivyVault?: {
          abi: unknown[]
          evm: {
            bytecode: {
              object: string
            }
          }
        }
      }
    }
    errors?: Array<{ severity: string; formattedMessage: string }>
  }

  const errors = output.errors?.filter((item) => item.severity === 'error') ?? []
  if (errors.length > 0) {
    throw new Error(errors.map((item) => item.formattedMessage).join('\n'))
  }

  const contract = output.contracts?.['AivyVault.sol']?.AivyVault
  if (!contract?.evm.bytecode.object) {
    throw new Error('Failed to compile AivyVault contract.')
  }

  return {
    abi: contract.abi,
    bytecode: contract.evm.bytecode.object,
  }
}

const compiledVault = compileVault()

const titleCase = (value: string) =>
  value
    .split('_')
    .filter((part) => part !== 'tool' && part !== 'query')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')

const parseParameterHints = (description: string) => {
  const lines = description.split('\n').map((line) => line.trim())
  const start = lines.findIndex((line) => line === 'Parameters:')
  if (start === -1) {
    return []
  }

  const hints: string[] = []
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index]
    if (!line || line.startsWith('Important:') || line.startsWith('Example')) {
      break
    }

    if (line.startsWith('- ')) {
      hints.push(line.slice(2))
    }
  }

  return hints.slice(0, 8)
}

const fallbackToolDescription = (toolName: string) =>
  `${titleCase(toolName)} is available in the current Hedera Agent Kit installation.`

let toolCatalogCache: {
  groups: ToolCatalogGroup[]
  tools: ToolCatalogEntry[]
  suggestedToolsByTemplate: Record<string, string[]>
  defaultCapabilityGroupsByTemplate: Record<string, CapabilityGroupId[]>
  workflowsByTemplate: Record<string, ToolWorkflow[]>
} | null = null

const getToolkit = (tools = allToolNames, agentClient?: Client) => {
  const c = agentClient ?? client
  if (!c) {
    throw new Error('Hedera client is not configured.')
  }

  return new HederaAIToolkit({
    client: c,
    configuration: {
      tools,
      context: {
        mode: AgentMode.AUTONOMOUS,
      },
    },
  })
}

const buildToolCatalog = () => {
  if (toolCatalogCache) {
    return toolCatalogCache
  }

  const runtimeTools = client ? getToolkit().getTools() : {}

  const tools: ToolCatalogEntry[] = allToolNames.map((toolName) => {
    const runtimeTool = runtimeTools[toolName]
    const description = String(runtimeTool?.description ?? fallbackToolDescription(toolName))
      .replace(/\s+/g, ' ')
      .trim()

    return {
      name: toolName,
      label: titleCase(toolName),
      groupId: toolNameToGroup.get(toolName) ?? 'accountQueries',
      description,
      parameterHints: parseParameterHints(String(runtimeTool?.description ?? '')),
      example: toolExampleMap[toolName] ?? {},
      kind: queryGroupIds.has(toolNameToGroup.get(toolName) ?? 'accountQueries')
        ? 'query'
        : 'mutation',
      form: visualFormMap[toolName],
    }
  })

  toolCatalogCache = {
    groups: capabilityGroups,
    tools,
    suggestedToolsByTemplate,
    defaultCapabilityGroupsByTemplate,
    workflowsByTemplate,
  }

  return toolCatalogCache
}

const executeTool = async (toolName: string, params: Record<string, unknown>, agentClient?: Client) => {
  const toolkit = getToolkit(undefined, agentClient)
  const tool = toolkit.getTools()[toolName]
  if (!tool) {
    throw new Error(`Tool ${toolName} is not available.`)
  }

  const execute = tool.execute as unknown as (
    input: Record<string, unknown>,
  ) => Promise<string | ToolResponse>

  const result = await execute(params)

  // HederaAIToolkit wraps results in JSON.stringify — parse back to object
  if (typeof result === 'string') {
    try {
      return JSON.parse(result) as ToolResponse
    } catch {
      return { raw: {}, humanMessage: result } as ToolResponse
    }
  }

  return result as ToolResponse
}

/** Detect HBAR spending from tool name + params */
function detectSpendingAmount(toolName: string, params: Record<string, unknown>): number {
  if (toolName === 'transfer_hbar_tool' && Array.isArray(params.transfers)) {
    return (params.transfers as Array<{ amount?: number }>).reduce(
      (sum, t) => sum + Math.abs(Number(t.amount ?? 0)),
      0,
    )
  }
  if (toolName === 'create_account_tool' && typeof params.initialBalance === 'number') {
    return params.initialBalance
  }
  return 0
}

const makeMirrorUrl = (type: ResultReference['type'], value: string) => {
  const encoded = encodeURIComponent(value)
  switch (type) {
    case 'transaction':
      return `${config.mirrorNodeUrl}/transactions?transaction.id=${encoded}`
    case 'topic':
      return `${config.mirrorNodeUrl}/topics/${encoded}`
    case 'contract':
      return `${config.mirrorNodeUrl}/contracts/${encoded}`
    case 'token':
      return `${config.mirrorNodeUrl}/tokens/${encoded}`
    case 'account':
      return `${config.mirrorNodeUrl}/accounts/${encoded}`
    case 'address':
      return `${config.mirrorNodeUrl}/contracts/${encoded}`
  }
}

/** Convert an SDK entity ID (may be object like {shard,realm,num}) to a dotted string */
const toEntityString = (value: unknown): string => {
  if (!value) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  if (typeof value === 'object' && value !== null) {
    const obj = value as Record<string, unknown>
    // Hedera SDK objects: { shard, realm, num } or Long objects { low, high }
    if ('shard' in obj && 'realm' in obj && 'num' in obj) {
      const s = typeof obj.shard === 'object' ? (obj.shard as Record<string, unknown>)?.low ?? 0 : obj.shard ?? 0
      const r = typeof obj.realm === 'object' ? (obj.realm as Record<string, unknown>)?.low ?? 0 : obj.realm ?? 0
      const n = typeof obj.num === 'object' ? (obj.num as Record<string, unknown>)?.low ?? 0 : obj.num ?? 0
      return `${s}.${r}.${n}`
    }
    // Try toString() if it's an SDK class instance
    const str = String(value)
    if (str !== '[object Object]') return str
    // Last resort: JSON
    return JSON.stringify(value)
  }
  return String(value)
}

const extractResultReferences = (
  raw: Record<string, unknown> | undefined,
): ResultReference[] => {
  if (!raw) {
    return []
  }

  const candidateMap: Array<[string, ResultReference['type'], string]> = [
    ['transactionId', 'transaction', 'Transaction'],
    ['scheduleId', 'transaction', 'Schedule'],
    ['topicId', 'topic', 'Topic'],
    ['contractId', 'contract', 'Contract'],
    ['contractAddress', 'address', 'Contract address'],
    ['tokenId', 'token', 'Token'],
    ['accountId', 'account', 'Account'],
    ['erc20Address', 'address', 'ERC20 address'],
    ['erc721Address', 'address', 'ERC721 address'],
  ]

  return candidateMap.flatMap(([key, type, label]) => {
    const value = raw[key]
    if (!value) {
      return []
    }

    const stringValue = toEntityString(value)
    return [
      {
        type,
        label,
        value: stringValue,
        url: makeMirrorUrl(type, stringValue),
      },
    ]
  })
}

const deployVaultContract = async (
  agentName: string,
  guardrail: string,
  vaultCapHbar: number,
) => {
  if (!client) {
    throw new Error('Hedera client is not configured.')
  }

  const tinybarCap = Math.floor(vaultCapHbar * 100_000_000)
  const transaction = await new ContractCreateFlow()
    .setGas(1_700_000)
    .setBytecode(compiledVault.bytecode)
    .setConstructorParameters(
      new ContractFunctionParameters()
        .addString(agentName)
        .addString(config.operatorAccountId)
        .addUint256(tinybarCap)
        .addString(guardrail),
    )
    .execute(client)
  const receipt = await transaction.getReceipt(client)

  return {
    transactionId: transaction.transactionId.toString(),
    contractId: receipt.contractId?.toString() ?? null,
    contractAddress: receipt.contractId?.toSolidityAddress() ?? null,
  }
}

const updateVaultPauseState = async (
  contractId: string,
  paused: boolean,
  spendingCapHbar: number,
  policyLabel: string,
) => {
  if (!client) {
    throw new Error('Hedera client is not configured.')
  }

  const tinybarCap = Math.floor(spendingCapHbar * 100_000_000)
  const transaction = await new ContractExecuteTransaction()
    .setContractId(ContractId.fromString(contractId))
    .setGas(220_000)
    .setFunction(
      'updateGuardrails',
      new ContractFunctionParameters()
        .addUint256(tinybarCap)
        .addBool(paused)
        .addString(policyLabel),
    )
    .execute(client)
  await transaction.getReceipt(client)
  return {
    transactionId: transaction.transactionId.toString(),
  }
}

const logVaultExecution = async (
  contractId: string,
  action: string,
  amountHbar: number,
  targetAccountId: string,
  note: string,
) => {
  if (!client) {
    throw new Error('Hedera client is not configured.')
  }

  const transaction = await new ContractExecuteTransaction()
    .setContractId(ContractId.fromString(contractId))
    .setGas(220_000)
    .setFunction(
      'logExecution',
      new ContractFunctionParameters()
        .addString(action)
        .addUint256(Math.floor(amountHbar * 100_000_000))
        .addString(targetAccountId)
        .addString(note),
    )
    .execute(client)
  await transaction.getReceipt(client)
  return {
    transactionId: transaction.transactionId.toString(),
  }
}

const fetchWithTimeout = async (url: string | URL, timeoutMs = 5000): Promise<Response> => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

const fetchMirrorTransactions = async () => {
  if (!isConfigured) {
    return []
  }

  try {
    const url = new URL(`${config.mirrorNodeUrl}/transactions`)
    url.searchParams.set('account.id', config.operatorAccountId)
    url.searchParams.set('limit', '6')
    url.searchParams.set('order', 'desc')

    const response = await fetchWithTimeout(url)
    if (!response.ok) {
      return []
    }

    const data = (await response.json()) as {
      transactions?: Array<{
        transaction_id: string
        name: string
        consensus_timestamp: string
        result: string
      }>
    }

    return (data.transactions ?? []).map((transaction) => ({
      id: `mirror-${transaction.transaction_id}`,
      label: `${transaction.name.replaceAll('_', ' ')} -> ${transaction.result}`,
      tone: transaction.result === 'SUCCESS' ? 'success' : 'system',
      timestamp: transaction.consensus_timestamp,
    }))
  } catch {
    return []
  }
}

const fetchTopicMessages = async (topicId: string) => {
  try {
    const response = await fetchWithTimeout(
      `${config.mirrorNodeUrl}/topics/${encodeURIComponent(topicId)}/messages?limit=3&order=desc`,
    )

    if (!response.ok) {
      return []
    }

    const data = (await response.json()) as {
      messages?: Array<{
        consensus_timestamp: string
        message: string
      }>
    }

    return (data.messages ?? []).map((message) => ({
      id: `topic-${topicId}-${message.consensus_timestamp}`,
      label: Buffer.from(message.message, 'base64').toString('utf8'),
      tone: 'vault' as const,
      timestamp: message.consensus_timestamp,
    }))
  } catch {
    return []
  }
}

/** Fetch ALL topic messages (paginated) — used for audit export */
const fetchAllTopicMessages = async (topicId: string) => {
  const allMessages: Array<{
    consensus_timestamp: string
    sequence_number: number
    message: string
  }> = []

  let url: string | null =
    `${config.mirrorNodeUrl}/topics/${encodeURIComponent(topicId)}/messages?limit=100&order=asc`

  try {
    while (url) {
      const resp = await fetchWithTimeout(url, 10000)
      if (!resp.ok) break

      const data = (await resp.json()) as {
        messages?: Array<{
          consensus_timestamp: string
          sequence_number: number
          message: string
        }>
        links?: { next?: string }
      }

      for (const msg of data.messages ?? []) {
        allMessages.push(msg)
      }

      const nextLink = data.links?.next
      if (nextLink && allMessages.length < 500) {
        url = nextLink.startsWith('http')
          ? nextLink
          : `https://testnet.mirrornode.hedera.com${nextLink}`
      } else {
        url = null
      }
    }
  } catch {
    // Return whatever we collected so far
  }

  return allMessages
}

const buildStats = (items?: DeploymentRecord[]) => {
  const deployments = items ?? db.getAllDeployments()

  return {
    connectedAgents: deployments.length,
    safeVaults: deployments.filter((item) => item.vaultProtected).length,
    totalExecutions: deployments.reduce((sum, item) => sum + item.executions, 0),
    pendingTransactions: deployments.filter((item) => item.status === 'deploying').length,
    hbarSecured: Number(
      deployments
        .filter((item) => item.vaultProtected)
        .reduce((sum, item) => sum + item.vaultCapHbar, 0)
        .toFixed(1),
    ),
  }
}

/** Strip agentPrivateKey and userId before sending to frontend */
const safeDeployment = (d: DeploymentRecord) => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { agentPrivateKey, userId: _uid, ...rest } = d
  return rest
}

const buildLivePayload = async (userId?: string | null) => {
  const allItems = db.getAllDeployments()
  // Authenticated users see only their own agents; unauthenticated see empty office
  const deploymentItems = userId && userId !== 'demo' && userId !== 'anonymous'
    ? allItems.filter((d) => d.userId === userId)
    : []
  const topicMessages = await Promise.all(
    deploymentItems
      .filter((item) => item.topicId)
      .slice(0, 2)
      .map((item) => fetchTopicMessages(item.topicId as string)),
  )
  const mirrorTransactions = await fetchMirrorTransactions()
  const recentActivity = db.getActivity(14)

  return {
    configured: isConfigured || demoMode,
    demoMode,
    chatEnabled: chatEnabled || demoMode,
    network: demoMode ? 'testnet' : config.network,
    operatorAccountId: config.operatorAccountId || (demoMode ? demoAccountId : null),
    mirrorNodeUrl: config.mirrorNodeUrl,
    stats: buildStats(deploymentItems),
    deployments: deploymentItems.map(safeDeployment),
    activity: [...recentActivity, ...mirrorTransactions, ...topicMessages.flat()]
      .sort((left, right) => right.timestamp.localeCompare(left.timestamp))
      .slice(0, 14),
    coordinations: coordinationLog.slice(0, 10),
  }
}

const app = express()

app.use(cors())
app.use(express.json())
app.use(authMiddleware(demoMode))

// ─── Auth Routes ────────────────────────────────────
const authChallengeSchema = z.object({ accountId: z.string().regex(/^0\.0\.\d+$/) })

app.post('/api/auth/challenge', authLimiter, (request, response) => {
  const parsed = authChallengeSchema.safeParse(request.body)
  if (!parsed.success) {
    response.status(400).json({ error: 'Invalid account ID format.' })
    return
  }
  const result = generateChallenge(parsed.data.accountId)
  response.json(result)
})

app.post('/api/auth/verify', authLimiter, async (request, response) => {
  const parsed = authChallengeSchema.safeParse(request.body)
  if (!parsed.success) {
    response.status(400).json({ error: 'Invalid account ID format.' })
    return
  }
  const { accountId } = parsed.data
  const nonce = consumeChallenge(accountId)
  if (!nonce) {
    response.status(400).json({ error: 'Invalid or expired challenge. Request a new one.' })
    return
  }

  // Verify the account exists on Hedera
  const exists = demoMode || await verifyAccountExists(accountId, config.mirrorNodeUrl)
  if (!exists) {
    response.status(400).json({ error: 'Account not found on Hedera.' })
    return
  }

  const user = db.getOrCreateUser(accountId)
  const token = issueToken(user.id, accountId)
  response.json({ token, user: { id: user.id, accountId: user.hederaAccountId, displayName: user.displayName } })
})

app.get('/api/live', readLimiter, async (request, response) => {
  try {
    const userId = (request as AuthRequest).userId
    response.json(await buildLivePayload(userId))
  } catch (error) {
    response.status(500).json({
      configured: isConfigured,
      error: error instanceof Error ? error.message : 'Unknown live payload error.',
      stats: buildStats(),
      deployments: [],
      activity: [],
    })
  }
})

app.get('/api/tool-catalog', readLimiter, (_request, response) => {
  try {
    response.json(buildToolCatalog())
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : 'Could not build tool catalog.',
    })
  }
})

app.post('/api/deploy', requireAuth, deployLimiter, async (request, response) => {
  const parsed = deploymentSchema.safeParse(request.body)
  if (!parsed.success) {
    response.status(400).json({ error: flattenZodError(parsed.error) })
    return
  }

  try {
    const {
      templateId,
      name,
      room,
      guardrail,
      vaultProtected,
      vaultCapHbar: requestedVaultCapHbar,
      launchNote,
      capabilityGroups: chosenGroups,
      walletType,
      initialFundingHbar,
      fundingSource,
    } = parsed.data
    const capabilitySelection =
      chosenGroups.length > 0
        ? chosenGroups
        : defaultCapabilityGroupsByTemplate[templateId] ?? ['accountQueries']

    const vaultCapHbar = vaultProtected ? requestedVaultCapHbar ?? 250 : 0

    let topicId = ''
    let deploymentTxId = ''
    let contract = { transactionId: null as string | null, contractId: null as string | null, contractAddress: null as string | null }
    let balanceSnapshot: unknown = null
    let agentAccountId: string | null = null
    let agentPrivateKey: string | null = null

    if (demoMode) {
      // Demo mode: generate fake IDs without hitting Hedera
      topicId = nextDemoTopicId()
      deploymentTxId = nextDemoTxId()
      balanceSnapshot = 142.5
      if (walletType === 'dedicated') {
        agentAccountId = nextDemoAccountId()
        agentPrivateKey = '302e_demo_agent_key_' + agentAccountId
      }
      if (vaultProtected && vaultCapHbar > 0) {
        contract = {
          transactionId: nextDemoTxId(),
          contractId: nextDemoContractId(),
          contractAddress: `0x${Math.random().toString(16).slice(2, 42)}`,
        }
      }
    } else {
      if (!client) {
        response.status(503).json({
          error: 'Hedera credentials are missing. Set HEDERA_ACCOUNT_ID and HEDERA_PRIVATE_KEY in .env.',
        })
        return
      }

      // Create dedicated agent account if requested
      if (walletType === 'dedicated') {
        // Wallet funding: create with minimal balance (user signs HashPack transfer after)
        // Platform funding: capped at 5 HBAR to prevent abuse
        const PLATFORM_FUNDING_CAP = 5
        const creationBalance = fundingSource === 'wallet'
          ? 2
          : Math.min(initialFundingHbar ?? PLATFORM_FUNDING_CAP, PLATFORM_FUNDING_CAP)
        const agentAccount = await createAgentAccount(creationBalance)
        agentAccountId = agentAccount.accountId
        agentPrivateKey = agentAccount.privateKey
        console.log(`[Aivy] Created dedicated agent account: ${agentAccountId} (funding: ${fundingSource}, initial: ${creationBalance} HBAR)`)
      }

      const balanceResult = await executeTool(
        coreAccountQueryPluginToolNames.GET_HBAR_BALANCE_QUERY_TOOL,
        { accountId: config.operatorAccountId },
      )
      const topicResult = await executeTool(
        coreConsensusPluginToolNames.CREATE_TOPIC_TOOL,
        {
          topicMemo: `Aivy audit stream for ${name}`,
          transactionMemo: `Aivy deploy ${templateId}`,
        },
      )

      topicId = toEntityString(topicResult.raw?.topicId)
      deploymentTxId = toEntityString(topicResult.raw?.transactionId)
      balanceSnapshot = balanceResult.raw?.hbarBalance ?? null
      contract =
        vaultProtected && vaultCapHbar > 0
          ? await deployVaultContract(name, guardrail, vaultCapHbar)
          : { transactionId: null, contractId: null, contractAddress: null }

      if (topicId) {
        const walletInfo = agentAccountId ? ` Dedicated wallet: ${agentAccountId}.` : ''
        await executeTool(coreConsensusPluginToolNames.SUBMIT_TOPIC_MESSAGE_TOOL, {
          topicId,
          message: `[Aivy] ${name} deployed in ${room}. Guardrail: ${guardrail}. ${launchNote ? `${launchNote}. ` : ''}Operator balance snapshot: ${balanceResult.raw?.hbarBalance ?? 'unknown'} HBAR.${walletInfo}`,
          transactionMemo: `Aivy launch ${name}`,
        })
      }
    }

    const deployment: DeploymentRecord = {
      id: `${templateId}-${Date.now()}`,
      userId: (request as AuthRequest).userId ?? 'anonymous',
      templateId,
      name,
      room,
      guardrail,
      vaultProtected,
      capabilityGroups: capabilitySelection,
      status: vaultProtected ? 'guarded' : 'active',
      lastAction: vaultProtected
        ? 'Vault contract provisioned and tool library ready'
        : 'Agent launched without vault wrapper',
      executions: 0,
      createdAt: new Date().toISOString(),
      topicId: topicId || null,
      contractId: contract.contractId,
      contractAddress: contract.contractAddress,
      deploymentTxId: deploymentTxId || null,
      vaultCapHbar,
      agentAccountId,
      agentPrivateKey,
      walletType,
    }

    db.runInTransaction(() => {
      db.insertDeployment(deployment)
      pushActivity(
        `${name} deployed with ${capabilitySelection.length} capability bundles and ${vaultProtected ? 'vault guardrails' : 'direct execution permissions'}.`,
        vaultProtected ? 'vault' : 'success',
      )
    })

    response.status(201).json({
      deployment: safeDeployment(deployment),
      balanceSnapshot,
      references: extractResultReferences({
        topicId: topicId || undefined,
        transactionId: (contract.transactionId ?? deploymentTxId) || undefined,
        contractId: contract.contractId ?? undefined,
        contractAddress: contract.contractAddress ?? undefined,
        accountId: agentAccountId ?? undefined,
      }),
    })
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown deploy error.',
    })
  }
})

app.get('/api/agents/:agentId/wallet', requireAuth, readLimiter, async (request, response) => {
  const deployment = db.getDeployment(request.params.agentId)
  if (!deployment) {
    response.status(404).json({ error: 'Deployment not found.' })
    return
  }
  if (!assertAgentOwnership(deployment, request)) {
    response.status(403).json({ error: 'You do not own this agent.' })
    return
  }

  try {
    let balance: number | null = null
    const accountId = deployment.agentAccountId ?? (deployment.walletType === 'platform' ? (config.operatorAccountId || demoAccountId) : null)

    if (accountId) {
      if (demoMode) {
        balance = Math.round((50 + Math.random() * 200) * 100) / 100
      } else {
        const result = await executeTool(
          coreAccountQueryPluginToolNames.GET_HBAR_BALANCE_QUERY_TOOL,
          { accountId },
        )
        balance = typeof result.raw?.hbarBalance === 'number' ? result.raw.hbarBalance : null
      }
    }

    response.json({
      walletType: deployment.walletType,
      agentAccountId: accountId,
      balance,
    })
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : 'Wallet query failed.',
    })
  }
})

app.get('/api/agents/:agentId/spending', requireAuth, readLimiter, (request, response) => {
  const deployment = db.getDeployment(request.params.agentId)
  if (!deployment) {
    response.status(404).json({ error: 'Deployment not found.' })
    return
  }
  if (!assertAgentOwnership(deployment, request)) {
    response.status(403).json({ error: 'You do not own this agent.' })
    return
  }

  const summary = db.getSpendingSummary(deployment.id)
  const records = db.getSpendingByAgent(deployment.id, 50)

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const recentSpending = db.getRecentSpending(deployment.id, sevenDaysAgo)
  const totalRecentSpent = recentSpending
    .filter(s => s.direction === 'outflow')
    .reduce((s, r) => s + r.amountHbar, 0)
  const daysSinceFirst = recentSpending.length > 0
    ? Math.max(1, (Date.now() - new Date(recentSpending[0].createdAt).getTime()) / (24 * 60 * 60 * 1000))
    : 1
  const burnRatePerDay = Math.round((totalRecentSpent / daysSinceFirst) * 100) / 100

  response.json({ summary, burnRatePerDay, records })
})

const fundSchema = z.object({
  amountHbar: z.number().min(0.01).max(10000),
  txId: z.string().min(5),
  funderAccountId: z.string().regex(/^0\.0\.\d+$/),
})

app.post('/api/agents/:agentId/fund', requireAuth, toolLimiter, async (request, response) => {
  const parsed = fundSchema.safeParse(request.body)
  if (!parsed.success) {
    response.status(400).json({ error: flattenZodError(parsed.error) })
    return
  }

  const deployment = db.getDeployment(request.params.agentId)
  if (!deployment) {
    response.status(404).json({ error: 'Deployment not found.' })
    return
  }
  if (!assertAgentOwnership(deployment, request)) {
    response.status(403).json({ error: 'You do not own this agent.' })
    return
  }

  db.recordSpending(
    deployment.id,
    parsed.data.amountHbar,
    'inflow',
    null,
    parsed.data.txId,
    'funding',
    `Funded by ${parsed.data.funderAccountId}`,
  )

  if (deployment.topicId && !demoMode) {
    try {
      await executeTool(coreConsensusPluginToolNames.SUBMIT_TOPIC_MESSAGE_TOOL, {
        topicId: deployment.topicId,
        message: `[Aivy Funding] ${parsed.data.funderAccountId} funded ${deployment.name} with ${parsed.data.amountHbar} HBAR. Tx: ${parsed.data.txId}`,
        transactionMemo: 'Aivy agent funding',
      })
    } catch {
      // Non-critical
    }
  }

  pushActivity(
    `${deployment.name} funded with ${parsed.data.amountHbar} HBAR by ${parsed.data.funderAccountId}`,
    'vault',
  )

  response.json({
    recorded: true,
    funding: {
      amountHbar: parsed.data.amountHbar,
      txId: parsed.data.txId,
      funderAccountId: parsed.data.funderAccountId,
    },
  })
})

const withdrawSchema = z.object({
  amountHbar: z.number().min(0.01).max(10000),
  recipientAccountId: z.string().regex(/^0\.0\.\d+$/),
})

app.post('/api/agents/:agentId/withdraw', requireAuth, toolLimiter, async (request, response) => {
  const parsed = withdrawSchema.safeParse(request.body)
  if (!parsed.success) {
    response.status(400).json({ error: flattenZodError(parsed.error) })
    return
  }

  const deployment = db.getDeployment(request.params.agentId)
  if (!deployment) {
    response.status(404).json({ error: 'Deployment not found.' })
    return
  }
  if (!assertAgentOwnership(deployment, request)) {
    response.status(403).json({ error: 'You do not own this agent.' })
    return
  }
  if (deployment.walletType !== 'dedicated' || !deployment.agentAccountId || !deployment.agentPrivateKey) {
    response.status(400).json({ error: 'Agent does not have a dedicated wallet.' })
    return
  }

  try {
    if (demoMode) {
      // Demo mode: fake withdrawal
      db.recordSpending(
        deployment.id,
        parsed.data.amountHbar,
        'outflow',
        null,
        'demo-withdraw-tx',
        'withdraw',
        `Withdrawn to ${parsed.data.recipientAccountId}`,
      )
      response.json({ txId: 'demo-withdraw-tx', amountHbar: parsed.data.amountHbar })
      return
    }

    const agentClient = createAgentClient(deployment.agentAccountId, deployment.agentPrivateKey)
    const tx = await new TransferTransaction()
      .addHbarTransfer(deployment.agentAccountId, new Hbar(-parsed.data.amountHbar))
      .addHbarTransfer(parsed.data.recipientAccountId, new Hbar(parsed.data.amountHbar))
      .setTransactionMemo(`Aivy withdraw: ${deployment.name}`)
      .execute(agentClient)

    const receipt = await tx.getReceipt(agentClient)
    const txId = tx.transactionId?.toString() ?? 'unknown'

    if (receipt.status.toString() !== 'SUCCESS') {
      response.status(500).json({ error: `Transaction failed: ${receipt.status}` })
      return
    }

    db.recordSpending(
      deployment.id,
      parsed.data.amountHbar,
      'outflow',
      null,
      txId,
      'withdraw',
      `Withdrawn to ${parsed.data.recipientAccountId}`,
    )

    if (deployment.topicId) {
      try {
        await executeTool(coreConsensusPluginToolNames.SUBMIT_TOPIC_MESSAGE_TOOL, {
          topicId: deployment.topicId,
          message: `[Aivy Withdrawal] ${parsed.data.amountHbar} HBAR withdrawn from ${deployment.name} to ${parsed.data.recipientAccountId}. Tx: ${txId}`,
          transactionMemo: 'Aivy agent withdrawal',
        })
      } catch {
        // Non-critical
      }
    }

    pushActivity(
      `${parsed.data.amountHbar} HBAR withdrawn from ${deployment.name} to ${parsed.data.recipientAccountId}`,
      'vault',
    )

    response.json({ txId, amountHbar: parsed.data.amountHbar })
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : 'Withdrawal failed.',
    })
  }
})

app.post('/api/agents/:agentId/run', requireAuth, toolLimiter, async (request, response) => {
  const parsed = runAgentSchema.safeParse(request.body)
  if (!parsed.success) {
    response.status(400).json({ error: flattenZodError(parsed.error) })
    return
  }

  const deployment = db.getDeployment(request.params.agentId)
  if (!deployment) {
    response.status(404).json({ error: 'Deployment not found.' })
    return
  }
  if (!assertAgentOwnership(deployment, request)) {
    response.status(403).json({ error: 'You do not own this agent.' })
    return
  }

  try {
    const action = parsed.data.action ?? 'vault approved execution'
    const amountHbar = parsed.data.amountHbar ?? 12
    const targetAccountId = parsed.data.targetAccountId ?? (config.operatorAccountId || demoAccountId)
    let vaultTxId: string | null = null

    if (demoMode) {
      vaultTxId = nextDemoTxId()
    } else {
      if (deployment.topicId) {
        await executeTool(coreConsensusPluginToolNames.SUBMIT_TOPIC_MESSAGE_TOOL, {
          topicId: deployment.topicId,
          message: `[Aivy] ${deployment.name} executed "${action}" for ${amountHbar} HBAR toward ${targetAccountId}.`,
          transactionMemo: `Aivy execute ${deployment.templateId}`,
        })
      }

      const vaultResult = deployment.contractId
        ? await logVaultExecution(
          deployment.contractId,
          action,
          amountHbar,
          targetAccountId,
          deployment.guardrail,
        )
        : null
      vaultTxId = vaultResult?.transactionId ?? null
    }

    deployment.executions += 1
    deployment.status = deployment.vaultProtected ? 'guarded' : 'active'
    deployment.lastAction = `Executed ${action} on Hedera ${demoMode ? 'testnet (demo)' : config.network}`
    db.updateDeployment(deployment)

    pushActivity(
      `${deployment.name} executed ${action} with ${deployment.vaultProtected ? 'vault policy enforcement' : 'direct execution'}.`,
      deployment.vaultProtected ? 'vault' : 'success',
    )

    response.json({
      deployment: safeDeployment(deployment),
      result: {
        humanMessage: `${deployment.name} executed ${action}.`,
        raw: {
          topicId: deployment.topicId,
          contractId: deployment.contractId,
          transactionId: vaultTxId ?? deployment.deploymentTxId,
        },
      },
      references: extractResultReferences({
        topicId: deployment.topicId,
        contractId: deployment.contractId,
        transactionId: vaultTxId ?? deployment.deploymentTxId,
      }),
    })
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown run action error.',
    })
  }
})

app.post('/api/agents/:agentId/tools/:toolName', requireAuth, toolLimiter, async (request, response) => {
  const parsed = invokeToolSchema.safeParse(request.body)
  if (!parsed.success) {
    response.status(400).json({ error: flattenZodError(parsed.error) })
    return
  }

  const deployment = db.getDeployment(request.params.agentId)
  if (!deployment) {
    response.status(404).json({ error: 'Deployment not found.' })
    return
  }
  if (!assertAgentOwnership(deployment, request)) {
    response.status(403).json({ error: 'You do not own this agent.' })
    return
  }

  const toolName = request.params.toolName
  const groupId = toolNameToGroup.get(toolName)
  if (!groupId) {
    response.status(404).json({ error: 'Unknown Hedera Agent Kit tool.' })
    return
  }

  if (!deployment.capabilityGroups.includes(groupId)) {
    response.status(403).json({
      error: `${titleCase(toolName)} is not enabled for this agent. Add the ${capabilityGroups.find((group) => group.id === groupId)?.label ?? groupId} capability bundle first.`,
    })
    return
  }

  try {
    const result = demoMode
      ? getDemoToolResponse(toolName, parsed.data.params)
      : await executeTool(toolName, parsed.data.params)
    const label = titleCase(toolName)
    const humanMessage = result.humanMessage ?? `${label} completed.`
    const isQuery = queryGroupIds.has(groupId)

    if (toolName === coreConsensusPluginToolNames.CREATE_TOPIC_TOOL) {
      deployment.topicId = String(result.raw?.topicId ?? deployment.topicId ?? '')
    }

    // Record HBAR spending
    const spendingAmount = detectSpendingAmount(toolName, parsed.data.params)
    if (spendingAmount > 0) {
      const txId = typeof result.raw?.transactionId === 'string' ? result.raw.transactionId : null
      db.recordSpending(deployment.id, spendingAmount, 'outflow', toolName, txId, 'chat', humanMessage)
    }

    deployment.lastAction = label
    if (!isQuery) {
      deployment.executions += 1
      deployment.status = deployment.vaultProtected ? 'guarded' : 'active'
    }
    db.updateDeployment(deployment)

    pushActivity(
      `${deployment.name}: ${humanMessage}`,
      isQuery ? 'system' : deployment.vaultProtected ? 'vault' : 'success',
    )

    response.json({
      deployment: safeDeployment(deployment),
      tool: {
        name: toolName,
        label,
        groupId,
        kind: isQuery ? 'query' : 'mutation',
      },
      result,
      references: extractResultReferences(result.raw),
    })
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown tool execution error.',
    })
  }
})

app.post('/api/agents/:agentId/pause', requireAuth, async (request, response) => {
  const parsed = pauseSchema.safeParse(request.body)
  if (!parsed.success) {
    response.status(400).json({ error: flattenZodError(parsed.error) })
    return
  }

  const deployment = db.getDeployment(request.params.agentId)
  if (!deployment) {
    response.status(404).json({ error: 'Deployment not found.' })
    return
  }
  if (!assertAgentOwnership(deployment, request)) {
    response.status(403).json({ error: 'You do not own this agent.' })
    return
  }

  try {
    const vaultResult = deployment.contractId
      ? await updateVaultPauseState(
        deployment.contractId,
        parsed.data.paused,
        deployment.vaultCapHbar,
        deployment.guardrail,
      )
      : null

    deployment.status = parsed.data.paused
      ? 'paused'
      : deployment.vaultProtected
        ? 'guarded'
        : 'active'
    deployment.lastAction = parsed.data.paused
      ? 'Execution halted by operator'
      : 'Execution resumed with current guardrails'
    db.updateDeployment(deployment)

    pushActivity(
      `${deployment.name} ${parsed.data.paused ? 'paused' : 'resumed'} by operator.`,
      parsed.data.paused ? 'system' : 'success',
    )

    response.json({
      deployment: safeDeployment(deployment),
      result: {
        humanMessage: `${deployment.name} ${parsed.data.paused ? 'paused' : 'resumed'}.`,
        raw: {
          contractId: deployment.contractId,
          transactionId: vaultResult?.transactionId,
        },
      },
      references: extractResultReferences({
        contractId: deployment.contractId,
        transactionId: vaultResult?.transactionId,
      }),
    })
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown pause action error.',
    })
  }
})

app.delete('/api/agents/:agentId', requireAuth, (request, response) => {
  const deployment = db.getDeployment(request.params.agentId)
  if (!deployment) {
    response.status(404).json({ error: 'Deployment not found.' })
    return
  }
  if (!assertAgentOwnership(deployment, request)) {
    response.status(403).json({ error: 'You do not own this agent.' })
    return
  }

  db.runInTransaction(() => {
    db.deleteDeployment(request.params.agentId)
    pushActivity(`${deployment.name} removed from the Aivy floor.`, 'system')
  })
  response.status(204).end()
})

// ─── Export Audit Report ──────────────────────────────
app.get('/api/agents/:agentId/export-audit', requireAuth, readLimiter, async (request, response) => {
  const deployment = db.getDeployment(request.params.agentId)
  if (!deployment) {
    response.status(404).json({ error: 'Deployment not found.' })
    return
  }
  if (!assertAgentOwnership(deployment, request)) {
    response.status(403).json({ error: 'You do not own this agent.' })
    return
  }

  try {
    const topicMessages = deployment.topicId
      ? await fetchAllTopicMessages(deployment.topicId)
      : []

    const decodedMessages = topicMessages.map((msg) => ({
      sequenceNumber: msg.sequence_number,
      timestamp: msg.consensus_timestamp,
      content: Buffer.from(msg.message, 'base64').toString('utf8'),
    }))

    const agentActivity = db.getActivityForAgent(deployment.name)

    const auditReport = {
      exportedAt: new Date().toISOString(),
      agent: {
        id: deployment.id,
        name: deployment.name,
        templateId: deployment.templateId,
        room: deployment.room,
        status: deployment.status,
        guardrail: deployment.guardrail,
        topicId: deployment.topicId,
        contractId: deployment.contractId,
        contractAddress: deployment.contractAddress,
        vaultCapHbar: deployment.vaultCapHbar,
        vaultProtected: deployment.vaultProtected,
        executions: deployment.executions,
        capabilityGroups: deployment.capabilityGroups,
        createdAt: deployment.createdAt,
      },
      topicMessages: decodedMessages,
      activityLog: agentActivity,
      summary: {
        totalTopicMessages: decodedMessages.length,
        totalActivityEvents: agentActivity.length,
        network: config.network,
        mirrorNodeUrl: config.mirrorNodeUrl,
      },
    }

    const filename = `audit-${deployment.name.replace(/\s+/g, '-').toLowerCase()}-${Date.now()}.json`
    response.setHeader('Content-Type', 'application/json')
    response.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    response.json(auditReport)
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : 'Export failed.',
    })
  }
})

// ─── Chat Endpoint ─────────────────────────────────
const chatSchema = z.object({
  message: z.string().min(1).max(2000),
  userAccountId: z.string().regex(/^0\.0\.\d+$/).optional(),
})

app.post('/api/agents/:agentId/chat', requireAuth, chatLimiter, async (request, response) => {
  const parsed = chatSchema.safeParse(request.body)
  if (!parsed.success) {
    response.status(400).json({ error: flattenZodError(parsed.error) })
    return
  }

  const deployment = db.getDeployment(request.params.agentId)
  if (!deployment) {
    response.status(404).json({ error: 'Deployment not found.' })
    return
  }
  if (!assertAgentOwnership(deployment, request)) {
    response.status(403).json({ error: 'You do not own this agent.' })
    return
  }

  if (deployment.status === 'paused') {
    response.status(403).json({ error: 'Agent is paused. Resume it to chat.' })
    return
  }

  // Demo fallback when OpenAI is not available
  if (!openai) {
    const responses = demoChatResponses[deployment.templateId] ?? [
      `I'm ${deployment.name}, running in demo mode. I can help with on-chain operations when connected to the Hedera testnet.`,
    ]
    const reply = responses[Math.floor(Math.random() * responses.length)]
    response.json({ reply, toolCalls: [], references: [] })
    return
  }

  try {
    const userAccountId = parsed.data.userAccountId

    // Resolve per-agent client for dedicated wallets
    const agentClient = deployment.walletType === 'dedicated' && deployment.agentAccountId && deployment.agentPrivateKey
      ? createAgentClient(deployment.agentAccountId, deployment.agentPrivateKey)
      : undefined

    // Get or create chat history (always refresh system prompt with user context)
    let history = db.getChatHistory(deployment.id)
    if (history.length === 0) {
      history = [{ role: 'system', content: buildAgentSystemPrompt(deployment, userAccountId) }]
    } else {
      history[0] = { role: 'system', content: buildAgentSystemPrompt(deployment, userAccountId) }
    }

    // Add user message
    history.push({ role: 'user', content: parsed.data.message })

    // Run the shared chat loop
    const result = await runChatLoop(deployment, history, agentClient, 'chat')

    response.json({
      reply: result.reply,
      toolCalls: result.toolCalls,
      references: result.references,
    })
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : 'Chat failed.',
    })
  }
})

// ═══════════════════════════════════════════════════
// Shared chat loop (used by chat endpoint, schedules, triggers)
// ═══════════════════════════════════════════════════

type ChatLoopResult = {
  reply: string
  toolCalls: Array<{ toolName: string; params: Record<string, unknown>; result: { raw?: Record<string, unknown>; humanMessage?: string } }>
  references: ResultReference[]
}

async function runChatLoop(
  deployment: DeploymentRecord,
  history: db.ChatMessage[],
  agentClient?: Client,
  source: 'chat' | 'schedule' | 'trigger' = 'chat',
): Promise<ChatLoopResult> {
  if (!openai) throw new Error('OpenAI is not configured.')

  const catalog = buildToolCatalog()
  const enabledGroups = new Set(deployment.capabilityGroups)
  const agentTools = catalog.tools.filter((t) => enabledGroups.has(t.groupId))
  const openaiTools = buildOpenAITools(agentTools)
  const agentToolNames = new Set(agentTools.map((t) => t.name))

  const collectedToolCalls: ChatLoopResult['toolCalls'] = []
  const collectedReferences: ResultReference[] = []

  let iterations = 0
  const maxIterations = 5

  while (iterations < maxIterations) {
    iterations++

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: history as OpenAI.ChatCompletionMessageParam[],
      tools: openaiTools.length > 0 ? openaiTools : undefined,
      temperature: 0.3,
      max_tokens: 1024,
    })

    const choice = completion.choices[0]
    if (!choice) break

    const assistantMessage = choice.message
    const fnToolCalls = (assistantMessage.tool_calls ?? []).filter(
      (tc): tc is Extract<typeof tc, { type: 'function' }> => tc.type === 'function',
    )

    history.push({
      role: 'assistant',
      content: assistantMessage.content,
      tool_calls: fnToolCalls.length > 0
        ? fnToolCalls.map((tc) => ({
            id: tc.id,
            type: 'function' as const,
            function: { name: tc.function.name, arguments: tc.function.arguments },
          }))
        : undefined,
    })

    if (fnToolCalls.length === 0) break

    for (const toolCall of fnToolCalls) {
      const fnName = toolCall.function.name
      let fnArgs: Record<string, unknown> = {}
      try { fnArgs = JSON.parse(toolCall.function.arguments) as Record<string, unknown> } catch { /* empty */ }

      let toolResultContent: string
      console.log(`[${source}] ${deployment.name} calling tool: ${fnName}`, JSON.stringify(fnArgs))

      if (!agentToolNames.has(fnName)) {
        toolResultContent = JSON.stringify({ error: `Tool ${fnName} is not available for this agent.` })
      } else {
        // Programmatic spending cap check BEFORE executing the tool
        if (deployment.vaultProtected && deployment.vaultCapHbar > 0) {
          const projectedSpend = detectSpendingAmount(fnName, fnArgs)
          if (projectedSpend > 0) {
            const summary = db.getSpendingSummary(deployment.id)
            const totalAfter = summary.totalSpent + projectedSpend
            if (totalAfter > deployment.vaultCapHbar) {
              toolResultContent = JSON.stringify({
                error: `Spending cap exceeded. This transaction would spend ${projectedSpend} HBAR, bringing total to ${totalAfter.toFixed(2)} HBAR — above the ${deployment.vaultCapHbar} HBAR vault cap. Transaction blocked.`,
              })
              history.push({ role: 'tool', content: toolResultContent, tool_call_id: toolCall.id, name: fnName })
              continue
            }
          }
        }
        try {
          const result = demoMode
            ? getDemoToolResponse(fnName, fnArgs)
            : await executeTool(fnName, fnArgs, agentClient)
          const references = extractResultReferences(result.raw)
          collectedToolCalls.push({ toolName: fnName, params: fnArgs, result })
          collectedReferences.push(...references)

          const spendingAmount = detectSpendingAmount(fnName, fnArgs)
          if (spendingAmount > 0) {
            const txId = typeof result.raw?.transactionId === 'string' ? result.raw.transactionId : null
            db.recordSpending(deployment.id, spendingAmount, 'outflow', fnName, txId, source, result.humanMessage ?? null)
          }

          if (result.raw) runCoordinationChecks(deployment, { ...result.raw, humanMessage: result.humanMessage })

          const groupId = toolNameToGroup.get(fnName)
          const isQuery = groupId ? queryGroupIds.has(groupId) : true
          if (!isQuery) {
            deployment.executions += 1
            deployment.status = deployment.vaultProtected ? 'guarded' : 'active'
            deployment.lastAction = titleCase(fnName)
            db.updateDeployment(deployment)
          }

          pushActivity(
            `${deployment.name} (${source}): ${result.humanMessage ?? titleCase(fnName)}`,
            isQuery ? 'system' : deployment.vaultProtected ? 'vault' : 'success',
          )

          toolResultContent = JSON.stringify({ humanMessage: result.humanMessage, raw: result.raw })
        } catch (err) {
          toolResultContent = JSON.stringify({ error: err instanceof Error ? err.message : 'Tool execution failed.' })
        }
      }

      history.push({ role: 'tool', content: toolResultContent, tool_call_id: toolCall.id, name: fnName })
    }
  }

  // Trim history
  if (history.length > 42) {
    const system = history[0]
    history = [system, ...history.slice(-40)]
  }
  db.replaceChatHistory(deployment.id, history)

  const lastAssistant = [...history].reverse().find((m) => m.role === 'assistant' && m.content)
  const reply = lastAssistant?.content ?? 'I completed the requested actions.'

  const uniqueRefs = collectedReferences.filter(
    (ref, idx, all) => idx === all.findIndex((r) => r.label === ref.label && r.value === ref.value),
  )

  return { reply, toolCalls: collectedToolCalls, references: uniqueRefs }
}

/** Execute a scheduled or trigger-based prompt against an agent */
async function executeScheduledPrompt(
  sourceId: string,
  deploymentId: string,
  prompt: string,
  source: 'schedule' | 'trigger' = 'schedule',
): Promise<string> {
  const deployment = db.getDeployment(deploymentId)
  if (!deployment || deployment.status === 'paused') {
    return 'Agent is paused or not found.'
  }

  // Prevent concurrent runs for the same agent
  if (!acquireAgentLock(deploymentId)) {
    console.log(`[${source}] Skipping — agent ${deploymentId} is already running.`)
    return 'Agent is already executing another task.'
  }

  const execId = source === 'schedule'
    ? db.insertScheduleExecution(sourceId, deploymentId)
    : 0

  try {
    const agentClient = deployment.walletType === 'dedicated' && deployment.agentAccountId && deployment.agentPrivateKey
      ? createAgentClient(deployment.agentAccountId, deployment.agentPrivateKey)
      : undefined

    let history = db.getChatHistory(deploymentId)
    if (history.length === 0) {
      history = [{ role: 'system', content: buildAgentSystemPrompt(deployment) }]
    } else {
      history[0] = { role: 'system', content: buildAgentSystemPrompt(deployment) }
    }

    history.push({ role: 'user', content: `[AUTOMATED ${source.toUpperCase()}] ${prompt}` })

    const result = await runChatLoop(deployment, history, agentClient, source)

    if (execId > 0) {
      db.updateScheduleExecution(execId, 'completed', result.reply.slice(0, 500), null)
    }

    pushActivity(
      `${deployment.name} (${source}): Completed automated task`,
      'system',
    )

    return result.reply
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'Execution failed'
    if (execId > 0) {
      db.updateScheduleExecution(execId, 'failed', null, errMsg)
    }
    console.error(`[${source}] Failed for deployment ${deploymentId}:`, errMsg)
    return errMsg
  } finally {
    releaseAgentLock(deploymentId)
  }
}

// ═══════════════════════════════════════════════════
// Feature 2: Multi-agent chat routing
// ═══════════════════════════════════════════════════

const routeSchema = z.object({
  message: z.string().min(1).max(2000),
  agentIds: z.array(z.string()).min(1).max(10),
  userAccountId: z.string().regex(/^0\.0\.\d+$/).optional(),
})

/** Keyword-based routing: pick the best agent for a user's intent */
function routeMessageToAgent(
  message: string,
  agentIds: string[],
): string {
  const lower = message.toLowerCase()

  // Intent → templateId mapping
  const intentMap: Array<{ keywords: string[]; templateId: string }> = [
    {
      keywords: ['balance', 'transfer', 'send', 'hbar', 'treasury', 'vault', 'pay', 'withdraw'],
      templateId: 'treasury-sentinel',
    },
    {
      keywords: ['token', 'create token', 'mint', 'nft', 'erc20', 'erc721', 'fungible', 'liquidity', 'swap', 'deploy contract'],
      templateId: 'yield-router',
    },
    {
      keywords: ['audit', 'compliance', 'inspect', 'verify', 'check transaction', 'lookup', 'history'],
      templateId: 'compliance-clerk',
    },
    {
      keywords: ['topic', 'proposal', 'vote', 'governance', 'schedule', 'consensus', 'message', 'hcs'],
      templateId: 'governance-relay',
    },
  ]

  // Score each template
  const scores = new Map<string, number>()
  for (const { keywords, templateId } of intentMap) {
    let score = 0
    for (const kw of keywords) {
      if (lower.includes(kw)) score += kw.split(' ').length // multi-word matches score higher
    }
    scores.set(templateId, score)
  }

  // Find the deployment that matches the best-scoring template
  const deploymentList = agentIds.map((id) => db.getDeployment(id)).filter((d): d is DeploymentRecord => d !== null)

  // Sort by score descending
  const ranked = deploymentList.sort((a, b) => {
    const scoreA = scores.get(a.templateId) ?? 0
    const scoreB = scores.get(b.templateId) ?? 0
    return scoreB - scoreA
  })

  // Return the best match, or the first agent if no keywords matched
  return ranked[0]?.id ?? agentIds[0]
}

app.post('/api/chat/route', requireAuth, chatLimiter, async (request, response) => {
  const parsed = routeSchema.safeParse(request.body)
  if (!parsed.success) {
    response.status(400).json({ error: flattenZodError(parsed.error) })
    return
  }

  const { message, agentIds, userAccountId } = parsed.data

  // Route to the best agent
  const targetId = routeMessageToAgent(message, agentIds)
  const deployment = db.getDeployment(targetId)
  if (!deployment) {
    response.status(404).json({ error: 'No matching agent found.' })
    return
  }

  if (deployment.status === 'paused') {
    response.status(403).json({ error: `${deployment.name} is paused.` })
    return
  }

  // Demo fallback when OpenAI is not available
  if (!openai) {
    const responses = demoChatResponses[deployment.templateId] ?? [
      `I'm ${deployment.name}, running in demo mode.`,
    ]
    const reply = responses[Math.floor(Math.random() * responses.length)]
    response.json({ agentId: deployment.id, agentName: deployment.name, reply, toolCalls: [], references: [] })
    return
  }

  try {
    // Resolve per-agent client for dedicated wallets
    const routeAgentClient = deployment.walletType === 'dedicated' && deployment.agentAccountId && deployment.agentPrivateKey
      ? createAgentClient(deployment.agentAccountId, deployment.agentPrivateKey)
      : undefined

    // Reuse the chat logic: build prompt, call OpenAI
    let history = db.getChatHistory(deployment.id)
    if (history.length === 0) {
      history = [{ role: 'system', content: buildAgentSystemPrompt(deployment, userAccountId) }]
    } else {
      history[0] = { role: 'system', content: buildAgentSystemPrompt(deployment, userAccountId) }
    }

    const catalog = buildToolCatalog()
    const enabledGroups = new Set(deployment.capabilityGroups)
    const agentTools = catalog.tools.filter((t) => enabledGroups.has(t.groupId))
    const openaiTools = buildOpenAITools(agentTools, userAccountId)
    const agentToolNames = new Set(agentTools.map((t) => t.name))

    history.push({ role: 'user', content: message })

    const collectedToolCalls: Array<{
      toolName: string
      params: Record<string, unknown>
      result: { raw?: Record<string, unknown>; humanMessage?: string }
    }> = []

    let iterations = 0
    while (iterations < 5) {
      iterations++
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: history as OpenAI.ChatCompletionMessageParam[],
        tools: openaiTools.length > 0 ? openaiTools : undefined,
        temperature: 0.3,
        max_tokens: 1024,
      })

      const choice = completion.choices[0]
      if (!choice) break

      const assistantMessage = choice.message
      const fnToolCalls2 = (assistantMessage.tool_calls ?? []).filter((tc): tc is Extract<typeof tc, { type: 'function' }> => tc.type === 'function')
      history.push({
        role: 'assistant',
        content: assistantMessage.content,
        tool_calls: fnToolCalls2.length > 0
          ? fnToolCalls2.map((tc) => ({
              id: tc.id,
              type: 'function' as const,
              function: { name: tc.function.name, arguments: tc.function.arguments },
            }))
          : undefined,
      })

      if (fnToolCalls2.length === 0) break

      for (const toolCall of fnToolCalls2) {
        const fnName = toolCall.function.name
        let fnArgs: Record<string, unknown> = {}
        try { fnArgs = JSON.parse(toolCall.function.arguments) as Record<string, unknown> } catch { /* empty */ }

        let toolResultContent: string

        if (!agentToolNames.has(fnName)) {
          toolResultContent = JSON.stringify({ error: `Tool ${fnName} not available.` })
        } else {
          try {
            const result = demoMode
              ? getDemoToolResponse(fnName, fnArgs)
              : await executeTool(fnName, fnArgs, routeAgentClient)
            collectedToolCalls.push({ toolName: fnName, params: fnArgs, result })

            // Feature 4: Agent-to-agent coordination checks
            if (result.raw) {
              runCoordinationChecks(deployment, { ...result.raw, humanMessage: result.humanMessage })
            }

            const groupId = toolNameToGroup.get(fnName)
            const isQuery = groupId ? queryGroupIds.has(groupId) : true
            if (!isQuery) {
              deployment.executions += 1
              deployment.status = deployment.vaultProtected ? 'guarded' : 'active'
              deployment.lastAction = titleCase(fnName)
              db.updateDeployment(deployment)
            }

            pushActivity(
              `${deployment.name} (routed): ${result.humanMessage ?? titleCase(fnName)}`,
              isQuery ? 'system' : deployment.vaultProtected ? 'vault' : 'success',
            )

            toolResultContent = JSON.stringify({ humanMessage: result.humanMessage, raw: result.raw })
          } catch (err) {
            toolResultContent = JSON.stringify({ error: err instanceof Error ? err.message : 'Tool failed.' })
          }
        }

        history.push({ role: 'tool', content: toolResultContent, tool_call_id: toolCall.id, name: fnName })
      }
    }

    if (history.length > 42) {
      const system = history[0]
      history = [system, ...history.slice(-40)]
    }
    db.replaceChatHistory(deployment.id, history)

    const lastAssistant = [...history].reverse().find((m) => m.role === 'assistant' && m.content)
    const reply = lastAssistant?.content ?? 'Done.'

    response.json({
      agentId: deployment.id,
      agentName: deployment.name,
      reply,
      toolCalls: collectedToolCalls,
    })
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : 'Route failed.' })
  }
})

// ═══════════════════════════════════════════════════
// Feature 4: Agent-to-agent coordination
// ═══════════════════════════════════════════════════

type CoordinationEvent = {
  id: string
  sourceAgentId: string
  sourceAgentName: string
  targetAgentId: string
  targetAgentName: string
  trigger: string
  action: string
  timestamp: string
  status: 'triggered' | 'completed' | 'failed'
}

const coordinationLog: CoordinationEvent[] = []

const coordinationRules: Array<{
  sourceTemplate: string
  targetTemplate: string
  triggerCondition: string
  actionDescription: string
  check: (raw: Record<string, unknown>) => boolean
  buildMessage: (raw: Record<string, unknown>, source: DeploymentRecord) => string
}> = [
  {
    sourceTemplate: 'treasury-sentinel',
    targetTemplate: 'yield-router',
    triggerCondition: 'low_balance',
    actionDescription: 'Rebalance funds',
    check: (raw) => {
      const bal = typeof raw['balance'] === 'number' ? raw['balance']
        : typeof raw['hbars'] === 'number' ? raw['hbars']
          : typeof raw['hbarBalance'] === 'number' ? raw['hbarBalance'] : null
      return bal !== null && bal < 50
    },
    buildMessage: (raw, source) => {
      const bal = raw['balance'] ?? raw['hbars'] ?? raw['hbarBalance'] ?? '?'
      return `[COORDINATION] ${source.name} detected low balance (${bal} HBAR). Please evaluate rebalancing options.`
    },
  },
  {
    sourceTemplate: 'treasury-sentinel',
    targetTemplate: 'compliance-clerk',
    triggerCondition: 'large_transfer',
    actionDescription: 'Audit large transfer',
    check: (raw) => {
      const amount = typeof raw['amount'] === 'number' ? raw['amount'] : 0
      return amount > 100
    },
    buildMessage: (raw, source) => {
      const amount = raw['amount'] ?? 'unknown'
      return `[COORDINATION] ${source.name} executed a large transfer of ${amount} HBAR. Please verify for compliance.`
    },
  },
  {
    sourceTemplate: 'yield-router',
    targetTemplate: 'governance-relay',
    triggerCondition: 'new_token_created',
    actionDescription: 'Register new asset',
    check: (raw) => !!(raw['tokenId'] || raw['erc20Address'] || raw['contractId']),
    buildMessage: (raw, source) => {
      const asset = raw['tokenId'] ?? raw['erc20Address'] ?? raw['contractId'] ?? 'unknown'
      return `[COORDINATION] ${source.name} created new asset ${asset}. Please record in governance register.`
    },
  },
  {
    sourceTemplate: 'compliance-clerk',
    targetTemplate: 'governance-relay',
    triggerCondition: 'policy_violation',
    actionDescription: 'Escalate to governance',
    check: (raw) => {
      const msg = String(raw['humanMessage'] ?? '').toLowerCase()
      return msg.includes('violation') || msg.includes('blocked') || msg.includes('denied')
    },
    buildMessage: (raw, source) =>
      `[COORDINATION] ${source.name} detected a policy issue: ${raw['humanMessage'] ?? 'unknown'}. Please review.`,
  },
]

function runCoordinationChecks(
  sourceDeployment: DeploymentRecord,
  raw: Record<string, unknown>,
): void {
  try {
    const activeDeployments = db.getAllDeployments().filter(d => d.status !== 'paused')

    for (const rule of coordinationRules) {
      if (sourceDeployment.templateId !== rule.sourceTemplate) continue
      if (!rule.check(raw)) continue

      const target = activeDeployments.find(d => d.templateId === rule.targetTemplate)
      if (!target) continue

      const coordEvent: CoordinationEvent = {
        id: `coord-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
        sourceAgentId: sourceDeployment.id,
        sourceAgentName: sourceDeployment.name,
        targetAgentId: target.id,
        targetAgentName: target.name,
        trigger: rule.triggerCondition,
        action: rule.actionDescription,
        timestamp: formatTimestamp(),
        status: 'triggered',
      }
      coordinationLog.unshift(coordEvent)
      if (coordinationLog.length > 50) coordinationLog.length = 50

      pushActivity(`${sourceDeployment.name} → ${target.name}: ${rule.actionDescription}`, 'vault')

      db.appendChatMessage(target.id, { role: 'system', content: rule.buildMessage(raw, sourceDeployment) })
      coordEvent.status = 'completed'
    }
  } catch {
    // Non-critical
  }
}

// ─── Explicit Coordination Endpoint ──────────────────
const coordinateSchema = z.object({
  targetAgentId: z.string(),
  message: z.string().min(1).max(500),
})

app.post('/api/agents/:agentId/coordinate', requireAuth, async (request, response) => {
  const parsed = coordinateSchema.safeParse(request.body)
  if (!parsed.success) {
    response.status(400).json({ error: flattenZodError(parsed.error) })
    return
  }

  const source = db.getDeployment(request.params.agentId)
  if (!source) {
    response.status(404).json({ error: 'Source agent not found.' })
    return
  }
  if (!assertAgentOwnership(source, request)) {
    response.status(403).json({ error: 'You do not own this agent.' })
    return
  }

  const target = db.getDeployment(parsed.data.targetAgentId)
  if (!target) {
    response.status(404).json({ error: 'Target agent not found.' })
    return
  }
  if (!assertAgentOwnership(target, request)) {
    response.status(403).json({ error: 'You do not own the target agent.' })
    return
  }

  if (target.status === 'paused') {
    response.status(403).json({ error: `${target.name} is paused.` })
    return
  }

  try {
    const coordEvent: CoordinationEvent = {
      id: `coord-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
      sourceAgentId: source.id,
      sourceAgentName: source.name,
      targetAgentId: target.id,
      targetAgentName: target.name,
      trigger: 'manual',
      action: parsed.data.message.slice(0, 60),
      timestamp: formatTimestamp(),
      status: 'triggered',
    }
    coordinationLog.unshift(coordEvent)
    if (coordinationLog.length > 50) coordinationLog.length = 50

    const targetHistory = db.getChatHistory(target.id)
    if (targetHistory.length === 0) {
      db.appendChatMessage(target.id, { role: 'system', content: buildAgentSystemPrompt(target) })
    }
    db.appendChatMessage(target.id, {
      role: 'system',
      content: `[CROSS-AGENT REQUEST from ${source.name}] ${parsed.data.message}`,
    })

    if (target.topicId && !demoMode) {
      try {
        await executeTool(coreConsensusPluginToolNames.SUBMIT_TOPIC_MESSAGE_TOOL, {
          topicId: target.topicId,
          message: `[Aivy Coordination] ${source.name} → ${target.name}: ${parsed.data.message}`,
          transactionMemo: 'Aivy cross-agent coordination',
        })
      } catch {
        // Non-critical
      }
    }

    pushActivity(`${source.name} → ${target.name}: ${parsed.data.message.slice(0, 50)}`, 'vault')
    coordEvent.status = 'completed'

    response.json({ coordination: coordEvent, message: `Message delivered to ${target.name}.` })
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : 'Coordination failed.' })
  }
})

app.get('/api/coordination', (_request, response) => {
  response.json({ events: coordinationLog })
})

// ═══════════════════════════════════════════════════
// Feature 5: Dashboard Stats Endpoint
// ═══════════════════════════════════════════════════

app.get('/api/dashboard', readLimiter, (_request, response) => {
  try {
    const items = db.getAllDeployments()

    const agentStats = items.map(d => ({
      id: d.id,
      name: d.name,
      templateId: d.templateId,
      status: d.status,
      executions: d.executions,
      vaultProtected: d.vaultProtected,
      vaultCapHbar: d.vaultCapHbar,
      room: d.room,
      createdAt: d.createdAt,
    }))

    const totalExecutions = items.reduce((s, d) => s + d.executions, 0)
    const totalVaultCap = items.filter(d => d.vaultProtected).reduce((s, d) => s + d.vaultCapHbar, 0)
    const vaultUtilization = items.length > 0
      ? items.filter(d => d.vaultProtected).length / items.length
      : 0

    const roomDistribution: Record<string, number> = {}
    for (const d of items) {
      roomDistribution[d.room] = (roomDistribution[d.room] ?? 0) + 1
    }

    const templateDistribution: Record<string, number> = {}
    for (const d of items) {
      templateDistribution[d.templateId] = (templateDistribution[d.templateId] ?? 0) + 1
    }

    const perAgentSpending = items.map(d => {
      const s = db.getSpendingSummary(d.id)
      return { agentId: d.id, agentName: d.name, totalSpent: s.totalSpent, totalFunded: s.totalFunded, txCount: s.txCount }
    })

    response.json({
      summary: {
        totalAgents: items.length,
        activeAgents: items.filter(d => d.status !== 'paused').length,
        pausedAgents: items.filter(d => d.status === 'paused').length,
        totalExecutions,
        totalVaultCapHbar: totalVaultCap,
        vaultUtilization: Math.round(vaultUtilization * 100),
        totalCoordinations: coordinationLog.length,
      },
      agentStats,
      roomDistribution,
      templateDistribution,
      recentActivity: db.getActivity(20),
      recentCoordinations: coordinationLog.slice(0, 10),
      spending: {
        totalSpentAllAgents: perAgentSpending.reduce((s, a) => s + a.totalSpent, 0),
        perAgent: perAgentSpending,
      },
    })
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : 'Dashboard data failed.' })
  }
})

// ─── Demo Mode ─────────────────────────────────────
const demoAccountId = '0.0.4515432'
let demoTxCounter = 1000

function nextDemoTxId() {
  demoTxCounter += 1
  return `${demoAccountId}@${Math.floor(Date.now() / 1000)}.${String(demoTxCounter).padStart(9, '0')}`
}

function nextDemoAccountId() {
  return `0.0.${4600000 + Math.floor(Math.random() * 100000)}`
}

function nextDemoTopicId() {
  return `0.0.${5000000 + Math.floor(Math.random() * 100000)}`
}

function nextDemoContractId() {
  return `0.0.${6000000 + Math.floor(Math.random() * 100000)}`
}

function nextDemoTokenId() {
  return `0.0.${7000000 + Math.floor(Math.random() * 100000)}`
}

const demoToolResponses: Record<string, (params: Record<string, unknown>) => ToolResponse> = {
  get_hbar_balance_query_tool: (params) => ({
    raw: { accountId: params['accountId'] ?? demoAccountId, hbarBalance: 142.5 },
    humanMessage: `Balance: 142.5 HBAR for account ${params['accountId'] ?? demoAccountId}`,
  }),
  get_account_query_tool: (params) => ({
    raw: {
      accountId: params['accountId'] ?? demoAccountId,
      hbarBalance: 142.5,
      maxAutoTokenAssociations: 10,
      isDeleted: false,
      memo: 'Aivy demo account',
    },
    humanMessage: `Account info retrieved for ${params['accountId'] ?? demoAccountId}.`,
  }),
  transfer_hbar_tool: () => ({
    raw: { transactionId: nextDemoTxId(), status: 'SUCCESS' },
    humanMessage: 'HBAR transfer completed successfully.',
  }),
  create_topic_tool: () => {
    const topicId = nextDemoTopicId()
    return {
      raw: { topicId, transactionId: nextDemoTxId() },
      humanMessage: `Topic ${topicId} created successfully.`,
    }
  },
  submit_topic_message_tool: () => ({
    raw: { transactionId: nextDemoTxId(), status: 'SUCCESS' },
    humanMessage: 'Message submitted to topic.',
  }),
  create_fungible_token_tool: (params) => {
    const tokenId = nextDemoTokenId()
    return {
      raw: { tokenId, transactionId: nextDemoTxId(), tokenName: params['tokenName'] },
      humanMessage: `Token ${params['tokenName'] ?? 'Aivy Token'} created with ID ${tokenId}.`,
    }
  },
  mint_fungible_token_tool: (params) => ({
    raw: { transactionId: nextDemoTxId(), totalSupply: params['amount'] ?? 1000 },
    humanMessage: `Minted ${params['amount'] ?? 1000} tokens.`,
  }),
  create_non_fungible_token_tool: (params) => {
    const tokenId = nextDemoTokenId()
    return {
      raw: { tokenId, transactionId: nextDemoTxId() },
      humanMessage: `NFT collection ${params['tokenName'] ?? 'Aivy NFT'} created with ID ${tokenId}.`,
    }
  },
  get_exchange_rate_tool: () => ({
    raw: { hbarToUsd: 0.065, centEquivalent: 6.5, expirationTime: new Date().toISOString() },
    humanMessage: 'Exchange rate: 1 HBAR = $0.065 USD.',
  }),
  get_topic_info_query_tool: (params) => ({
    raw: { topicId: params['topicId'], sequenceNumber: 12, memo: 'Aivy audit stream' },
    humanMessage: `Topic ${params['topicId']} has 12 messages.`,
  }),
  get_token_info_query_tool: (params) => ({
    raw: { tokenId: params['tokenId'], name: 'Aivy Token', symbol: 'AIVY', totalSupply: 10000, decimals: 2 },
    humanMessage: `Token ${params['tokenId']}: AIVY with 10,000 supply.`,
  }),
}

function getDemoToolResponse(toolName: string, params: Record<string, unknown>): ToolResponse {
  const handler = demoToolResponses[toolName]
  if (handler) return handler(params)
  return {
    raw: { status: 'SUCCESS', transactionId: nextDemoTxId() },
    humanMessage: `${titleCase(toolName)} completed successfully (demo).`,
  }
}

const demoChatResponses: Record<string, string[]> = {
  'treasury-sentinel': [
    'I checked the treasury balance — currently at 142.5 HBAR. Everything is within the spending cap. Would you like me to transfer funds or check a specific account?',
    'The vault guardrails are active. I can monitor balances, execute transfers within the spending cap, or log actions to the audit trail. What would you like to do?',
  ],
  'yield-router': [
    'I can create fungible or non-fungible tokens, manage ERC20/ERC721 contracts, and route liquidity on Hedera. What token operation would you like to perform?',
    'Ready to route yield! I can mint tokens, manage airdrops, or deploy ERC contracts. Just let me know what you need.',
  ],
  'compliance-clerk': [
    'I\'ve been monitoring the audit trail — all transactions are within policy limits. I can inspect specific transactions, verify account activity, or pull the full audit log.',
    'Compliance check: all agents are operating within their guardrails. Would you like me to audit a specific account or transaction?',
  ],
  'governance-relay': [
    'I can coordinate governance proposals, manage HCS topics, and handle scheduled transactions. Would you like to create a proposal or review existing ones?',
    'Governance systems are online. I can submit proposals to the consensus topic, coordinate votes, or schedule future transactions.',
  ],
}

const demoSeedAgents = [
  {
    templateId: 'treasury-sentinel',
    name: 'Treasury Alpha',
    room: 'Launch Bay',
    guardrail: 'Max 250 HBAR per transaction',
    vaultProtected: true,
    vaultCapHbar: 250,
    capabilityGroups: ['accounts', 'accountQueries', 'consensus', 'consensusQueries', 'transactionQueries', 'networkQueries'] as CapabilityGroupId[],
  },
  {
    templateId: 'yield-router',
    name: 'Yield Ranger',
    room: 'Strategy Pit',
    guardrail: 'Only approved token operations',
    vaultProtected: true,
    vaultCapHbar: 500,
    capabilityGroups: ['accounts', 'accountQueries', 'tokens', 'tokenQueries', 'contracts', 'contractQueries', 'transactionQueries', 'networkQueries'] as CapabilityGroupId[],
  },
  {
    templateId: 'compliance-clerk',
    name: 'Audit Bot',
    room: 'Forum Deck',
    guardrail: 'Read-only access, no mutations',
    vaultProtected: false,
    vaultCapHbar: 0,
    capabilityGroups: ['accountQueries', 'consensusQueries', 'tokenQueries', 'contractQueries', 'transactionQueries', 'networkQueries'] as CapabilityGroupId[],
  },
]

app.post('/api/demo/seed', requireAuth, (_request, response) => {
  if (!demoMode) {
    response.status(403).json({ error: 'Demo seeding is only available in demo mode.' })
    return
  }
  // Clear existing deployments for a fresh demo
  db.clearAllDeployments()
  db.clearActivity()
  db.clearAllChatHistory()
  coordinationLog.length = 0

  const created: DeploymentRecord[] = []

  for (const seed of demoSeedAgents) {
    const topicId = nextDemoTopicId()
    const contractId = seed.vaultProtected ? nextDemoContractId() : null
    const demoAgentAccountId = nextDemoAccountId()
    const deployment: DeploymentRecord = {
      id: `${seed.templateId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      userId: 'demo',
      templateId: seed.templateId,
      name: seed.name,
      room: seed.room,
      guardrail: seed.guardrail,
      vaultProtected: seed.vaultProtected,
      capabilityGroups: seed.capabilityGroups,
      status: seed.vaultProtected ? 'guarded' : 'active',
      lastAction: 'Deployed in demo mode',
      executions: Math.floor(Math.random() * 8) + 1,
      createdAt: new Date().toISOString(),
      topicId,
      contractId,
      contractAddress: contractId ? `0x${Math.random().toString(16).slice(2, 42)}` : null,
      deploymentTxId: nextDemoTxId(),
      vaultCapHbar: seed.vaultCapHbar,
      agentAccountId: demoAgentAccountId,
      agentPrivateKey: '302e_demo_agent_key_' + demoAgentAccountId,
      walletType: 'dedicated',
    }
    db.insertDeployment(deployment)
    created.push(deployment)

    pushActivity(
      `${seed.name} deployed with ${seed.capabilityGroups.length} capability bundles${seed.vaultProtected ? ' and vault guardrails' : ''}.`,
      seed.vaultProtected ? 'vault' : 'success',
    )
  }

  // Add a coordination event for flavor
  const items = db.getAllDeployments()
  const treasury = items.find(d => d.templateId === 'treasury-sentinel')
  const yieldAgent = items.find(d => d.templateId === 'yield-router')
  if (treasury && yieldAgent) {
    coordinationLog.unshift({
      id: `coord-demo-${Date.now()}`,
      sourceAgentId: treasury.id,
      sourceAgentName: treasury.name,
      targetAgentId: yieldAgent.id,
      targetAgentName: yieldAgent.name,
      trigger: 'low_balance',
      action: 'Rebalance funds',
      timestamp: new Date().toISOString(),
      status: 'completed',
    })
  }

  response.status(201).json({ seeded: created.length, deployments: created.map(safeDeployment) })
})

// ═══════════════════════════════════════════════════
// Feature 5: Agent Schedules CRUD
// ═══════════════════════════════════════════════════

const scheduleSchema = z.object({
  cronExpression: z.string().min(5).max(50),
  prompt: z.string().min(1).max(2000),
  description: z.string().max(200).optional(),
})

const scheduleUpdateSchema = z.object({
  cronExpression: z.string().min(5).max(50).optional(),
  prompt: z.string().min(1).max(2000).optional(),
  description: z.string().max(200).optional(),
  enabled: z.boolean().optional(),
})

app.get('/api/agents/:agentId/schedules', requireAuth, readLimiter, (request, response) => {
  const deployment = db.getDeployment(request.params.agentId)
  if (!deployment) { response.status(404).json({ error: 'Agent not found' }); return }
  if (!assertAgentOwnership(deployment, request)) { response.status(403).json({ error: 'You do not own this agent.' }); return }
  const schedules = db.getSchedulesByAgent(deployment.id)
  response.json({ schedules })
})

app.post('/api/agents/:agentId/schedules', requireAuth, toolLimiter, (request, response) => {
  const parsed = scheduleSchema.safeParse(request.body)
  if (!parsed.success) { response.status(400).json({ error: flattenZodError(parsed.error) }); return }

  const deployment = db.getDeployment(request.params.agentId)
  if (!deployment) { response.status(404).json({ error: 'Agent not found' }); return }
  if (!assertAgentOwnership(deployment, request)) { response.status(403).json({ error: 'You do not own this agent.' }); return }

  if (!validateCron(parsed.data.cronExpression)) {
    response.status(400).json({ error: 'Invalid cron expression' })
    return
  }

  const id = `sched-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
  const schedule: db.AgentSchedule = {
    id,
    deploymentId: deployment.id,
    cronExpression: parsed.data.cronExpression,
    prompt: parsed.data.prompt,
    description: parsed.data.description ?? '',
    enabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  db.insertSchedule(schedule)

  // Start the cron job
  startSchedule(id, schedule.cronExpression, () =>
    executeScheduledPrompt(id, deployment.id, schedule.prompt, 'schedule'),
  )

  pushActivity(`Schedule created for ${deployment.name}: ${schedule.description || schedule.cronExpression}`, 'system')
  response.status(201).json({ schedule })
})

app.put('/api/agents/:agentId/schedules/:schedId', requireAuth, (request, response) => {
  const parsed = scheduleUpdateSchema.safeParse(request.body)
  if (!parsed.success) { response.status(400).json({ error: flattenZodError(parsed.error) }); return }

  const deployment = db.getDeployment(request.params.agentId)
  if (!deployment) { response.status(404).json({ error: 'Agent not found' }); return }
  if (!assertAgentOwnership(deployment, request)) { response.status(403).json({ error: 'You do not own this agent.' }); return }

  const existing = db.getSchedule(request.params.schedId)
  if (!existing || existing.deploymentId !== request.params.agentId) {
    response.status(404).json({ error: 'Schedule not found' })
    return
  }

  if (parsed.data.cronExpression && !validateCron(parsed.data.cronExpression)) {
    response.status(400).json({ error: 'Invalid cron expression' })
    return
  }

  db.updateSchedule(existing.id, parsed.data)

  const updated = db.getSchedule(existing.id)!

  // Restart or stop cron
  if (updated.enabled) {
    startSchedule(updated.id, updated.cronExpression, () =>
      executeScheduledPrompt(updated.id, updated.deploymentId, updated.prompt, 'schedule'),
    )
  } else {
    stopSchedule(updated.id)
  }

  response.json({ schedule: updated })
})

app.delete('/api/agents/:agentId/schedules/:schedId', requireAuth, (request, response) => {
  const deployment = db.getDeployment(request.params.agentId)
  if (!deployment) { response.status(404).json({ error: 'Agent not found' }); return }
  if (!assertAgentOwnership(deployment, request)) { response.status(403).json({ error: 'You do not own this agent.' }); return }

  const existing = db.getSchedule(request.params.schedId)
  if (!existing || existing.deploymentId !== request.params.agentId) {
    response.status(404).json({ error: 'Schedule not found' })
    return
  }
  stopSchedule(existing.id)
  db.deleteSchedule(existing.id)
  response.json({ deleted: true })
})

app.get('/api/agents/:agentId/schedules/:schedId/executions', requireAuth, readLimiter, (request, response) => {
  const deployment = db.getDeployment(request.params.agentId)
  if (!deployment) { response.status(404).json({ error: 'Agent not found' }); return }
  if (!assertAgentOwnership(deployment, request)) { response.status(403).json({ error: 'You do not own this agent.' }); return }
  const existing = db.getSchedule(request.params.schedId)
  if (!existing || existing.deploymentId !== request.params.agentId) {
    response.status(404).json({ error: 'Schedule not found' })
    return
  }
  const executions = db.getScheduleExecutions(existing.id)
  response.json({ executions })
})

app.post('/api/agents/:agentId/schedules/:schedId/run', requireAuth, toolLimiter, async (request, response) => {
  const deployment = db.getDeployment(request.params.agentId)
  if (!deployment) { response.status(404).json({ error: 'Agent not found' }); return }
  if (!assertAgentOwnership(deployment, request)) { response.status(403).json({ error: 'You do not own this agent.' }); return }

  const existing = db.getSchedule(request.params.schedId)
  if (!existing || existing.deploymentId !== request.params.agentId) {
    response.status(404).json({ error: 'Schedule not found' })
    return
  }

  try {
    const result = await executeScheduledPrompt(existing.id, existing.deploymentId, existing.prompt, 'schedule')
    response.json({ status: 'completed', result })
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'Execution failed'
    response.json({ status: 'failed', error: errMsg })
  }
})

// ═══════════════════════════════════════════════════
// Feature 6: Event Triggers CRUD
// ═══════════════════════════════════════════════════

const triggerSchema = z.object({
  eventType: z.enum(['hbar_inflow', 'hcs_message', 'token_transfer']),
  config: z.record(z.unknown()).optional(),
  promptTemplate: z.string().min(1).max(2000),
})

const triggerUpdateSchema = z.object({
  eventType: z.enum(['hbar_inflow', 'hcs_message', 'token_transfer']).optional(),
  config: z.record(z.unknown()).optional(),
  promptTemplate: z.string().min(1).max(2000).optional(),
  enabled: z.boolean().optional(),
})

app.get('/api/agents/:agentId/triggers', requireAuth, readLimiter, (request, response) => {
  const deployment = db.getDeployment(request.params.agentId)
  if (!deployment) { response.status(404).json({ error: 'Agent not found' }); return }
  if (!assertAgentOwnership(deployment, request)) { response.status(403).json({ error: 'You do not own this agent.' }); return }
  const triggers = db.getTriggersByAgent(deployment.id)
  response.json({ triggers })
})

app.post('/api/agents/:agentId/triggers', requireAuth, toolLimiter, (request, response) => {
  const parsed = triggerSchema.safeParse(request.body)
  if (!parsed.success) { response.status(400).json({ error: flattenZodError(parsed.error) }); return }

  const deployment = db.getDeployment(request.params.agentId)
  if (!deployment) { response.status(404).json({ error: 'Agent not found' }); return }
  if (!assertAgentOwnership(deployment, request)) { response.status(403).json({ error: 'You do not own this agent.' }); return }

  const id = `trig-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
  const trigger: db.EventTrigger = {
    id,
    deploymentId: deployment.id,
    eventType: parsed.data.eventType,
    config: (parsed.data.config ?? {}) as Record<string, unknown>,
    promptTemplate: parsed.data.promptTemplate,
    enabled: true,
    lastCheckedAt: null,
    lastTriggeredAt: null,
    createdAt: new Date().toISOString(),
  }
  db.insertTrigger(trigger)

  pushActivity(`Event trigger created for ${deployment.name}: ${parsed.data.eventType}`, 'system')
  response.status(201).json({ trigger })
})

app.put('/api/agents/:agentId/triggers/:trigId', requireAuth, (request, response) => {
  const parsed = triggerUpdateSchema.safeParse(request.body)
  if (!parsed.success) { response.status(400).json({ error: flattenZodError(parsed.error) }); return }

  const deployment = db.getDeployment(request.params.agentId)
  if (!deployment) { response.status(404).json({ error: 'Agent not found' }); return }
  if (!assertAgentOwnership(deployment, request)) { response.status(403).json({ error: 'You do not own this agent.' }); return }

  const existing = db.getTrigger(request.params.trigId)
  if (!existing || existing.deploymentId !== request.params.agentId) {
    response.status(404).json({ error: 'Trigger not found' })
    return
  }

  db.updateTriggerFields(existing.id, parsed.data)
  const updated = db.getTrigger(existing.id)!
  response.json({ trigger: updated })
})

app.delete('/api/agents/:agentId/triggers/:trigId', requireAuth, (request, response) => {
  const deployment = db.getDeployment(request.params.agentId)
  if (!deployment) { response.status(404).json({ error: 'Agent not found' }); return }
  if (!assertAgentOwnership(deployment, request)) { response.status(403).json({ error: 'You do not own this agent.' }); return }

  const existing = db.getTrigger(request.params.trigId)
  if (!existing || existing.deploymentId !== request.params.agentId) {
    response.status(404).json({ error: 'Trigger not found' })
    return
  }
  db.deleteTrigger(existing.id)
  response.json({ deleted: true })
})

// ═══════════════════════════════════════════════════
// Bootstrap schedules & event poller at startup
// ═══════════════════════════════════════════════════

function bootstrapSchedules(): void {
  const schedules = db.getAllEnabledSchedules()
  for (const s of schedules) {
    startSchedule(s.id, s.cronExpression, () =>
      executeScheduledPrompt(s.id, s.deploymentId, s.prompt, 'schedule'),
    )
  }
  if (schedules.length > 0) {
    console.log(`[Aivy] Bootstrapped ${schedules.length} schedule(s).`)
  }
}

function bootstrapEventPoller(): void {
  // Always start poller so new triggers are picked up dynamically
  startPoller(
    config.mirrorNodeUrl,
    (triggerId, deploymentId, filledPrompt) =>
      executeScheduledPrompt(triggerId, deploymentId, filledPrompt, 'trigger').then(() => {}),
    30_000,
  )
}

// ─── Graceful Shutdown ──────────────────────────────
function gracefulShutdown(signal: string): void {
  console.log(`[Aivy] Received ${signal}, shutting down...`)
  stopAllSchedules()
  stopPoller()
  db.close()
  process.exit(0)
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
process.on('SIGINT', () => gracefulShutdown('SIGINT'))

app.listen(config.port, () => {
  const mode = isConfigured ? 'live testnet mode' : demoMode ? 'demo mode (no Hedera keys)' : 'config required mode'
  console.log(`[Aivy] server listening on http://localhost:${config.port} (${mode})`)
  bootstrapSchedules()
  bootstrapEventPoller()
})
