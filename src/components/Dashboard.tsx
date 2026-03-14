import { useCallback, useEffect, useMemo, useState } from 'react'
import { requestJson } from '../utils'
import { templates } from '../data'
import './Dashboard.css'

type AgentStat = {
  id: string
  name: string
  templateId: string
  status: string
  executions: number
  vaultProtected: boolean
  vaultCapHbar: number
  room: string
  createdAt: string
}

type CoordinationEvent = {
  id: string
  sourceAgentName: string
  targetAgentName: string
  trigger: string
  action: string
  timestamp: string
  status: string
}

type AgentSpending = {
  agentId: string
  agentName: string
  totalSpent: number
  totalFunded: number
  txCount: number
}

type DashboardData = {
  summary: {
    totalAgents: number
    activeAgents: number
    pausedAgents: number
    totalExecutions: number
    totalVaultCapHbar: number
    vaultUtilization: number
    totalCoordinations: number
  }
  agentStats: AgentStat[]
  roomDistribution: Record<string, number>
  templateDistribution: Record<string, number>
  recentActivity: Array<{ id: string; label: string; tone: string; timestamp: string }>
  recentCoordinations: CoordinationEvent[]
  spending?: {
    totalSpentAllAgents: number
    perAgent: AgentSpending[]
  }
}

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null)

  const refresh = useCallback(async () => {
    try {
      const d = await requestJson<DashboardData>('/api/dashboard')
      setData(d)
    } catch (err) {
      console.warn('[Dashboard] Failed to load data:', err)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const interval = window.setInterval(() => void refresh(), 8000)
    return () => window.clearInterval(interval)
  }, [refresh])

  // useMemo must run on EVERY render (React 19 hook-count rule)
  const maxExec = useMemo(
    () => (data ? Math.max(...data.agentStats.map(a => a.executions), 1) : 1),
    [data],
  )

  if (!data) {
    return (
      <div className="dashboard-loading">
        <svg className="dash-spinner" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#5ad6b5" strokeWidth="2.5">
          <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round">
            <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite" />
          </path>
        </svg>
        <p>Loading dashboard...</p>
      </div>
    )
  }

  const { summary, agentStats, roomDistribution, recentCoordinations } = data

  return (
    <div className="dashboard">
      {/* ─── Summary Cards ─────────────────────── */}
      <div className="dash-cards">
        <div className="dash-card">
          <span className="dash-card-value">{summary.totalAgents}</span>
          <span className="dash-card-label">Total Agents</span>
          <span className="dash-card-sub">
            {summary.activeAgents} active, {summary.pausedAgents} paused
          </span>
        </div>
        <div className="dash-card accent-amber">
          <span className="dash-card-value">{summary.totalExecutions}</span>
          <span className="dash-card-label">Total Runs</span>
          <span className="dash-card-sub">Across all agents</span>
        </div>
        <div className="dash-card accent-teal">
          <span className="dash-card-value">{summary.totalVaultCapHbar.toFixed(0)}</span>
          <span className="dash-card-label">HBAR Secured</span>
          <span className="dash-card-sub">{summary.vaultUtilization}% vault protected</span>
        </div>
        <div className="dash-card accent-purple">
          <span className="dash-card-value">{summary.totalCoordinations}</span>
          <span className="dash-card-label">Coordinations</span>
          <span className="dash-card-sub">Cross-agent triggers</span>
        </div>
      </div>

      <div className="dash-grid">
        {/* ─── Runs per Agent ────────────────────── */}
        <div className="dash-section">
          <h3 className="dash-section-title">Runs per Agent</h3>
          {agentStats.length === 0 ? (
            <p className="dash-empty">No agents deployed yet</p>
          ) : (
            <div className="dash-bars">
              {agentStats.map(agent => {
                const template = templates.find(t => t.id === agent.templateId)
                const pct = (agent.executions / maxExec) * 100
                return (
                  <div className="dash-bar-row" key={agent.id}>
                    <div className="dash-bar-label">
                      {template && (
                        <img
                          alt=""
                          className="pixel-image"
                          src={template.sprite}
                          style={{ width: 18, height: 18, imageRendering: 'pixelated' }}
                        />
                      )}
                      <span>{agent.name}</span>
                    </div>
                    <div className="dash-bar-track">
                      <div
                        className="dash-bar-fill"
                        style={{
                          width: `${Math.max(pct, 2)}%`,
                          background: template?.color ?? '#5ad6b5',
                        }}
                      />
                    </div>
                    <span className="dash-bar-count">{agent.executions}</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* ─── Room Distribution ─────────────────── */}
        <div className="dash-section">
          <h3 className="dash-section-title">Room Distribution</h3>
          <div className="dash-room-grid">
            {Object.entries(roomDistribution).map(([room, count]) => (
              <div className="dash-room-card" key={room}>
                <span className="dash-room-count">{count}</span>
                <span className="dash-room-name">{room}</span>
              </div>
            ))}
            {Object.keys(roomDistribution).length === 0 && (
              <p className="dash-empty">No rooms occupied</p>
            )}
          </div>
        </div>

        {/* ─── Vault Utilization ──────────────────── */}
        <div className="dash-section">
          <h3 className="dash-section-title">Vault Utilization</h3>
          <div className="dash-vault-ring-container">
            <svg className="dash-vault-ring" viewBox="0 0 120 120">
              <circle
                cx="60" cy="60" r="50"
                fill="none"
                stroke="rgba(255,255,255,0.06)"
                strokeWidth="10"
              />
              <circle
                cx="60" cy="60" r="50"
                fill="none"
                stroke="#5ad6b5"
                strokeWidth="10"
                strokeDasharray={`${summary.vaultUtilization * 3.14} ${314 - summary.vaultUtilization * 3.14}`}
                strokeDashoffset="78.5"
                strokeLinecap="round"
                style={{ transition: 'stroke-dasharray 0.6s ease' }}
              />
            </svg>
            <div className="dash-vault-ring-text">
              <span className="dash-vault-pct">{summary.vaultUtilization}%</span>
              <span className="dash-vault-sub">Protected</span>
            </div>
          </div>
          <div className="dash-vault-details">
            {agentStats.filter(a => a.vaultProtected).map(agent => (
              <div className="dash-vault-item" key={agent.id}>
                <span className="dash-vault-name">{agent.name}</span>
                <span className="dash-vault-cap">{agent.vaultCapHbar} HBAR</span>
              </div>
            ))}
          </div>
        </div>

        {/* ─── HBAR Spending ──────────────────────── */}
        {data.spending?.perAgent && data.spending.perAgent.some(a => a.txCount > 0) && (
          <div className="dash-section">
            <h3 className="dash-section-title">HBAR Spending</h3>
            <div className="dash-spending-total">
              <span className="dash-spending-value">{data.spending.totalSpentAllAgents.toFixed(2)}</span>
              <span className="dash-spending-label">Total HBAR spent across all agents</span>
            </div>
            <div className="dash-bars">
              {data.spending.perAgent.filter(a => a.txCount > 0).map(agent => {
                const perAgent = data.spending?.perAgent ?? []
                const maxSpent = Math.max(...perAgent.map(a => a.totalSpent), 1)
                const pct = (agent.totalSpent / maxSpent) * 100
                return (
                  <div className="dash-bar-row" key={agent.agentId}>
                    <div className="dash-bar-label">
                      <span>{agent.agentName}</span>
                    </div>
                    <div className="dash-bar-track">
                      <div
                        className="dash-bar-fill"
                        style={{ width: `${Math.max(pct, 2)}%`, background: '#f87171' }}
                      />
                      {agent.totalFunded > 0 && (
                        <div
                          className="dash-bar-fill dash-bar-funded"
                          style={{ width: `${Math.max((agent.totalFunded / maxSpent) * 100, 2)}%`, background: '#4ade80' }}
                        />
                      )}
                    </div>
                    <span className="dash-bar-count">{agent.totalSpent.toFixed(1)}</span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* ─── Agent-to-Agent Coordination ────────── */}
        <div className="dash-section">
          <h3 className="dash-section-title">
            Agent Coordination
            {recentCoordinations.length > 0 && (
              <span className="dash-coord-badge">{recentCoordinations.length}</span>
            )}
          </h3>
          {recentCoordinations.length === 0 ? (
            <div className="dash-coord-empty">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#3a4a68" strokeWidth="1.5">
                <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />
              </svg>
              <p>No cross-agent events yet. Deploy multiple agents and let them interact.</p>
            </div>
          ) : (
            <div className="dash-coord-list">
              {recentCoordinations.map(event => (
                <div className="dash-coord-item" key={event.id}>
                  <span className="dash-coord-arrow">
                    <strong>{event.sourceAgentName}</strong>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5ad6b5" strokeWidth="2">
                      <path d="M5 12h14M12 5l7 7-7 7" />
                    </svg>
                    <strong>{event.targetAgentName}</strong>
                  </span>
                  <span className="dash-coord-action">{event.action}</span>
                  <span className="dash-coord-time">{event.timestamp}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
