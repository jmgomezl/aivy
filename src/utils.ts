import type { AgentTemplate, LiveAgent, ResultReference } from './types'

export async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(url, init)
  } catch {
    throw new Error('Cannot reach the backend server. Make sure it is running (npm run dev).')
  }

  if (!response.ok) {
    let message = `Request failed with status ${response.status}`
    // Vite proxy returns 502/504 HTML when backend is down
    if (response.status === 502 || response.status === 504) {
      throw new Error('Backend server is offline. Start it with: npm run dev')
    }
    try {
      const payload = (await response.json()) as { error?: string | { formErrors?: string[] } }
      if (typeof payload.error === 'string') {
        message = payload.error
      } else if (payload.error?.formErrors?.[0]) {
        message = payload.error.formErrors[0]
      }
    } catch {
      // ignore JSON parse failure
    }
    throw new Error(message)
  }

  if (response.status === 204) {
    return undefined as T
  }

  return (await response.json()) as T
}

export function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export function pruneToolParams(value: unknown): unknown {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed ? trimmed : undefined
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined
  }

  if (typeof value === 'boolean') {
    return value
  }

  if (Array.isArray(value)) {
    const items = value
      .map((item) => pruneToolParams(item))
      .filter((item) => item !== undefined)
    return items.length > 0 ? items : undefined
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value)
      .map(([key, item]) => [key, pruneToolParams(item)] as const)
      .filter(([, item]) => item !== undefined)
    return entries.length > 0 ? Object.fromEntries(entries) : undefined
  }

  return undefined
}

export function resolveWorkflowValue(
  value: unknown,
  context: {
    operatorAccountId: string | null
    selectedAgent: LiveAgent | null
  },
): unknown {
  if (typeof value === 'string') {
    return value
      .replaceAll('{{operatorAccountId}}', context.operatorAccountId ?? '')
      .replaceAll('{{selectedAgent.topicId}}', context.selectedAgent?.topicId ?? '')
      .replaceAll(
        '{{selectedAgent.deploymentTxId}}',
        context.selectedAgent?.deploymentTxId ?? '',
      )
  }

  if (Array.isArray(value)) {
    return value.map((item) => resolveWorkflowValue(item, context))
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        resolveWorkflowValue(item, context),
      ]),
    )
  }

  return value
}

export function buildLaunchPayload(
  template: AgentTemplate,
  values: Record<string, unknown>,
  count: number,
  vaultRequired: boolean,
) {
  const label =
    typeof values.agentLabel === 'string' && values.agentLabel.trim()
      ? values.agentLabel.trim()
      : `${template.name} ${count}`
  const note =
    typeof values.launchNote === 'string' && values.launchNote.trim()
      ? values.launchNote.trim()
      : template.mission

  if (template.id === 'treasury-sentinel') {
    const cap = Number(values.vaultCapHbar ?? 250)
    const policyMode = String(values.policyMode ?? 'approved counterparties')
    return {
      name: `${label}`,
      guardrail: `Treasury transfers capped at ${cap} HBAR with ${policyMode}.`,
      vaultCapHbar: cap,
      launchNote: note,
    }
  }

  if (template.id === 'yield-router') {
    const cap = Number(values.vaultCapHbar ?? 120)
    const policyMode = String(values.policyMode ?? 'stable pools')
    const slippageBps = Number(values.slippageBps ?? 50)
    return {
      name: `${label}`,
      guardrail: `Execution capped at ${cap} HBAR across ${policyMode} with max slippage ${slippageBps} bps.`,
      vaultCapHbar: vaultRequired ? cap : 0,
      launchNote: note,
    }
  }

  if (template.id === 'compliance-clerk') {
    const evidenceMode = String(values.evidenceMode ?? 'topic + tx record')
    const policyMode = String(values.policyMode ?? 'all transactions')
    return {
      name: `${label}`,
      guardrail: `Compliance review for ${policyMode} with ${evidenceMode} evidence enforcement.`,
      vaultCapHbar: vaultRequired ? Number(values.vaultCapHbar ?? 60) : 0,
      launchNote: note,
    }
  }

  const threshold = Number(values.threshold ?? 3)
  const timelockHours = Number(values.timelockHours ?? 24)
  return {
    name: `${label}`,
    guardrail: `Governance actions require ${threshold} approvals with a ${timelockHours} hour timelock.`,
    vaultCapHbar: vaultRequired ? Number(values.vaultCapHbar ?? 0) : 0,
    launchNote: note,
  }
}

export function summarizeResultReferences(references: ResultReference[]) {
  if (references.length === 0) {
    return 'No on-chain objects were returned for this action.'
  }

  const labels = references.map((reference) => reference.label.toLowerCase())

  if (labels.includes('contract') || labels.includes('contract address')) {
    return 'Contract deployment completed and is ready to inspect in the mirror node.'
  }

  if (labels.includes('topic')) {
    return 'Consensus output is live and ready to inspect in the mirror node.'
  }

  if (labels.includes('token')) {
    return 'Token state changed successfully and the created asset is linked below.'
  }

  if (labels.includes('transaction')) {
    return 'The transaction settled successfully and can be inspected below.'
  }

  return 'The action returned live Hedera references you can inspect or copy below.'
}
