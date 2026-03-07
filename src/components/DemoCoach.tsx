import { useCallback, useEffect, useRef, useState } from 'react'
import './DemoCoach.css'

type DemoStep = {
  id: string
  selector: string
  title: string
  body: string
  hint?: string // short action hint shown below body (e.g. "Click the glowing element")
  cardPos: 'top' | 'bottom' | 'left' | 'right'
  trigger: 'signal' | 'auto'
  autoMs?: number
  waitFor?: string // wait until this selector exists before showing
}

const steps: DemoStep[] = [
  {
    id: 'select-agent',
    selector: '.agent-sprite-v2',
    title: 'Meet your agents',
    body: 'These are your AI agents, each with a role and on-chain vault.',
    hint: 'Click the glowing agent to open its panel',
    cardPos: 'right',
    trigger: 'signal',
  },
  {
    id: 'try-prompt',
    selector: '.chat-suggestions',
    title: 'Try a suggested prompt',
    body: 'Each agent comes with pre-built prompts that trigger real Hedera tools.',
    hint: 'Click any prompt chip to send it',
    cardPos: 'left',
    trigger: 'signal',
    waitFor: '.chat-suggestions',
  },
  {
    id: 'watch-result',
    selector: '.chat-tool-card',
    title: 'Watch the agent work',
    body: 'The agent called a Hedera tool and returned a live on-chain result — all verifiable on the mirror node.',
    cardPos: 'left',
    trigger: 'auto',
    autoMs: 5000,
    waitFor: '.chat-tool-card',
  },
  {
    id: 'omni-bar',
    selector: '.omni-bar',
    title: 'Use the command bar',
    body: 'This is the central hub — type any request and Aivy automatically routes it to the best agent.',
    hint: 'Try: "What tokens do I have?" or anything else',
    cardPos: 'top',
    trigger: 'signal',
  },
  {
    id: 'route-result',
    selector: '.omni-route-toast',
    title: 'Smart routing',
    body: 'Aivy analyzed your request and picked the right agent — no manual selection needed.',
    cardPos: 'top',
    trigger: 'auto',
    autoMs: 5000,
    waitFor: '.omni-route-toast',
  },
  {
    id: 'deploy-fab',
    selector: '.deploy-fab',
    title: 'Deploy a new agent',
    body: 'Expand your team by deploying another AI agent with its own vault and audit trail.',
    hint: 'Hover the + button and pick a template',
    cardPos: 'left',
    trigger: 'signal',
  },
  {
    id: 'deploy-submit',
    selector: '.dm-deploy',
    title: 'Launch to Hedera',
    body: 'This creates a real smart contract vault and consensus audit topic on Hedera testnet.',
    hint: 'Click "Deploy to Hedera" to launch',
    cardPos: 'top',
    trigger: 'signal',
    waitFor: '.dm-deploy',
  },
  {
    id: 'complete',
    selector: '',
    title: "You're all set!",
    body: 'Your AI agent office is live on Hedera. Explore, chat, and build.',
    cardPos: 'bottom',
    trigger: 'auto',
    autoMs: 10000,
  },
]

type Props = {
  selectedAgentId: string
  deployModalOpen: boolean
  lastChatMessages: Record<string, string>
  onDismiss: () => void
}

export default function DemoCoach({
  selectedAgentId,
  deployModalOpen,
  lastChatMessages,
  onDismiss,
}: Props) {
  const [step, setStep] = useState(0)
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null)
  const [waiting, setWaiting] = useState(false)
  const prevChatSnapshotRef = useRef(JSON.stringify(lastChatMessages))
  const stepEnteredAtRef = useRef(Date.now())
  const skippedRef = useRef(false)
  const stepRef = useRef(step)
  stepRef.current = step

  const current = steps[step]
  const isLast = step === steps.length - 1

  // ─── Advance helper ──────────────────────────
  const advance = useCallback(() => {
    setStep((s) => Math.min(s + 1, steps.length - 1))
  }, [])

  // Manual "Next" / "Got it" — marks step as skipped so
  // rewind and auto-signal effects don't fight it
  const manualAdvance = useCallback(() => {
    skippedRef.current = true
    advance()
  }, [advance])

  // ─── Track step entry time + reset chat baseline ──
  useEffect(() => {
    stepEnteredAtRef.current = Date.now()
    prevChatSnapshotRef.current = JSON.stringify(lastChatMessages)
    setTargetRect(null) // reset so card doesn't flash at old position
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step])

  // ─── Signal: agent selected (step 0 → 1) ────
  useEffect(() => {
    if (step === 0 && selectedAgentId) advance()
  }, [step, selectedAgentId, advance])

  // ─── Signal: chat message sent (step 1 → 2, step 3 → 4) ─
  // Ignores chat changes within 800ms of entering a step to prevent
  // stale responses from a previous step causing a double-advance
  useEffect(() => {
    const snapshot = JSON.stringify(lastChatMessages)
    if (snapshot !== prevChatSnapshotRef.current) {
      const elapsed = Date.now() - stepEnteredAtRef.current
      if ((step === 1 || step === 3) && elapsed > 800) {
        advance()
      }
    }
    prevChatSnapshotRef.current = snapshot
  }, [lastChatMessages, step, advance])

  // ─── Signal: deploy modal opened (step 5 → 6) ─
  useEffect(() => {
    if (step === 5 && deployModalOpen) advance()
  }, [step, deployModalOpen, advance])

  // ─── Signal: deploy completed (step 6 → 7) ─
  useEffect(() => {
    if (step === 6 && !deployModalOpen && !skippedRef.current) advance()
  }, [step, deployModalOpen, advance])

  // ─── Rewind: agent panel closed during early steps ─
  // Skip rewind if user manually clicked "Next"
  useEffect(() => {
    if (skippedRef.current) {
      skippedRef.current = false
      return
    }
    if ((step === 1 || step === 2) && !selectedAgentId) {
      setStep(0)
    }
  }, [step, selectedAgentId])

  // ─── Auto-advance timer ──────────────────────
  useEffect(() => {
    if (current.trigger !== 'auto') return
    if (current.waitFor && waiting) return // don't start timer while waiting
    const timer = setTimeout(() => {
      if (isLast) {
        onDismiss()
      } else {
        advance()
      }
    }, current.autoMs ?? 4000)
    return () => clearTimeout(timer)
  }, [step, current, waiting, isLast, advance, onDismiss])

  // ─── Target tracking + waitFor polling ───────
  useEffect(() => {
    let disposed = false
    let pollTimer: ReturnType<typeof setInterval> | null = null
    let resizeObs: ResizeObserver | null = null

    const applyTarget = () => {
      // Remove previous target highlight
      document.querySelectorAll('.demo-coach-target').forEach((el) => {
        el.classList.remove('demo-coach-target')
      })

      if (!current.selector) {
        setTargetRect(null)
        setWaiting(false)
        return
      }

      const el = document.querySelector(current.selector)
      if (!el) {
        setTargetRect(null)
        setWaiting(true)
        return
      }

      setWaiting(false)
      el.classList.add('demo-coach-target')
      const rect = el.getBoundingClientRect()
      setTargetRect(rect)

      // Watch for resize
      resizeObs = new ResizeObserver(() => {
        if (disposed) return
        const r = el.getBoundingClientRect()
        setTargetRect(r)
      })
      resizeObs.observe(el)
    }

    applyTarget()

    // Poll for waitFor selectors
    if (current.waitFor) {
      pollTimer = setInterval(() => {
        if (disposed) return
        const el = document.querySelector(current.waitFor!)
        if (el) {
          applyTarget()
          if (pollTimer) clearInterval(pollTimer)
        }
      }, 200)

      // Safety timeout: auto-advance if element never appears
      const safety = setTimeout(() => {
        if (disposed) return
        if (!document.querySelector(current.waitFor!)) {
          advance()
        }
      }, 10000)

      return () => {
        disposed = true
        if (pollTimer) clearInterval(pollTimer)
        clearTimeout(safety)
        resizeObs?.disconnect()
        document.querySelectorAll('.demo-coach-target').forEach((el) => {
          el.classList.remove('demo-coach-target')
        })
      }
    }

    // Recalculate on window resize
    const onResize = () => applyTarget()
    window.addEventListener('resize', onResize)

    return () => {
      disposed = true
      window.removeEventListener('resize', onResize)
      resizeObs?.disconnect()
      document.querySelectorAll('.demo-coach-target').forEach((el) => {
        el.classList.remove('demo-coach-target')
      })
    }
  }, [step, current, advance])

  // ─── Compute card position ───────────────────
  const getCardStyle = (): React.CSSProperties => {
    if (!targetRect || isLast) {
      // Centered for final step or when no target
      return {
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
      }
    }

    const gap = 16
    const cardW = 290
    const cardH = 250 // approximate max card height (with hint box)
    const vh = window.innerHeight
    const vw = window.innerWidth

    // Clamp top so card doesn't overflow bottom of viewport
    const clampTop = (ideal: number) => Math.min(Math.max(16, ideal), vh - cardH - 16)

    switch (current.cardPos) {
      case 'right':
        return {
          top: clampTop(targetRect.top),
          left: Math.min(targetRect.right + gap, vw - cardW - 16),
        }
      case 'left':
        return {
          top: clampTop(targetRect.top),
          left: Math.max(16, targetRect.left - cardW - gap),
        }
      case 'top':
        return {
          bottom: Math.max(16, vh - targetRect.top + gap),
          left: Math.max(16, targetRect.left + targetRect.width / 2 - cardW / 2),
        }
      case 'bottom':
        return {
          top: clampTop(targetRect.bottom + gap),
          left: Math.max(16, targetRect.left + targetRect.width / 2 - cardW / 2),
        }
    }
  }

  // ─── Compute clip-path for spotlight ─────────
  const getClipPath = (): string => {
    if (!targetRect) return 'none'

    const pad = 12
    const t = Math.max(0, targetRect.top - pad)
    const l = Math.max(0, targetRect.left - pad)
    const b = Math.min(window.innerHeight, targetRect.bottom + pad)
    const r = Math.min(window.innerWidth, targetRect.right + pad)

    // Polygon: outer rect → inner cutout (counterclockwise)
    return `polygon(
      0% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 0%,
      ${l}px ${t}px, ${l}px ${b}px, ${r}px ${b}px, ${r}px ${t}px, ${l}px ${t}px
    )`
  }

  return (
    <>
      {/* Backdrop with spotlight cutout */}
      {!isLast && (
        <div
          className="demo-coach-backdrop"
          style={{ clipPath: targetRect ? getClipPath() : 'none' }}
        />
      )}

      {/* Instruction card */}
      <div
        className={`demo-coach-card ${isLast ? 'is-celebration' : ''} ${waiting ? 'demo-coach-waiting' : ''}`}
        style={getCardStyle()}
        key={step}
      >
        {isLast ? (
          /* ─── Celebration ─── */
          <>
            <div className="demo-coach-celebration-icon">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#5ad6b5" strokeWidth="2">
                <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
            </div>
            <div className="demo-coach-title">{current.title}</div>
            <div className="demo-coach-body">{current.body}</div>
            <button className="demo-coach-finish" onClick={onDismiss} type="button">
              Start exploring
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </button>
          </>
        ) : (
          /* ─── Regular step ─── */
          <>
            <div className="demo-coach-header">
              <span className="demo-coach-step-pill">
                {step + 1} / {steps.length}
              </span>
            </div>
            <div className="demo-coach-title">{current.title}</div>
            <div className="demo-coach-body">{current.body}</div>

            {/* Action hint for signal steps */}
            {current.trigger === 'signal' && current.hint && (
              <div className="demo-coach-hint">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
                {current.hint}
              </div>
            )}

            {/* Auto-step countdown bar */}
            {current.trigger === 'auto' && !waiting && (
              <div className="demo-coach-progress-track">
                <div
                  className="demo-coach-progress-bar"
                  style={{ animationDuration: `${current.autoMs ?? 4000}ms` }}
                />
              </div>
            )}

            <div className="demo-coach-footer">
              <div className="demo-coach-dots">
                {steps.map((_, i) => (
                  <span
                    key={i}
                    className={`demo-coach-dot ${i < step ? 'is-done' : ''} ${i === step ? 'is-active' : ''}`}
                  />
                ))}
              </div>
              <div className="demo-coach-actions">
                {/* "Next" for signal steps, "Got it" for auto steps */}
                <button className="demo-coach-next" onClick={manualAdvance} type="button">
                  Next
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                    <path d="M5 12h14M12 5l7 7-7 7" />
                  </svg>
                </button>
                <button className="demo-coach-skip" onClick={onDismiss} type="button">
                  Skip
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  )
}
