import { createContext, useContext, useState, useCallback, useRef, type ReactNode } from 'react'
import type { WalletState } from '../types'
import { useWallet } from '../hooks/useWallet'

type WalletContextValue = {
  wallet: WalletState
  connectWallet: () => Promise<void>
  disconnectWallet: () => Promise<void>
  sessionAccountId: string | null
  logout: () => void
  balanceVersion: number
  invalidateBalances: () => void
  /** Pre-fetched agent balances (agentAccountId → HBAR amount) */
  agentBalances: Map<string, number>
  /** Batch-fetch balances for all given account IDs from Mirror Node */
  fetchAgentBalances: (accountIds: string[], mirrorNodeUrl: string) => void
}

const WalletContext = createContext<WalletContextValue | null>(null)

export function WalletProvider({ children }: { children: ReactNode }) {
  const { wallet, connectWallet, disconnectWallet, sessionAccountId, logout } = useWallet()
  const [balanceVersion, setBalanceVersion] = useState(0)
  const [agentBalances, setAgentBalances] = useState<Map<string, number>>(() => new Map())
  const fetchingRef = useRef(false)

  const invalidateBalances = useCallback(() => {
    setBalanceVersion((v) => v + 1)
    setAgentBalances(new Map())
    fetchingRef.current = false
  }, [])

  const fetchAgentBalances = useCallback((accountIds: string[], mirrorNodeUrl: string) => {
    if (fetchingRef.current || accountIds.length === 0 || !mirrorNodeUrl) return
    fetchingRef.current = true
    const base = mirrorNodeUrl.replace(/\/api\/v1\/?$/, '')

    // Fetch all balances in parallel
    Promise.all(
      accountIds.map((id) =>
        fetch(`${base}/api/v1/balances?account.id=${id}&limit=1`, {
          signal: AbortSignal.timeout(8_000),
        })
          .then((r) => r.json())
          .then((data: { balances?: Array<{ balance: number }> }) => {
            const bal = data.balances?.[0]?.balance
            if (typeof bal === 'number') return [id, Math.round((bal / 1e8) * 100) / 100] as const
            return null
          })
          .catch(() => null),
      ),
    ).then((results) => {
      const map = new Map<string, number>()
      for (const r of results) {
        if (r) map.set(r[0], r[1])
      }
      setAgentBalances(map)
      fetchingRef.current = false // allow next poll
    })
  }, [])

  return (
    <WalletContext.Provider
      value={{
        wallet,
        connectWallet,
        disconnectWallet,
        sessionAccountId,
        logout,
        balanceVersion,
        invalidateBalances,
        agentBalances,
        fetchAgentBalances,
      }}
    >
      {children}
    </WalletContext.Provider>
  )
}

export function useWalletContext(): WalletContextValue {
  const ctx = useContext(WalletContext)
  if (!ctx) throw new Error('useWalletContext must be used within WalletProvider')
  return ctx
}
