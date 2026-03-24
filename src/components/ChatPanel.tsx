import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChatMessage, ChatResponse, LiveAgent } from '../types'
import { requestJson } from '../utils'
import { getAuthHeaders } from '../lib/auth'
import './ChatPanel.css'

// Module-level variable to store pending image file (avoids React closure issues)
let _pendingImageFile: File | null = null

type ChatPanelProps = {
  agent: LiveAgent
  userAccountId?: string | null
  onAgentReply?: (agentId: string, message: string) => void
  onRefresh?: () => void
  onMarkActive?: (agentId: string) => void
}

const welcomeMessages: Record<string, string> = {
  'treasury-sentinel':
    "Hi! I'm your Treasury Sentinel. Ask me to check balances, transfer HBAR, or inspect your vault.",
  'yield-router':
    "Hey there! I'm the Yield Router. I can create tokens, mint assets, manage ERC contracts, and route liquidity.",
  'compliance-clerk':
    "Hello. I'm the Compliance Clerk. I can audit transactions, inspect accounts, and verify token activity.",
  'governance-relay':
    "Welcome! I'm the Governance Relay. I manage HCS topics, coordinate proposals, and handle scheduled actions.",
  'bonzo-keeper':
    "Hey! I'm your Bonzo Keeper. I manage your DeFi yield on Bonzo Finance — deposits, harvesting, and sentiment-aware rebalancing. Tell me your yield goal!",
}

const suggestedPrompts: Record<string, string[]> = {
  'treasury-sentinel': [
    'Check my HBAR balance',
    'Show account info',
    'Transfer 5 HBAR to 0.0.5678',
    'Get the price of HBAR from Chainlink',
  ],
  'yield-router': [
    'Create token HackCoin',
    'Mint 500 tokens',
    'Deploy ERC20 contract',
    'Token balances',
    'Get the price of HBAR from Pyth',
    'Get the price of BTC from Chainlink',
    'Mint an NFT',
  ],
  'compliance-clerk': [
    'Audit my account',
    'Token balances',
    'Check exchange rate',
    'Lookup transaction',
  ],
  'governance-relay': [
    'Create proposal topic',
    'Submit a message',
    'Show topic messages',
    'Schedule transfer',
  ],
  'bonzo-keeper': [
    'Show Bonzo market rates',
    'Deposit 10 HBAR into Bonzo',
    'Check crypto sentiment',
    'Withdraw from Bonzo',
  ],
}

const placeholderHints: Record<string, string> = {
  'treasury-sentinel': 'Check balance, transfer HBAR...',
  'yield-router': 'Create tokens, mint NFTs...',
  'compliance-clerk': 'Audit accounts, verify tokens...',
  'governance-relay': 'Create topics, submit proposals...',
  'bonzo-keeper': 'Deposit, harvest, check sentiment...',
}

export default function ChatPanel({ agent, userAccountId, onAgentReply, onRefresh, onMarkActive }: ChatPanelProps) {
  const welcomeMsg: ChatMessage = {
    id: 'welcome',
    role: 'assistant',
    content:
      welcomeMessages[agent.templateId] ??
      "Hi! I'm your AI agent. Ask me anything about Hedera.",
    timestamp: new Date().toISOString(),
  }
  const [messages, setMessages] = useState<ChatMessage[]>([welcomeMsg])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [pendingImage, setPendingImage] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const pendingImageRef = useRef<File | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Load existing chat history on mount (e.g. after OmniBar routing)
  useEffect(() => {
    let cancelled = false
    requestJson<{ messages: ChatMessage[] }>(`/api/agents/${agent.id}/chat`)
      .then((data) => {
        if (cancelled) return
        if (data.messages && data.messages.length > 0) {
          setMessages([welcomeMsg, ...data.messages])
        }
      })
      .catch(() => { /* ignore - use welcome message only */ })
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent.id])

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, isLoading])

  // Focus input on mount (skip on narrow screens to avoid mobile keyboard popup)
  useEffect(() => {
    if (window.innerWidth > 768) {
      const timer = window.setTimeout(() => inputRef.current?.focus(), 100)
      return () => window.clearTimeout(timer)
    }
  }, [])

  const handleImageSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !file.type.startsWith('image/')) return
    _pendingImageFile = file
    setPendingImage(file)
    pendingImageRef.current = file
    setImagePreview(URL.createObjectURL(file))
  }, [])

  const clearImage = useCallback(() => {
    _pendingImageFile = null
    setPendingImage(null)
    pendingImageRef.current = null
    if (imagePreview) URL.revokeObjectURL(imagePreview)
    setImagePreview(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [imagePreview])

  const sendMessage = useCallback(async (text?: string) => {
    const msgText = (text ?? input).trim()
    if (!msgText || isLoading) return

    // Use module-level variable to avoid any React closure/state issues
    const imageFile = _pendingImageFile
    const preview = imagePreview
    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: msgText,
      timestamp: new Date().toISOString(),
      imageUrl: preview ?? undefined,
    }
    setMessages((prev) => [...prev, userMsg])
    setInput('')
    if (imageFile) {
      // Clear all image state
      _pendingImageFile = null
      setPendingImage(null)
      pendingImageRef.current = null
      setImagePreview(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
    setIsLoading(true)
    try {
      // If image is attached, upload first and inject metadata URI
      let messageToSend = msgText
      if (imageFile) {
        const formData = new FormData()
        formData.append('image', imageFile)
        // Try to extract a name from the message
        const nameMatch = msgText.match(/called\s+["']?(.+?)["']?\s*$/i)
          || msgText.match(/named?\s+["']?(.+?)["']?\s*$/i)
          || msgText.match(/as\s+(?:an?\s+NFT\s+)?["']?([A-Za-z0-9_-]+)["']?\s*$/i)
        if (nameMatch) formData.append('name', nameMatch[1])
        formData.append('description', msgText)

        const headers = getAuthHeaders()
        try {
          const uploadRes = await fetch('/api/nft/upload', {
            method: 'POST',
            headers,
            body: formData,
          })
          if (uploadRes.ok) {
            const uploadData = await uploadRes.json() as { metadataUrl: string; imageUrl: string }
            messageToSend = `${msgText}\n\n[The user has uploaded an image for NFT minting. NFT metadata URI: ${uploadData.metadataUrl} — use this URI when minting. First create an NFT collection, then mint with this metadata URI in the "uris" parameter as a single-element array like {"tokenId": "0.0.XXX", "uris": ["${uploadData.metadataUrl}"]}.]`
          } else {
            console.error('[NFT] Upload failed:', uploadRes.status, await uploadRes.text())
          }
        } catch (uploadErr) {
          console.error('[NFT] Upload error:', uploadErr)
        }
      }

      const data = await requestJson<ChatResponse>(
        `/api/agents/${agent.id}/chat`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: messageToSend,
            ...(userAccountId && /^0\.0\.\d+$/.test(userAccountId) ? { userAccountId } : {}),
          }),
        },
      )

      // Add tool call messages (if any) — now with references for tx cards
      const toolMessages: ChatMessage[] = (data.toolCalls ?? []).map((tc, i) => ({
        id: `tool-${Date.now()}-${i}`,
        role: 'tool' as const,
        content: tc.result.humanMessage ?? `Executed ${tc.toolName}`,
        toolName: tc.toolName,
        toolParams: tc.params,
        timestamp: new Date().toISOString(),
      }))

      // Add assistant reply
      const assistantMsg: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: data.reply,
        timestamp: new Date().toISOString(),
      }

      setMessages((prev) => [...prev, ...toolMessages, assistantMsg])

      // Notify parent of the reply (for speech bubbles)
      onAgentReply?.(agent.id, data.reply)

      // Refresh live data if tools were executed + trigger activity overlay
      if (data.toolCalls && data.toolCalls.length > 0) {
        onMarkActive?.(agent.id)
        onRefresh?.()
      }
    } catch (error) {
      const errorMsg: ChatMessage = {
        id: `error-${Date.now()}`,
        role: 'assistant',
        content:
          error instanceof Error
            ? error.message
            : 'Something went wrong. Please try again.',
        timestamp: new Date().toISOString(),
      }
      setMessages((prev) => [...prev, errorMsg])
    } finally {
      setIsLoading(false)
    }
  }, [input, isLoading, agent.id, userAccountId, onAgentReply, onRefresh, onMarkActive, pendingImage, imagePreview, clearImage])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        void sendMessage()
      }
    },
    [sendMessage],
  )

  const handleSuggestionClick = useCallback(
    (prompt: string) => {
      void sendMessage(prompt)
    },
    [sendMessage],
  )

  const clearChat = useCallback(async () => {
    try {
      await requestJson(`/api/agents/${agent.id}/chat`, { method: 'DELETE' })
      setMessages([{
        id: 'welcome',
        role: 'assistant',
        content: welcomeMessages[agent.templateId] ?? welcomeMessages['treasury-sentinel'],
        timestamp: new Date().toISOString(),
      }])
    } catch { /* ignore */ }
  }, [agent.id, agent.templateId])

  const basePrompts = suggestedPrompts[agent.templateId] ?? suggestedPrompts['treasury-sentinel']
  // Add SaucerSwap prompts when the agent has the capability
  const saucerPrompts = agent.capabilityGroups?.includes('saucerswap')
    ? ['Show top SaucerSwap pools', 'Get SAUCE token price', 'Quote swap 100 HBAR to USDC']
    : []
  const allPrompts = [...basePrompts, ...saucerPrompts]
  // Filter out prompts the user already sent
  const usedTexts = new Set(messages.filter((m) => m.role === 'user').map((m) => m.content))
  const promptChips = allPrompts.filter((p) => !usedTexts.has(p))

  return (
    <div className="chat-panel">
      <div className="chat-messages" ref={scrollRef}>
        {messages.map((msg) => (
          <ChatBubble key={msg.id} message={msg} agentColor={agent.color} />
        ))}

        {/* Suggested prompt chips — always visible when not loading */}
        {!isLoading && promptChips.length > 0 && (
          <div className="chat-suggestions">
            {promptChips.map((prompt) => (
              <button
                className="chat-suggestion-chip"
                key={prompt}
                onClick={() => handleSuggestionClick(prompt)}
                type="button"
              >
                {prompt}
              </button>
            ))}
          </div>
        )}

        {isLoading && (
          <div className="chat-bubble assistant">
            <div className="chat-typing">
              <span />
              <span />
              <span />
            </div>
          </div>
        )}
      </div>

      {/* Image preview strip */}
      {imagePreview && (
        <div className="chat-image-preview">
          <img src={imagePreview} alt="NFT preview" />
          <span className="chat-image-label">Ready to mint as NFT</span>
          <button onClick={clearImage} className="chat-image-remove" type="button" aria-label="Remove image">&times;</button>
        </div>
      )}

      <div className="chat-input-row">
        <button
          className="chat-clear"
          onClick={clearChat}
          type="button"
          aria-label="Clear chat history"
          title="Clear chat"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" />
          </svg>
        </button>
        {/* Hidden file input for image upload */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleImageSelect}
          style={{ display: 'none' }}
        />
        <button
          className="chat-attach"
          onClick={() => fileInputRef.current?.click()}
          type="button"
          aria-label="Attach image for NFT"
          title="Attach image for NFT minting"
          disabled={isLoading}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
            <circle cx="8.5" cy="8.5" r="1.5"/>
            <polyline points="21 15 16 10 5 21"/>
          </svg>
        </button>
        <textarea
          ref={inputRef}
          className="chat-input"
          placeholder={`Ask ${agent.name}... ${placeholderHints[agent.templateId] ?? ''}`}
          aria-label={`Message ${agent.name}`}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={2}
          disabled={isLoading}
        />
        <button
          className="chat-send"
          onClick={() => void sendMessage()}
          disabled={(!input.trim() && !pendingImage) || isLoading}
          type="button"
          aria-label="Send message"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
          </svg>
        </button>
      </div>
    </div>
  )
}

function ChatBubble({
  message,
  agentColor,
}: {
  message: ChatMessage
  agentColor: string
}) {
  // Feature 3: Enhanced tool badge with transaction mini-card
  if (message.role === 'tool') {
    // Extract references from tool params if available
    const raw = message.toolParams as Record<string, unknown> | undefined
    const txId = raw?.transactionId as string | undefined
    const accountId = raw?.accountId as string | undefined

    return (
      <div className="chat-tool-card">
        <div className="chat-tool-badge-row">
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z" />
          </svg>
          <span className="tool-name">{formatToolName(message.toolName ?? '')}</span>
          <span className="tool-status-ok">OK</span>
        </div>
        <div className="chat-tool-result">{renderMarkdown(message.content, `tool-${message.id}`)}</div>
        {(txId || accountId) && (
          <div className="chat-tool-refs">
            {txId && (
              <a
                className="chat-tool-ref"
                href={`https://hashscan.io/testnet/transaction/${txId}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                Tx: {txId.length > 24 ? txId.slice(0, 24) + '...' : txId}
              </a>
            )}
            {accountId && (
              <a
                className="chat-tool-ref"
                href={`https://hashscan.io/testnet/account/${accountId}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                Account: {accountId}
              </a>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className={`chat-bubble ${message.role}`}>
      {message.role === 'assistant' && (
        <div className="chat-avatar" style={{ borderColor: agentColor }}>
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill={agentColor}
          >
            <circle cx="12" cy="12" r="10" />
          </svg>
        </div>
      )}
      <div className="chat-content">
        {message.imageUrl && (
          <div className="chat-bubble-image">
            <img src={message.imageUrl} alt="Attached" />
          </div>
        )}
        {renderMarkdown(message.content, message.id)}
      </div>
    </div>
  )
}

function formatToolName(name: string): string {
  return name
    .replace(/_tool$/, '')
    .replace(/_query$/, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

/** Lightweight inline markdown → React nodes: **bold**, *italic*, `code` */
function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = []
  // Match **bold**, *italic*, `code`
  const regex = /(\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`)/g
  let last = 0
  let idx = 0
  let match: RegExpExecArray | null
  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index))
    if (match[2]) nodes.push(<strong key={`${keyPrefix}-${idx++}`}>{match[2]}</strong>)
    else if (match[3]) nodes.push(<em key={`${keyPrefix}-${idx++}`}>{match[3]}</em>)
    else if (match[4]) nodes.push(<code key={`${keyPrefix}-${idx++}`} className="chat-md-code">{match[4]}</code>)
    last = match.index + match[0].length
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes.length > 0 ? nodes : [text]
}

/** Render a block of text with basic markdown: paragraphs, bold, italic, code, list items */
function renderMarkdown(content: string, idPrefix: string): React.ReactNode {
  const lines = content.split('\n')
  const elements: React.ReactNode[] = []
  let listItems: React.ReactNode[] = []

  const flushList = () => {
    if (listItems.length > 0) {
      elements.push(<ul key={`${idPrefix}-ul${elements.length}`} className="chat-md-list">{listItems}</ul>)
      listItems = []
    }
  }

  lines.forEach((line, i) => {
    const trimmed = line.trimStart()
    if (trimmed.startsWith('- ') || trimmed.startsWith('• ')) {
      const text = trimmed.slice(2)
      listItems.push(<li key={`${idPrefix}-li${i}`}>{renderInline(text, `${idPrefix}-li${i}`)}</li>)
    } else {
      flushList()
      elements.push(
        <p key={`${idPrefix}-l${i}`}>
          {line ? renderInline(line, `${idPrefix}-l${i}`) : '\u00A0'}
        </p>,
      )
    }
  })
  flushList()

  return <>{elements}</>
}
