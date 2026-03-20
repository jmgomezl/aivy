import { type CSSProperties, useState, useEffect, useRef, useMemo } from 'react'
import { templates, roomCards } from '../data'
import { getSpriteSheet, ensureSpritesLoaded, agentNameToSpriteType } from '../sprites/generateSprites'
import './Landing.css'

type LandingProps = {
  onEnter: () => void
  onTryDemo: () => Promise<void> | void
  onAbout?: () => void
}

/* Each agent: walk class + bubble text */
const walkConfigs = [
  { walkClass: 'walk-ts', bubble: 'Balance: 142.5 HBAR' },
  { walkClass: 'walk-yr', bubble: 'Token minted!' },
  { walkClass: 'walk-cc', bubble: 'Audit logged on-chain' },
  { walkClass: 'walk-gr', bubble: 'Proposal submitted' },
]

/* Inter-agent data transfers with source/dest room centers
   Each renders: 3 trail particles + send ring + receive beacon */
const dataTransfers = [
  { id: 'lb-wr', cls: 'p-lb-wr', color: '#ff9a3c', delay: '0s',  src: { x: 25, y: 27 }, dst: { x: 73, y: 75 } },
  { id: 'sp-fd', cls: 'p-sp-fd', color: '#4ecdc4', delay: '6s',  src: { x: 73, y: 27 }, dst: { x: 25, y: 75 } },
  { id: 'fd-lb', cls: 'p-fd-lb', color: '#7f95d1', delay: '12s', src: { x: 25, y: 75 }, dst: { x: 25, y: 27 } },
  { id: 'wr-sp', cls: 'p-wr-sp', color: '#f25f5c', delay: '18s', src: { x: 73, y: 75 }, dst: { x: 73, y: 27 } },
]

/* Activity ticker entries */
const demoTickerItems = [
  { text: 'Treasury Sentinel deployed with vault guardrails', tone: 'vault' },
  { text: 'Yield Router: Token minted \u2014 1,000 AIVY', tone: 'success' },
  { text: 'Compliance Clerk: Audit record published', tone: 'system' },
  { text: 'Governance Relay: Proposal topic created', tone: 'success' },
  { text: 'Treasury Sentinel: Transferred 25 HBAR', tone: 'vault' },
]

/* ─── Deployment Story Steps ─────────────────────── */
const deploySteps = [
  {
    icon: '🔐',
    title: 'Generating KMS Keys',
    detail: 'Creating dedicated AWS KMS symmetric keys for each agent...',
    sub: 'Private keys will never be stored in plaintext',
  },
  {
    icon: '🏗️',
    title: 'Creating Hedera Accounts',
    detail: 'Deploying dedicated wallets for Treasury, Yield, Compliance & Governance agents...',
    sub: 'Each agent gets its own isolated on-chain identity',
  },
  {
    icon: '🔒',
    title: 'Encrypting Signing Keys',
    detail: 'Wrapping Ed25519 keys with KMS envelope encryption...',
    sub: 'AES-256 via AWS KMS — decrypted only in-memory for signing',
  },
  {
    icon: '📜',
    title: 'Compiling Smart Contracts',
    detail: 'Building AivyVault.sol with Solidity compiler...',
    sub: 'On-chain spending caps to protect every agent',
  },
  {
    icon: '⛓️',
    title: 'Deploying Vault Contracts',
    detail: 'Submitting ContractCreateFlow transactions to Hedera EVM...',
    sub: 'Guardrails enforced at the blockchain level',
  },
  {
    icon: '📡',
    title: 'Creating Audit Topics',
    detail: 'Setting up HCS consensus topics for immutable action logging...',
    sub: 'Every agent action recorded on Hedera Consensus Service',
  },
  {
    icon: '🤖',
    title: 'Initializing AI Sessions',
    detail: 'Connecting agents to GPT-4o with 50+ Hedera tools...',
    sub: 'Natural language interface to the entire Hedera network',
  },
  {
    icon: '✅',
    title: 'Almost There!',
    detail: 'All agents are live and secured — hang tight, opening the office for you...',
    sub: 'You will be redirected automatically in a moment',
  },
]

/** Full-screen cinematic overlay shown during demo deployment */
function DeployOverlay({ active }: { active: boolean }) {
  const [step, setStep] = useState(0)
  const [typedChars, setTypedChars] = useState(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Advance steps on a timer — variable pace to fill ~45s total wait
  // Earlier steps are slower (user is more engaged), last step stays visible
  const stepDelays = [5500, 6000, 5500, 5500, 5500, 6000, 5500, 999999]

  useEffect(() => {
    if (!active) { setStep(0); setTypedChars(0); return }
    let currentStep = 0
    let timeout: ReturnType<typeof setTimeout>

    const scheduleNext = () => {
      timeout = setTimeout(() => {
        currentStep++
        if (currentStep >= deploySteps.length) return
        setStep(currentStep)
        scheduleNext()
      }, stepDelays[currentStep])
    }
    scheduleNext()

    return () => clearTimeout(timeout)
  }, [active])

  // Typewriter for current step detail
  useEffect(() => {
    setTypedChars(0)
    if (!active) return
    const text = deploySteps[step]?.detail ?? ''
    if (intervalRef.current) clearInterval(intervalRef.current)
    let i = 0
    intervalRef.current = setInterval(() => {
      i++
      setTypedChars(i)
      if (i >= text.length && intervalRef.current) clearInterval(intervalRef.current)
    }, 35)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [step, active])

  if (!active) return null

  const current = deploySteps[step]
  const progress = ((step + 1) / deploySteps.length) * 100

  return (
    <div className="deploy-overlay">
      <div className="deploy-overlay-bg" />

      <div className="deploy-content">
        {/* Completed steps trail */}
        <div className="deploy-trail">
          {deploySteps.map((s, i) => (
            <div
              key={i}
              className={`deploy-trail-dot${i < step ? ' done' : ''}${i === step ? ' active' : ''}${i > step ? ' pending' : ''}`}
            >
              <span className="deploy-trail-icon">{i <= step ? s.icon : '○'}</span>
            </div>
          ))}
        </div>

        {/* Current step card */}
        <div className="deploy-step-card" key={step}>
          <div className="deploy-step-icon">{current.icon}</div>
          <h2 className="deploy-step-title">{current.title}</h2>
          <p className="deploy-step-detail">
            {current.detail.slice(0, typedChars)}
            <span className="deploy-cursor">|</span>
          </p>
          <p className="deploy-step-sub">{current.sub}</p>
        </div>

        {/* Terminal-style log feed */}
        <div className="deploy-terminal">
          {deploySteps.slice(0, step + 1).map((s, i) => (
            <div key={i} className={`deploy-log-line${i === step ? ' current' : ' done'}`}>
              <span className="deploy-log-prefix">{i < step ? '✓' : '▸'}</span>
              <span className="deploy-log-text">{s.title}</span>
              {i < step && <span className="deploy-log-time">{(1.2 + i * 0.8).toFixed(1)}s</span>}
            </div>
          ))}
        </div>

        {/* Progress bar */}
        <div className="deploy-progress">
          <div className="deploy-progress-fill" style={{ width: `${progress}%` }} />
        </div>
        <p className="deploy-progress-label">
          Step {step + 1} of {deploySteps.length}
        </p>
      </div>
    </div>
  )
}

/** Animated pixel sprite for the landing page using the tileset */
function LandingSprite({ name }: { name: string }) {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    ensureSpritesLoaded().then(() => setReady(true))
  }, [])

  const spriteUrl = useMemo(() => {
    if (!ready) return ''
    const type = agentNameToSpriteType(name)
    return getSpriteSheet(type)
  }, [name, ready])

  if (!spriteUrl) return <div style={{ width: 34, height: 34 }} />

  return (
    <div
      className="pixel-sprite"
      style={{ backgroundImage: `url(${spriteUrl})` }}
      role="img"
      aria-label={name}
    />
  )
}

/* ─── Deploy Loading Overlay ──────────────────────── */

/* Each phase has a different pixel art character + theme color */
type DeployPhase = {
  label: string
  steps: { text: string; dur: number }[]   // dur = ms this step takes
  color: string
  character: 'key' | 'shield' | 'vault' | 'robot' | 'rocket'
}

const deployPhases: DeployPhase[] = [
  {
    label: 'Key Generation',
    color: '#f3c35f',
    character: 'key',
    steps: [
      { text: 'Initialising entropy pool', dur: 2500 },
      { text: 'Generating Ed25519 key pair', dur: 3500 },
      { text: 'Deriving public key hash', dur: 2000 },
    ],
  },
  {
    label: 'KMS Encryption',
    color: '#ff9a3c',
    character: 'shield',
    steps: [
      { text: 'Connecting to AWS KMS', dur: 2500 },
      { text: 'Creating symmetric data key', dur: 3000 },
      { text: 'Encrypting private key (AES-256-GCM)', dur: 3500 },
      { text: 'Wiping plaintext from memory', dur: 1500 },
    ],
  },
  {
    label: 'Hedera Account',
    color: '#5ad6b5',
    character: 'vault',
    steps: [
      { text: 'Creating Hedera account (ED25519)', dur: 3000 },
      { text: 'Funding account via operator wallet', dur: 3500 },
      { text: 'Verifying on-chain balance', dur: 2000 },
    ],
  },
  {
    label: 'Smart Contract',
    color: '#4ecdc4',
    character: 'robot',
    steps: [
      { text: 'Compiling AivyVault.sol', dur: 3000 },
      { text: 'Deploying vault to Hedera EVM', dur: 4000 },
      { text: 'Setting spending cap & guardrails', dur: 2500 },
    ],
  },
  {
    label: 'Launch',
    color: '#7f95d1',
    character: 'rocket',
    steps: [
      { text: 'Provisioning AI agent runtime', dur: 3000 },
      { text: 'Binding tools & capabilities', dur: 2500 },
      { text: 'Entering the office...', dur: 2000 },
    ],
  },
]

// Pre-calculate absolute start times for each step
const allSteps: { text: string; phaseIdx: number; absStart: number; dur: number }[] = []
let cursor = 0
deployPhases.forEach((phase, pi) => {
  phase.steps.forEach((s) => {
    allSteps.push({ text: s.text, phaseIdx: pi, absStart: cursor, dur: s.dur })
    cursor += s.dur
  })
})
const TOTAL_DEPLOY_MS = cursor   // ≈ 42s

/* ─── Pixel Art Characters (SVG) ────────────────── */
function PixelKey() {
  return (
    <svg className="deploy-char" viewBox="0 0 48 56" width="64" height="74">
      {/* Key head (ring) */}
      <rect x={16} y={2} width={16} height={4} fill="#f3c35f"/>
      <rect x={12} y={6} width={4} height={12} fill="#f3c35f"/>
      <rect x={32} y={6} width={4} height={12} fill="#f3c35f"/>
      <rect x={16} y={18} width={16} height={4} fill="#f3c35f"/>
      <rect x={20} y={6} width={8} height={4} fill="#1a1a2e"/>
      <rect x={16} y={10} width={4} height={4} fill="#1a1a2e"/>
      <rect x={28} y={10} width={4} height={4} fill="#1a1a2e"/>
      <rect x={20} y={14} width={8} height={4} fill="#1a1a2e"/>
      {/* Key shaft */}
      <rect x={22} y={22} width={4} height={20} fill="#e8b830"/>
      {/* Key teeth */}
      <rect x={26} y={34} width={6} height={4} fill="#f3c35f"/>
      <rect x={26} y={40} width={8} height={4} fill="#f3c35f"/>
      {/* Sparkles */}
      <rect x={8} y={4} width={2} height={2} fill="#fff" opacity={0.6} className="deploy-sparkle-1"/>
      <rect x={38} y={8} width={2} height={2} fill="#fff" opacity={0.6} className="deploy-sparkle-2"/>
    </svg>
  )
}

function PixelShield() {
  return (
    <svg className="deploy-char" viewBox="0 0 48 56" width="64" height="74">
      {/* Shield top */}
      <rect x={8} y={4} width={32} height={4} fill="#ff9a3c"/>
      <rect x={4} y={8} width={40} height={4} fill="#ff9a3c"/>
      <rect x={4} y={12} width={40} height={4} fill="#e8872e"/>
      {/* Shield body */}
      <rect x={4} y={16} width={40} height={4} fill="#ff9a3c"/>
      <rect x={8} y={20} width={32} height={4} fill="#e8872e"/>
      <rect x={8} y={24} width={32} height={4} fill="#ff9a3c"/>
      <rect x={12} y={28} width={24} height={4} fill="#e8872e"/>
      <rect x={16} y={32} width={16} height={4} fill="#ff9a3c"/>
      <rect x={20} y={36} width={8} height={4} fill="#e8872e"/>
      <rect x={22} y={40} width={4} height={4} fill="#ff9a3c"/>
      {/* Lock symbol */}
      <rect x={20} y={14} width={8} height={4} fill="#1a1a2e"/>
      <rect x={18} y={18} width={12} height={8} fill="#1a1a2e"/>
      <rect x={22} y={20} width={4} height={4} fill="#f3c35f" className="deploy-lock-glow"/>
      {/* AWS sparkle */}
      <rect x={2} y={8} width={2} height={2} fill="#ff9a3c" opacity={0.5} className="deploy-sparkle-1"/>
      <rect x={44} y={12} width={2} height={2} fill="#ff9a3c" opacity={0.5} className="deploy-sparkle-2"/>
    </svg>
  )
}

function PixelVault() {
  return (
    <svg className="deploy-char" viewBox="0 0 48 56" width="64" height="74">
      {/* Hexagon shape (Hedera-inspired) */}
      <rect x={16} y={2} width={16} height={4} fill="#5ad6b5"/>
      <rect x={8} y={6} width={32} height={4} fill="#5ad6b5"/>
      <rect x={4} y={10} width={40} height={4} fill="#4cc4a4"/>
      <rect x={4} y={14} width={40} height={4} fill="#5ad6b5"/>
      <rect x={4} y={18} width={40} height={4} fill="#4cc4a4"/>
      {/* H for Hedera */}
      <rect x={16} y={10} width={4} height={12} fill="#1a1a2e"/>
      <rect x={28} y={10} width={4} height={12} fill="#1a1a2e"/>
      <rect x={20} y={14} width={8} height={4} fill="#1a1a2e"/>
      {/* Bottom hex */}
      <rect x={4} y={22} width={40} height={4} fill="#5ad6b5"/>
      <rect x={8} y={26} width={32} height={4} fill="#4cc4a4"/>
      <rect x={16} y={30} width={16} height={4} fill="#5ad6b5"/>
      {/* Vault door / coins */}
      <rect x={14} y={36} width={8} height={8} fill="#f3c35f" className="deploy-coin-1"/>
      <rect x={26} y={36} width={8} height={8} fill="#f3c35f" className="deploy-coin-2"/>
      <rect x={20} y={42} width={8} height={8} fill="#e8b830" className="deploy-coin-3"/>
      {/* Sparkle */}
      <rect x={2} y={6} width={2} height={2} fill="#5ad6b5" opacity={0.6} className="deploy-sparkle-1"/>
    </svg>
  )
}

function PixelRobot() {
  return (
    <svg className="deploy-char" viewBox="0 0 48 56" width="64" height="74">
      {/* Antenna */}
      <rect x={22} y={0} width={4} height={6} fill="#4ecdc4"/>
      <rect x={20} y={0} width={8} height={2} fill="#5ad6b5" className="deploy-sparkle-1"/>
      {/* Head */}
      <rect x={10} y={6} width={28} height={4} fill="#2a3a5c"/>
      <rect x={8} y={10} width={32} height={4} fill="#354a6e"/>
      <rect x={8} y={14} width={32} height={4} fill="#2a3a5c"/>
      <rect x={10} y={18} width={28} height={4} fill="#354a6e"/>
      {/* Eyes */}
      <rect x={14} y={12} width={6} height={6} fill="#4ecdc4" className="deploy-eye-blink"/>
      <rect x={28} y={12} width={6} height={6} fill="#4ecdc4" className="deploy-eye-blink"/>
      {/* Mouth */}
      <rect x={18} y={18} width={12} height={2} fill="#4ecdc4" opacity={0.5}/>
      {/* Body */}
      <rect x={12} y={24} width={24} height={4} fill="#1e2d4a"/>
      <rect x={10} y={28} width={28} height={4} fill="#253755"/>
      <rect x={10} y={32} width={28} height={4} fill="#1e2d4a"/>
      <rect x={12} y={36} width={24} height={4} fill="#253755"/>
      {/* Core */}
      <rect x={20} y={28} width={8} height={8} fill="#f3c35f" className="deploy-lock-glow"/>
      {/* Arms */}
      <rect x={4} y={26} width={6} height={4} fill="#354a6e" className="deploy-arm-l"/>
      <rect x={38} y={26} width={6} height={4} fill="#354a6e" className="deploy-arm-r"/>
      {/* Legs */}
      <rect x={14} y={40} width={6} height={6} fill="#2a3a5c"/>
      <rect x={28} y={40} width={6} height={6} fill="#2a3a5c"/>
      {/* Feet */}
      <rect x={12} y={46} width={10} height={4} fill="#354a6e"/>
      <rect x={26} y={46} width={10} height={4} fill="#354a6e"/>
    </svg>
  )
}

function PixelRocket() {
  return (
    <svg className="deploy-char deploy-char--rocket" viewBox="0 0 48 64" width="64" height="86">
      {/* Nose cone */}
      <rect x={22} y={0} width={4} height={4} fill="#e0e0e0"/>
      <rect x={18} y={4} width={12} height={4} fill="#c8c8c8"/>
      <rect x={16} y={8} width={16} height={4} fill="#e0e0e0"/>
      {/* Body */}
      <rect x={14} y={12} width={20} height={4} fill="#d0d0d0"/>
      <rect x={14} y={16} width={20} height={4} fill="#e0e0e0"/>
      <rect x={14} y={20} width={20} height={4} fill="#d0d0d0"/>
      <rect x={14} y={24} width={20} height={4} fill="#c8c8c8"/>
      <rect x={14} y={28} width={20} height={4} fill="#d0d0d0"/>
      {/* Window */}
      <rect x={20} y={14} width={8} height={8} fill="#4ecdc4" rx={1}/>
      <rect x={22} y={16} width={4} height={4} fill="#7eeae0"/>
      {/* Aivy logo on body */}
      <rect x={22} y={26} width={4} height={4} fill="#5ad6b5"/>
      {/* Fins */}
      <rect x={8} y={24} width={6} height={4} fill="#7f95d1"/>
      <rect x={6} y={28} width={8} height={4} fill="#6b82bd"/>
      <rect x={34} y={24} width={6} height={4} fill="#7f95d1"/>
      <rect x={34} y={28} width={8} height={4} fill="#6b82bd"/>
      {/* Engine */}
      <rect x={16} y={32} width={16} height={4} fill="#8a8a9a"/>
      {/* Flames! */}
      <rect x={18} y={36} width={4} height={4} fill="#f3c35f" className="deploy-flame-1"/>
      <rect x={22} y={36} width={4} height={6} fill="#ff9a3c" className="deploy-flame-2"/>
      <rect x={26} y={36} width={4} height={4} fill="#f3c35f" className="deploy-flame-3"/>
      <rect x={20} y={42} width={4} height={6} fill="#f25f5c" className="deploy-flame-4"/>
      <rect x={24} y={44} width={4} height={6} fill="#ff9a3c" className="deploy-flame-5"/>
      <rect x={18} y={48} width={4} height={4} fill="#f25f5c" opacity={0.6} className="deploy-flame-6"/>
      <rect x={26} y={48} width={4} height={4} fill="#f25f5c" opacity={0.6} className="deploy-flame-6"/>
      {/* Exhaust particles */}
      <rect x={16} y={52} width={2} height={2} fill="#f3c35f" opacity={0.3} className="deploy-sparkle-1"/>
      <rect x={30} y={54} width={2} height={2} fill="#ff9a3c" opacity={0.3} className="deploy-sparkle-2"/>
    </svg>
  )
}

const charComponents: Record<DeployPhase['character'], () => JSX.Element> = {
  key: PixelKey,
  shield: PixelShield,
  vault: PixelVault,
  robot: PixelRobot,
  rocket: PixelRocket,
}

function DeployLoadingOverlay() {
  const [activeStepIdx, setActiveStepIdx] = useState(0)
  const [dots, setDots] = useState('')
  const [elapsed, setElapsed] = useState(0)
  const [charVisible, setCharVisible] = useState(true)

  // Advance steps based on elapsed time
  useEffect(() => {
    const start = Date.now()
    const iv = setInterval(() => {
      const ms = Date.now() - start
      setElapsed(ms)
      // Find which step we're on
      for (let i = allSteps.length - 1; i >= 0; i--) {
        if (ms >= allSteps[i].absStart) {
          setActiveStepIdx(i)
          break
        }
      }
    }, 100)
    return () => clearInterval(iv)
  }, [])

  // Animate character swap: fade out → swap → fade in
  const currentPhaseIdx = allSteps[activeStepIdx]?.phaseIdx ?? 0
  const prevPhaseRef = useRef(0)
  useEffect(() => {
    if (currentPhaseIdx !== prevPhaseRef.current) {
      setCharVisible(false)
      const t = setTimeout(() => {
        prevPhaseRef.current = currentPhaseIdx
        setCharVisible(true)
      }, 300)
      return () => clearTimeout(t)
    }
  }, [currentPhaseIdx])

  const displayPhaseIdx = charVisible ? currentPhaseIdx : prevPhaseRef.current
  const phase = deployPhases[displayPhaseIdx]
  const CharComponent = charComponents[phase.character]

  // Dots animation
  useEffect(() => {
    const iv = setInterval(() => setDots(d => d.length >= 3 ? '' : d + '.'), 400)
    return () => clearInterval(iv)
  }, [])

  // Steps visible: show steps for current phase only
  const phaseSteps = allSteps.filter(s => s.phaseIdx === currentPhaseIdx)
  const phaseFirstIdx = allSteps.findIndex(s => s.phaseIdx === currentPhaseIdx)
  const progress = Math.min(100, (elapsed / TOTAL_DEPLOY_MS) * 100)

  return (
    <div className="deploy-loading-overlay">
      <div className="deploy-grid-bg" />

      {/* Floating pixel particles */}
      {Array.from({ length: 16 }).map((_, i) => (
        <span
          key={i}
          className="deploy-pixel-particle"
          style={{
            '--pp-x': `${5 + Math.random() * 90}%`,
            '--pp-dur': `${3 + Math.random() * 4}s`,
            '--pp-delay': `${Math.random() * 3}s`,
            '--pp-size': `${3 + Math.random() * 5}px`,
            '--pp-color': ['#5ad6b5', '#f3c35f', '#4ecdc4', '#ff9a3c', '#7f95d1', '#f25f5c'][i % 6],
          } as CSSProperties}
        />
      ))}

      <div className="deploy-loading-content">
        {/* Phase indicator pills */}
        <div className="deploy-phases-bar">
          {deployPhases.map((p, i) => (
            <div
              className={`deploy-phase-pill ${i < currentPhaseIdx ? 'is-done' : i === currentPhaseIdx ? 'is-active' : ''}`}
              key={p.label}
              style={{ '--phase-color': p.color } as CSSProperties}
            >
              <span className="deploy-phase-dot" />
              <span className="deploy-phase-label">{p.label}</span>
            </div>
          ))}
        </div>

        {/* Character area with swap animation */}
        <div className="deploy-char-stage" style={{ '--phase-color': phase.color } as CSSProperties}>
          <div className={`deploy-char-wrap ${charVisible ? 'is-visible' : 'is-hidden'}`}>
            <CharComponent />
          </div>
          {/* Orbiting particles around character */}
          <div className="deploy-orbit deploy-orbit--1" style={{ '--orb-color': phase.color } as CSSProperties} />
          <div className="deploy-orbit deploy-orbit--2" style={{ '--orb-color': phase.color } as CSSProperties} />
          <div className="deploy-orbit deploy-orbit--3" style={{ '--orb-color': phase.color } as CSSProperties} />
        </div>

        <h2 className="deploy-loading-title" style={{ color: phase.color }}>
          {phase.label}{dots}
        </h2>

        {/* Step progress for current phase */}
        <div className="deploy-steps">
          {phaseSteps.map((step, i) => {
            const globalIdx = phaseFirstIdx + i
            const isDone = activeStepIdx > globalIdx
            const isActive = activeStepIdx === globalIdx
            return (
              <div
                className={`deploy-step ${isDone ? 'is-done' : isActive ? 'is-active' : ''}`}
                key={step.text}
                style={{ '--phase-color': phase.color } as CSSProperties}
              >
                <span className="deploy-step-icon">{isDone ? '✓' : isActive ? '▸' : '○'}</span>
                <span className="deploy-step-text">{step.text}</span>
                {isActive && <span className="deploy-step-spinner" style={{ borderTopColor: phase.color } as CSSProperties} />}
              </div>
            )
          })}
        </div>

        {/* Progress bar */}
        <div className="deploy-progress-bar">
          <div
            className="deploy-progress-fill"
            style={{
              width: `${progress}%`,
              background: `linear-gradient(90deg, ${deployPhases[0].color}, ${phase.color})`,
            }}
          />
          <span className="deploy-progress-pct">{Math.round(progress)}%</span>
        </div>
      </div>
    </div>
  )
}

export default function Landing({ onEnter, onTryDemo, onAbout }: LandingProps) {
  const [demoLoading, setDemoLoading] = useState(false)

  const handleDemo = async () => {
    setDemoLoading(true)
    try {
      await onTryDemo()
    } finally {
      setDemoLoading(false)
    }
  }

  if (demoLoading) {
    return <DeployLoadingOverlay />
  }

  return (
    <div className="landing">
      <DeployOverlay active={demoLoading} />
      <div className="landing-content">
        <header className="landing-header" style={{ animationDelay: '0s' }}>
          <img className="landing-brand-logo" src="/logo-192.png" alt="Aivy" />
          <h1 className="landing-title">Aivy</h1>
          <p className="landing-tagline">
            Deploy AI Agents on Hedera in 60 Seconds
          </p>
        </header>

        <div className="landing-office-preview" style={{ animationDelay: '0.2s' }}>
          <div className="preview-office">
            {roomCards.map((room) => (
              <div className={`preview-room ${room.className}`} key={room.name}>
                <span className="preview-room-label">{room.name}</span>
              </div>
            ))}

            {/* Walking agents */}
            {templates.slice(0, 4).map((template, index) => {
              const cfg = walkConfigs[index]
              if (!cfg) return null
              return (
                <div
                  className={`preview-agent ${cfg.walkClass}`}
                  key={template.id}
                  style={{ '--sprite-color': template.color } as CSSProperties}
                >
                  <LandingSprite name={template.name} />
                  <span className="preview-agent-ring" />
                  <span className="demo-work-dots">
                    <span /><span /><span />
                  </span>
                  <span className="demo-bubble">{cfg.bubble}</span>
                </div>
              )
            })}

            {/* Inter-agent data transfers */}
            {dataTransfers.map((t) => (
              <span key={t.id}>
                {/* Trail particles (3 dots) */}
                {[0, 1, 2].map((i) => (
                  <span
                    key={`${t.id}-p${i}`}
                    className={`demo-particle ${t.cls}`}
                    style={{
                      '--p-color': t.color,
                      '--p-trail': `${i * 0.18}s`,
                    } as CSSProperties}
                  />
                ))}

                {/* Send ring — expands from source on departure */}
                <span
                  className="demo-send-ring"
                  style={{
                    left: `${t.src.x}%`,
                    top: `${t.src.y}%`,
                    '--p-color': t.color,
                    '--t-delay': t.delay,
                  } as CSSProperties}
                />

                {/* Receive beacon — pulses at dest while waiting, flashes on arrival */}
                <span
                  className="demo-recv-beacon"
                  style={{
                    left: `${t.dst.x}%`,
                    top: `${t.dst.y}%`,
                    '--p-color': t.color,
                    '--t-delay': t.delay,
                  } as CSSProperties}
                />
              </span>
            ))}
          </div>

          {/* Activity ticker */}
          <div className="demo-ticker">
            <div className="demo-ticker-track">
              {[...demoTickerItems, ...demoTickerItems].map((item, i) => (
                <span className={`demo-ticker-item demo-ticker-${item.tone}`} key={`${item.text}-${i}`}>
                  {item.text}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="landing-pillars" style={{ animationDelay: '0.4s' }}>
          <div className="pillar">
            <div className="pillar-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="7" height="7" rx="1" />
                <rect x="14" y="3" width="7" height="7" rx="1" />
                <rect x="3" y="14" width="7" height="7" rx="1" />
                <rect x="14" y="14" width="7" height="7" rx="1" />
              </svg>
            </div>
            <h3>Visual Office</h3>
            <p>Watch your agents work in a pixel art workspace</p>
          </div>

          <div className="pillar">
            <div className="pillar-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
            </div>
            <h3>Vaults + KMS</h3>
            <p>On-chain spending caps with AWS KMS key management — private keys never stored in plaintext</p>
          </div>

          <div className="pillar">
            <div className="pillar-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
              </svg>
            </div>
            <h3>50+ Tools</h3>
            <p>Full Hedera Agent Kit: tokens, contracts, consensus</p>
          </div>
        </div>

        <div className="landing-cta-group" style={{ animationDelay: '0.5s' }}>
          <button
            className="landing-cta"
            onClick={onEnter}
            type="button"
          >
            Enter the Office
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </button>
          <button
            className={`landing-cta-demo${demoLoading ? ' is-loading' : ''}`}
            onClick={handleDemo}
            disabled={demoLoading}
            type="button"
          >
            {demoLoading ? (
              <>
                <svg className="demo-spinner" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round">
                    <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.7s" repeatCount="indefinite" />
                  </path>
                </svg>
                Deploying on Hedera...
              </>
            ) : (
              <>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
                Try Demo
              </>
            )}
          </button>
        </div>

        <p className="landing-powered" style={{ animationDelay: '0.6s' }}>
          Powered by <strong>Hedera Agent Kit</strong> &middot; Built for APEX Hackathon &middot; <strong>AivyLabs</strong>
          {onAbout && (
            <>
              {' '}&middot;{' '}
              <button className="landing-about-link" onClick={onAbout} type="button">
                Architecture
              </button>
            </>
          )}
          {' '}&middot;{' '}
          <a className="landing-about-link" href="https://github.com/jmgomezl/aivy" target="_blank" rel="noopener noreferrer">
            GitHub
          </a>
          {' '}&middot;{' '}
          <span className="landing-license">MIT License</span>
        </p>
      </div>
    </div>
  )
}
