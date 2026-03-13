import { useState, useMemo } from 'react'
import type { WalletState } from '../types'
import {
  connectHederaWallet,
  disconnectHederaWallet,
  isWalletConnectConfigured,
} from '../lib/hederaWallet'
import { setToken, clearToken, getSessionAccountId } from '../lib/auth'

export { isWalletConnectConfigured }

async function authenticateWithServer(accountId: string): Promise<void> {
  try {
    // Step 1: Request challenge
    const challengeResp = await fetch('/api/auth/challenge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId }),
    })
    if (!challengeResp.ok) return

    // Step 2: Verify with server (simplified - server verifies account exists on Hedera)
    const verifyResp = await fetch('/api/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId }),
    })
    if (!verifyResp.ok) return

    const { token } = (await verifyResp.json()) as { token: string }
    setToken(token)
  } catch {
    // Auth failure is non-critical - app still works without it
    console.warn('[Aivy] Server authentication failed, continuing without auth.')
  }
}

export function useWallet() {
  const [wallet, setWallet] = useState<WalletState>({ status: 'idle' })

  const connectWallet = async () => {
    if (!isWalletConnectConfigured) {
      setWallet({
        status: 'error',
        error: 'Set VITE_WALLETCONNECT_PROJECT_ID to enable wallet connection.',
      })
      return
    }

    setWallet({ status: 'connecting' })
    try {
      const session = await connectHederaWallet()
      setWallet({ status: 'connected', ...session })

      // Authenticate with backend after wallet connects
      void authenticateWithServer(session.accountId)
    } catch (error) {
      setWallet({
        status: 'error',
        error: error instanceof Error ? error.message : 'Wallet connection failed.',
      })
    }
  }

  const disconnectWallet = async () => {
    if (wallet.status !== 'connected') {
      return
    }

    try {
      await disconnectHederaWallet()
      clearToken()
      setWallet({ status: 'idle' })
    } catch (error) {
      setWallet({
        status: 'error',
        error: error instanceof Error ? error.message : 'Wallet disconnect failed.',
      })
    }
  }

  /** Account ID from a persisted JWT session (survives page refresh) */
  const sessionAccountId = useMemo(() => {
    if (wallet.status === 'connected') return wallet.accountId
    return getSessionAccountId()
  }, [wallet])

  /** Log out: clear JWT token without needing HashConnect */
  const logout = () => {
    clearToken()
    setWallet({ status: 'idle' })
    window.location.reload()
  }

  return { wallet, connectWallet, disconnectWallet, sessionAccountId, logout }
}
