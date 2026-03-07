import { useEffect, useState, type CSSProperties } from 'react'
import type { LiveAgent } from '../types'
import { statusMeta, speechBubbles } from '../data'
import './AgentSprite.css'

type AgentSpriteProps = {
  agent: LiveAgent
  isSelected: boolean
  isActive?: boolean
  bobDelay: number
  onClick: () => void
  lastChatMessage?: string
}

export default function AgentSprite({ agent, isSelected, isActive, bobDelay, onClick, lastChatMessage }: AgentSpriteProps) {
  const [bubble, setBubble] = useState<string | null>(null)
  const [bubbleFading, setBubbleFading] = useState(false)

  // Show real chat messages as speech bubbles when available
  useEffect(() => {
    if (!lastChatMessage) return

    const truncated =
      lastChatMessage.length > 40
        ? lastChatMessage.slice(0, 40) + '...'
        : lastChatMessage

    setBubbleFading(false)
    setBubble(truncated)

    const fadeTimer = window.setTimeout(() => {
      setBubbleFading(true)
      const removeTimer = window.setTimeout(() => {
        setBubble(null)
      }, 500)
      return () => window.clearTimeout(removeTimer)
    }, 5000)

    return () => window.clearTimeout(fadeTimer)
  }, [lastChatMessage])

  // Fallback to template-based speech bubbles when no chat activity
  useEffect(() => {
    if (agent.status === 'paused') return
    if (lastChatMessage) return // Don't show random bubbles if there's real chat

    const messages = speechBubbles[agent.templateId] ?? speechBubbles['treasury-sentinel']
    let messageIndex = Math.floor(Math.random() * messages.length)

    const showBubble = () => {
      setBubbleFading(false)
      setBubble(messages[messageIndex % messages.length])
      messageIndex++

      // Fade out after 3 seconds
      const fadeTimer = window.setTimeout(() => {
        setBubbleFading(true)
        const removeTimer = window.setTimeout(() => {
          setBubble(null)
        }, 500)
        return () => window.clearTimeout(removeTimer)
      }, 3000)

      return () => window.clearTimeout(fadeTimer)
    }

    // First bubble after random delay (3-8s)
    const initialDelay = 3000 + Math.random() * 5000
    const initialTimer = window.setTimeout(() => {
      showBubble()
    }, initialDelay)

    // Recurring bubbles every 8-15s
    const interval = window.setInterval(() => {
      showBubble()
    }, 8000 + Math.random() * 7000)

    return () => {
      window.clearTimeout(initialTimer)
      window.clearInterval(interval)
    }
  }, [agent.templateId, agent.status, lastChatMessage])

  const isWorking = agent.status === 'active' || agent.status === 'guarded'
  const isDeploying = agent.status === 'deploying'
  const isPaused = agent.status === 'paused'

  const spriteClass = [
    'agent-sprite-v2',
    isSelected && 'is-selected',
    isWorking && 'is-working',
    isDeploying && 'is-deploying',
    isPaused && 'is-paused',
    isActive && 'is-executing',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <button
      className={spriteClass}
      onClick={onClick}
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
        <div className={`speech-bubble ${bubbleFading ? 'is-fading' : ''}`}>
          {bubble}
        </div>
      )}

      <span className="sprite-portrait">
        <img alt="" className="pixel-image" src={agent.sprite} />
      </span>

      <span className="sprite-name">{agent.name.split(' ')[0]}</span>
      <span className="sprite-status">{statusMeta[agent.status].label}</span>

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
