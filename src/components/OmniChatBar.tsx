import { useCallback, useRef, useState } from 'react'
import type { LiveAgent } from '../types'
import { requestJson } from '../utils'
import './OmniChatBar.css'

type OmniChatBarProps = {
  agents: LiveAgent[]
  userAccountId?: string | null
  onSelectAgent: (id: string) => void
  onAgentReply?: (agentId: string, message: string) => void
  onRefresh?: () => void
}

type RouteResponse = {
  agentId: string
  agentName: string
  reply: string
  toolCalls?: Array<{
    toolName: string
    params: Record<string, unknown>
    result: { raw?: Record<string, unknown>; humanMessage?: string }
  }>
}

export default function OmniChatBar({
  agents,
  userAccountId,
  onSelectAgent,
  onAgentReply,
  onRefresh,
}: OmniChatBarProps) {
  const [input, setInput] = useState('')
  const [isRouting, setIsRouting] = useState(false)
  const [routeResult, setRouteResult] = useState<RouteResponse | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleSubmit = useCallback(async () => {
    const text = input.trim()
    if (!text || isRouting || agents.length === 0) return

    setIsRouting(true)
    setRouteResult(null)

    try {
      const data = await requestJson<RouteResponse>('/api/chat/route', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          agentIds: agents.filter((a) => a.status !== 'paused').map((a) => a.id),
          ...(userAccountId ? { userAccountId } : {}),
        }),
      })

      setRouteResult(data)
      setInput('')

      // Notify parent: select the agent and pass the reply for speech bubble
      onSelectAgent(data.agentId)
      onAgentReply?.(data.agentId, data.reply)
      if (data.toolCalls && data.toolCalls.length > 0) {
        onRefresh?.()
      }

      // Clear the route result toast after 4 seconds
      setTimeout(() => setRouteResult(null), 4000)
    } catch {
      setRouteResult(null)
    } finally {
      setIsRouting(false)
    }
  }, [input, isRouting, agents, userAccountId, onSelectAgent, onAgentReply, onRefresh])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        void handleSubmit()
      }
    },
    [handleSubmit],
  )

  if (agents.length === 0) return null

  return (
    <div className="omni-bar-wrapper">
      {routeResult && (
        <div className="omni-route-toast">
          <span className="omni-route-icon">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
            </svg>
          </span>
          <span>
            Routed to <strong>{routeResult.agentName}</strong>
          </span>
        </div>
      )}

      <div className="omni-bar">
        <svg className="omni-bar-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="8" />
          <path d="M21 21l-4.35-4.35" />
        </svg>
        <input
          ref={inputRef}
          className="omni-bar-input"
          type="text"
          placeholder="Ask any agent... e.g. 'Create a token called HackCoin'"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isRouting}
        />
        {isRouting && <span className="omni-bar-spinner" />}
        <button
          className="omni-bar-send"
          onClick={() => void handleSubmit()}
          disabled={!input.trim() || isRouting}
          type="button"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M5 12h14M12 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    </div>
  )
}
