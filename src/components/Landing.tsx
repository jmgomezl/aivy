import { type CSSProperties, useState, useEffect, useMemo, useRef } from 'react'
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
  { walkClass: 'walk-bk', bubble: 'Sentiment: Bullish' },
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
