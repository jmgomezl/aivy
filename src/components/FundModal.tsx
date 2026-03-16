import { useState, useEffect, useMemo } from 'react'
import type { LiveAgent } from '../types'
import { requestJson } from '../utils'
import { useToast } from '../hooks/useToast'
import { useWalletContext } from '../contexts/WalletContext'
import { getSpriteSheet, agentNameToSpriteType } from '../sprites/generateSprites'
import './FundModal.css'

type FundModalProps = {
  agent: LiveAgent
  allAgents?: LiveAgent[]
  onSelectAgent?: (agentId: string) => void
  mirrorNodeUrl?: string
  onClose: () => void
  onSuccess: () => void
}

const PRESETS = [1, 5, 10, 25]

export default function FundModal({
  agent,
  allAgents,
  onSelectAgent,
  mirrorNodeUrl,
  onClose,
  onSuccess,
}: FundModalProps) {
  const { wallet, connectWallet, balanceVersion } = useWalletContext()
  const [selectedAmount, setSelectedAmount] = useState(5)
  const [customAmount, setCustomAmount] = useState('')
  const [isCustom, setIsCustom] = useState(false)
  const [balances, setBalances] = useState<Record<string, number | null>>({})
  const [balanceLoading, setBalanceLoading] = useState(false)
  const [funding, setFunding] = useState(false)
  const [result, setResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const { addToast } = useToast()

  const isConnected = wallet.status === 'connected'
  const effectiveAmount = isCustom ? parseFloat(customAmount) || 0 : selectedAmount

  const spriteUrl = useMemo(() => {
    const type = agentNameToSpriteType(agent.name)
    return getSpriteSheet(type)
  }, [agent.name])

  // Filter fundable agents (dedicated wallets with account IDs)
  const fundableAgents = useMemo(() => {
    if (!allAgents) return []
    return allAgents.filter(
      (a) => a.walletType === 'dedicated' && a.agentAccountId,
    )
  }, [allAgents])

  // Stable key for fundable agent IDs (prevents infinite effect loops)
  const fundableIds = useMemo(
    () => fundableAgents.map((a) => a.id).join(','),
    [fundableAgents],
  )

  // Fetch balances from Hedera Mirror Node (same pattern as DeployModal)
  useEffect(() => {
    if (!mirrorNodeUrl) return
    const agents = fundableAgents.length > 0
      ? fundableAgents
      : agent.agentAccountId ? [agent] : []
    if (agents.length === 0) return
    const ctrl = new AbortController()
    setBalanceLoading(true)
    const base = mirrorNodeUrl.replace(/\/api\/v1\/?$/, '')
    Promise.all(
      agents.map((a) => {
        const url = `${base}/api/v1/balances?account.id=${a.agentAccountId}&limit=1`
        return fetch(url, { signal: ctrl.signal })
          .then((r) => r.json())
          .then((data: { balances?: Array<{ balance: number }> }) => {
            const bal = data.balances?.[0]?.balance
            return [a.id, typeof bal === 'number' ? Math.round((bal / 1e8) * 100) / 100 : null] as const
          })
          .catch(() => [a.id, null] as const)
      }),
    ).then((results) => {
      if (ctrl.signal.aborted) return
      const map: Record<string, number | null> = {}
      for (const [id, bal] of results) map[id] = bal
      setBalances(map)
      setBalanceLoading(false)
    })
    return () => ctrl.abort()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fundableIds, mirrorNodeUrl, balanceVersion])

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const handleFund = async () => {
    if (!effectiveAmount || effectiveAmount <= 0 || !agent.agentAccountId) return
    setFunding(true)
    setResult(null)
    try {
      const { fundAgentAccount } = await import('../lib/hederaWallet')
      const { transactionId } = await fundAgentAccount(agent.agentAccountId, effectiveAmount)
      await requestJson(`/api/agents/${agent.id}/fund`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amountHbar: effectiveAmount,
          txId: transactionId,
          funderAccountId: isConnected ? wallet.accountId : 'unknown',
        }),
      })
      setResult({ type: 'success', message: `Funded ${effectiveAmount} HBAR!` })
      addToast(`Funded ${agent.name} with ${effectiveAmount} HBAR`, 'success')
      onSuccess()
      setTimeout(onClose, 1500)
    } catch (err) {
      setResult({ type: 'error', message: err instanceof Error ? err.message : 'Funding failed' })
    } finally {
      setFunding(false)
    }
  }

  return (
    <div className="fund-overlay" role="dialog" aria-modal="true" aria-label="Fund Agent" onClick={onClose}>
      <div className="fund-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="fm-header">
          <div className="fm-header-left">
            <span className="fm-portrait">
              {spriteUrl ? (
                <div
                  className="pixel-sprite"
                  style={{
                    backgroundImage: `url(${spriteUrl})`,
                    width: 36,
                    height: 36,
                    margin: 0,
                    backgroundSize: '100% 100%',
                  }}
                />
              ) : (
                <span style={{ fontSize: 24 }}>{agent.glyph}</span>
              )}
            </span>
            <div>
              <h2 className="fm-name">{agent.name}</h2>
              {agent.agentAccountId && (
                <span
                  className="fm-account-id"
                  onClick={() => {
                    void navigator.clipboard.writeText(agent.agentAccountId!).then(() => {
                      addToast('Address copied!', 'success')
                    })
                  }}
                  role="button"
                  tabIndex={0}
                  title="Click to copy"
                >
                  {agent.agentAccountId}
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                    <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                  </svg>
                </span>
              )}
              <span className="fm-balance">
                {balanceLoading ? '...' : balances[agent.id] != null ? `${balances[agent.id]} HBAR` : '--'}
              </span>
            </div>
          </div>
          <button className="fm-close" onClick={onClose} type="button" aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Agent picker — switch between fundable agents */}
        {fundableAgents.length > 1 && onSelectAgent && (
          <div className="fm-agent-picker">
            {fundableAgents.map((a) => {
              const url = getSpriteSheet(agentNameToSpriteType(a.name))
              const isCurrent = a.id === agent.id
              return (
                <button
                  key={a.id}
                  className={`fm-agent-chip ${isCurrent ? 'is-current' : ''}`}
                  onClick={() => {
                    if (!isCurrent) {
                      onSelectAgent(a.id)
                      setResult(null)
                    }
                  }}
                  type="button"
                  title={a.name}
                >
                  {url ? (
                    <div
                      className="pixel-sprite"
                      style={{
                        backgroundImage: `url(${url})`,
                        width: 22,
                        height: 22,
                        margin: 0,
                        backgroundSize: '100% 100%',
                      }}
                    />
                  ) : (
                    <span className="fm-agent-glyph">{a.glyph}</span>
                  )}
                  <span className="fm-agent-chip-name">
                    {a.name.split(' ')[0]}
                    {balances[a.id] != null && (
                      <span className="fm-agent-chip-bal">{balances[a.id]} ℏ</span>
                    )}
                  </span>
                </button>
              )
            })}
          </div>
        )}

        {/* Preset amounts */}
        <div className="fm-presets">
          {PRESETS.map((amt) => (
            <button
              key={amt}
              className={`fm-preset ${!isCustom && selectedAmount === amt ? 'is-active' : ''}`}
              onClick={() => { setSelectedAmount(amt); setIsCustom(false) }}
              type="button"
              disabled={funding}
            >
              {amt} ℏ
            </button>
          ))}
          <button
            className={`fm-preset ${isCustom ? 'is-active' : ''}`}
            onClick={() => setIsCustom(true)}
            type="button"
            disabled={funding}
          >
            Custom
          </button>
        </div>

        {/* Custom input */}
        {isCustom && (
          <div className="fm-custom">
            <input
              type="number"
              className="fm-custom-input"
              placeholder="Enter HBAR amount"
              value={customAmount}
              onChange={(e) => setCustomAmount(e.target.value)}
              min="0.01"
              step="0.1"
              autoFocus
              disabled={funding}
            />
          </div>
        )}

        {/* Result message */}
        {result && (
          <div className={`fm-result ${result.type}`}>
            {result.type === 'success' && (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
            {result.message}
          </div>
        )}

        {/* Action */}
        <div className="fm-actions">
          {isConnected ? (
            <button
              className="fm-fund-btn"
              onClick={() => void handleFund()}
              disabled={funding || effectiveAmount <= 0}
              type="button"
            >
              {funding ? 'Sign in HashPack...' : `Fund ${effectiveAmount || 0} HBAR`}
              {!funding && (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              )}
            </button>
          ) : (
            <button
              className="fm-connect-btn"
              onClick={() => void connectWallet()}
              disabled={wallet.status === 'connecting'}
              type="button"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="2" y="4" width="20" height="16" rx="2" />
                <path d="M22 10H18a2 2 0 000 4h4" />
              </svg>
              {wallet.status === 'connecting' ? 'Connecting...' : 'Connect Wallet to Fund'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
