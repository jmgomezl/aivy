import { useMemo, useState } from 'react'
import type { LiveAgent, ToolCatalogResponse, ToolCatalogEntry, ToolWorkflow, ToolCatalogGroup, ActivityEvent } from '../types'
import { statusMeta, toneClass } from '../data'
import { requestJson } from '../utils'
import ChatPanel from './ChatPanel'
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
}: AgentPanelProps) {
  const [activeTab, setActiveTab] = useState<'info' | 'chat' | 'history'>(chatEnabled ? 'chat' : 'info')
  const [isExporting, setIsExporting] = useState(false)
  const [coordTarget, setCoordTarget] = useState('')
  const [coordMsg, setCoordMsg] = useState('')
  const [coordSending, setCoordSending] = useState(false)
  const [coordResult, setCoordResult] = useState<string | null>(null)

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
      </aside>
    </div>
  )
}
