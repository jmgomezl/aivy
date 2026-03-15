import { useEffect, useRef, useState, useCallback } from 'react'
import type { LiveAgent, CoordinationEvent } from '../types'

/* ─── Waypoint System ─────────────────────────────────
 * All coordinates are percentages (0-100) matching the
 * CSS positioning in AgentSprite:
 *   left: calc(X% - 38px), top: calc(Y% - 38px)
 *
 * Room layout (percentage space):
 *   Launch Bay:    x ≈ 2-48,  y ≈ 2-48
 *   Strategy Pit:  x ≈ 52-98, y ≈ 2-48
 *   Forum Deck:    x ≈ 2-48,  y ≈ 52-98
 *   War Room:      x ≈ 52-98, y ≈ 52-98
 * ──────────────────────────────────────────────────── */

/** Named waypoints within each room for furniture-driven movement.
 *  Door waypoints cluster near the center intersection (X hub). */
const roomWaypoints: Record<string, Record<string, { x: number; y: number }>> = {
  'Launch Bay': {
    home:       { x: 14, y: 18 },
    rack:       { x: 6,  y: 22 },     // near server racks (left wall)
    terminal:   { x: 34, y: 14 },     // near command terminal (top-right)
    status:     { x: 36, y: 28 },     // near deployment status panel
    doorRight:  { x: 46, y: 38 },     // door to Strategy Pit (near center)
    doorDown:   { x: 38, y: 44 },     // door to Forum Deck (near center)
    doorCenter: { x: 44, y: 42 },     // diagonal to War Room (center hub)
    center:     { x: 22, y: 28 },     // room center
    wander1:    { x: 18, y: 36 },
    wander2:    { x: 30, y: 20 },
    wander3:    { x: 12, y: 32 },
  },
  'Strategy Pit': {
    home:       { x: 66, y: 18 },
    monitor1:   { x: 58, y: 14 },    // left trading monitor
    monitor2:   { x: 68, y: 12 },    // center monitor
    monitor3:   { x: 78, y: 14 },    // right monitor
    desk:       { x: 70, y: 28 },    // central analysis desk
    yield:      { x: 92, y: 22 },    // yield indicator bar (right)
    doorLeft:   { x: 54, y: 38 },    // door to Launch Bay (near center)
    doorDown:   { x: 62, y: 44 },    // door to War Room (near center)
    doorCenter: { x: 56, y: 42 },    // diagonal to Forum Deck (center hub)
    center:     { x: 72, y: 26 },
    wander1:    { x: 62, y: 32 },
    wander2:    { x: 82, y: 20 },
    wander3:    { x: 74, y: 38 },
  },
  'Forum Deck': {
    home:       { x: 14, y: 66 },
    table:      { x: 22, y: 74 },    // round governance table
    station1:   { x: 22, y: 64 },    // top voting station
    station2:   { x: 32, y: 74 },    // right voting station
    proposal:   { x: 38, y: 62 },    // proposal display (top-right)
    clock:      { x: 6,  y: 86 },    // timelock clock (bottom-left)
    doorUp:     { x: 38, y: 56 },    // door to Launch Bay (near center)
    doorRight:  { x: 46, y: 58 },    // door to War Room (near center)
    doorCenter: { x: 44, y: 54 },    // diagonal to Strategy Pit (center hub)
    center:     { x: 24, y: 76 },
    wander1:    { x: 16, y: 82 },
    wander2:    { x: 32, y: 68 },
    wander3:    { x: 20, y: 70 },
  },
  'War Room': {
    home:       { x: 66, y: 66 },
    vault:      { x: 58, y: 74 },    // vault door (left-center)
    monitors:   { x: 82, y: 62 },    // security monitor grid (top-right)
    auditLog:   { x: 74, y: 88 },    // audit log display (bottom)
    alarm:      { x: 54, y: 62 },    // alarm LEDs (top-left)
    doorUp:     { x: 62, y: 56 },    // door to Strategy Pit (near center)
    doorLeft:   { x: 54, y: 58 },    // door to Forum Deck (near center)
    doorCenter: { x: 56, y: 54 },    // diagonal to Launch Bay (center hub)
    center:     { x: 72, y: 76 },
    wander1:    { x: 62, y: 82 },
    wander2:    { x: 84, y: 70 },
    wander3:    { x: 68, y: 68 },
  },
}

/** Maps template → preferred furniture waypoints when executing */
const executionWaypoints: Record<string, string[]> = {
  'treasury-sentinel': ['rack', 'terminal', 'status'],
  'yield-router':      ['monitor1', 'monitor2', 'desk', 'yield'],
  'compliance-clerk':  ['vault', 'auditLog', 'monitors'],
  'governance-relay':  ['table', 'proposal', 'station1', 'station2', 'clock'],
}

/** Find the door waypoint name in sourceRoom that faces targetRoom.
 *  Supports adjacent AND diagonal connections through the center hub (X pattern). */
function getDoorWaypoint(sourceRoom: string, targetRoom: string): string | null {
  const map: Record<string, Record<string, string>> = {
    'Launch Bay': {
      'Strategy Pit': 'doorRight',
      'Forum Deck': 'doorDown',
      'War Room': 'doorCenter',      // diagonal through center hub
    },
    'Strategy Pit': {
      'Launch Bay': 'doorLeft',
      'War Room': 'doorDown',
      'Forum Deck': 'doorCenter',    // diagonal through center hub
    },
    'Forum Deck': {
      'Launch Bay': 'doorUp',
      'War Room': 'doorRight',
      'Strategy Pit': 'doorCenter',  // diagonal through center hub
    },
    'War Room': {
      'Strategy Pit': 'doorUp',
      'Forum Deck': 'doorLeft',
      'Launch Bay': 'doorCenter',    // diagonal through center hub
    },
  }
  return map[sourceRoom]?.[targetRoom] ?? null
}

/** Idle waypoints for gentle wandering */
const wanderKeys = ['wander1', 'wander2', 'wander3', 'center', 'home']

/** Speed profiles per movement type (lerp factor per tick at ~20fps) */
const LERP_SPEEDS: Record<MovementState, number> = {
  coordinating: 0.12,  // Urgent — arrive in ~1.5s
  executing:    0.08,   // Purposeful — arrive in ~2s
  idle:         0.04,   // Gentle drift — arrive in ~4s
}

export type MovementState = 'idle' | 'executing' | 'coordinating'

type AgentMoveState = {
  targetX: number
  targetY: number
  currentX: number
  currentY: number
  state: MovementState
  wanderIndex: number
  lastMoveTime: number
  isMoving: boolean       // true while interpolating toward target
}

/* ─── Tick interval (ms) ─────────────────────────────
 * Instead of requestAnimationFrame (60fps), we use a
 * setInterval at ~20fps. This is plenty smooth for
 * position changes and cuts React re-renders by 3×.
 * ──────────────────────────────────────────────────── */
const TICK_MS = 50 // 20 ticks/sec

/**
 * useAgentMovement — Dynamically repositions agents based on activity.
 *
 * Returns a Map<agentId, {x, y, isMoving}> with animated positions.
 * The caller should apply x/y to override agent positions, and
 * pass `isMoving` to AgentSprite to pause the bob animation.
 *
 * Movement rules:
 * 1. Coordinating → walk toward door (fast)
 * 2. Executing (isActive) → walk to furniture (medium)
 * 3. Idle → drift between waypoints every 12-20s (slow)
 */
export function useAgentMovement(
  agents: LiveAgent[],
  coordinations: CoordinationEvent[],
  activeAgentIds: Set<string>,
): Map<string, { x: number; y: number; isMoving: boolean }> {
  const [positions, setPositions] = useState<Map<string, { x: number; y: number; isMoving: boolean }>>(new Map())
  const stateRef = useRef<Map<string, AgentMoveState>>(new Map())
  const tickRef = useRef(0)

  // Initialize state for new agents
  useEffect(() => {
    const stateMap = stateRef.current
    for (const agent of agents) {
      if (!stateMap.has(agent.id)) {
        stateMap.set(agent.id, {
          targetX: agent.x,
          targetY: agent.y,
          currentX: agent.x,
          currentY: agent.y,
          state: 'idle',
          wanderIndex: Math.floor(Math.random() * wanderKeys.length),
          lastMoveTime: Date.now() - Math.random() * 8000, // stagger initial timings
          isMoving: false,
        })
      }
    }
    // Clean up agents that no longer exist
    for (const id of stateMap.keys()) {
      if (!agents.find((a) => a.id === id)) {
        stateMap.delete(id)
      }
    }
  }, [agents])

  // Decide movement targets based on activity
  const updateTargets = useCallback(() => {
    const stateMap = stateRef.current
    const now = Date.now()

    // Build a set of currently coordinating agents and their targets
    const coordinatingAgents = new Map<string, string>() // agentId → targetRoom
    for (const coord of coordinations) {
      if (coord.status === 'triggered') {
        const targetAgent = agents.find((a) => a.id === coord.targetAgentId)
        if (targetAgent) {
          coordinatingAgents.set(coord.sourceAgentId, targetAgent.room)
        }
      }
    }

    for (const agent of agents) {
      const state = stateMap.get(agent.id)
      if (!state) continue
      const waypoints = roomWaypoints[agent.room]
      if (!waypoints) continue

      const isCoordinating = coordinatingAgents.has(agent.id)
      const isActive = activeAgentIds.has(agent.id)

      // ── Priority 1: Coordination → walk to door ──
      if (isCoordinating && state.state !== 'coordinating') {
        const targetRoom = coordinatingAgents.get(agent.id)!
        const doorKey = getDoorWaypoint(agent.room, targetRoom)
        if (doorKey && waypoints[doorKey]) {
          state.targetX = waypoints[doorKey].x
          state.targetY = waypoints[doorKey].y
          state.state = 'coordinating'
          state.lastMoveTime = now
        }
      }
      // ── Priority 2: Executing → walk to furniture ──
      else if (!isCoordinating && isActive && state.state !== 'executing') {
        const templateWaypoints = executionWaypoints[agent.templateId] ?? ['center']
        const wpKey = templateWaypoints[Math.floor(Math.random() * templateWaypoints.length)]
        const wp = waypoints[wpKey] ?? waypoints['center']
        if (wp) {
          state.targetX = wp.x
          state.targetY = wp.y
          state.state = 'executing'
          state.lastMoveTime = now
        }
      }
      // ── Priority 3: Idle → gentle wander every 12-20s ──
      else if (!isCoordinating && !isActive) {
        // Return home first when transitioning from coordination/execution
        if (state.state === 'coordinating' || state.state === 'executing') {
          const home = waypoints['home'] ?? { x: agent.x, y: agent.y }
          state.targetX = home.x
          state.targetY = home.y
          state.state = 'idle'
          state.lastMoveTime = now
        }
        // Wander interval: 12-20 seconds (per-agent, deterministic)
        else {
          const wanderInterval = 12000 + (agent.id.charCodeAt(0) % 9) * 1000
          if (now - state.lastMoveTime > wanderInterval) {
            state.wanderIndex = (state.wanderIndex + 1) % wanderKeys.length
            const wpKey = wanderKeys[state.wanderIndex]
            const wp = waypoints[wpKey] ?? waypoints['home']
            if (wp) {
              // Add slight randomness (±2%) to avoid overlapping
              state.targetX = wp.x + (Math.random() - 0.5) * 4
              state.targetY = wp.y + (Math.random() - 0.5) * 4
              state.state = 'idle'
              state.lastMoveTime = now
            }
          }
        }
      }
    }
  }, [agents, coordinations, activeAgentIds])

  // Throttled interpolation loop (~20fps via setInterval)
  useEffect(() => {
    const SNAP_THRESHOLD = 0.2

    const tick = () => {
      const stateMap = stateRef.current
      if (stateMap.size === 0) return

      updateTargets()

      let anyChanged = false
      const newPositions = new Map<string, { x: number; y: number; isMoving: boolean }>()

      for (const [id, state] of stateMap) {
        const dx = state.targetX - state.currentX
        const dy = state.targetY - state.currentY
        const dist = Math.abs(dx) + Math.abs(dy)

        if (dist > SNAP_THRESHOLD) {
          const speed = LERP_SPEEDS[state.state]
          state.currentX += dx * speed
          state.currentY += dy * speed
          state.isMoving = true
          anyChanged = true
        } else if (state.isMoving) {
          // Snap to target and mark as stopped
          state.currentX = state.targetX
          state.currentY = state.targetY
          state.isMoving = false
          anyChanged = true
        }

        newPositions.set(id, {
          x: Math.round(state.currentX * 100) / 100,
          y: Math.round(state.currentY * 100) / 100,
          isMoving: state.isMoving,
        })
      }

      if (anyChanged) {
        setPositions(new Map(newPositions))
      }
    }

    tickRef.current = window.setInterval(tick, TICK_MS)
    return () => window.clearInterval(tickRef.current)
  }, [updateTargets])

  return positions
}
