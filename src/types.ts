import type { WalletSessionInfo } from './lib/hederaWallet'

export type AgentStatus = 'deploying' | 'guarded' | 'active' | 'paused'

export type CapabilityGroupId =
  | 'accounts'
  | 'accountQueries'
  | 'consensus'
  | 'consensusQueries'
  | 'tokens'
  | 'tokenQueries'
  | 'contracts'
  | 'contractQueries'
  | 'networkQueries'
  | 'transactionQueries'
  | 'saucerswap'
  | 'pyth'
  | 'memejob'
  | 'bonzo'
  | 'coincap'
  | 'chainlink'

export type AgentTemplate = {
  id: string
  name: string
  glyph: string
  sprite: string
  color: string
  room: string
  mission: string
  description: string
  guardrail: string
}

export type ActivityEvent = {
  id: string
  label: string
  tone: 'system' | 'success' | 'vault'
  timestamp: string
}

export type NetworkStats = {
  connectedAgents: number
  safeVaults: number
  totalExecutions: number
  pendingTransactions: number
  hbarSecured: number   // vault spending caps (governance limit)
  totalBalance: number  // net funded balance across all agents (funded - spent)
}

export type ServerDeployment = {
  id: string
  templateId: string
  name: string
  room: string
  guardrail: string
  vaultProtected: boolean
  capabilityGroups: CapabilityGroupId[]
  status: AgentStatus
  lastAction: string
  executions: number
  topicId: string | null
  contractId: string | null
  contractAddress: string | null
  deploymentTxId: string | null
  vaultCapHbar: number
  agentAccountId: string | null
  walletType: 'platform' | 'dedicated'
}

export type ToolCatalogGroup = {
  id: CapabilityGroupId
  label: string
  description: string
  tone: 'teal' | 'amber' | 'blue' | 'rose'
  tools: string[]
}

export type ToolFormField = {
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

export type ToolFormDefinition = {
  fields: ToolFormField[]
}

export type ToolCatalogEntry = {
  name: string
  label: string
  groupId: CapabilityGroupId
  description: string
  parameterHints: string[]
  example: Record<string, unknown>
  kind: 'query' | 'mutation'
  form?: ToolFormDefinition
}

export type ToolWorkflow = {
  id: string
  title: string
  description: string
  toolName: string
  params: Record<string, unknown>
}

export type ResultReference = {
  type: 'transaction' | 'topic' | 'contract' | 'token' | 'account' | 'address'
  label: string
  value: string
  url: string
}

export type ToolCatalogResponse = {
  groups: ToolCatalogGroup[]
  tools: ToolCatalogEntry[]
  suggestedToolsByTemplate: Record<string, string[]>
  defaultCapabilityGroupsByTemplate: Record<string, CapabilityGroupId[]>
  workflowsByTemplate: Record<string, ToolWorkflow[]>
}

export type CoordinationEvent = {
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

export type LivePayload = {
  configured: boolean
  demoMode?: boolean
  chatEnabled?: boolean
  network?: string
  operatorAccountId?: string | null
  mirrorNodeUrl?: string
  stats: NetworkStats
  deployments: ServerDeployment[]
  activity: ActivityEvent[]
  coordinations?: CoordinationEvent[]
  error?: string
}

export type LiveAgent = ServerDeployment & {
  glyph: string
  sprite: string
  color: string
  mission: string
  x: number
  y: number
}

export type ToolInvokeResponse = {
  deployment: ServerDeployment
  tool: {
    name: string
    label: string
    groupId: CapabilityGroupId
    kind: 'query' | 'mutation'
  }
  result: {
    raw?: Record<string, unknown>
    humanMessage?: string
  }
  references: ResultReference[]
}

export type DeployResponse = {
  deployment: ServerDeployment
  balanceSnapshot: string | null
  references: ResultReference[]
}

export type AgentMutationResponse = {
  deployment: ServerDeployment
  result: {
    raw?: Record<string, unknown>
    humanMessage?: string
  }
  references: ResultReference[]
}

export type ResultDrawerState = {
  title: string
  message: string
  references: ResultReference[]
}

export type LaunchWizardConfig = {
  title: string
  description: string
  defaults: Record<string, string | number>
  fields: Array<{
    id: string
    label: string
    input: 'text' | 'number' | 'textarea' | 'select'
    placeholder?: string
    help?: string
    options?: Array<{ label: string; value: string }>
  }>
}

export type WalletState =
  | { status: 'idle' }
  | { status: 'connecting' }
  | ({ status: 'connected' } & WalletSessionInfo)
  | { status: 'error'; error: string }

// ─── Chat Types ───────────────────────────────────
export type ChatRole = 'user' | 'assistant' | 'tool'

export type ChatMessage = {
  id: string
  role: ChatRole
  content: string
  toolName?: string
  toolParams?: Record<string, unknown>
  timestamp: string
}

export type ChatResponse = {
  reply: string
  toolCalls?: Array<{
    toolName: string
    params: Record<string, unknown>
    result: { raw?: Record<string, unknown>; humanMessage?: string }
  }>
  references: ResultReference[]
}

// ─── Spending Types ─────────────────────────────────
export type SpendingRecord = {
  id: number
  deploymentId: string
  amountHbar: number
  direction: 'outflow' | 'inflow'
  toolName: string | null
  txId: string | null
  source: 'chat' | 'schedule' | 'trigger' | 'funding'
  description: string | null
  createdAt: string
}

export type AgentSpendingResponse = {
  summary: { totalSpent: number; totalFunded: number; txCount: number }
  burnRatePerDay: number
  records: SpendingRecord[]
}

// ─── Job Types (ERC-8183) ────────────────────────────
export type JobRecord = {
  id: string
  jobChainId: number
  clientAgentId: string
  providerAgentId: string
  evaluatorAddress: string | null
  description: string
  budgetHbar: number
  expiredAt: string
  status: 'Open' | 'Funded' | 'Submitted' | 'Completed' | 'Rejected' | 'Expired'
  deliverable: string | null
  contractId: string | null
  txId: string | null
  createdAt: string
  updatedAt: string
}

// ─── Schedule Types ──────────────────────────────────
export type AgentSchedule = {
  id: string
  deploymentId: string
  cronExpression: string
  prompt: string
  description: string
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export type ScheduleExecution = {
  id: number
  scheduleId: string
  deploymentId: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cap_exceeded'
  resultSummary: string | null
  errorMessage: string | null
  startedAt: string | null
  completedAt: string | null
}

// ─── Event Trigger Types ─────────────────────────────
export type EventTrigger = {
  id: string
  deploymentId: string
  eventType: 'hbar_inflow' | 'hcs_message' | 'token_transfer'
  config: Record<string, unknown>
  promptTemplate: string
  enabled: boolean
  lastCheckedAt: string | null
  lastTriggeredAt: string | null
  createdAt: string
}
