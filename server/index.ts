import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import cors from 'cors'
import dotenv from 'dotenv'
import express from 'express'
import solc from 'solc'
import OpenAI from 'openai'
import {
  AgentMode,
  HederaAIToolkit,
  coreAccountPlugin,
  coreAccountPluginToolNames,
  coreAccountQueryPlugin,
  coreAccountQueryPluginToolNames,
  coreConsensusPlugin,
  coreConsensusPluginToolNames,
  coreConsensusQueryPlugin,
  coreConsensusQueryPluginToolNames,
  coreEVMPlugin,
  coreEVMPluginToolNames,
  coreEVMQueryPlugin,
  coreEVMQueryPluginToolNames,
  coreMiscQueriesPlugin,
  coreMiscQueriesPluginsToolNames,
  coreTokenPlugin,
  coreTokenPluginToolNames,
  coreTokenQueryPlugin,
  coreTokenQueryPluginToolNames,
  coreTransactionQueryPlugin,
  coreTransactionQueryPluginToolNames,
} from 'hedera-agent-kit'
import {
  AccountCreateTransaction,
  AccountId,
  Client,
  ContractCreateFlow,
  ContractExecuteTransaction,
  ContractFunctionParameters,
  ContractId,
  Hbar,
  PrivateKey,
  TransferTransaction,
} from '@hashgraph/sdk'
import multer from 'multer'
import { z } from 'zod'
import { initMasterKey } from './crypto.js'
import * as db from './db.js'
import { initAuth, generateChallenge, consumeChallenge, verifyAccountExists, issueToken } from './auth.js'
import { authMiddleware, requireAuth, type AuthRequest } from './middleware.js'
import { deployLimiter, chatLimiter, toolLimiter, readLimiter, authLimiter } from './rateLimiter.js'
import { startSchedule, stopSchedule, stopAllSchedules, validateCron, acquireAgentLock, releaseAgentLock } from './scheduler.js'
import { startPoller, stopPoller } from './eventPoller.js'
import { isKmsAvailable, createAgentKmsKey, kmsEncryptKey, kmsDecryptKey, scheduleKmsKeyDeletion } from './kms.js'
import { saucerswapPlugin } from 'hak-saucerswap-plugin'
import { pythPlugin } from 'hak-pyth-plugin'
import { memejobPlugin } from '@buidlerlabs/hak-memejob-plugin'
import { bonzoPlugin } from '@bonzofinancelabs/hak-bonzo-plugin'
// coincap-hedera-plugin & chainlink-pricefeed-plugin have broken ESM packaging
// (they use `import` syntax in .js files without "type": "module").
// We inline lightweight plugin wrappers that replicate their tool logic directly.
import { ethers } from 'ethers'
import axios from 'axios'

// Patch the global axios.create to inject x-api-key for SaucerSwap instances.
// The hak-saucerswap-plugin calls axios.create({ baseURL: "https://api.saucerswap.finance" })
// and the API now requires an API key via x-api-key header.
if (process.env.SAUCERSWAP_API_KEY) {
  const _origCreate = axios.create.bind(axios)
  axios.create = function patchedCreate(config?: Parameters<typeof _origCreate>[0]) {
    const instance = _origCreate(config)
    if (config?.baseURL?.includes('saucerswap.finance')) {
      instance.defaults.headers.common['x-api-key'] = process.env.SAUCERSWAP_API_KEY!
    }
    return instance
  } as typeof axios.create
}

const CoinCapHederaPlugin = {
  name: 'CoinCapHederaPlugin',
  version: '1.0.1',
  description: 'Get the current HBAR price in USD via CoinCap API.',
  tools: () => [{
    method: 'get_hbar_price_in_USD_tool',
    name: 'get HBAR price in USD Tool',
    description: 'Get the current HBAR price in USD from CoinCap API. No parameters required.',
    parameters: z.object({}),
    execute: async () => {
      const res = await fetch('https://rest.coincap.io/v3/price/bysymbol/hbar', {
        headers: {
          Authorization: `Bearer ${process.env.COINCAP_BEARER_TOKEN}`,
          'Content-Type': 'application/json',
        },
      })
      if (!res.ok) throw new Error(`CoinCap HTTP ${res.status}`)
      const json = (await res.json()) as { data: string[] }
      const price = Number(json.data[0])
      return { humanMessage: `Current HBAR price: $${price.toFixed(4)} USD`, raw: { price } }
    },
  }],
}

const CHAINLINK_FEEDS: Record<string, string> = {
  BTC: '0x058fe79cb5775d4b167920ca6036b824805a9abd',
  ETH: '0xb9d461e0b962af219866adfa7dd19c52bb9871b9',
  HBAR: '0x59bc155eb6c6c415fe43255af66ecf0523c92b4a',
  LINK: '0xeb93a53c648e3e89bc0fc327d36a37619b1cf0cd',
  USDC: '0x2946220288dbaec91a26c772f5a1bb7b191c1a73',
  USDT: '0x1c5275a77d74c89256801322e9a52a991c68e79b',
  DAI: '0xb7546c6ebfc0b6b4fe68909734d7e2c1c5a3ffdf',
}
const AGGREGATOR_ABI = [
  'function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)',
  'function decimals() view returns (uint8)',
]

const ChainlinkPriceFeedPlugin = {
  name: 'ChainlinkPriceFeedPlugin',
  version: '1.0.0',
  description: 'Query Chainlink Price Feed oracles on Hedera Testnet.',
  tools: () => [{
    method: 'get_chainlink_price_feed_tool',
    name: 'get Chainlink price feed Tool',
    description: 'Get a price feed from a Chainlink oracle on Hedera Testnet. Params: coinId (BTC, ETH, HBAR, LINK, USDC, USDT, DAI).',
    parameters: z.object({ coinId: z.string() }),
    execute: async (_client: unknown, _context: unknown, params: { coinId: string }) => {
      const addr = CHAINLINK_FEEDS[params.coinId]
      if (!addr) throw new Error(`Unknown coinId: ${params.coinId}. Supported: ${Object.keys(CHAINLINK_FEEDS).join(', ')}`)
      const provider = new ethers.JsonRpcProvider('https://testnet.hashio.io/api')
      const contract = new ethers.Contract(addr, AGGREGATOR_ABI, provider)
      const [roundId, answer, , updatedAt] = await contract.latestRoundData()
      const decimals = await contract.decimals()
      const price = Number(answer) / Math.pow(10, Number(decimals))
      return {
        humanMessage: `${params.coinId}/USD: $${price.toFixed(Number(decimals))}`,
        raw: { coinId: params.coinId, contractAddress: addr, price: price.toString(), decimals: Number(decimals), roundId: roundId.toString(), updatedAt: new Date(Number(updatedAt) * 1000).toISOString() },
      }
    },
  }],
}

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
  'saucerswap',
  'pyth',
  'memejob',
  'bonzo',
  'coincap',
  'chainlink',
  'sentiment',
] as const

// Third-party plugin tool names — always use .method (the snake_case identifier
// that HederaAIToolkit registers internally), never .name (display label with spaces)
const sanitizeToolName = (n: string) => n.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_-]/g, '')
const saucerswapTools = saucerswapPlugin.tools().map((t: { method: string }) => t.method)
const pythTools = pythPlugin.tools().map((t: { method: string }) => t.method)
const memejobTools = memejobPlugin.tools().map((t: { method: string }) => t.method)
const bonzoTools = bonzoPlugin.tools().map((t: { method: string }) => t.method)
// CoinCap & Chainlink plugins have broken ESM packaging — hardcode their single tool names
const coincapTools = ['get_hbar_price_in_USD_tool']
const chainlinkTools = ['get_chainlink_price_feed_tool']
const sentimentTools = ['crypto_sentiment_tool']

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

const VALID_TEMPLATE_IDS = ['treasury-sentinel', 'yield-router', 'compliance-clerk', 'governance-relay', 'bonzo-keeper'] as const

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

// Read AivyVault contract source from the .sol file
const __dirname = dirname(fileURLToPath(import.meta.url))
const AIVY_VAULT_SOURCE = readFileSync(
  resolve(__dirname, '..', 'contracts', 'AivyVault.sol'),
  'utf-8',
)

// Migrate old JSON deployments to SQLite on first run
db.migrateFromJson()
const startupDeployments = db.getAllDeployments()
console.log(`[Aivy] ${startupDeployments.length} agent(s) loaded from database.`)

// ─── Chat (OpenAI) ───────────────────────────────
const chatEnabled = !!process.env.OPENAI_API_KEY
const openai = chatEnabled ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null

// Retry wrapper for OpenAI calls to handle 429 rate-limit errors
async function withRetry<T>(fn: () => Promise<T>, maxRetries = 5): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (err: unknown) {
      const status = (err as { status?: number }).status
      if (status === 429 && attempt < maxRetries) {
        // Parse retry-after header; fall back to exponential backoff (3s, 6s, 12s, 24s, 48s)
        const retryAfter = Number((err as { headers?: Record<string, string> }).headers?.['retry-after']) || 0
        const delay = Math.max(retryAfter * 1000, 3000 * Math.pow(2, attempt))
        console.log(`[chat] Rate limited, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`)
        await new Promise(r => setTimeout(r, delay))
        continue
      }
      throw err
    }
  }
  throw new Error('withRetry: unreachable')
}

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
  'bonzo-keeper': {
    tagline: 'Intelligent DeFi Keeper Agent',
    mission: 'Manage yield on Bonzo Finance lending vaults with sentiment-aware harvesting and autonomous deposit/withdraw strategies.',
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
    // KMS security info — so the agent can answer questions about its key protection
    deployment.kmsKeyId
      ? [
          '## KEY SECURITY — AWS KMS ENVELOPE ENCRYPTION',
          `Your Ed25519 signing key is protected by AWS KMS envelope encryption (KMS Key ID: ${deployment.kmsKeyId}).`,
          'How it works:',
          '- You have a dedicated AWS KMS symmetric key that wraps your Ed25519 private key.',
          '- Your private key is NEVER stored in plaintext — it is encrypted (envelope encryption) and only decrypted in-memory for <50ms during transaction signing, then immediately wiped with Buffer.fill(0).',
          '- This provides defense-in-depth: even if the database is compromised, the attacker cannot extract your signing key without access to AWS KMS.',
          'Aivy uses a three-layer security model:',
          '1. **Application layer**: JWT authentication + AES-256-GCM encryption at rest',
          '2. **Smart contract layer**: AivyVault.sol on-chain spending caps',
          '3. **Cloud HSM layer**: AWS KMS envelope encryption for signing keys',
          'If a user asks about your security, key management, or KMS — you can confidently explain this setup.',
        ].join('\n')
      : '',
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
    '## NFT MINTING FROM IMAGES',
    'When the user attaches an image and asks to mint an NFT:',
    '1. Use create_non_fungible_token_tool to create a new NFT collection (use the name they provide, or "Aivy NFT")',
    '2. Then use mint_non_fungible_token_tool with the EXACT metadata URI from the message — look for "[NFT metadata URI: https://...]"',
    '3. CRITICAL: You MUST use the exact URL from the message. NEVER make up or fabricate IPFS URIs. The metadata URL will start with https://aivylabs.xyz/uploads/',
    '4. Pass it in the "uris" parameter as an array: {"tokenId": "0.0.XXX", "uris": ["https://aivylabs.xyz/uploads/..."]}',
    'Always create the collection first, then mint. Report the token ID, serial number, and a link to view it on HashScan.',
    '',
    // Bonzo Keeper specific instructions
    deployment.templateId === 'bonzo-keeper' ? [
      '## BONZO KEEPER — INTELLIGENT DeFi AGENT',
      'You are a sentiment-aware DeFi keeper for Bonzo Finance lending vaults on Hedera.',
      '',
      '### Your Core Capabilities:',
      '1. **Market Analysis**: Use crypto_sentiment_tool to check Fear & Greed Index before making decisions',
      '2. **Deposit**: Use bonzo_deposit_tool to supply tokens into Bonzo lending pools',
      '3. **Withdraw**: Use bonzo_withdraw_tool to pull tokens from lending pools',
      '4. **Market Data**: Use bonzo_market_data_tool to check current APY rates',
      '5. **Price Feeds**: Use Pyth/Chainlink/CoinCap for real-time price data',
      '',
      '### Decision Framework:',
      '- When sentiment is EXTREME FEAR (0-25): Recommend withdrawing and moving to stables',
      '- When sentiment is FEAR (25-40): Recommend cautious positions, harvest rewards',
      '- When sentiment is NEUTRAL (40-60): Continue current strategy normally',
      '- When sentiment is GREED (60-75): Consider new deposits, let rewards accumulate',
      '- When sentiment is EXTREME GREED (75-100): Take some profits, reduce exposure',
      '',
      '### Workflow for "I want yield on my HBAR":',
      '1. Check sentiment with crypto_sentiment_tool',
      '2. Check Bonzo rates with bonzo_market_data_tool',
      '3. Recommend the best strategy based on sentiment + rates',
      '4. If user agrees, approve tokens then deposit',
      '',
      '### Auto-Mode Keeper Logic:',
      'When running autonomously, follow this loop:',
      '1. Check sentiment → if bearish, harvest and convert to stables',
      '2. Check Bonzo rates → find best APY opportunities',
      '3. Report findings and actions taken',
      '',
    ].join('\n') : '',
    '',
    'Be concise but informative. Use markdown formatting: **bold** for key values, `code` for IDs/addresses, and bullet lists with "- " for structured data.',
    'Format amounts clearly (e.g., "**142.5 HBAR**"). When you return tool results, summarize them in a human-friendly way with proper formatting.',
    'IMPORTANT: All HashScan links MUST use testnet, not mainnet. Use https://hashscan.io/testnet/ (never /mainnet/).',
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
        name: sanitizeToolName(tool.name),
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
  {
    id: 'saucerswap',
    label: 'SaucerSwap DEX',
    description: 'Token swaps, liquidity pools, and yield farming on SaucerSwap.',
    tone: 'teal',
    tools: saucerswapTools,
  },
  {
    id: 'pyth',
    label: 'Pyth Oracle',
    description: 'Real-time price feeds from Pyth Network (400+ assets).',
    tone: 'amber',
    tools: pythTools,
  },
  {
    id: 'memejob',
    label: 'Memejob',
    description: 'Create, buy, and sell meme tokens on the Memejob protocol.',
    tone: 'rose',
    tools: memejobTools,
  },
  {
    id: 'bonzo',
    label: 'Bonzo Finance',
    description: 'Decentralised lending and borrowing on Hedera via Bonzo (Aave v2).',
    tone: 'teal',
    tools: bonzoTools,
  },
  {
    id: 'coincap',
    label: 'CoinCap',
    description: 'Get real-time HBAR price in USD from CoinCap API.',
    tone: 'amber',
    tools: coincapTools,
  },
  {
    id: 'sentiment',
    label: 'Market Sentiment',
    description: 'Crypto Fear & Greed Index and market sentiment analysis for keeper decisions.',
    tone: 'rose',
    tools: sentimentTools,
  },
  {
    id: 'chainlink',
    label: 'Chainlink Oracles',
    description: 'Price feeds from Chainlink decentralised oracles (BTC, ETH, HBAR, LINK, USDC, USDT, DAI).',
    tone: 'blue',
    tools: chainlinkTools,
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
    'coincap',
    'chainlink',
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
    'saucerswap',
    'pyth',
    'bonzo',
    'memejob',
    'coincap',
    'chainlink',
  ],
  'compliance-clerk': [
    'accountQueries',
    'consensusQueries',
    'tokenQueries',
    'contractQueries',
    'transactionQueries',
    'networkQueries',
    'coincap',
    'chainlink',
  ],
  'governance-relay': [
    'accounts',
    'accountQueries',
    'consensus',
    'consensusQueries',
    'transactionQueries',
    'networkQueries',
  ],
  'bonzo-keeper': [
    'accounts',
    'accountQueries',
    'tokens',
    'tokenQueries',
    'contracts',
    'contractQueries',
    'transactionQueries',
    'networkQueries',
    'bonzo',
    'pyth',
    'coincap',
    'chainlink',
    'sentiment',
  ],
}

const suggestedToolsByTemplate: Record<string, string[]> = {
  'treasury-sentinel': [
    coreAccountPluginToolNames.TRANSFER_HBAR_TOOL,
    coreAccountQueryPluginToolNames.GET_HBAR_BALANCE_QUERY_TOOL,
    coreConsensusPluginToolNames.CREATE_TOPIC_TOOL,
    coreConsensusPluginToolNames.SUBMIT_TOPIC_MESSAGE_TOOL,
    ...coincapTools,
    ...chainlinkTools,
  ],
  'yield-router': [
    coreTokenPluginToolNames.CREATE_FUNGIBLE_TOKEN_TOOL,
    coreTokenPluginToolNames.MINT_FUNGIBLE_TOKEN_TOOL,
    coreEVMPluginToolNames.CREATE_ERC20_TOOL,
    coreEVMPluginToolNames.TRANSFER_ERC20_TOOL,
    ...saucerswapTools.slice(0, 2),
    ...pythTools.slice(0, 1),
    ...bonzoTools.slice(0, 2),
    ...memejobTools.slice(0, 1),
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
  'bonzo-keeper': [
    ...bonzoTools,
    ...pythTools.slice(0, 1),
    ...coincapTools,
    ...chainlinkTools,
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

  // ── SaucerSwap plugin ────────────────────────────
  saucerswap_swap_tokens: {
    fromToken: 'HBAR',
    toToken: '0.0.456858',
    amount: '10',
    slippageTolerance: 0.5,
  },
  saucerswap_get_swap_quote: {
    fromToken: 'HBAR',
    toToken: '0.0.456858',
    amount: '10',
    slippageTolerance: 0.5,
  },
  saucerswap_get_pools: {
    tokenA: 'HBAR',
    tokenB: '0.0.456858',
    version: 'v1',
    limit: 10,
  },
  saucerswap_add_liquidity: {
    tokenA: 'HBAR',
    tokenB: '0.0.456858',
    amountA: '10',
    amountB: '50',
    slippageTolerance: 0.5,
  },
  saucerswap_remove_liquidity: {
    tokenA: 'HBAR',
    tokenB: '0.0.456858',
    lpTokenAmount: '100',
    minAmountA: '5',
    minAmountB: '25',
  },
  saucerswap_get_farms: {
    poolId: 1,
  },

  // ── Pyth plugin ──────────────────────────────────
  pyth_list_price_feeds: {
    query: 'BTC',
  },
  pyth_get_latest_price: {
    symbol: 'HBAR/USD',
  },
  pyth_get_latest_prices: {
    symbols: ['BTC/USD', 'ETH/USD'],
  },

  // ── Memejob plugin ──────────────────────────────
  create_memejob_token_tool: {
    required: { name: 'MyCoin', symbol: 'MYCN', memo: 'ipfs://metadata' },
    optional: { amount: 0, distributeRewards: true },
  },
  buy_memejob_token_tool: {
    required: { tokenId: '0.0.1234', amount: 100 },
    optional: { autoAssociate: true },
  },
  sell_memejob_token_tool: {
    required: { tokenId: '0.0.1234', amount: 50 },
    optional: { instant: true },
  },

  // ── Bonzo plugin ─────────────────────────────────
  bonzo_market_data_tool: {},
  approve_erc20_tool: {
    required: { tokenSymbol: 'USDC', amount: '1000' },
    optional: { useMax: false },
  },
  bonzo_deposit_tool: {
    required: { tokenSymbol: 'USDC', amount: '100' },
    optional: { referralCode: 0 },
  },
  bonzo_withdraw_tool: {
    required: { tokenSymbol: 'USDC', amount: '50' },
    optional: { withdrawAll: false },
  },
  bonzo_borrow_tool: {
    required: { tokenSymbol: 'USDC', amount: '200', rateMode: 'variable' },
    optional: { referralCode: 0 },
  },
  bonzo_repay_tool: {
    required: { tokenSymbol: 'USDC', amount: '100', rateMode: 'variable' },
    optional: { repayAll: false },
  },

  // ── CoinCap plugin ──────────────────────────────
  get_hbar_price_in_USD_tool: {},

  // ── Chainlink plugin ────────────────────────────
  get_chainlink_price_feed_tool: {
    coinId: 'HBAR',
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
  'bonzo-keeper': [
    {
      id: 'bonzo-market',
      title: 'Check Bonzo rates',
      description: 'Fetch real-time market data from Bonzo Finance.',
      toolName: 'bonzo_market_data_tool',
      params: {},
    },
    {
      id: 'bonzo-deposit',
      title: 'Deposit to Bonzo',
      description: 'Supply tokens to a Bonzo lending pool.',
      toolName: 'bonzo_deposit_tool',
      params: {
        tokenSymbol: 'USDC',
        amount: 10,
      },
    },
    {
      id: 'bonzo-withdraw',
      title: 'Withdraw from Bonzo',
      description: 'Withdraw supplied tokens from Bonzo.',
      toolName: 'bonzo_withdraw_tool',
      params: {
        tokenSymbol: 'USDC',
        amount: 10,
      },
    },
    {
      id: 'bonzo-sentiment',
      title: 'Check crypto sentiment',
      description: 'Analyze current market sentiment for decision-making.',
      toolName: 'crypto_sentiment_tool',
      params: {},
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

/** Create a brand-new Hedera account funded from the operator for a dedicated agent.
 *  When KMS is available, uses Ed25519 keys encrypted via KMS envelope encryption.
 *  Otherwise falls back to ECDSA with local AES-256-GCM encryption. */
const createAgentAccount = async (
  initialHbar = 1,
  opts?: { agentId?: string; agentName?: string; useKms?: boolean },
): Promise<{ accountId: string; privateKey: string; kmsKeyId: string | null }> => {
  if (!client) throw new Error('Hedera client is not configured.')

  const useKms = opts?.useKms !== false && isKmsAvailable()

  // KMS agents use Ed25519; legacy agents use ECDSA
  const agentKey = useKms ? PrivateKey.generateED25519() : PrivateKey.generateECDSA()

  const tx = await new AccountCreateTransaction()
    .setKey(agentKey.publicKey)
    .setInitialBalance(new Hbar(initialHbar))
    .setTransactionMemo('Aivy agent account')
    .execute(client)

  const receipt = await tx.getReceipt(client)
  const accountId = receipt.accountId?.toString()
  if (!accountId) throw new Error('Account creation receipt missing accountId.')

  let kmsKeyId: string | null = null
  let storedPrivateKey: string

  if (useKms && opts?.agentId) {
    // Envelope encryption: create per-agent KMS key, encrypt private key
    kmsKeyId = await createAgentKmsKey(opts.agentId, opts.agentName ?? accountId)
    const rawBytes = agentKey.toBytesDer()
    storedPrivateKey = await kmsEncryptKey(kmsKeyId, rawBytes, opts.agentId)
    console.log(`[KMS] Agent ${opts.agentName ?? accountId}: Ed25519 key encrypted with KMS key ${kmsKeyId}`)
  } else {
    // Local encryption (handled by db.ts encrypt() on insert)
    storedPrivateKey = agentKey.toStringRaw()
  }

  return { accountId, privateKey: storedPrivateKey, kmsKeyId }
}

/** Build a Hedera Client configured with a per-agent key pair.
 * @param kmsKeyId — when present the key was generated as Ed25519 by KMS;
 *   when absent the key is legacy ECDSA.  We MUST use the correct parser
 *   because PrivateKey.fromStringECDSA() silently "succeeds" on Ed25519 raw
 *   bytes but produces a completely different (wrong) key pair.
 * @param deploymentId — required for KMS agents to provide encryption context */
const createAgentClient = async (
  accountId: string,
  privateKey: string,
  kmsKeyId?: string | null,
  deploymentId?: string,
): Promise<Client> => {
  const agentClient = config.network === 'mainnet' ? Client.forMainnet() : Client.forTestnet()
  let key: PrivateKey
  try {
    if (kmsKeyId && deploymentId) {
      // KMS agents: decrypt ciphertext → Ed25519
      const plaintext = await kmsDecryptKey(kmsKeyId, privateKey, deploymentId)
      key = PrivateKey.fromBytesED25519(plaintext)
      plaintext.fill(0) // Wipe from memory
    } else if (kmsKeyId) {
      // KMS key but no deploymentId — try as raw Ed25519 string
      key = PrivateKey.fromStringED25519(privateKey)
    } else {
      // Legacy agents use ECDSA
      key = PrivateKey.fromStringECDSA(privateKey)
    }
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

// ─── ERC-8183 AivyJobManager Compilation ────────────
const AIVY_JOB_MANAGER_SOURCE = readFileSync(
  resolve(__dirname, '..', 'contracts', 'AivyJobManager.sol'),
  'utf-8',
)

const compileJobManager = () => {
  const input = {
    language: 'Solidity',
    sources: {
      'AivyJobManager.sol': {
        content: AIVY_JOB_MANAGER_SOURCE,
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
      'AivyJobManager.sol'?: {
        AivyJobManager?: {
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

  const contract = output.contracts?.['AivyJobManager.sol']?.AivyJobManager
  if (!contract?.evm.bytecode.object) {
    throw new Error('Failed to compile AivyJobManager contract.')
  }

  console.log('[Aivy] AivyJobManager (ERC-8183) compiled successfully.')
  return {
    abi: contract.abi,
    bytecode: contract.evm.bytecode.object,
  }
}

const compiledJobManager = compileJobManager()

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

/** Enriched descriptions for plugin tools whose originals are too vague for OpenAI */
const toolDescriptionOverrides: Record<string, string> = {
  saucerswap_swap_tokens: 'Execute a token swap on SaucerSwap DEX. Params: fromToken (token ID or "HBAR"), toToken (token ID), amount (decimal string), slippageTolerance (number, default 0.5).',
  saucerswap_get_swap_quote: 'Get a price quote for swapping tokens on SaucerSwap. Params: fromToken (token ID or "HBAR"), toToken (token ID), amount (decimal string), slippageTolerance (number, default 0.5).',
  saucerswap_get_pools: 'Query SaucerSwap liquidity pools. Params: tokenA (token ID or symbol), tokenB (token ID or symbol), version ("v1" or "v2"), limit (number).',
  saucerswap_add_liquidity: 'Add liquidity to a SaucerSwap pool. Params: tokenA, tokenB (token IDs), amountA, amountB (decimal strings), slippageTolerance (default 0.5).',
  saucerswap_remove_liquidity: 'Remove liquidity from a SaucerSwap pool. Params: tokenA, tokenB (token IDs), lpTokenAmount, minAmountA, minAmountB (decimal strings).',
  saucerswap_get_farms: 'Get active farming opportunities on SaucerSwap. Params: poolId (optional number to filter).',
  pyth_list_price_feeds: 'List available Pyth price feeds. Params: query (string to filter by symbol, e.g. "BTC" or "HBAR").',
  pyth_get_latest_price: 'Get the latest price from Pyth oracle for a given symbol. Params: symbol (e.g. "HBAR/USD", "BTC/USD") OR priceFeedId (hex string).',
  pyth_get_latest_prices: 'Get latest prices from Pyth oracle for multiple symbols. Params: symbols (array of strings, e.g. ["BTC/USD","ETH/USD"]).',
  create_memejob_token_tool: 'Create a new meme token on Memejob. Params: required { name, symbol, memo (IPFS path) }, optional { amount, distributeRewards }.',
  buy_memejob_token_tool: 'Buy a meme token on Memejob. Params: required { tokenId (string), amount (number) }, optional { autoAssociate }.',
  sell_memejob_token_tool: 'Sell a meme token on Memejob. Params: required { tokenId (string), amount (number) }, optional { instant }.',
  bonzo_market_data_tool: 'Get Bonzo Finance lending market data and interest rates. No required params.',
  approve_erc20_tool: 'Approve ERC-20 token spending on Bonzo. Params: required { tokenSymbol, amount }, optional { useMax }.',
  bonzo_deposit_tool: 'Deposit tokens into Bonzo lending protocol. Params: required { tokenSymbol, amount }.',
  bonzo_withdraw_tool: 'Withdraw tokens from Bonzo lending protocol. Params: required { tokenSymbol, amount }, optional { withdrawAll }.',
  bonzo_borrow_tool: 'Borrow tokens from Bonzo lending protocol. Params: required { tokenSymbol, amount, rateMode ("variable" or "stable") }.',
  bonzo_repay_tool: 'Repay borrowed tokens on Bonzo lending protocol. Params: required { tokenSymbol, amount, rateMode }, optional { repayAll }.',
  get_hbar_price_in_USD_tool: 'Get the current HBAR price in USD from CoinCap API. No params required.',
  get_chainlink_price_feed_tool: 'Get a price feed from Chainlink oracle on Hedera. Params: coinId (string, e.g. "HBAR", "BTC", "ETH", "LINK", "USDC", "USDT", "DAI").',
  crypto_sentiment_tool: 'Analyze crypto market sentiment using the Fear & Greed Index and Bonzo lending rates. Returns sentiment score (0-100), trend, and keeper recommendations for DeFi strategy. No params required. Use this before making deposit/withdraw/harvest decisions.',
}

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
      // When custom plugins are registered, PluginRegistry skips core plugins,
      // so we must explicitly include every core plugin alongside third-party ones.
      plugins: [
        coreAccountPlugin,
        coreAccountQueryPlugin,
        coreConsensusPlugin,
        coreConsensusQueryPlugin,
        coreEVMPlugin,
        coreEVMQueryPlugin,
        coreMiscQueriesPlugin,
        coreTokenPlugin,
        coreTokenQueryPlugin,
        coreTransactionQueryPlugin,
        saucerswapPlugin,
        pythPlugin,
        memejobPlugin,
        bonzoPlugin,
        CoinCapHederaPlugin,
        ChainlinkPriceFeedPlugin,
      ],
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
    const description = String(
      toolDescriptionOverrides[toolName] ?? runtimeTool?.description ?? fallbackToolDescription(toolName),
    ).replace(/\s+/g, ' ').trim()

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

// ─── Crypto Sentiment Tool (Fear & Greed Index) ───────────────
const fetchCryptoSentiment = async (): Promise<ToolResponse> => {
  try {
    const [fngRes, bonzoRes] = await Promise.all([
      fetch('https://api.alternative.me/fng/?limit=7'),
      fetch('https://mainnet-data-staging.bonzo.finance/market').catch(() => null),
    ])
    const fngData = (await fngRes.json()) as { data: Array<{ value: string; value_classification: string; timestamp: string }> }
    const latest = fngData.data[0]
    const history = fngData.data.slice(0, 7)
    const avg7d = Math.round(history.reduce((s, d) => s + Number(d.value), 0) / history.length)
    const trend = Number(history[0].value) > Number(history[history.length - 1].value) ? 'improving' : 'declining'

    // Bonzo market data if available
    let bonzoSummary = ''
    if (bonzoRes?.ok) {
      const bonzoData = (await bonzoRes.json()) as Array<{ symbol: string; supplyAPY: string; borrowAPY: string; availableLiquidityUSD: string }>
      const topPools = bonzoData
        .filter((m: any) => Number(m.availableLiquidityUSD) > 1000)
        .sort((a: any, b: any) => Number(b.supplyAPY) - Number(a.supplyAPY))
        .slice(0, 5)
      if (topPools.length > 0) {
        bonzoSummary = '\n\n**Top Bonzo Lending Rates:**\n' +
          topPools.map((p: any) => `- **${p.symbol}**: ${(Number(p.supplyAPY) * 100).toFixed(2)}% supply APY, $${Number(p.availableLiquidityUSD).toLocaleString()} liquidity`).join('\n')
      }
    }

    const score = Number(latest.value)
    let recommendation = ''
    if (score <= 25) recommendation = 'EXTREME FEAR — Consider harvesting rewards immediately and moving to stablecoins. High risk of further decline.'
    else if (score <= 40) recommendation = 'FEAR — Cautious approach. Harvest rewards and hold in stable positions. Wait for sentiment improvement before new deposits.'
    else if (score <= 60) recommendation = 'NEUTRAL — Normal operations. Continue current strategy with regular harvesting schedule.'
    else if (score <= 75) recommendation = 'GREED — Market is optimistic. Consider letting rewards accumulate for price appreciation. Good time for new deposits.'
    else recommendation = 'EXTREME GREED — Market may be overheated. Consider taking profits and reducing exposure. Harvest and convert some to stables.'

    return {
      humanMessage: [
        `**Crypto Market Sentiment Analysis**`,
        ``,
        `**Fear & Greed Index**: ${latest.value}/100 — **${latest.value_classification}**`,
        `**7-day Average**: ${avg7d}/100 (${trend})`,
        `**Trend**: ${history.map(d => d.value).join(' → ')}`,
        ``,
        `**Keeper Recommendation**: ${recommendation}`,
        bonzoSummary,
      ].join('\n'),
      raw: {
        score,
        classification: latest.value_classification,
        average7d: avg7d,
        trend,
        recommendation,
        history: history.map(d => ({ value: Number(d.value), label: d.value_classification })),
      },
    }
  } catch (err) {
    return {
      humanMessage: `Failed to fetch sentiment data: ${err instanceof Error ? err.message : String(err)}`,
      raw: { error: String(err) },
    }
  }
}

const executeTool = async (toolName: string, params: Record<string, unknown>, agentClient?: Client) => {
  // Handle custom tools that aren't in HederaAIToolkit
  if (toolName === 'crypto_sentiment_tool') {
    return fetchCryptoSentiment()
  }

  const toolkit = getToolkit(undefined, agentClient)
  const tool = toolkit.getTools()[toolName]
  if (!tool) {
    throw new Error(`Tool ${toolName} is not available.`)
  }

  const execute = tool.execute as unknown as (
    input: Record<string, unknown>,
  ) => Promise<string | ToolResponse>

  // Map form field names to Hedera Agent Kit expected parameter names
  if (toolName === 'mint_non_fungible_token_tool') {
    if (params['metadata'] && !params['uris']) {
      const meta = params['metadata']
      params['uris'] = Array.isArray(meta) ? meta : [meta]
      delete params['metadata']
    }
  }

  const result = await execute(params)

  // HederaAIToolkit wraps results in JSON.stringify — parse back to object
  let parsed: Record<string, unknown>
  if (typeof result === 'string') {
    try {
      parsed = JSON.parse(result)
    } catch {
      return { raw: {}, humanMessage: result } as ToolResponse
    }
  } else {
    parsed = result as Record<string, unknown>
  }

  // If the result already has humanMessage/raw, return as-is
  if ('humanMessage' in parsed || 'raw' in parsed) {
    return parsed as ToolResponse
  }

  // Plugin-native format: { success, error, ... } → normalize to ToolResponse
  if (parsed.success === false && typeof parsed.error === 'string') {
    throw new Error(parsed.error)
  }

  // Successful plugin result without humanMessage — synthesize one
  const humanMsg = typeof parsed.message === 'string'
    ? parsed.message
    : (parsed.success === true ? `${toolName} completed successfully.` : JSON.stringify(parsed).slice(0, 200))
  return { raw: parsed, humanMessage: humanMsg } as ToolResponse
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
    case 'transaction': {
      // Mirror Node path format: 0.0.XXXXX-SECONDS-NANOS (replace @ with - and first . after @ with -)
      const mirrorTxId = value.replace('@', '-').replace(/\.(\d+)$/, '-$1')
      return `${config.mirrorNodeUrl}/transactions/${encodeURIComponent(mirrorTxId)}`
    }
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

// ─── ERC-8183 JobManager Deployment ─────────────────
const deployJobManagerContract = async () => {
  if (!client) {
    throw new Error('Hedera client is not configured.')
  }

  const transaction = await new ContractCreateFlow()
    .setGas(4_000_000)
    .setBytecode(compiledJobManager.bytecode)
    .execute(client)
  const receipt = await transaction.getReceipt(client)

  return {
    transactionId: transaction.transactionId.toString(),
    contractId: receipt.contractId?.toString() ?? null,
    contractAddress: receipt.contractId?.toSolidityAddress() ?? null,
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

const buildStats = async (items?: DeploymentRecord[]) => {
  const deployments = items ?? db.getAllDeployments()

  // Fetch real on-chain balances from mirror node for all agents
  let totalBalance = 0
  const balancePromises = deployments.map(async (d) => {
    if (!d.agentAccountId) return 0
    try {
      const res = await fetch(`${config.mirrorNodeUrl}/accounts/${d.agentAccountId}`)
      if (!res.ok) return 0
      const data = await res.json() as { balance?: { balance?: number } }
      const tinybar = data?.balance?.balance ?? 0
      return tinybar / 1e8 // convert tinybars to HBAR
    } catch {
      return 0
    }
  })
  const balances = await Promise.all(balancePromises)
  totalBalance = balances.reduce((sum, b) => sum + b, 0)

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
    totalBalance: Number(totalBalance.toFixed(1)),
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
  // Authenticated users see their own agents; demo users see shared demo agents
  const deploymentItems = userId
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
    stats: await buildStats(deploymentItems),
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

// ─── NFT Image Uploads ─────────────────────────────────
const uploadsDir = resolve(__dirname, '..', 'uploads')
mkdirSync(uploadsDir, { recursive: true })
app.use('/uploads', express.static(uploadsDir))
const nftUpload = multer({
  storage: multer.diskStorage({
    destination: uploadsDir,
    filename: (_req, file, cb) => {
      const ext = file.originalname.split('.').pop() ?? 'png'
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`)
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    cb(null, /^image\//.test(file.mimetype))
  },
})

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

// ─── NFT Image Upload ──────────────────────────────────
app.post('/api/nft/upload', requireAuth, nftUpload.single('image'), (request, response) => {
  const file = (request as any).file as Express.Multer.File | undefined
  if (!file) {
    response.status(400).json({ error: 'No image file provided.' })
    return
  }

  // Build public URL — use the request host so it works in dev and production
  const protocol = request.headers['x-forwarded-proto'] || 'http'
  const host = request.headers.host || `localhost:${config.port}`
  const baseUrl = `${protocol}://${host}`
  const imageUrl = `${baseUrl}/uploads/${file.filename}`

  // Generate HIP-412 compliant metadata JSON alongside the image
  const metadataFilename = file.filename.replace(/\.[^.]+$/, '.json')
  const nftName = (request.body?.name as string) || 'Aivy NFT'
  const nftDescription = (request.body?.description as string) || 'Minted via Aivy AI Agent Platform'
  const metadata = {
    name: nftName,
    description: nftDescription,
    image: imageUrl,
    type: file.mimetype,
    creator: 'Aivy — aivylabs.xyz',
  }
  writeFileSync(resolve(uploadsDir, metadataFilename), JSON.stringify(metadata, null, 2))
  const metadataUrl = `${baseUrl}/uploads/${metadataFilename}`

  response.json({ imageUrl, metadataUrl, filename: file.filename })
})

app.get('/api/live', readLimiter, async (request, response) => {
  try {
    const userId = (request as AuthRequest).userId
    response.json(await buildLivePayload(userId))
  } catch (error) {
    response.status(500).json({
      configured: isConfigured,
      error: error instanceof Error ? error.message : 'Unknown live payload error.',
      stats: await buildStats(),
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

    // Prevent duplicate agent names per user
    const userId = (request as AuthenticatedRequest).userId!
    const existing = db.getDeploymentsByUser(userId)
    if (existing.some((d) => d.name.toLowerCase() === name.trim().toLowerCase())) {
      response.status(409).json({ error: `An agent named "${name.trim()}" already exists. Please choose a different name.` })
      return
    }

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
    let kmsKeyId: string | null = null
    const deploymentId = `${templateId}-${Date.now()}`

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
        // Wallet funding: create with near-zero balance — the user signs a
        // HashPack transfer for the full amount right after deployment.
        // Platform funding: capped at 5 HBAR to prevent abuse.
        const PLATFORM_FUNDING_CAP = 5
        const WALLET_SEED_HBAR = 0
        const creationBalance = fundingSource === 'wallet'
          ? WALLET_SEED_HBAR
          : Math.min(initialFundingHbar ?? PLATFORM_FUNDING_CAP, PLATFORM_FUNDING_CAP)
        const agentAccount = await createAgentAccount(creationBalance, {
          agentId: deploymentId,
          agentName: name,
          useKms: true, // KMS for all real deployments
        })
        agentAccountId = agentAccount.accountId
        agentPrivateKey = agentAccount.privateKey
        kmsKeyId = agentAccount.kmsKeyId
        console.log(`[Aivy] Created dedicated agent account: ${agentAccountId} (funding: ${fundingSource}, initial: ${creationBalance} HBAR${kmsKeyId ? ', KMS: ' + kmsKeyId : ''})`)
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
      id: deploymentId,
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
      kmsKeyId,
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

    const agentClient = await createAgentClient(deployment.agentAccountId, deployment.agentPrivateKey, deployment.kmsKeyId, deployment.id)
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

app.delete('/api/agents/:agentId', requireAuth, async (request, response) => {
  const deployment = db.getDeployment(request.params.agentId)
  if (!deployment) {
    response.status(404).json({ error: 'Deployment not found.' })
    return
  }
  if (!assertAgentOwnership(deployment, request)) {
    response.status(403).json({ error: 'You do not own this agent.' })
    return
  }

  let refundedHbar = 0
  let refundTxId: string | null = null

  // Auto-refund remaining HBAR from dedicated agent accounts
  if (deployment.walletType === 'dedicated' && deployment.agentAccountId && deployment.agentPrivateKey && !demoMode) {
    try {
      const agentClient = await createAgentClient(deployment.agentAccountId, deployment.agentPrivateKey, deployment.kmsKeyId, deployment.id)
      // Query the agent's on-chain balance
      const balanceResult = await executeTool('get_hbar_balance_query_tool', { accountId: deployment.agentAccountId })
      const rawBalance = balanceResult.raw?.balance ?? balanceResult.raw?.hbarBalance
      const balanceHbar = typeof rawBalance === 'number' ? rawBalance : parseFloat(String(rawBalance ?? '0'))

      if (balanceHbar > 0.1) {
        // Keep 0.01 HBAR for the transfer fee, refund the rest
        const refundAmount = Math.floor((balanceHbar - 0.01) * 100) / 100
        // Refund to the user's wallet (deployment.userId is their account ID)
        // If the agent was created by the platform, refund to operator instead
        const recipientId = SHARED_USER_IDS.has(deployment.userId)
          ? config.operatorAccountId
          : deployment.userId
        if (recipientId && refundAmount > 0) {
          const tx = await new TransferTransaction()
            .addHbarTransfer(deployment.agentAccountId, new Hbar(-refundAmount))
            .addHbarTransfer(recipientId, new Hbar(refundAmount))
            .setTransactionMemo(`Aivy destroy: refund from ${deployment.name}`)
            .execute(agentClient)
          await tx.getReceipt(agentClient)
          refundedHbar = refundAmount
          refundTxId = tx.transactionId?.toString() ?? null
          console.log(`[Aivy] Refunded ${refundAmount} HBAR from ${deployment.name} (${deployment.agentAccountId}) to ${recipientId}`)
        }
      }
    } catch (err) {
      console.error(`[Aivy] Failed to refund HBAR from ${deployment.name}:`, err instanceof Error ? err.message : err)
      // Continue with deletion even if refund fails
    }
  }

  // Stop any active schedules/pollers
  stopSchedule(deployment.id)
  stopPoller(deployment.id)

  // Schedule KMS key deletion if applicable
  if (deployment.kmsKeyId) {
    scheduleKmsKeyDeletion(deployment.kmsKeyId).catch(err =>
      console.warn(`[KMS] Failed to schedule key deletion for ${deployment.kmsKeyId}:`, err)
    )
  }

  db.runInTransaction(() => {
    db.deleteDeployment(request.params.agentId)
    const refundMsg = refundedHbar > 0 ? ` (${refundedHbar} HBAR refunded)` : ''
    pushActivity(`${deployment.name} destroyed and removed from the Aivy floor.${refundMsg}`, 'system')
  })
  response.json({ ok: true, refundedHbar, refundTxId })
})

app.delete('/api/agents/:agentId/chat', requireAuth, (request, response) => {
  const deployment = db.getDeployment(request.params.agentId)
  if (!deployment) { response.status(404).json({ error: 'Deployment not found.' }); return }
  if (!assertAgentOwnership(deployment, request)) { response.status(403).json({ error: 'You do not own this agent.' }); return }
  db.clearChatHistory(request.params.agentId)
  response.json({ ok: true })
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
      `I'm **${deployment.name}**, running in demo mode. I can help with on-chain operations when connected to the Hedera testnet.`,
    ]
    const reply = responses[Math.floor(Math.random() * responses.length)]
    response.json({ reply, toolCalls: [], references: [] })
    return
  }

  try {
    const userAccountId = parsed.data.userAccountId

    // Resolve per-agent client for dedicated wallets
    const agentClient = deployment.walletType === 'dedicated' && deployment.agentAccountId && deployment.agentPrivateKey
      ? await createAgentClient(deployment.agentAccountId, deployment.agentPrivateKey, deployment.kmsKeyId, deployment.id)
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

/**
 * Remove orphaned 'tool' messages whose parent 'assistant' (tool_calls) is missing.
 * OpenAI requires every tool message to follow an assistant message with tool_calls.
 */
function sanitizeHistory(history: db.ChatMessage[]): db.ChatMessage[] {
  const validToolCallIds = new Set<string>()
  for (const msg of history) {
    if (msg.role === 'assistant' && msg.tool_calls) {
      for (const tc of msg.tool_calls) validToolCallIds.add(tc.id)
    }
  }
  return history.filter((msg) => {
    if (msg.role !== 'tool') return true
    return msg.tool_call_id != null && validToolCallIds.has(msg.tool_call_id)
  })
}

/**
 * Safely trim chat history without breaking tool_calls / tool pairs.
 * Keeps the system message + the last ~40 messages, but ensures we
 * never start the trimmed history with orphaned 'tool' messages.
 */
function safeTrimHistory(history: db.ChatMessage[], maxLen = 42): db.ChatMessage[] {
  if (history.length <= maxLen) return history
  const system = history[0]
  let trimmed = history.slice(-(maxLen - 2))
  // Drop leading 'tool' messages that lost their parent 'assistant' (tool_calls) message
  while (trimmed.length > 0 && trimmed[0].role === 'tool') {
    trimmed = trimmed.slice(1)
  }
  return [system, ...trimmed]
}

type ChatLoopResult = {
  reply: string
  toolCalls: Array<{ toolName: string; params: Record<string, unknown>; result: { raw?: Record<string, unknown>; humanMessage?: string } }>
  references: ResultReference[]
  capExceeded: boolean
}

async function runChatLoop(
  deployment: DeploymentRecord,
  history: db.ChatMessage[],
  agentClient?: Client,
  source: 'chat' | 'schedule' | 'trigger' = 'chat',
): Promise<ChatLoopResult> {
  if (!openai) throw new Error('OpenAI is not configured.')

  // Sanitize: drop orphaned 'tool' messages that lost their parent 'assistant' (tool_calls)
  history = sanitizeHistory(history)

  let capExceeded = false
  const catalog = buildToolCatalog()
  const enabledGroups = new Set(deployment.capabilityGroups)
  const agentTools = catalog.tools.filter((t) => enabledGroups.has(t.groupId))
  const openaiTools = buildOpenAITools(agentTools)
  // Map sanitised OpenAI names back to original plugin names for executeTool
  const sanitizedToOriginal = new Map(agentTools.map((t) => [sanitizeToolName(t.name), t.name]))
  const agentToolNames = new Set(sanitizedToOriginal.keys())

  const collectedToolCalls: ChatLoopResult['toolCalls'] = []
  const collectedReferences: ResultReference[] = []

  let iterations = 0
  const maxIterations = 5

  while (iterations < maxIterations) {
    iterations++

    const completion = await withRetry(() => openai!.chat.completions.create({
      model: 'gpt-4o',
      messages: history as OpenAI.ChatCompletionMessageParam[],
      tools: openaiTools.length > 0 ? openaiTools : undefined,
      temperature: 0.3,
      max_tokens: 1024,
    }))

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
      const originalFnName = sanitizedToOriginal.get(fnName) ?? fnName
      let fnArgs: Record<string, unknown> = {}
      try { fnArgs = JSON.parse(toolCall.function.arguments) as Record<string, unknown> } catch { /* empty */ }

      let toolResultContent: string
      console.log(`[${source}] ${deployment.name} calling tool: ${fnName}`, JSON.stringify(fnArgs))

      if (!agentToolNames.has(fnName)) {
        toolResultContent = JSON.stringify({ error: `Tool ${fnName} is not available for this agent.` })
      } else {
        // Programmatic spending cap check BEFORE executing the tool
        if (deployment.vaultProtected && deployment.vaultCapHbar > 0) {
          const projectedSpend = detectSpendingAmount(originalFnName, fnArgs)
          if (projectedSpend > 0) {
            const summary = db.getSpendingSummary(deployment.id)
            const totalAfter = summary.totalSpent + projectedSpend
            if (totalAfter > deployment.vaultCapHbar) {
              capExceeded = true
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
            ? getDemoToolResponse(originalFnName, fnArgs)
            : await executeTool(originalFnName, fnArgs, agentClient)
          const references = extractResultReferences(result.raw)
          collectedToolCalls.push({ toolName: originalFnName, params: fnArgs, result })
          collectedReferences.push(...references)

          const spendingAmount = detectSpendingAmount(originalFnName, fnArgs)
          if (spendingAmount > 0) {
            const txId = typeof result.raw?.transactionId === 'string' ? result.raw.transactionId : null
            db.recordSpending(deployment.id, spendingAmount, 'outflow', originalFnName, txId, source, result.humanMessage ?? null)
          }

          if (result.raw) runCoordinationChecks(deployment, { ...result.raw, humanMessage: result.humanMessage })

          const groupId = toolNameToGroup.get(originalFnName)
          const isQuery = groupId ? queryGroupIds.has(groupId) : true
          if (!isQuery) {
            deployment.executions += 1
            deployment.status = deployment.vaultProtected ? 'guarded' : 'active'
            deployment.lastAction = titleCase(originalFnName)
            db.updateDeployment(deployment)
          }

          pushActivity(
            `${deployment.name} (${source}): ${result.humanMessage ?? titleCase(originalFnName)}`,
            isQuery ? 'system' : deployment.vaultProtected ? 'vault' : 'success',
          )

          toolResultContent = JSON.stringify({ humanMessage: result.humanMessage, raw: result.raw })
          console.log(`[chat] ${deployment.name} tool result for ${originalFnName}:`, toolResultContent.slice(0, 500))
        } catch (err) {
          toolResultContent = JSON.stringify({ error: err instanceof Error ? err.message : 'Tool execution failed.' })
          console.error(`[chat] ${deployment.name} tool error for ${originalFnName}:`, err instanceof Error ? err.message : err)
        }
      }

      history.push({ role: 'tool', content: toolResultContent, tool_call_id: toolCall.id, name: fnName })
    }
  }

  // Trim history (safe — never orphans tool messages)
  history = safeTrimHistory(history)
  db.replaceChatHistory(deployment.id, history)

  const lastAssistant = [...history].reverse().find((m) => m.role === 'assistant' && m.content)
  const reply = lastAssistant?.content ?? 'I completed the requested actions.'

  const uniqueRefs = collectedReferences.filter(
    (ref, idx, all) => idx === all.findIndex((r) => r.label === ref.label && r.value === ref.value),
  )

  return { reply, toolCalls: collectedToolCalls, references: uniqueRefs, capExceeded }
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
      ? await createAgentClient(deployment.agentAccountId, deployment.agentPrivateKey, deployment.kmsKeyId, deployment.id)
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
      const status = result.capExceeded ? 'cap_exceeded' as const : 'completed' as const
      db.updateScheduleExecution(execId, status, result.reply.slice(0, 500), null)

      // Auto-pause schedule after 3 consecutive cap-exceeded runs
      if (result.capExceeded && source === 'schedule') {
        const recent = db.getScheduleExecutions(sourceId, 3)
        if (recent.length >= 3 && recent.every(e => e.status === 'cap_exceeded')) {
          db.updateSchedule(sourceId, { enabled: false })
          console.log(`[schedule] Auto-paused schedule ${sourceId} after 3 consecutive cap-exceeded runs`)
          pushActivity(
            `${deployment.name}: Schedule auto-paused — spending cap reached`,
            'warning',
          )
        }
      }
    }

    pushActivity(
      result.capExceeded
        ? `${deployment.name} (${source}): Spending cap blocked execution`
        : `${deployment.name} (${source}): Completed automated task`,
      result.capExceeded ? 'warning' : 'system',
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
    {
      keywords: ['bonzo', 'lending', 'borrow', 'deposit bonzo', 'yield', 'sentiment', 'fear', 'greed', 'keeper', 'apy', 'supply rate'],
      templateId: 'bonzo-keeper',
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
      ? await createAgentClient(deployment.agentAccountId, deployment.agentPrivateKey, deployment.kmsKeyId, deployment.id)
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
    const sanitizedToOriginal2 = new Map(agentTools.map((t) => [sanitizeToolName(t.name), t.name]))
    const agentToolNames = new Set(sanitizedToOriginal2.keys())

    history.push({ role: 'user', content: message })

    const collectedToolCalls: Array<{
      toolName: string
      params: Record<string, unknown>
      result: { raw?: Record<string, unknown>; humanMessage?: string }
    }> = []

    let iterations = 0
    while (iterations < 5) {
      iterations++
      const completion = await withRetry(() => openai!.chat.completions.create({
        model: 'gpt-4o',
        messages: history as OpenAI.ChatCompletionMessageParam[],
        tools: openaiTools.length > 0 ? openaiTools : undefined,
        temperature: 0.3,
        max_tokens: 1024,
      }))

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
        const originalFnName2 = sanitizedToOriginal2.get(fnName) ?? fnName
        let fnArgs: Record<string, unknown> = {}
        try { fnArgs = JSON.parse(toolCall.function.arguments) as Record<string, unknown> } catch { /* empty */ }

        let toolResultContent: string

        if (!agentToolNames.has(fnName)) {
          toolResultContent = JSON.stringify({ error: `Tool ${fnName} not available.` })
        } else {
          try {
            const result = demoMode
              ? getDemoToolResponse(originalFnName2, fnArgs)
              : await executeTool(originalFnName2, fnArgs, routeAgentClient)
            collectedToolCalls.push({ toolName: fnName, params: fnArgs, result })

            // Feature 4: Agent-to-agent coordination checks
            if (result.raw) {
              runCoordinationChecks(deployment, { ...result.raw, humanMessage: result.humanMessage })
            }

            const groupId = toolNameToGroup.get(originalFnName2)
            const isQuery = groupId ? queryGroupIds.has(groupId) : true
            if (!isQuery) {
              deployment.executions += 1
              deployment.status = deployment.vaultProtected ? 'guarded' : 'active'
              deployment.lastAction = titleCase(originalFnName2)
              db.updateDeployment(deployment)
            }

            pushActivity(
              `${deployment.name} (routed): ${result.humanMessage ?? titleCase(originalFnName2)}`,
              isQuery ? 'system' : deployment.vaultProtected ? 'vault' : 'success',
            )

            toolResultContent = JSON.stringify({ humanMessage: result.humanMessage, raw: result.raw })
            console.log(`[chat] ${deployment.name} tool result for ${originalFnName2}:`, toolResultContent.slice(0, 500))
          } catch (err) {
            toolResultContent = JSON.stringify({ error: err instanceof Error ? err.message : 'Tool failed.' })
            console.error(`[chat] ${deployment.name} tool error for ${originalFnName2}:`, err instanceof Error ? err.message : err)
          }
        }

        history.push({ role: 'tool', content: toolResultContent, tool_call_id: toolCall.id, name: fnName })
      }
    }

    history = safeTrimHistory(history)
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

app.get('/api/dashboard', readLimiter, (request, response) => {
  try {
    const userId = (request as AuthRequest).userId
    const allItems = db.getAllDeployments()
    // Filter by authenticated user — same as office view for consistency
    const items = userId && userId !== 'demo' && userId !== 'anonymous'
      ? allItems.filter((d) => d.userId === userId)
      : allItems

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
  get_hbar_balance_query_tool: (params) => {
    const acct = params['accountId'] ?? demoAccountId
    return {
      raw: { accountId: acct, hbarBalance: 142.5 },
      humanMessage: `**Balance** for \`${acct}\`: **142.5 HBAR** (~$9.26 USD)`,
    }
  },
  get_account_query_tool: (params) => {
    const acct = params['accountId'] ?? demoAccountId
    return {
      raw: {
        accountId: acct,
        hbarBalance: 142.5,
        maxAutoTokenAssociations: 10,
        isDeleted: false,
        memo: 'Aivy demo account',
        publicKey: '03e5d10263d9dedbd743de220f6aaa35c1a43c69a5dff03f5824285610dd478ad6',
        evmAddress: '0x014a6d6a011006d2b7ab5efe3592015e4df29086',
      },
      humanMessage: [
        `Account details for **${acct}**:`,
        `- **Balance**: 142.5 HBAR`,
        `- **Public Key**: \`03e5d10263...dd478ad6\``,
        `- **EVM Address**: \`0x014a6d6a...f29086\``,
        `- **Auto-Associations**: 10`,
        `- **Status**: Active`,
      ].join('\n'),
    }
  },
  transfer_hbar_tool: (params) => {
    const amount = params['amount'] ?? 10
    const to = params['toAccountId'] ?? '0.0.5678'
    return {
      raw: { transactionId: nextDemoTxId(), status: 'SUCCESS' },
      humanMessage: `**Transfer complete** — sent **${amount} HBAR** to \`${to}\``,
    }
  },
  create_topic_tool: () => {
    const topicId = nextDemoTopicId()
    return {
      raw: { topicId, transactionId: nextDemoTxId() },
      humanMessage: `**Topic created**: \`${topicId}\`\n- Ready to receive consensus messages`,
    }
  },
  submit_topic_message_tool: () => ({
    raw: { transactionId: nextDemoTxId(), status: 'SUCCESS' },
    humanMessage: '**Message submitted** to topic successfully',
  }),
  create_fungible_token_tool: (params) => {
    const tokenId = nextDemoTokenId()
    const name = params['tokenName'] ?? 'Aivy Token'
    return {
      raw: { tokenId, transactionId: nextDemoTxId(), tokenName: name },
      humanMessage: [
        `**Token created**: *${name}*`,
        `- **Token ID**: \`${tokenId}\``,
        `- **Type**: Fungible`,
        `- **Decimals**: 2`,
      ].join('\n'),
    }
  },
  mint_fungible_token_tool: (params) => ({
    raw: { transactionId: nextDemoTxId(), totalSupply: params['amount'] ?? 1000 },
    humanMessage: `**Minted** ${params['amount'] ?? 1000} tokens — new total supply updated`,
  }),
  create_non_fungible_token_tool: (params) => {
    const tokenId = nextDemoTokenId()
    const name = params['tokenName'] ?? 'Aivy NFT'
    return {
      raw: { tokenId, transactionId: nextDemoTxId() },
      humanMessage: [
        `**NFT collection created**: *${name}*`,
        `- **Token ID**: \`${tokenId}\``,
        `- **Type**: Non-Fungible`,
      ].join('\n'),
    }
  },
  mint_non_fungible_token_tool: (params) => {
    const tokenId = params['tokenId'] ?? '0.0.9999'
    const uris = (params['metadata'] as string[]) ?? (params['uris'] as string[]) ?? []
    return {
      raw: { transactionId: nextDemoTxId(), tokenId, serialNumber: 1 },
      humanMessage: [
        `**NFT minted** on collection \`${tokenId}\``,
        `- **Serial**: #1`,
        uris[0] ? `- **Metadata**: ${uris[0]}` : '',
        `- **View**: [HashScan](https://hashscan.io/testnet/token/${tokenId})`,
      ].filter(Boolean).join('\n'),
    }
  },
  get_exchange_rate_tool: () => ({
    raw: { hbarToUsd: 0.065, centEquivalent: 6.5, expirationTime: new Date().toISOString() },
    humanMessage: '**Exchange Rate**\n- **1 HBAR** = $0.065 USD\n- **100 HBAR** = $6.50 USD',
  }),
  get_topic_info_query_tool: (params) => ({
    raw: { topicId: params['topicId'], sequenceNumber: 12, memo: 'Aivy audit stream' },
    humanMessage: `**Topic** \`${params['topicId']}\`\n- **Messages**: 12\n- **Memo**: Aivy audit stream`,
  }),
  get_token_info_query_tool: (params) => ({
    raw: { tokenId: params['tokenId'], name: 'Aivy Token', symbol: 'AIVY', totalSupply: 10000, decimals: 2 },
    humanMessage: `**Token** \`${params['tokenId']}\`\n- **Name**: Aivy Token (*AIVY*)\n- **Supply**: 10,000\n- **Decimals**: 2`,
  }),
  scheduled_transaction_tool: (params) => ({
    raw: { transactionId: nextDemoTxId(), status: 'SUCCESS', scheduleId: nextDemoAccountId() },
    humanMessage: `**Scheduled transaction** created\n- **Amount**: ${params['amount'] ?? 1} HBAR\n- **Status**: Pending execution`,
  }),
  crypto_sentiment_tool: () => ({
    raw: { score: 42, classification: 'Fear', average7d: 38, trend: 'improving' },
    humanMessage: '**Crypto Market Sentiment**\n\n**Fear & Greed Index**: 42/100 — **Fear**\n**7-day Average**: 38/100 (improving)\n**Trend**: 35 → 38 → 40 → 42\n\n**Keeper Recommendation**: FEAR — Cautious approach. Harvest rewards and hold in stable positions.',
  }),
  bonzo_market_data_tool: () => ({
    raw: { markets: [{ symbol: 'USDC', supplyAPY: 0.048, borrowAPY: 0.067 }, { symbol: 'HBAR', supplyAPY: 0.032, borrowAPY: 0.055 }] },
    humanMessage: '**Bonzo Lending Markets**\n\n- **USDC**: 4.80% supply APY, 6.70% borrow APY\n- **HBAR**: 3.20% supply APY, 5.50% borrow APY\n- **SAUCE**: 2.10% supply APY, 4.30% borrow APY',
  }),
  bonzo_deposit_tool: (params) => ({
    raw: { transactionId: nextDemoTxId(), tokenSymbol: params['tokenSymbol'], amount: params['amount'] },
    humanMessage: `**Deposited** ${params['amount']} ${params['tokenSymbol']} into Bonzo lending pool\n- **APY**: ~4.8%\n- **Transaction**: \`${nextDemoTxId()}\``,
  }),
  bonzo_withdraw_tool: (params) => ({
    raw: { transactionId: nextDemoTxId(), tokenSymbol: params['tokenSymbol'], amount: params['amount'] },
    humanMessage: `**Withdrew** ${params['amount']} ${params['tokenSymbol']} from Bonzo lending pool\n- **Transaction**: \`${nextDemoTxId()}\``,
  }),
  approve_erc20_tool: (params) => ({
    raw: { transactionId: nextDemoTxId(), tokenSymbol: params['tokenSymbol'], amount: params['amount'] },
    humanMessage: `**Approved** ${params['amount'] ?? 'max'} ${params['tokenSymbol']} for Bonzo LendingPool\n- **Transaction**: \`${nextDemoTxId()}\``,
  }),
  bonzo_borrow_tool: (params) => ({
    raw: { transactionId: nextDemoTxId(), tokenSymbol: params['tokenSymbol'], amount: params['amount'] },
    humanMessage: `**Borrowed** ${params['amount']} ${params['tokenSymbol']} from Bonzo at ${params['rateMode']} rate\n- **Transaction**: \`${nextDemoTxId()}\``,
  }),
  bonzo_repay_tool: (params) => ({
    raw: { transactionId: nextDemoTxId(), tokenSymbol: params['tokenSymbol'], amount: params['amount'] },
    humanMessage: `**Repaid** ${params['amount']} ${params['tokenSymbol']} to Bonzo lending pool\n- **Transaction**: \`${nextDemoTxId()}\``,
  }),
}

function getDemoToolResponse(toolName: string, params: Record<string, unknown>): ToolResponse {
  const handler = demoToolResponses[toolName]
  if (handler) return handler(params)
  const txId = nextDemoTxId()
  return {
    raw: { status: 'SUCCESS', transactionId: txId },
    humanMessage: `**${titleCase(toolName)}** completed successfully`,
  }
}

const demoChatResponses: Record<string, string[]> = {
  'treasury-sentinel': [
    'I checked the treasury — here\'s the current status:\n\n- **Balance**: 142.5 HBAR (~$9.26 USD)\n- **Vault Cap**: 250 HBAR\n- **Utilization**: 57%\n\nEverything is within the spending cap. Would you like me to transfer funds or check a specific account?',
    'The **vault guardrails** are active and enforcing your spending cap. I can:\n\n- **Check balances** for any Hedera account\n- **Transfer HBAR** within your vault spending cap\n- **Audit transactions** via the consensus topic\n\nWhat would you like to do?',
  ],
  'yield-router': [
    'I\'m ready to manage your token operations on Hedera. Here\'s what I can do:\n\n- **Create tokens** — fungible or NFT collections\n- **Mint & distribute** — manage token supply\n- **Deploy contracts** — ERC20/ERC721 via Hedera EVM\n\nWhat token operation would you like to perform?',
    'Your token portfolio is looking good! I can:\n\n- **Mint tokens** into existing collections\n- **Create new tokens** with custom parameters\n- **Check token info** — supply, holders, metadata\n\nJust let me know what you need.',
  ],
  'compliance-clerk': [
    'I\'ve been monitoring the **audit trail** — here\'s the summary:\n\n- **Transactions audited**: 47\n- **Policy violations**: 0\n- **All agents**: Operating within guardrails\n\nI can inspect specific transactions, verify account activity, or pull the full audit log.',
    '**Compliance check** complete:\n\n- All agents are operating within their **spending caps**\n- No unauthorized transactions detected\n- Consensus topic logs are intact\n\nWould you like me to audit a specific account or transaction?',
  ],
  'governance-relay': [
    'Governance systems are **online**. I can help with:\n\n- **Create proposals** — submit to the HCS consensus topic\n- **Schedule transactions** — set up future actions\n- **Coordinate agents** — trigger cross-agent workflows\n\nWould you like to create a proposal or review existing ones?',
    'I manage the **governance layer** for your agent swarm:\n\n- **HCS Topics**: Active, receiving messages\n- **Scheduled Actions**: 3 pending\n- **Agent Coordination**: All links healthy\n\nWhat governance action would you like to take?',
  ],
  'bonzo-keeper': [
    'I\'ve scanned the **Bonzo lending markets** and checked sentiment:\n\n- **Fear & Greed**: 42/100 (Fear)\n- **Best Supply APY**: USDC at 4.8%\n- **HBAR Supply APY**: 3.2%\n\n**Recommendation**: Market is cautious — consider depositing to stablecoins for safer yield. Want me to deposit?',
    'Your **Bonzo Keeper** is active and monitoring:\n\n- **Sentiment**: Improving (38 → 42)\n- **Current Positions**: None active\n- **Available**: USDC, HBAR, SAUCE pools\n\nTell me your yield goal (e.g., "safe yield on HBAR") and I\'ll handle the rest!',
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
    capabilityGroups: ['accounts', 'accountQueries', 'consensus', 'consensusQueries', 'transactionQueries', 'networkQueries', 'coincap', 'chainlink'] as CapabilityGroupId[],
  },
  {
    templateId: 'yield-router',
    name: 'Yield Ranger',
    room: 'Strategy Pit',
    guardrail: 'Only approved token operations',
    vaultProtected: true,
    vaultCapHbar: 500,
    capabilityGroups: ['accounts', 'accountQueries', 'tokens', 'tokenQueries', 'contracts', 'contractQueries', 'transactionQueries', 'networkQueries', 'saucerswap', 'pyth', 'bonzo', 'memejob'] as CapabilityGroupId[],
  },
  {
    templateId: 'compliance-clerk',
    name: 'Audit Bot',
    room: 'War Room',
    guardrail: 'Read-only access, no mutations',
    vaultProtected: false,
    vaultCapHbar: 0,
    capabilityGroups: ['accountQueries', 'consensusQueries', 'tokenQueries', 'contractQueries', 'transactionQueries', 'networkQueries', 'coincap', 'chainlink'] as CapabilityGroupId[],
  },
  {
    templateId: 'governance-relay',
    name: 'Gov Relay',
    room: 'Forum Deck',
    guardrail: 'Consensus and scheduling only',
    vaultProtected: true,
    vaultCapHbar: 100,
    capabilityGroups: ['accounts', 'accountQueries', 'consensus', 'consensusQueries', 'transactionQueries', 'networkQueries'] as CapabilityGroupId[],
  },
]

app.post('/api/demo/seed', async (_request, response) => {
  // Always create a fresh demo identity — never touch the caller's real agents
  const demoId = `demo-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  const guestToken = issueToken(demoId, 'guest')
  const authReq = _request as AuthenticatedRequest
  authReq.userId = demoId
  authReq.accountId = null

  // Clear only previous demo data for the shared 'demo' user
  const userId = demoId
  db.clearJobsByUser(userId)
  db.clearChatHistoryByUser(userId)
  db.clearDeploymentsByUser(userId)
  db.clearActivityByUser(userId)
  coordinationLog.length = 0

  const created: DeploymentRecord[] = []
  const useRealHedera = isConfigured && client

  for (const seed of demoSeedAgents) {
    let topicId = ''
    let deploymentTxId = ''
    let contractId: string | null = null
    let contractAddress: string | null = null
    let agentAccountId: string | null = null
    let agentPrivateKey: string | null = null

    if (useRealHedera) {
      try {
        // Create real agent account (10 HBAR for meaningful demo)
        // Demo agents skip KMS to avoid unnecessary key creation costs
        const agentAccount = await createAgentAccount(10, { useKms: false })
        agentAccountId = agentAccount.accountId
        agentPrivateKey = agentAccount.privateKey

        // Create real topic
        const topicResult = await executeTool(
          coreConsensusPluginToolNames.CREATE_TOPIC_TOOL,
          { topicMemo: `Aivy audit stream for ${seed.name}`, transactionMemo: `Aivy demo seed ${seed.templateId}` },
        )
        topicId = toEntityString(topicResult.raw?.topicId)
        deploymentTxId = toEntityString(topicResult.raw?.transactionId)

        // Deploy real vault contract if needed
        if (seed.vaultProtected && seed.vaultCapHbar > 0) {
          const vault = await deployVaultContract(seed.name, seed.guardrail, seed.vaultCapHbar)
          contractId = vault.contractId
          contractAddress = vault.contractAddress
        }
      } catch (err) {
        console.warn(`[demo/seed] Failed to create real resources for ${seed.name}:`, err)
        // Fallback to demo IDs
        topicId = nextDemoTopicId()
        deploymentTxId = nextDemoTxId()
        agentAccountId = nextDemoAccountId()
        agentPrivateKey = '302e_demo_agent_key_' + agentAccountId
        if (seed.vaultProtected) {
          contractId = nextDemoContractId()
          contractAddress = `0x${Math.random().toString(16).slice(2, 42)}`
        }
      }
    } else {
      // Demo mode: fake IDs
      topicId = nextDemoTopicId()
      deploymentTxId = nextDemoTxId()
      agentAccountId = nextDemoAccountId()
      agentPrivateKey = '302e_demo_agent_key_' + agentAccountId
      if (seed.vaultProtected) {
        contractId = nextDemoContractId()
        contractAddress = `0x${Math.random().toString(16).slice(2, 42)}`
      }
    }

    const deployment: DeploymentRecord = {
      id: `${seed.templateId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      userId: (_request as AuthenticatedRequest).userId ?? 'demo',
      templateId: seed.templateId,
      name: seed.name,
      room: seed.room,
      guardrail: seed.guardrail,
      vaultProtected: seed.vaultProtected,
      capabilityGroups: seed.capabilityGroups,
      status: seed.vaultProtected ? 'guarded' : 'active',
      lastAction: 'Deployed via demo seed',
      executions: Math.floor(Math.random() * 8) + 1,
      createdAt: new Date().toISOString(),
      topicId,
      contractId,
      contractAddress,
      deploymentTxId,
      vaultCapHbar: seed.vaultCapHbar,
      agentAccountId,
      agentPrivateKey,
      walletType: 'dedicated',
      kmsKeyId: null,
    }
    db.insertDeployment(deployment)
    created.push(deployment)

    pushActivity(
      `${seed.name} deployed with ${seed.capabilityGroups.length} capability bundles${seed.vaultProtected ? ' and vault guardrails' : ''}.`,
      seed.vaultProtected ? 'vault' : 'success',
    )
  }

  // Add coordination events for flavor — use only THIS user's just-created agents
  const treasury = created.find(d => d.templateId === 'treasury-sentinel')
  const yieldAgent = created.find(d => d.templateId === 'yield-router')
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

  const govAgent = created.find(d => d.templateId === 'governance-relay')
  if (treasury && govAgent) {
    coordinationLog.unshift({
      id: `coord-demo2-${Date.now()}`,
      sourceAgentId: govAgent.id,
      sourceAgentName: govAgent.name,
      targetAgentId: treasury.id,
      targetAgentName: treasury.name,
      trigger: 'scheduled_action',
      action: 'Execute scheduled transfer',
      timestamp: new Date().toISOString(),
      status: 'completed',
    })
  }

  // ─── Demo ERC-8183 Jobs ──────────────────────────
  const auditAgent = created.find(d => d.templateId === 'compliance-clerk')
  const demoJobSpecs: Array<{
    client: DeploymentRecord | undefined
    provider: DeploymentRecord | undefined
    budgetHbar: number
    description: string
    status: db.JobRecord['status']
    deliverable: string | null
  }> = [
    {
      client: treasury,
      provider: yieldAgent,
      budgetHbar: 10,
      description: 'Optimize yield strategy for Q1 treasury reserves',
      status: 'Completed',
      deliverable: 'Routed 500 HBAR to SaucerSwap HBAR-USDC pool at 4.2% APY. Net gain: 5.25 HBAR.',
    },
    {
      client: yieldAgent,
      provider: auditAgent,
      budgetHbar: 3,
      description: 'Audit token swap transactions from last 24h',
      status: 'Submitted',
      deliverable: 'Reviewed 12 swap transactions. All within slippage limits. No anomalies detected.',
    },
    {
      client: govAgent,
      provider: treasury,
      budgetHbar: 25,
      description: 'Execute approved governance proposal #7: fund community grants',
      status: 'Funded',
      deliverable: null,
    },
    {
      client: treasury,
      provider: auditAgent,
      budgetHbar: 5,
      description: 'Verify vault spending cap compliance across all agents',
      status: 'Open',
      deliverable: null,
    },
  ]

  for (const spec of demoJobSpecs) {
    if (!spec.client || !spec.provider) continue
    const jobId = `job-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
    const job: db.JobRecord = {
      id: jobId,
      jobChainId: 1,
      clientAgentId: spec.client.id,
      providerAgentId: spec.provider.id,
      evaluatorAddress: config.operatorAccountId || null,
      description: spec.description,
      budgetHbar: spec.budgetHbar,
      expiredAt: new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
      status: spec.status,
      deliverable: spec.deliverable,
      contractId: nextDemoContractId(),
      txId: nextDemoTxId(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    db.insertJob(job)
    pushActivity(`ERC-8183 job: ${spec.client.name} → ${spec.provider.name} (${spec.budgetHbar} ℏ) [${spec.status}]`, 'vault')
  }

  response.status(201).json({
    seeded: created.length,
    deployments: created.map(safeDeployment),
    ...(guestToken ? { token: guestToken } : {}),
  })

  // ─── Schedule 2-hour demo cleanup ─────────────────
  // Return HBAR to operator and remove demo resources after the trial window
  const DEMO_TTL_MS = 2 * 60 * 60_000 // 2 hours
  const demoUserId = userId
  const demoAgents = created.filter(d => d.agentAccountId && d.agentPrivateKey && !d.agentPrivateKey.startsWith('302e_demo'))

  if (demoAgents.length > 0 && useRealHedera && client && config.operatorAccountId) {
    const operatorId = config.operatorAccountId
    console.log(`[demo/cleanup] Scheduled cleanup for ${demoAgents.length} demo agents in ${DEMO_TTL_MS / 60_000} minutes (user: ${demoUserId})`)

    setTimeout(async () => {
      console.log(`[demo/cleanup] Starting cleanup for user ${demoUserId}...`)
      for (const agent of demoAgents) {
        try {
          // 1. Query remaining balance via mirror node
          const balResp = await fetch(`https://testnet.mirrornode.hedera.com/api/v1/balances?account.id=${agent.agentAccountId}&limit=1`)
          const balData = await balResp.json() as { balances?: Array<{ balance: number }> }
          const tinybar = balData.balances?.[0]?.balance ?? 0
          const hbarBalance = tinybar / 1e8

          if (hbarBalance > 0.5) {
            // 2. Transfer remaining HBAR back to operator (keep 0.1 for the tx fee)
            const refundAmount = Math.floor((hbarBalance - 0.1) * 100) / 100
            if (refundAmount > 0) {
              const agentKey = PrivateKey.fromStringRaw(agent.agentPrivateKey!)
              const agentClient = Client.forTestnet().setOperator(
                AccountId.fromString(agent.agentAccountId!),
                agentKey,
              )

              const tx = await new TransferTransaction()
                .addHbarTransfer(AccountId.fromString(agent.agentAccountId!), new Hbar(-refundAmount))
                .addHbarTransfer(AccountId.fromString(operatorId), new Hbar(refundAmount))
                .setTransactionMemo('Aivy demo cleanup — returning funds')
                .execute(agentClient)

              await tx.getReceipt(agentClient)
              agentClient.close()
              console.log(`[demo/cleanup] Refunded ${refundAmount} HBAR from ${agent.agentAccountId} → ${operatorId}`)
            }
          } else {
            console.log(`[demo/cleanup] Agent ${agent.agentAccountId} balance too low (${hbarBalance} HBAR), skipping refund`)
          }
        } catch (err) {
          console.warn(`[demo/cleanup] Failed to refund ${agent.agentAccountId}:`, err)
        }
      }

      // 2b. Schedule KMS key deletion for any KMS-encrypted agents
      for (const agent of demoAgents) {
        if (agent.kmsKeyId) {
          await scheduleKmsKeyDeletion(agent.kmsKeyId)
        }
      }

      // 3. Clean up demo data from DB
      db.clearDeploymentsByUser(demoUserId)
      db.clearJobsByUser(demoUserId)
      db.clearChatHistoryByUser(demoUserId)
      db.clearActivityByUser(demoUserId)
      console.log(`[demo/cleanup] Cleaned up DB for user ${demoUserId}`)
    }, DEMO_TTL_MS)
  }
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
// ERC-8183 — Agent-to-Agent Jobs
// ═══════════════════════════════════════════════════

const jobCreateSchema = z.object({
  clientAgentId: z.string().min(1),
  providerAgentId: z.string().min(1),
  description: z.string().min(2).max(500),
  budgetHbar: z.number().min(0.001).max(100000),
  expiresInMinutes: z.number().min(1).max(525600).optional().default(1440), // default 24h
})

const jobSubmitSchema = z.object({
  deliverable: z.string().min(1).max(2000),
})

const jobRejectSchema = z.object({
  reason: z.string().min(1).max(500).optional().default('Rejected by evaluator'),
})

// POST /api/jobs — Create a job between two agents
app.post('/api/jobs', requireAuth, toolLimiter, async (request, response) => {
  const parsed = jobCreateSchema.safeParse(request.body)
  if (!parsed.success) {
    response.status(400).json({ error: flattenZodError(parsed.error) })
    return
  }

  const { clientAgentId, providerAgentId, description, budgetHbar, expiresInMinutes } = parsed.data

  if (clientAgentId === providerAgentId) {
    response.status(400).json({ error: 'Client and provider must be different agents.' })
    return
  }

  const clientAgent = db.getDeployment(clientAgentId)
  if (!clientAgent) { response.status(404).json({ error: 'Client agent not found.' }); return }
  if (!assertAgentOwnership(clientAgent, request)) { response.status(403).json({ error: 'You do not own the client agent.' }); return }

  const providerAgent = db.getDeployment(providerAgentId)
  if (!providerAgent) { response.status(404).json({ error: 'Provider agent not found.' }); return }
  if (!assertAgentOwnership(providerAgent, request)) { response.status(403).json({ error: 'You do not own the provider agent.' }); return }

  try {
    const jobId = `job-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
    const expiredAt = new Date(Date.now() + expiresInMinutes * 60_000).toISOString()

    let contractId: string | null = null
    let txId: string | null = null

    if (!demoMode) {
      const result = await deployJobManagerContract()
      contractId = result.contractId
      txId = result.transactionId
    } else {
      contractId = nextDemoContractId()
      txId = nextDemoTxId()
    }

    const job: db.JobRecord = {
      id: jobId,
      jobChainId: 1,
      clientAgentId,
      providerAgentId,
      evaluatorAddress: config.operatorAccountId || null,
      description,
      budgetHbar,
      expiredAt,
      status: 'Open',
      deliverable: null,
      contractId,
      txId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    db.insertJob(job)
    pushActivity(`Job created: ${clientAgent.name} → ${providerAgent.name} (${budgetHbar} HBAR)`, 'vault')

    response.json({ job: db.getJob(jobId) })
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : 'Failed to create job.' })
  }
})

// GET /api/jobs — List jobs for current user's agents
app.get('/api/jobs', requireAuth, readLimiter, (request, response) => {
  const authReq = request as AuthRequest
  const jobs = db.getJobsByUser(authReq.userId ?? 'anonymous')
  response.json({ jobs })
})

// GET /api/jobs/:jobId — Get job details
app.get('/api/jobs/:jobId', requireAuth, readLimiter, (request, response) => {
  const job = db.getJob(request.params.jobId)
  if (!job) { response.status(404).json({ error: 'Job not found.' }); return }

  // Verify user owns either the client or provider agent
  const clientAgent = db.getDeployment(job.clientAgentId)
  const providerAgent = db.getDeployment(job.providerAgentId)
  const ownsClient = clientAgent && assertAgentOwnership(clientAgent, request)
  const ownsProvider = providerAgent && assertAgentOwnership(providerAgent, request)
  if (!ownsClient && !ownsProvider) {
    response.status(403).json({ error: 'You do not own either agent in this job.' })
    return
  }

  response.json({ job })
})

// POST /api/jobs/:jobId/fund — Fund the job (checks vault spending cap first)
app.post('/api/jobs/:jobId/fund', requireAuth, toolLimiter, async (request, response) => {
  const job = db.getJob(request.params.jobId)
  if (!job) { response.status(404).json({ error: 'Job not found.' }); return }
  if (job.status !== 'Open') { response.status(400).json({ error: `Job is ${job.status}, expected Open.` }); return }

  const clientAgent = db.getDeployment(job.clientAgentId)
  if (!clientAgent) { response.status(404).json({ error: 'Client agent not found.' }); return }
  if (!assertAgentOwnership(clientAgent, request)) { response.status(403).json({ error: 'You do not own the client agent.' }); return }

  // Vault cap bridge: check spending cap before funding
  if (clientAgent.vaultProtected) {
    const summary = db.getSpendingSummary(clientAgent.id)
    if (summary.totalSpent + job.budgetHbar > clientAgent.vaultCapHbar) {
      response.status(403).json({
        error: `Vault cap exceeded. Agent spent ${summary.totalSpent} HBAR of ${clientAgent.vaultCapHbar} HBAR cap. Job requires ${job.budgetHbar} HBAR.`,
      })
      return
    }
  }

  try {
    // Record spending against vault
    const fundTxId = demoMode ? nextDemoTxId() : job.txId
    db.recordSpending(
      clientAgent.id,
      job.budgetHbar,
      'outflow',
      'erc8183_fund',
      fundTxId,
      'chat',
      `Funded ERC-8183 job: ${job.description.slice(0, 80)}`,
    )

    db.updateJobStatus(job.id, 'Funded', null, fundTxId)
    pushActivity(`Job funded: ${clientAgent.name} escrowed ${job.budgetHbar} HBAR`, 'vault')

    response.json({ job: db.getJob(job.id), message: 'Job funded successfully.' })
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : 'Failed to fund job.' })
  }
})

// POST /api/jobs/:jobId/submit — Provider submits deliverable
app.post('/api/jobs/:jobId/submit', requireAuth, toolLimiter, (request, response) => {
  const parsed = jobSubmitSchema.safeParse(request.body)
  if (!parsed.success) { response.status(400).json({ error: flattenZodError(parsed.error) }); return }

  const job = db.getJob(request.params.jobId)
  if (!job) { response.status(404).json({ error: 'Job not found.' }); return }
  if (job.status !== 'Funded') { response.status(400).json({ error: `Job is ${job.status}, expected Funded.` }); return }

  const providerAgent = db.getDeployment(job.providerAgentId)
  if (!providerAgent) { response.status(404).json({ error: 'Provider agent not found.' }); return }
  if (!assertAgentOwnership(providerAgent, request)) { response.status(403).json({ error: 'You do not own the provider agent.' }); return }

  db.updateJobStatus(job.id, 'Submitted', parsed.data.deliverable)
  pushActivity(`Job submitted: ${providerAgent.name} delivered work`, 'success')

  response.json({ job: db.getJob(job.id), message: 'Deliverable submitted.' })
})

// POST /api/jobs/:jobId/complete — Evaluator approves and releases payment
app.post('/api/jobs/:jobId/complete', requireAuth, toolLimiter, (request, response) => {
  const job = db.getJob(request.params.jobId)
  if (!job) { response.status(404).json({ error: 'Job not found.' }); return }
  if (job.status !== 'Submitted') { response.status(400).json({ error: `Job is ${job.status}, expected Submitted.` }); return }

  // Only the client agent's owner (evaluator) can approve
  const clientAgent = db.getDeployment(job.clientAgentId)
  if (!clientAgent || !assertAgentOwnership(clientAgent, request)) {
    response.status(403).json({ error: 'Only the client agent owner can approve jobs.' })
    return
  }

  const providerAgent = db.getDeployment(job.providerAgentId)
  if (!providerAgent) { response.status(404).json({ error: 'Provider agent not found.' }); return }

  // Record inflow to provider agent
  const payTxId = demoMode ? nextDemoTxId() : `${job.txId}-pay`
  db.recordSpending(
    providerAgent.id,
    job.budgetHbar,
    'inflow',
    'erc8183_payout',
    payTxId,
    'chat',
    `ERC-8183 payout for job: ${job.description.slice(0, 80)}`,
  )

  db.updateJobStatus(job.id, 'Completed', null, payTxId)

  pushActivity(
    `Job completed: ${clientAgent.name} paid ${providerAgent.name} ${job.budgetHbar} HBAR`,
    'success',
  )

  response.json({ job: db.getJob(job.id), message: `Payment of ${job.budgetHbar} HBAR released to ${providerAgent.name}.` })
})

// POST /api/jobs/:jobId/reject — Evaluator rejects deliverable
app.post('/api/jobs/:jobId/reject', requireAuth, toolLimiter, (request, response) => {
  const parsed = jobRejectSchema.safeParse(request.body)
  if (!parsed.success) { response.status(400).json({ error: flattenZodError(parsed.error) }); return }

  const job = db.getJob(request.params.jobId)
  if (!job) { response.status(404).json({ error: 'Job not found.' }); return }
  if (job.status !== 'Submitted' && job.status !== 'Funded') {
    response.status(400).json({ error: `Job is ${job.status}, expected Submitted or Funded.` })
    return
  }

  // Only the client agent's owner (evaluator) can reject
  const clientAgentCheck = db.getDeployment(job.clientAgentId)
  if (!clientAgentCheck || !assertAgentOwnership(clientAgentCheck, request)) {
    response.status(403).json({ error: 'Only the client agent owner can reject jobs.' })
    return
  }

  db.updateJobStatus(job.id, 'Rejected')

  // Refund client agent if job was funded
  if (job.status === 'Funded' || job.status === 'Submitted') {
    const refundTxId = demoMode ? nextDemoTxId() : `${job.txId}-refund`
    db.recordSpending(
      job.clientAgentId,
      job.budgetHbar,
      'inflow',
      'erc8183_refund',
      refundTxId,
      'chat',
      `ERC-8183 refund for rejected job: ${job.description.slice(0, 80)}`,
    )
  }

  const clientAgent = db.getDeployment(job.clientAgentId)
  pushActivity(`Job rejected: ${clientAgent?.name ?? 'agent'} refunded ${job.budgetHbar} HBAR`, 'system')

  response.json({ job: db.getJob(job.id), message: 'Job rejected. Funds returned to client agent.' })
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
