import { useEffect, useRef, useState, useMemo, useCallback, type CSSProperties } from 'react'
import type { LiveAgent } from '../types'
import { statusMeta, speechBubbles } from '../data'
import { getSpriteSheet, agentNameToSpriteType } from '../sprites/generateSprites'
import { useWalletContext } from '../contexts/WalletContext'
import { useToast } from '../hooks/useToast'
import './AgentSprite.css'

type AgentSpriteProps = {
  agent: LiveAgent
  isSelected: boolean
  isActive?: boolean
  isMoving?: boolean
  bobDelay: number
  onClick: () => void
  onFund?: () => void
  lastChatMessage?: string
}

export default function AgentSprite({ agent, isSelected, isActive, isMoving, bobDelay, onClick, onFund, lastChatMessage }: AgentSpriteProps) {
  const { agentBalances } = useWalletContext()
  const { addToast } = useToast()
  const [bubble, setBubble] = useState<string | null>(null)
  const [bubbleFading, setBubbleFading] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [showInfoCard, setShowInfoCard] = useState(false) // for mobile long-press
  const longPressRef = useRef(0)

  // Read pre-fetched balance from context
  const hoverBalance = agent.agentAccountId ? agentBalances.get(agent.agentAccountId) ?? null : null

  // Use refs for all timers to prevent leaks on rapid mount/unmount
  const chatFadeRef = useRef(0)
  const chatRemoveRef = useRef(0)
  const bubbleFadeRef = useRef(0)
  const bubbleRemoveRef = useRef(0)
  const initialTimerRef = useRef(0)
  const intervalRef = useRef(0)

  // Show real chat messages as speech bubbles when available
  useEffect(() => {
    if (!lastChatMessage) return

    const truncated =
      lastChatMessage.length > 40
        ? lastChatMessage.slice(0, 40) + '...'
        : lastChatMessage

    setBubbleFading(false)
    setBubble(truncated)

    window.clearTimeout(chatFadeRef.current)
    window.clearTimeout(chatRemoveRef.current)

    chatFadeRef.current = window.setTimeout(() => {
      setBubbleFading(true)
      chatRemoveRef.current = window.setTimeout(() => {
        setBubble(null)
      }, 500)
    }, 5000)

    return () => {
      window.clearTimeout(chatFadeRef.current)
      window.clearTimeout(chatRemoveRef.current)
    }
  }, [lastChatMessage])

  // Fallback to template-based speech bubbles when no chat activity
  useEffect(() => {
    if (agent.status === 'paused') return
    if (lastChatMessage) return // Don't show random bubbles if there's real chat

    const messages = speechBubbles[agent.templateId] ?? speechBubbles['treasury-sentinel']
    let messageIndex = Math.floor(Math.random() * messages.length)

    const showBubble = () => {
      // Clear any pending timers from a previous bubble
      window.clearTimeout(bubbleFadeRef.current)
      window.clearTimeout(bubbleRemoveRef.current)

      setBubbleFading(false)
      setBubble(messages[messageIndex % messages.length])
      messageIndex++

      // Fade out after 3 seconds
      bubbleFadeRef.current = window.setTimeout(() => {
        setBubbleFading(true)
        bubbleRemoveRef.current = window.setTimeout(() => {
          setBubble(null)
        }, 500)
      }, 3000)
    }

    // First bubble after random delay (3-8s)
    const initialDelay = 3000 + Math.random() * 5000
    initialTimerRef.current = window.setTimeout(() => {
      showBubble()
    }, initialDelay)

    // Recurring bubbles every 10s (fixed interval avoids drift)
    intervalRef.current = window.setInterval(() => {
      showBubble()
    }, 10000)

    return () => {
      window.clearTimeout(initialTimerRef.current)
      window.clearInterval(intervalRef.current)
      window.clearTimeout(bubbleFadeRef.current)
      window.clearTimeout(bubbleRemoveRef.current)
    }
  }, [agent.templateId, agent.status, lastChatMessage])

  const isWorking = agent.status === 'active' || agent.status === 'guarded'
  const isDeploying = agent.status === 'deploying'
  const isPaused = agent.status === 'paused'

  const handleMouseEnter = useCallback(() => setHovered(true), [])
  const handleMouseLeave = useCallback(() => { setHovered(false); setShowInfoCard(false) }, [])

  // Mobile long-press → show info card
  const handleTouchStart = useCallback(() => {
    longPressRef.current = window.setTimeout(() => setShowInfoCard(true), 500)
  }, [])
  const handleTouchEnd = useCallback(() => {
    window.clearTimeout(longPressRef.current)
  }, [])

  // Copy address to clipboard
  const handleCopyAddress = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    if (!agent.agentAccountId) return
    void navigator.clipboard.writeText(agent.agentAccountId).then(() => {
      addToast('Address copied!', 'success')
    })
  }, [agent.agentAccountId, addToast])

  const spriteClass = [
    'agent-sprite-v2',
    isSelected && 'is-selected',
    isWorking && 'is-working',
    isDeploying && 'is-deploying',
    isPaused && 'is-paused',
    isActive && 'is-executing',
    isMoving && 'is-moving',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <button
      className={spriteClass}
      onClick={onClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      aria-label={`${agent.name} — ${statusMeta[agent.status].label}`}
      style={{
        left: `calc(${agent.x}% - 38px)`,
        top: `calc(${agent.y}% - 38px)`,
        '--sprite-color': agent.color,
        '--sprite-accent': statusMeta[agent.status].accent,
        '--bob-delay': `${bobDelay}s`,
      } as CSSProperties}
      type="button"
    >
      {bubble && (
        <div className={`speech-bubble ${bubbleFading ? 'is-fading' : ''} ${agent.y < 18 ? 'bubble-below' : ''}`}>
          {bubble}
        </div>
      )}

      {/* Hover info card (desktop hover + mobile long-press) */}
      {(hovered || showInfoCard) && !bubble && (
        <div className={`sprite-hover-card ${agent.y < 18 ? 'hover-below' : ''}`}>
          <span className="hover-name">{agent.name}</span>
          {agent.agentAccountId && (
            <span
              className="hover-address hover-address-copy"
              onClick={handleCopyAddress}
              role="button"
              tabIndex={-1}
              title="Click to copy"
            >
              {agent.agentAccountId}
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
              </svg>
            </span>
          )}
          {hoverBalance != null ? (
            <span className="hover-balance">{hoverBalance} HBAR</span>
          ) : agent.agentAccountId ? (
            <span className="hover-balance">...</span>
          ) : null}
        </div>
      )}

      <span className="sprite-portrait">
        <SpriteAnimation name={agent.name} paused={isPaused} />
      </span>

      <span className="sprite-name" title={agent.name}>{agent.name.split(' ')[0]}</span>
      <span className="sprite-status">{statusMeta[agent.status].label}</span>

      {isSelected && agent.walletType === 'dedicated' && agent.agentAccountId && onFund && (
        <span
          className="sprite-fund-chip"
          onClick={(e) => { e.stopPropagation(); onFund() }}
          role="button"
          tabIndex={-1}
        >
          Fund ℏ
        </span>
      )}

      {isWorking && (
        <>
          <span className="sparkle s1" />
          <span className="sparkle s2" />
          <span className="sparkle s3" />
        </>
      )}

      {/* Activity overlay — pulsing ring when executing a tool */}
      {isActive && <span className="activity-ring" />}
    </button>
  )
}

/** Animated pixel sprite — cycles through 4 frames via CSS steps */
function SpriteAnimation({ name, paused }: { name: string; paused: boolean }) {
  const spriteUrl = useMemo(() => {
    const type = agentNameToSpriteType(name)
    return getSpriteSheet(type)
  }, [name])

  if (!spriteUrl) return null

  return (
    <div
      className={`pixel-sprite ${paused ? 'pixel-sprite-paused' : ''}`}
      style={{ backgroundImage: `url(${spriteUrl})` }}
      role="img"
      aria-label={name}
    />
  )
}
