import { useEffect, useMemo, useState } from 'react'
import type { LiveAgent, ToolCatalogResponse, ToolCatalogEntry, ToolWorkflow, ToolCatalogGroup, ActivityEvent, AgentSpendingResponse, WalletState } from '../types'
import { statusMeta, toneClass } from '../data'
import { requestJson } from '../utils'
import ChatPanel from './ChatPanel'
import ScheduleManager from './ScheduleManager'
import TriggerManager from './TriggerManager'
import './AgentPanel.css'

type AgentPanelProps = {
  agent: LiveAgent
  catalog: ToolCatalogResponse | null
  userAccountId: string | null
  isMutating: boolean
  chatEnabled: boolean
  events: ActivityEvent[]
  allAgents: LiveAgent[]
  onClose: () => void
  onRunAgent: () => void
  onToggleAgent: () => void
  onRemoveAgent: () => void
  onOpenToolLibrary: (toolName?: string, params?: Record<string, unknown>) => void
  onRunWorkflow: (workflow: ToolWorkflow) => void
  onAgentReply?: (agentId: string, message: string) => void
  onRefresh?: () => void
  onMarkActive?: (agentId: string) => void
  wallet?: WalletState
  onConnectWallet?: () => void
}

export default function AgentPanel({
  agent,
  catalog,
  userAccountId,
  isMutating,
  chatEnabled,
  events,
  allAgents,
  onClose,
  onRunAgent,
  onToggleAgent,
  onRemoveAgent,
  onOpenToolLibrary,
  onRunWorkflow,
  onAgentReply,
  onRefresh,
  onMarkActive,
  wallet,
  onConnectWallet,
}: AgentPanelProps) {
  const [activeTab, setActiveTab] = useState<'info' | 'chat' | 'history' | 'spending' | 'automation'>(chatEnabled ? 'chat' : 'info')
  const [isExporting, setIsExporting] = useState(false)
  const [coordTarget, setCoordTarget] = useState('')
  const [coordMsg, setCoordMsg] = useState('')
  const [coordSending, setCoordSending] = useState(false)
  const [coordResult, setCoordResult] = useState<string | null>(null)
  const [walletBalance, setWalletBalance] = useState<number | null>(null)
  const [walletLoading, setWalletLoading] = useState(false)
  const [fundAmount, setFundAmount] = useState('')
  const [fundingInProgress, setFundingInProgress] = useState(false)
  const [fundResult, setFundResult] = useState<string | null>(null)
  const [spendingData, setSpendingData] = useState<AgentSpendingResponse | null>(null)
  const [spendingLoading, setSpendingLoading] = useState(false)

  useEffect(() => {
    if (activeTab === 'spending') {
      setSpendingLoading(true)
      requestJson<AgentSpendingResponse>(`/api/agents/${agent.id}/spending`)
        .then(setSpendingData)
        .catch(() => setSpendingData(null))
        .finally(() => setSpendingLoading(false))
    }
  }, [agent.id, activeTab])

  useEffect(() => {
    if (activeTab !== 'info') return
    setWalletLoading(true)
    requestJson<{ walletType: string; agentAccountId: string | null; balance: number | null }>(
      `/api/agents/${agent.id}/wallet`,
    )
      .then((res) => setWalletBalance(res.balance))
      .catch(() => setWalletBalance(null))
      .finally(() => setWalletLoading(false))
  }, [agent.id, activeTab])

  const otherAgents = useMemo(
    () => allAgents.filter(a => a.id !== agent.id && a.status !== 'paused'),
    [allAgents, agent.id],
  )

  const handleCoordinate = async () => {
    if (!coordTarget || !coordMsg.trim()) return
    setCoordSending(true)
    setCoordResult(null)
    try {
      const res = await requestJson<{ message: string }>(
        `/api/agents/${agent.id}/coordinate`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ targetAgentId: coordTarget, message: coordMsg }),
        },
      )
      setCoordResult(res.message)
      setCoordMsg('')
      onRefresh?.()
    } catch (err) {
      setCoordResult(err instanceof Error ? err.message : 'Failed')
    } finally {
      setCoordSending(false)
    }
  }
  const toolGroups = useMemo(() => catalog?.groups ?? [], [catalog])

  const agentEvents = useMemo(() =>
    events.filter((e) => e.label.toLowerCase().includes(agent.name.toLowerCase())),
    [events, agent.name],
  )

  const handleExportAudit = async () => {
    setIsExporting(true)
    try {
      const resp = await fetch(`/api/agents/${agent.id}/export-audit`)
      if (!resp.ok) throw new Error('Export failed')
      const blob = await resp.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `audit-${agent.name.replace(/\s+/g, '-').toLowerCase()}-${Date.now()}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch {
      // Silent fail for hackathon
    } finally {
      setIsExporting(false)
    }
  }

  const handleFundAgent = async () => {
    const amount = parseFloat(fundAmount)
    if (!amount || amount <= 0 || !agent.agentAccountId) return
    setFundingInProgress(true)
    setFundResult(null)
    try {
      const { fundAgentAccount } = await import('../lib/hederaWallet')
      const { transactionId } = await fundAgentAccount(agent.agentAccountId, amount)
      await requestJson(`/api/agents/${agent.id}/fund`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amountHbar: amount,
          txId: transactionId,
          funderAccountId: wallet?.status === 'connected' ? wallet.accountId : 'unknown',
        }),
      })
      setFundResult(`Funded ${amount} HBAR!`)
      setFundAmount('')
      onRefresh?.()
    } catch (err) {
      setFundResult(err instanceof Error ? err.message : 'Funding failed')
    } finally {
      setFundingInProgress(false)
    }
  }

  const workflows = useMemo(() => {
    if (!catalog) return []
    return catalog.workflowsByTemplate[agent.templateId] ?? []
  }, [catalog, agent.templateId])

  const suggestedTools: ToolCatalogEntry[] = useMemo(() => {
    if (!catalog) return []
    const enabledGroups = new Set(agent.capabilityGroups)
    const toolEntries = catalog.tools
    return (catalog.suggestedToolsByTemplate[agent.templateId] ?? []).flatMap(
      (name) => {
        const entry = toolEntries.find((t) => t.name === name)
        return entry && enabledGroups.has(entry.groupId) ? [entry] : []
      },
    )
  }, [catalog, agent])

  return (
    <div className="agent-panel-overlay" onClick={onClose}>
      <aside className="agent-panel" onClick={(e) => e.stopPropagation()}>
        {/* ─── Header ──────────────────────────── */}
        <div className="ap-header">
          <div className="ap-header-left">
            <span className="ap-portrait">
              <img alt="" className="pixel-image" src={agent.sprite} />
            </span>
            <div>
              <h2 className="ap-name">{agent.name}</h2>
              <span
                className="ap-status"
                style={{ color: statusMeta[agent.status].accent }}
              >
                {statusMeta[agent.status].label}
              </span>
            </div>
          </div>
          <button className="ap-close" onClick={onClose} type="button">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* ─── Tabs ──────────────────────────── */}
        <div className="ap-tabs">
          {chatEnabled && (
            <button
              className={`ap-tab ${activeTab === 'chat' ? 'is-active' : ''}`}
              onClick={() => setActiveTab('chat')}
              type="button"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
              </svg>
              Chat
            </button>
          )}
          <button
            className={`ap-tab ${activeTab === 'info' ? 'is-active' : ''}`}
            onClick={() => setActiveTab('info')}
            type="button"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
            Info
          </button>
          <button
            className={`ap-tab ${activeTab === 'history' ? 'is-active' : ''}`}
            onClick={() => setActiveTab('history')}
            type="button"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
            History
            {agentEvents.length > 0 && (
              <span className="ap-tab-badge">{agentEvents.length}</span>
            )}
          </button>
          <button
            className={`ap-tab ${activeTab === 'spending' ? 'is-active' : ''}`}
            onClick={() => setActiveTab('spending')}
            type="button"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="1" x2="12" y2="23" />
              <path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
            </svg>
            Spending
          </button>
          <button
            className={`ap-tab ${activeTab === 'automation' ? 'is-active' : ''}`}
            onClick={() => setActiveTab('automation')}
            type="button"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
            </svg>
            Auto
          </button>
        </div>

        {/* ─── Chat Tab ──────────────────────── */}
        {activeTab === 'chat' && chatEnabled && (
          <ChatPanel
            agent={agent}
            userAccountId={userAccountId}
            onAgentReply={onAgentReply}
            onRefresh={onRefresh}
            onMarkActive={onMarkActive}
          />
        )}

        {/* ─── Info Tab ──────────────────────── */}
        {activeTab === 'info' && (
          <>
            {/* ─── Mission ─────────────────────────── */}
            <p className="ap-mission">{agent.mission}</p>

            {/* ─── Stats Grid ──────────────────────── */}
            <div className="ap-stats">
              <div className="ap-stat">
                <span>Topic</span>
                <strong>{agent.topicId ?? 'Pending'}</strong>
              </div>
              <div className="ap-stat">
                <span>Vault</span>
                <strong>{agent.contractId ?? 'Pending'}</strong>
              </div>
              <div className="ap-stat">
                <span>Runs</span>
                <strong>{agent.executions}</strong>
              </div>
              <div className="ap-stat">
                <span>Cap</span>
                <strong>{agent.vaultCapHbar} HBAR</strong>
              </div>
            </div>

            {/* ─── Wallet ──────────────────────────── */}
            <div className="ap-wallet-section">
              <div className="ap-wallet-header">
                <span className="ap-section-label">
                  {agent.walletType === 'dedicated' ? 'Dedicated Wallet' : 'Shared Wallet'}
                </span>
                {agent.walletType === 'dedicated' && (
                  <span className="ap-wallet-badge">Own Account</span>
                )}
              </div>
              {agent.agentAccountId && (
                <div className="ap-wallet-account">
                  <a
                    href={`https://hashscan.io/testnet/account/${agent.agentAccountId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ap-wallet-id"
                  >
                    {agent.agentAccountId}
                  </a>
                  <span className="ap-wallet-balance">
                    {walletLoading ? '...' : walletBalance !== null ? `${walletBalance} HBAR` : '--'}
                  </span>
                </div>
              )}
              {agent.walletType === 'dedicated' && agent.agentAccountId && (
                <div className="ap-fund-form">
                  {wallet?.status === 'connected' ? (
                    <>
                      <div className="ap-fund-row">
                        <input
                          type="number"
                          className="ap-fund-input"
                          placeholder="HBAR"
                          value={fundAmount}
                          onChange={(e) => setFundAmount(e.target.value)}
                          min="0.01"
                          step="0.1"
                        />
                        <button
                          className="ap-fund-btn"
                          onClick={() => void handleFundAgent()}
                          disabled={fundingInProgress || !fundAmount}
                          type="button"
                        >
                          {fundingInProgress ? 'Sending...' : `Fund ${fundAmount || '0'} ℏ`}
                        </button>
                      </div>
                      {fundResult && <span className={`ap-fund-result ${fundResult.includes('Funded') ? 'success' : 'error'}`}>{fundResult}</span>}
                    </>
                  ) : (
                    <button
                      className="ap-fund-btn"
                      onClick={() => onConnectWallet?.()}
                      type="button"
                    >
                      Connect wallet to fund
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* ─── Export Audit ────────────────────── */}
            <button
              className="ap-btn-export"
              onClick={() => void handleExportAudit()}
              disabled={isExporting}
              type="button"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
              </svg>
              {isExporting ? 'Exporting...' : 'Export Audit Report'}
            </button>

            {/* ─── Capabilities ────────────────────── */}
            <div className="ap-section">
              <div className="ap-section-header">
                <span className="ap-section-label">Capabilities</span>
                <button
                  className="ap-link"
                  onClick={() => onOpenToolLibrary()}
                  type="button"
                >
                  Open tool library
                </button>
              </div>
              <div className="ap-chips">
                {agent.capabilityGroups.map((groupId) => {
                  const group: ToolCatalogGroup | undefined = toolGroups.find((g) => g.id === groupId)
                  if (!group) return null
                  return (
                    <span className={`ap-chip ${toneClass[group.tone]}`} key={group.id}>
                      {group.label}
                    </span>
                  )
                })}
              </div>
            </div>

            {/* ─── Workflows ───────────────────────── */}
            {workflows.length > 0 && (
              <div className="ap-section">
                <span className="ap-section-label">Quick workflows</span>
                <div className="ap-workflows">
                  {workflows.map((wf) => (
                    <button
                      className="ap-workflow"
                      key={wf.id}
                      onClick={() => onRunWorkflow(wf)}
                      type="button"
                    >
                      <strong>{wf.title}</strong>
                      <p>{wf.description}</p>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* ─── Suggested Tools ─────────────────── */}
            {suggestedTools.length > 0 && (
              <div className="ap-section">
                <span className="ap-section-label">Popular tools</span>
                <div className="ap-quick-tools">
                  {suggestedTools.map((tool) => (
                    <button
                      className="ap-quick-tool"
                      key={tool.name}
                      onClick={() => onOpenToolLibrary(tool.name)}
                      type="button"
                    >
                      {tool.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* ─── Guardrail ───────────────────────── */}
            <div className="ap-info">
              <span>Guardrail</span>
              <p>{agent.guardrail}</p>
            </div>

            {agent.lastAction && (
              <div className="ap-info">
                <span>Last action</span>
                <p>{agent.lastAction}</p>
              </div>
            )}

            {/* ─── Coordination ────────────────────── */}
            {otherAgents.length > 0 && (
              <div className="ap-section">
                <span className="ap-section-label">Coordinate with agent</span>
                <div className="ap-coord-form">
                  <select
                    className="ap-coord-select"
                    value={coordTarget}
                    onChange={(e) => setCoordTarget(e.target.value)}
                  >
                    <option value="">Select agent...</option>
                    {otherAgents.map(a => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>
                  <input
                    className="ap-coord-input"
                    placeholder="Message to send..."
                    value={coordMsg}
                    onChange={(e) => setCoordMsg(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') void handleCoordinate() }}
                  />
                  <button
                    className="ap-coord-send"
                    onClick={() => void handleCoordinate()}
                    disabled={coordSending || !coordTarget || !coordMsg.trim()}
                    type="button"
                  >
                    {coordSending ? '...' : 'Send'}
                  </button>
                </div>
                {coordResult && (
                  <p className="ap-coord-result">{coordResult}</p>
                )}
              </div>
            )}

            {/* ─── Actions ─────────────────────────── */}
            <div className="ap-actions">
              <button className="ap-btn-primary" onClick={onRunAgent} type="button">
                {isMutating ? 'Running...' : 'Run recommended action'}
              </button>
              <button className="ap-btn-secondary" onClick={onToggleAgent} type="button">
                {agent.status === 'paused' ? 'Resume' : 'Pause'}
              </button>
              <button className="ap-btn-ghost" onClick={onRemoveAgent} type="button">
                Remove
              </button>
            </div>
          </>
        )}

        {/* ─── History Tab ─────────────────────── */}
        {activeTab === 'history' && (
          <div className="ap-history">
            {agentEvents.length === 0 ? (
              <p className="ap-history-empty">No activity recorded yet. Run an action or chat with this agent to see its history.</p>
            ) : (
              <div className="ap-timeline">
                {agentEvents.map((event) => (
                  <div className={`ap-timeline-item tone-${event.tone}`} key={event.id}>
                    <span className="ap-timeline-dot" />
                    <div className="ap-timeline-content">
                      <p>{event.label}</p>
                      <span className="ap-timeline-time">{event.timestamp}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ─── Spending Tab ────────────────────── */}
        {activeTab === 'spending' && (
          <div className="ap-spending">
            {spendingLoading ? (
              <p className="ap-history-empty">Loading spending data...</p>
            ) : !spendingData || spendingData.summary.txCount === 0 ? (
              <p className="ap-history-empty">No spending recorded yet. Execute HBAR transfers via chat or tools to track spending.</p>
            ) : (
              <>
                <div className="ap-spending-summary">
                  <div className="ap-spending-card outflow">
                    <span className="ap-spending-label">Total Spent</span>
                    <strong>{spendingData.summary.totalSpent.toFixed(2)} HBAR</strong>
                  </div>
                  <div className="ap-spending-card inflow">
                    <span className="ap-spending-label">Total Funded</span>
                    <strong>{spendingData.summary.totalFunded.toFixed(2)} HBAR</strong>
                  </div>
                  <div className="ap-spending-card">
                    <span className="ap-spending-label">Burn Rate</span>
                    <strong>{spendingData.burnRatePerDay} HBAR/day</strong>
                  </div>
                  {spendingData.burnRatePerDay > 0 && (
                    <div className="ap-spending-card">
                      <span className="ap-spending-label">Est. Runway</span>
                      <strong>
                        {Math.max(0, Math.round((spendingData.summary.totalFunded - spendingData.summary.totalSpent) / spendingData.burnRatePerDay))} days
                      </strong>
                    </div>
                  )}
                </div>
                <div className="ap-spending-list">
                  {spendingData.records.map((r) => (
                    <div className={`ap-spending-row ${r.direction}`} key={r.id}>
                      <span className="ap-spending-dir">{r.direction === 'inflow' ? '+' : '−'}</span>
                      <span className="ap-spending-amount">{r.amountHbar.toFixed(2)} HBAR</span>
                      <span className="ap-spending-meta">
                        {r.toolName ?? r.source}
                        {r.txId && <span className="ap-spending-tx"> · {r.txId.slice(0, 20)}…</span>}
                      </span>
                      <span className="ap-spending-time">{new Date(r.createdAt).toLocaleDateString()}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* ─── Automation Tab ─────────────────── */}
        {activeTab === 'automation' && (
          <div className="ap-automation">
            <ScheduleManager agentId={agent.id} />
            <div className="ap-automation-divider" />
            <TriggerManager
              agentId={agent.id}
              agentAccountId={agent.agentAccountId ?? null}
              agentTopicId={agent.topicId ?? null}
            />
          </div>
        )}
      </aside>
    </div>
  )
}
