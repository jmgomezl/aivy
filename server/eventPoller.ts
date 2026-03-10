import * as db from './db.js'

type EventCallback = (triggerId: string, deploymentId: string, filledPrompt: string) => Promise<void>

let pollInterval: ReturnType<typeof setInterval> | null = null
let mirrorNodeUrl = ''
let onTrigger: EventCallback | null = null

export function startPoller(
  mirrorUrl: string,
  callback: EventCallback,
  intervalMs = 30_000,
): void {
  mirrorNodeUrl = mirrorUrl.replace(/\/$/, '')
  onTrigger = callback
  stopPoller()
  pollInterval = setInterval(() => void pollAll(), intervalMs)
  console.log(`[EventPoller] Started polling every ${intervalMs / 1000}s`)
}

export function stopPoller(): void {
  if (pollInterval) {
    clearInterval(pollInterval)
    pollInterval = null
  }
}

async function pollAll(): Promise<void> {
  const triggers = db.getAllEnabledTriggers()
  for (const trigger of triggers) {
    try {
      await pollTrigger(trigger)
    } catch (err) {
      console.error(`[EventPoller] Error polling trigger ${trigger.id}:`, err)
    }
  }
}

async function pollTrigger(trigger: db.EventTrigger): Promise<void> {
  const deployment = db.getDeployment(trigger.deploymentId)
  if (!deployment || deployment.status === 'paused') return

  const now = new Date().toISOString()
  const since = trigger.lastCheckedAt ?? new Date(Date.now() - 60_000).toISOString()
  // Convert ISO to seconds timestamp for Mirror Node
  const sinceTs = (new Date(since).getTime() / 1000).toFixed(9)

  let events: Array<Record<string, unknown>> = []

  switch (trigger.eventType) {
    case 'hbar_inflow':
      events = await pollHbarInflow(trigger, deployment, sinceTs)
      break
    case 'hcs_message':
      events = await pollHcsMessage(trigger, sinceTs)
      break
    case 'token_transfer':
      events = await pollTokenTransfer(trigger, deployment, sinceTs)
      break
  }

  db.updateTriggerCheckedAt(trigger.id, now)

  for (const event of events) {
    const filledPrompt = fillTemplate(trigger.promptTemplate, event)
    db.updateTriggerTriggeredAt(trigger.id, now)
    if (onTrigger) {
      await onTrigger(trigger.id, trigger.deploymentId, filledPrompt)
    }
  }
}

async function pollHbarInflow(
  trigger: db.EventTrigger,
  deployment: db.DeploymentRecord,
  sinceTs: string,
): Promise<Array<Record<string, unknown>>> {
  const accountId = (trigger.config.accountId as string) || deployment.agentAccountId
  if (!accountId) return []

  const minAmount = Number(trigger.config.minAmount ?? 0)
  const url = `${mirrorNodeUrl}/transactions?account.id=${accountId}&type=CRYPTOTRANSFER&timestamp=gt:${sinceTs}&limit=10&order=asc`

  try {
    const resp = await fetch(url)
    if (!resp.ok) return []
    const data = await resp.json() as { transactions?: Array<Record<string, unknown>> }
    const txs = data.transactions ?? []

    const results: Array<Record<string, unknown>> = []
    for (const tx of txs) {
      const transfers = tx.transfers as Array<{ account: string; amount: number }> | undefined
      if (!transfers) continue
      const inflow = transfers.find(t => t.account === accountId && t.amount > 0)
      if (!inflow) continue
      const amountHbar = inflow.amount / 100_000_000
      if (amountHbar < minAmount) continue

      const sender = transfers.find(t => t.amount < 0 && t.account !== accountId)
      results.push({
        amount: amountHbar.toFixed(4),
        sender: sender?.account ?? 'unknown',
        txId: tx.transaction_id ?? '',
        timestamp: tx.consensus_timestamp ?? '',
      })
    }
    return results
  } catch {
    return []
  }
}

async function pollHcsMessage(
  trigger: db.EventTrigger,
  sinceTs: string,
): Promise<Array<Record<string, unknown>>> {
  const topicId = trigger.config.topicId as string
  if (!topicId) return []

  const url = `${mirrorNodeUrl}/topics/${topicId}/messages?timestamp=gt:${sinceTs}&limit=5&order=asc`

  try {
    const resp = await fetch(url)
    if (!resp.ok) return []
    const data = await resp.json() as { messages?: Array<Record<string, unknown>> }
    const messages = data.messages ?? []

    return messages.map(msg => {
      let decoded = ''
      try {
        decoded = Buffer.from(String(msg.message ?? ''), 'base64').toString('utf-8')
      } catch { /* ignore */ }
      return {
        message: decoded,
        sender: msg.payer_account_id ?? 'unknown',
        topicId,
        sequenceNumber: msg.sequence_number ?? '',
        timestamp: msg.consensus_timestamp ?? '',
      }
    })
  } catch {
    return []
  }
}

async function pollTokenTransfer(
  trigger: db.EventTrigger,
  deployment: db.DeploymentRecord,
  sinceTs: string,
): Promise<Array<Record<string, unknown>>> {
  const accountId = (trigger.config.accountId as string) || deployment.agentAccountId
  if (!accountId) return []

  const tokenId = trigger.config.tokenId as string | undefined
  const url = `${mirrorNodeUrl}/transactions?account.id=${accountId}&timestamp=gt:${sinceTs}&limit=10&order=asc`

  try {
    const resp = await fetch(url)
    if (!resp.ok) return []
    const data = await resp.json() as { transactions?: Array<Record<string, unknown>> }
    const txs = data.transactions ?? []

    const results: Array<Record<string, unknown>> = []
    for (const tx of txs) {
      const tokenTransfers = tx.token_transfers as Array<{ token_id: string; account: string; amount: number }> | undefined
      if (!tokenTransfers || tokenTransfers.length === 0) continue

      for (const tt of tokenTransfers) {
        if (tt.account !== accountId || tt.amount <= 0) continue
        if (tokenId && tt.token_id !== tokenId) continue

        const sender = tokenTransfers.find(t => t.token_id === tt.token_id && t.amount < 0)
        results.push({
          amount: tt.amount.toString(),
          tokenId: tt.token_id,
          sender: sender?.account ?? 'unknown',
          txId: tx.transaction_id ?? '',
          timestamp: tx.consensus_timestamp ?? '',
        })
      }
    }
    return results
  } catch {
    return []
  }
}

function fillTemplate(template: string, vars: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    return String(vars[key] ?? `{{${key}}}`)
  })
}
