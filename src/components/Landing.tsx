import { type CSSProperties, useState, useEffect, useMemo } from 'react'
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
            {templates.map((template, index) => {
              const cfg = walkConfigs[index]
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
            <h3>Safe Vaults</h3>
            <p>On-chain spending caps and guardrails for every agent</p>
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
        </p>
      </div>
    </div>
  )
}
