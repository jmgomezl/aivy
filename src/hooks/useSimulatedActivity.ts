import { useEffect, useRef, useState, useCallback } from 'react'
import type { LiveAgent, CoordinationEvent, ActivityEvent } from '../types'

/**
 * useActivityAnimations — Coordination + execution animations for REAL actions only.
 *
 * The office stays calm when idle. Animations fire only when a user action
 * triggers a coordination (chat reply, tool execution, etc.).
 *
 * Lifecycle per trigger (~10s):
 *  0s   — Coordination line appears, sound plays, ticker event pushed
 *  3s   — Tool execution ring on a related agent
 *  6s   — Coordination line starts fading
 *  7.5s — Coordination removed, agents return home
 *  9s   — Execution ring cleared
 */

let coordId = 0
let eventId = 0

export function useSimulatedActivity(agents: LiveAgent[], soundEnabled = true) {
  const [simCoordinations, setSimCoordinations] = useState<CoordinationEvent[]>([])
  const [simActiveIds, setSimActiveIds] = useState<Set<string>>(new Set())
  const [fadingCoordIds, setFadingCoordIds] = useState<Set<string>>(new Set())
  const [simEvents, setSimEvents] = useState<ActivityEvent[]>([])
  const timersRef = useRef<number[]>([])
  const soundRef = useRef(soundEnabled)
  soundRef.current = soundEnabled

  const agentsRef = useRef(agents)
  agentsRef.current = agents

  const clearTimers = useCallback(() => {
    for (const t of timersRef.current) window.clearTimeout(t)
    timersRef.current = []
  }, [])

  const addTimer = useCallback((fn: () => void, ms: number) => {
    timersRef.current.push(window.setTimeout(fn, ms))
  }, [])

  // Push a ticker event (keeps last 5)
  const pushEvent = useCallback((label: string, tone: ActivityEvent['tone']) => {
    const now = new Date()
    const ts = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    setSimEvents((prev) => [{
      id: `evt-${++eventId}`,
      label,
      tone,
      timestamp: ts,
    }, ...prev].slice(0, 5))
  }, [])

  // Play a short coordination sound
  const playSound = useCallback(() => {
    if (!soundRef.current) return
    try {
      const ac = new AudioContext()
      const osc = ac.createOscillator()
      const gain = ac.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(440, ac.currentTime)
      gain.gain.setValueAtTime(0.04, ac.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.3)
      osc.connect(gain)
      gain.connect(ac.destination)
      osc.start()
      osc.stop(ac.currentTime + 0.3)
    } catch { /* silent */ }
  }, [])

  // Clean up timers on unmount
  useEffect(() => () => clearTimers(), [clearTimers])

  // The only entry point — called from PhaserOffice when a real action happens
  const triggerCoordination = useCallback((srcId: string, tgtId: string, action: string, label: string) => {
    const liveAgents = agentsRef.current.filter((a) => a.status !== 'paused')
    const src = liveAgents.find((a) => a.id === srcId)
    const tgt = liveAgents.find((a) => a.id === tgtId)
    if (!src || !tgt) return

    // Cancel any running animation
    clearTimers()

    const id = `coord-${++coordId}`

    // ── 0s: Fire coordination ──
    setSimCoordinations([{
      id,
      sourceAgentId: src.id,
      sourceAgentName: src.name,
      targetAgentId: tgt.id,
      targetAgentName: tgt.name,
      trigger: 'user_action',
      action,
      timestamp: new Date().toISOString(),
      status: 'triggered',
    }])
    setFadingCoordIds(new Set())
    pushEvent(label, 'success')
    playSound()

    // ── 3s: Show execution ring on a related agent ──
    addTimer(() => {
      const others = liveAgents.filter((a) => a.id !== src.id && a.id !== tgt.id)
      const execAgent = others.length > 0
        ? others[Math.floor(Math.random() * others.length)]
        : tgt
      setSimActiveIds(new Set([execAgent.id]))
    }, 3000)

    // ── 6s: Start fading coordination line ──
    addTimer(() => setFadingCoordIds(new Set([id])), 6000)

    // ── 7.5s: Remove coordination ──
    addTimer(() => {
      setSimCoordinations([])
      setFadingCoordIds(new Set())
    }, 7500)

    // ── 9s: Clear execution ring ──
    addTimer(() => setSimActiveIds(new Set()), 9000)
  }, [clearTimers, addTimer, pushEvent, playSound])

  return { simCoordinations, simActiveIds, fadingCoordIds, simEvents, triggerCoordination }
}
