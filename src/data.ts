import treasurySentinelSprite from './assets/agents/treasury-sentinel.svg'
import yieldRouterSprite from './assets/agents/yield-router.svg'
import complianceClerkSprite from './assets/agents/compliance-clerk.svg'
import governanceRelaySprite from './assets/agents/governance-relay.svg'
import bonzoKeeperSprite from './assets/agents/bonzo-keeper.svg'
import type {
  AgentTemplate,
  AgentStatus,
  NetworkStats,
  LaunchWizardConfig,
  ToolCatalogGroup,
  ServerDeployment,
  LiveAgent,
} from './types'

export const templates: AgentTemplate[] = [
  {
    id: 'treasury-sentinel',
    name: 'Treasury Sentinel',
    glyph: 'TS',
    sprite: treasurySentinelSprite,
    color: '#ff9a3c',
    room: 'Launch Bay',
    mission: 'Monitor treasury balances and sign safe cash actions.',
    description:
      'Monitors balances and routes each action through a guarded vault contract.',
    guardrail: 'Transfer caps and approved counterparties',
  },
  {
    id: 'yield-router',
    name: 'Yield Router',
    glyph: 'YR',
    sprite: yieldRouterSprite,
    color: '#4ecdc4',
    room: 'Strategy Pit',
    mission: 'Rotate liquidity between approved strategies.',
    description:
      'Evaluates strategies and executes only against approved routes.',
    guardrail: 'Protocol allowlist and slippage limits',
  },
  {
    id: 'compliance-clerk',
    name: 'Compliance Clerk',
    glyph: 'CC',
    sprite: complianceClerkSprite,
    color: '#f25f5c',
    room: 'War Room',
    mission: 'Audit every agent action before it reaches Hedera.',
    description:
      'Publishes audit records and blocks flows that bypass policy.',
    guardrail: 'Attestation and audit log enforcement',
  },
  {
    id: 'governance-relay',
    name: 'Governance Relay',
    glyph: 'GR',
    sprite: governanceRelaySprite,
    color: '#7f95d1',
    room: 'Forum Deck',
    mission: 'Coordinate proposals, votes, and scheduled actions.',
    description:
      'Turns governance instructions into observable Hedera automations.',
    guardrail: 'Timelocks and approval thresholds',
  },
  {
    id: 'bonzo-keeper',
    name: 'Bonzo Keeper',
    glyph: 'BK',
    sprite: bonzoKeeperSprite,
    color: '#2ECC71',
    room: 'Strategy Pit',
    mission: 'Manage DeFi yield on Bonzo vaults with sentiment-aware strategies.',
    description:
      'Deposits, harvests, and rebalances Bonzo lending positions using market sentiment and price feeds.',
    guardrail: 'Vault spending caps and sentiment thresholds',
  },
]

export const roomCards = [
  { name: 'Launch Bay', className: 'launch-bay', blurb: 'Provisioning' },
  { name: 'Strategy Pit', className: 'strategy-pit', blurb: 'Execution' },
  { name: 'Forum Deck', className: 'forum-deck', blurb: 'Approvals' },
  { name: 'War Room', className: 'war-room', blurb: 'Vault + audit' },
]

export const launchWizardByTemplate: Record<string, LaunchWizardConfig> = {
  'treasury-sentinel': {
    title: 'Treasury launch',
    description: 'Set the desk identity, transfer boundary, and audit posture.',
    defaults: {
      agentLabel: 'Main Treasury',
      vaultCapHbar: 250,
      policyMode: 'approved counterparties',
      launchNote: 'Daily treasury monitoring and protected cash movement.',
    },
    fields: [
      { id: 'agentLabel', label: 'Desk label', input: 'text' },
      { id: 'vaultCapHbar', label: 'Vault cap (HBAR)', input: 'number' },
      {
        id: 'policyMode',
        label: 'Counterparty mode',
        input: 'select',
        options: [
          { label: 'Approved counterparties', value: 'approved counterparties' },
          { label: 'Treasury team only', value: 'treasury team only' },
          { label: 'Open test recipients', value: 'open test recipients' },
        ],
      },
      {
        id: 'launchNote',
        label: 'Launch note',
        input: 'textarea',
        placeholder: 'What this treasury agent is watching',
      },
    ],
  },
  'yield-router': {
    title: 'Yield launch',
    description: 'Choose the strategy style, slippage posture, and reward rail.',
    defaults: {
      agentLabel: 'Yield Desk',
      vaultCapHbar: 120,
      policyMode: 'stable pools',
      slippageBps: 50,
      launchNote: 'Routing rewards across approved yield rails.',
    },
    fields: [
      { id: 'agentLabel', label: 'Strategy label', input: 'text' },
      {
        id: 'policyMode',
        label: 'Strategy mode',
        input: 'select',
        options: [
          { label: 'Stable pools', value: 'stable pools' },
          { label: 'Blue-chip DeFi', value: 'blue-chip DeFi' },
          { label: 'Experimental testnet', value: 'experimental testnet' },
        ],
      },
      { id: 'slippageBps', label: 'Max slippage (bps)', input: 'number' },
      { id: 'vaultCapHbar', label: 'Vault cap (HBAR)', input: 'number' },
      {
        id: 'launchNote',
        label: 'Launch note',
        input: 'textarea',
        placeholder: 'What strategy this router should prioritize',
      },
    ],
  },
  'compliance-clerk': {
    title: 'Compliance launch',
    description: 'Define the review style, evidence scope, and operator boundary.',
    defaults: {
      agentLabel: 'Compliance Desk',
      vaultCapHbar: 60,
      policyMode: 'all transactions',
      evidenceMode: 'topic + tx record',
      launchNote: 'Audit-first workflow with evidence attached to every action.',
    },
    fields: [
      { id: 'agentLabel', label: 'Desk label', input: 'text' },
      {
        id: 'policyMode',
        label: 'Review mode',
        input: 'select',
        options: [
          { label: 'All transactions', value: 'all transactions' },
          { label: 'Treasury only', value: 'treasury only' },
          { label: 'High-value actions', value: 'high-value actions' },
        ],
      },
      {
        id: 'evidenceMode',
        label: 'Evidence trail',
        input: 'select',
        options: [
          { label: 'Topic + tx record', value: 'topic + tx record' },
          { label: 'Topic only', value: 'topic only' },
          { label: 'Tx record only', value: 'tx record only' },
        ],
      },
      {
        id: 'launchNote',
        label: 'Launch note',
        input: 'textarea',
        placeholder: 'How this compliance agent should review activity',
      },
    ],
  },
  'governance-relay': {
    title: 'Governance launch',
    description: 'Configure the proposal room, threshold, and timelock rhythm.',
    defaults: {
      agentLabel: 'Governance Forum',
      vaultCapHbar: 0,
      threshold: 3,
      timelockHours: 24,
      launchNote: 'Proposal routing with a visible approval window.',
    },
    fields: [
      { id: 'agentLabel', label: 'Forum label', input: 'text' },
      { id: 'threshold', label: 'Approval threshold', input: 'number' },
      { id: 'timelockHours', label: 'Timelock (hours)', input: 'number' },
      {
        id: 'launchNote',
        label: 'Launch note',
        input: 'textarea',
        placeholder: 'What governance stream this relay should coordinate',
      },
    ],
  },
  'bonzo-keeper': {
    title: 'Bonzo Keeper launch',
    description: 'Deploy a sentiment-aware DeFi keeper for Bonzo lending vaults.',
    defaults: {
      agentLabel: 'Bonzo Keeper',
      vaultCapHbar: 100,
      policyMode: 'conservative',
      launchNote: 'Autonomous yield management with sentiment-aware harvesting on Bonzo Finance.',
    },
    fields: [
      { id: 'agentLabel', label: 'Keeper label', input: 'text' },
      {
        id: 'policyMode',
        label: 'Risk profile',
        input: 'select',
        options: [
          { label: 'Conservative (stablecoins)', value: 'conservative' },
          { label: 'Balanced (blue-chip tokens)', value: 'balanced' },
          { label: 'Aggressive (volatile pairs)', value: 'aggressive' },
        ],
      },
      { id: 'vaultCapHbar', label: 'Vault cap (HBAR)', input: 'number' },
      {
        id: 'launchNote',
        label: 'Launch note',
        input: 'textarea',
        placeholder: 'Strategy focus: e.g. "maximize HBAR yield safely"',
      },
    ],
  },
}

export const emptyStats: NetworkStats = {
  connectedAgents: 0,
  safeVaults: 0,
  totalExecutions: 0,
  pendingTransactions: 0,
  hbarSecured: 0,
}

export const roomSlots: Record<string, Array<{ x: number; y: number }>> = {
  'Launch Bay': [
    { x: 14, y: 18 },
    { x: 30, y: 28 },
    { x: 18, y: 38 },
    { x: 36, y: 16 },
    { x: 38, y: 40 },
  ],
  'Strategy Pit': [
    { x: 66, y: 18 },
    { x: 80, y: 28 },
    { x: 72, y: 38 },
    { x: 88, y: 16 },
    { x: 60, y: 30 },
  ],
  'Forum Deck': [
    { x: 14, y: 66 },
    { x: 30, y: 76 },
    { x: 18, y: 86 },
    { x: 36, y: 68 },
    { x: 38, y: 88 },
  ],
  'War Room': [
    { x: 66, y: 66 },
    { x: 80, y: 76 },
    { x: 72, y: 86 },
    { x: 88, y: 68 },
    { x: 60, y: 80 },
  ],
}

export const statusMeta: Record<AgentStatus, { label: string; accent: string }> = {
  deploying: { label: 'Deploying', accent: '#f3c35f' },
  guarded: { label: 'Guarded', accent: '#61d6bf' },
  active: { label: 'Active', accent: '#8ae18f' },
  paused: { label: 'Paused', accent: '#8390ad' },
}

export const toneClass: Record<ToolCatalogGroup['tone'], string> = {
  amber: 'is-amber',
  teal: 'is-teal',
  blue: 'is-blue',
  rose: 'is-rose',
}

export const speechBubbles: Record<string, string[]> = {
  'treasury-sentinel': [
    'Checking balances...',
    'Vault cap OK',
    'Signing tx...',
    'Transfer approved',
    'Monitoring HBAR...',
  ],
  'yield-router': [
    'Scanning pools...',
    'Slippage within limits',
    'Routing liquidity...',
    'Strategy updated',
    'Yield optimized',
  ],
  'compliance-clerk': [
    'Auditing actions...',
    'Policy check passed',
    'Logging evidence...',
    'Reviewing tx record',
    'Attestation filed',
  ],
  'governance-relay': [
    'Reading proposals...',
    'Timelock active',
    'Collecting votes...',
    'Threshold met',
    'Scheduling action...',
  ],
  'bonzo-keeper': [
    'Checking sentiment...',
    'Scanning Bonzo APY...',
    'Harvesting rewards...',
    'Market bearish — swapping',
    'Yield optimized',
  ],
}

export function applyLayout(deployments: ServerDeployment[]): LiveAgent[] {
  const roomIndexes = new Map<string, number>()

  return deployments.map((deployment) => {
    const template =
      templates.find((item) => item.id === deployment.templateId) ?? templates[0]
    const index = roomIndexes.get(deployment.room) ?? 0
    roomIndexes.set(deployment.room, index + 1)
    const slot = roomSlots[deployment.room]?.[index] ?? { x: 50, y: 50 }

    return {
      ...deployment,
      glyph: template.glyph,
      sprite: template.sprite,
      color: template.color,
      mission: template.mission,
      x: slot.x,
      y: slot.y,
    }
  })
}
