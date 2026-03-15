import { useEffect, useMemo, useRef, useState } from 'react'
import Phaser from 'phaser'
import { createGameConfig } from './gameConfig'
import type { LiveAgent, NetworkStats, ActivityEvent, CoordinationEvent } from '../types'
import { templates } from '../data'
import { useAgentMovement } from '../hooks/useAgentMovement'
import { useSimulatedActivity } from '../hooks/useSimulatedActivity'
import { useWalletContext } from '../contexts/WalletContext'
import AgentSprite from '../components/AgentSprite'
import ActivityTicker from '../components/ActivityTicker'
import OmniChatBar from '../components/OmniChatBar'
import '../components/AgentSprite.css'
import './PhaserOffice.css'

/** Trigger a real coordination animation from a user action */
export type CoordTrigger = {
  srcId: string
  tgtId: string
  action: string
  label: string
} | null

type PhaserOfficeProps = {
  agents: LiveAgent[]
  stats: NetworkStats
  events: ActivityEvent[]
  coordinations: CoordinationEvent[]
  selectedAgentId: string
  lastChatMessages: Record<string, string>
  activeAgentIds: Set<string>
  coordTrigger?: CoordTrigger
  userAccountId?: string | null
  mirrorNodeUrl?: string
  onSelectAgent: (id: string) => void
  onDeploy: (templateId: string) => void
  onFundAgent?: (agentId: string) => void
  onAgentReply?: (agentId: string, message: string) => void
  onRefresh?: () => void
}

export default function PhaserOffice({
  agents,
  stats,
  events,
  coordinations,
  selectedAgentId,
  lastChatMessages,
  activeAgentIds,
  coordTrigger,
  userAccountId,
  mirrorNodeUrl,
  onSelectAgent,
  onDeploy,
  onFundAgent,
  onAgentReply,
  onRefresh,
}: PhaserOfficeProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const gameRef = useRef<Phaser.Game | null>(null)
  const [soundOn, setSoundOn] = useState(false)
  const { fetchAgentBalances, balanceVersion } = useWalletContext()

  // Pre-fetch all agent balances on mount + poll every 30s
  useEffect(() => {
    if (!mirrorNodeUrl || agents.length === 0) return
    const accountIds = agents
      .map((a) => a.agentAccountId)
      .filter((id): id is string => !!id)
    if (accountIds.length === 0) return
    fetchAgentBalances(accountIds, mirrorNodeUrl)
    const interval = setInterval(() => fetchAgentBalances(accountIds, mirrorNodeUrl), 30_000)
    return () => clearInterval(interval)
  }, [agents.length, mirrorNodeUrl, fetchAgentBalances, balanceVersion])

  // Activity animations — only fires on real user actions (chat, tool runs)
  const { simCoordinations, simActiveIds, fadingCoordIds, simEvents, triggerCoordination } = useSimulatedActivity(agents, soundOn)

  // Forward real coordination triggers from App
  const prevTriggerRef = useRef<CoordTrigger>(null)
  useEffect(() => {
    if (coordTrigger && coordTrigger !== prevTriggerRef.current) {
      triggerCoordination(coordTrigger.srcId, coordTrigger.tgtId, coordTrigger.action, coordTrigger.label)
    }
    prevTriggerRef.current = coordTrigger
  }, [coordTrigger, triggerCoordination])

  // Merge real + simulated coordinations and active IDs
  // Movement hook sees 'triggered' events (including fading ones — agents stay at door during fade)
  const mergedCoordinations = useMemo(() => {
    const simTriggered = simCoordinations.filter((c) => c.status === 'triggered')
    return [...coordinations, ...simTriggered]
  }, [coordinations, simCoordinations])

  const mergedActiveIds = useMemo(() => {
    const merged = new Set(activeAgentIds)
    for (const id of simActiveIds) merged.add(id)
    return merged
  }, [activeAgentIds, simActiveIds])

  // Merge real + simulated activity events for the ticker
  const mergedEvents = useMemo(() => {
    if (simEvents.length === 0) return events
    if (events.length === 0) return simEvents
    return [...simEvents, ...events].slice(0, 10)
  }, [events, simEvents])

  // Dynamic agent movement based on activity
  const movementPositions = useAgentMovement(agents, mergedCoordinations, mergedActiveIds)

  // Agents with dynamic positions applied
  const movedAgents = useMemo(() =>
    agents.map((agent) => {
      const pos = movementPositions.get(agent.id)
      if (!pos) return agent
      return { ...agent, x: pos.x, y: pos.y }
    }),
  [agents, movementPositions])

  // Mount Phaser game on first render (background only)
  useEffect(() => {
    if (!containerRef.current) return

    const config = createGameConfig(containerRef.current)
    const game = new Phaser.Game(config)
    gameRef.current = game

    return () => {
      game.destroy(true)
      gameRef.current = null
    }
  }, [])

  // Door positions in SVG percentage space — all clustered at center hub (X pattern)
  // Adjacent connections route through their nearby door; diagonal connections route through center
  const DOOR_POSITIONS: Record<string, { x: number; y: number }> = {
    // Adjacent — through center-cluster doors
    'Launch Bay|Strategy Pit': { x: 49.6, y: 42.8 },
    'Strategy Pit|Launch Bay': { x: 49.6, y: 42.8 },
    'Forum Deck|War Room': { x: 49.6, y: 56.1 },
    'War Room|Forum Deck': { x: 49.6, y: 56.1 },
    'Launch Bay|Forum Deck': { x: 41.7, y: 49.4 },
    'Forum Deck|Launch Bay': { x: 41.7, y: 49.4 },
    'Strategy Pit|War Room': { x: 58.3, y: 49.4 },
    'War Room|Strategy Pit': { x: 58.3, y: 49.4 },
    // Diagonal — through center hub (the X)
    'Launch Bay|War Room': { x: 50.0, y: 49.4 },
    'War Room|Launch Bay': { x: 50.0, y: 49.4 },
    'Strategy Pit|Forum Deck': { x: 50.0, y: 49.4 },
    'Forum Deck|Strategy Pit': { x: 50.0, y: 49.4 },
  }

  // Build unique coordination links between agents for SVG lines
  const coordLinks = useMemo(() => {
    const seen = new Set<string>()
    // Include both real coordinations and sim coordinations (triggered ones)
    const allCoords = [
      ...coordinations.filter((c) => c.status === 'triggered'),
      ...simCoordinations.filter((c) => c.status === 'triggered'),
    ]
    return allCoords
      .map((c) => {
        const src = movedAgents.find((a) => a.id === c.sourceAgentId)
        const tgt = movedAgents.find((a) => a.id === c.targetAgentId)
        if (!src || !tgt) return null
        const key = `${src.id}-${tgt.id}`
        if (seen.has(key)) return null
        seen.add(key)
        const fading = fadingCoordIds.has(c.id)
        // Find door position for handshake pulse
        const srcAgent = agents.find((a) => a.id === c.sourceAgentId)
        const tgtAgent = agents.find((a) => a.id === c.targetAgentId)
        const doorKey = srcAgent && tgtAgent ? `${srcAgent.room}|${tgtAgent.room}` : ''
        const doorPos = DOOR_POSITIONS[doorKey]
        return { src, tgt, action: c.action, fading, doorPos }
      })
      .filter(Boolean) as Array<{ src: LiveAgent; tgt: LiveAgent; action: string; fading: boolean; doorPos?: { x: number; y: number } }>
  }, [coordinations, simCoordinations, movedAgents, fadingCoordIds, agents])

  return (
    <div className="office-wrapper">
      {/* ─── Floating Stats (React overlay) ──── */}
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
          <label>Balance</label>
        </div>
        <div className="fstat-divider" />
        <div className="fstat">
          <span>{stats.hbarSecured.toFixed(0)}</span>
          <label>Vault Cap</label>
        </div>
        <div className="fstat-divider" />
        <button
          className={`sound-toggle ${soundOn ? 'sound-on' : ''}`}
          type="button"
          onClick={() => setSoundOn((v) => !v)}
          title={soundOn ? 'Mute sounds' : 'Enable sounds'}
        >
          {soundOn ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              <line x1="23" y1="9" x2="17" y2="15" />
              <line x1="17" y1="9" x2="23" y2="15" />
            </svg>
          )}
        </button>
      </div>

      {/* ─── Phaser Canvas + Agent Overlay ────── */}
      <div ref={containerRef} className="phaser-canvas-container">
        {/* Empty state overlay */}
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

        {/* ─── React Agent Sprites (overlay on top of Phaser) ── */}
        {movedAgents.map((agent, i) => (
          <AgentSprite
            key={agent.id}
            agent={agent}
            isSelected={agent.id === selectedAgentId}
            isActive={mergedActiveIds.has(agent.id)}
            isMoving={movementPositions.get(agent.id)?.isMoving ?? false}
            bobDelay={i * 0.3}
            onClick={() => onSelectAgent(agent.id)}
            onFund={onFundAgent && agent.walletType === 'dedicated' && agent.agentAccountId
              ? () => onFundAgent(agent.id) : undefined}
            lastChatMessage={lastChatMessages[agent.id]}
          />
        ))}

        {/* ─── Coordination Lines + Door Pulses (SVG overlay) ── */}
        {coordLinks.length > 0 && (
          <svg className="coord-lines" viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Agent coordination links">
            <defs>
              <marker id="coord-arrow" markerWidth="6" markerHeight="4" refX="6" refY="2" orient="auto">
                <path d="M0,0 L6,2 L0,4" fill="#5ad6b5" />
              </marker>
            </defs>
            {coordLinks.map(({ src, tgt, action, fading, doorPos }) => (
              <g key={`${src.id}-${tgt.id}`}>
                {/* Route line through the door instead of cutting through walls */}
                <polyline
                  points={doorPos
                    ? `${src.x},${src.y} ${doorPos.x},${doorPos.y} ${tgt.x},${tgt.y}`
                    : `${src.x},${src.y} ${tgt.x},${tgt.y}`}
                  fill="none"
                  stroke="#5ad6b5"
                  strokeWidth="0.4"
                  strokeDasharray="1.5 0.8"
                  strokeLinejoin="round"
                  markerEnd="url(#coord-arrow)"
                  className={`coord-line-anim ${fading ? 'coord-line-fading' : ''}`}
                >
                  <title>{src.name} → {tgt.name}: {action}</title>
                </polyline>
                {/* Door handshake pulse — glowing dot at the door */}
                {doorPos && !fading && (
                  <>
                    <circle cx={doorPos.x} cy={doorPos.y} r="0.6" fill="#5ad6b5" opacity="0.8" />
                    <circle cx={doorPos.x} cy={doorPos.y} r="1.5" fill="#5ad6b5" className="coord-pulse" />
                  </>
                )}
              </g>
            ))}
          </svg>
        )}

        {/* Deploy FAB */}
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
                <img
                  alt=""
                  className="pixel-image"
                  src={t.sprite}
                  style={{ width: 20, height: 20, imageRendering: 'pixelated' }}
                />
                <span>{t.name}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Activity Ticker */}
        <ActivityTicker events={mergedEvents} />
      </div>

      {/* ─── Omni Chat Bar (below canvas) ──── */}
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
