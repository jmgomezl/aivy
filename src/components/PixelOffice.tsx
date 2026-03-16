import { useMemo } from 'react'
import type { LiveAgent, NetworkStats, ActivityEvent, CoordinationEvent } from '../types'
import { roomCards, templates } from '../data'
import AgentSprite from './AgentSprite'
import OmniChatBar from './OmniChatBar'
import ActivityTicker from './ActivityTicker'
import './PixelOffice.css'

type PixelOfficeProps = {
  agents: LiveAgent[]
  stats: NetworkStats
  events: ActivityEvent[]
  coordinations: CoordinationEvent[]
  selectedAgentId: string
  lastChatMessages: Record<string, string>
  activeAgentIds: Set<string>
  userAccountId?: string | null
  onSelectAgent: (id: string) => void
  onDeploy: (templateId: string) => void
  onAgentReply?: (agentId: string, message: string) => void
  onRefresh?: () => void
}

export default function PixelOffice({
  agents,
  stats,
  events,
  coordinations,
  selectedAgentId,
  lastChatMessages,
  activeAgentIds,
  userAccountId,
  onSelectAgent,
  onDeploy,
  onAgentReply,
  onRefresh,
}: PixelOfficeProps) {
  // Build unique coordination links between agents for SVG lines
  const coordLinks = useMemo(() => {
    const seen = new Set<string>()
    return coordinations
      .map(c => {
        const src = agents.find(a => a.id === c.sourceAgentId)
        const tgt = agents.find(a => a.id === c.targetAgentId)
        if (!src || !tgt) return null
        const key = `${src.id}-${tgt.id}`
        if (seen.has(key)) return null
        seen.add(key)
        return { src, tgt, action: c.action }
      })
      .filter(Boolean) as Array<{ src: LiveAgent; tgt: LiveAgent; action: string }>
  }, [coordinations, agents])
  return (
    <div className="office-wrapper">
      {/* ─── Floating Stats ──────────────────────── */}
      <div className="floating-stats">
        <div className="fstat">
          <span>{stats.connectedAgents}</span>
          <label>Agents</label>
        </div>
        <div className="fstat-divider" />
        <div className="fstat">
          <span>{stats.safeVaults}</span>
          <label>Vaults</label>
        </div>
        <div className="fstat-divider" />
        <div className="fstat">
          <span>{stats.totalExecutions}</span>
          <label>Runs</label>
        </div>
        <div className="fstat-divider" />
        <div className="fstat">
          <span>{stats.totalBalance.toFixed(1)}</span>
          <label>Agents Balance</label>
        </div>
        <div className="fstat-divider" />
        <div className="fstat">
          <span>{stats.hbarSecured.toFixed(0)}</span>
          <label>Vault Cap</label>
        </div>
      </div>

      {/* ─── Office Grid ─────────────────────────── */}
      <div className="pixel-office-v2">
        {roomCards.map((room) => (
          <div className={`office-room-v2 ${room.className}`} key={room.name}>
            <h3>{room.name}</h3>
            <p>{room.blurb}</p>
          </div>
        ))}

        {agents.length === 0 && (
          <div className="office-empty">
            <div className="empty-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M12 2L2 7l10 5 10-5-10-5z" />
                <path d="M2 17l10 5 10-5" />
                <path d="M2 12l10 5 10-5" />
              </svg>
            </div>
            <h3>Your office is empty</h3>
            <p>Deploy AI agents to manage vaults, route yield, and govern on-chain</p>
            <button
              className="empty-deploy-btn"
              type="button"
              onClick={() => onDeploy(templates[0].id)}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M12 5v14M5 12h14" />
              </svg>
              Deploy your first agent
            </button>
            <span className="empty-hint">or press <kbd>D</kbd> to deploy</span>
          </div>
        )}

        {agents.map((agent, index) => (
          <AgentSprite
            key={agent.id}
            agent={agent}
            isSelected={selectedAgentId === agent.id}
            isActive={activeAgentIds.has(agent.id)}
            bobDelay={index * 0.3}
            onClick={() => onSelectAgent(agent.id)}
            lastChatMessage={lastChatMessages[agent.id]}
          />
        ))}

        {/* ─── Coordination Lines ──────────────────── */}
        {coordLinks.length > 0 && (
          <svg className="coord-lines" viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Agent coordination links">
            <defs>
              <marker id="coord-arrow" markerWidth="6" markerHeight="4" refX="6" refY="2" orient="auto">
                <path d="M0,0 L6,2 L0,4" fill="#5ad6b5" />
              </marker>
            </defs>
            {coordLinks.map(({ src, tgt, action }, i) => (
              <line
                key={`${src.x}-${src.y}-${tgt.x}-${tgt.y}-${i}`}
                x1={src.x}
                y1={src.y}
                x2={tgt.x}
                y2={tgt.y}
                stroke="#5ad6b5"
                strokeWidth="0.4"
                strokeDasharray="1.5 0.8"
                markerEnd="url(#coord-arrow)"
                opacity="0.75"
                className="coord-line-anim"
              >
                <title>{src.name} → {tgt.name}: {action}</title>
              </line>
            ))}
          </svg>
        )}

        {/* ─── Activity Ticker (overlay on grid) ──── */}
        <ActivityTicker events={events} />

        {/* ─── Floating Deploy Button ──────────────── */}
        <div className="deploy-fab-group">
          <button className="deploy-fab" type="button">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Deploy Agent
          </button>
          <div className="fab-dropdown">
            {templates.map((t) => (
              <button
                className="fab-option"
                key={t.id}
                onClick={() => onDeploy(t.id)}
                type="button"
              >
                <img alt="" className="pixel-image" src={t.sprite} style={{ width: 20, height: 20, imageRendering: 'pixelated' }} />
                <span>{t.name}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ─── Omni Chat Bar (below grid, in flow) ── */}
      <OmniChatBar
        agents={agents}
        userAccountId={userAccountId}
        onSelectAgent={onSelectAgent}
        onAgentReply={onAgentReply}
        onRefresh={onRefresh}
      />
    </div>
  )
}
