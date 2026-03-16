import { useState, useMemo } from 'react'
import type { WalletState } from '../types'
import {
  connectHederaWallet,
  disconnectHederaWallet,
  isWalletConnectConfigured,
} from '../lib/hederaWallet'
import { setToken, clearToken, getSessionAccountId } from '../lib/auth'

export { isWalletConnectConfigured }

async function authenticateWithServer(
  accountId: string,
  onAuthError?: (msg: string) => void,
): Promise<boolean> {
  try {
    const challengeResp = await fetch('/api/auth/challenge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId }),
    })
    if (!challengeResp.ok) {
      onAuthError?.('Server authentication failed (challenge step)')
      return false
    }

    const verifyResp = await fetch('/api/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId }),
    })
    if (!verifyResp.ok) {
      onAuthError?.('Server authentication failed (verify step)')
      return false
    }

    const { token } = (await verifyResp.json()) as { token: string }
    setToken(token)
    return true
  } catch {
    onAuthError?.('Server authentication failed — check connection')
    return false
  }
}

export function useWallet() {
  const [wallet, setWallet] = useState<WalletState>({ status: 'idle' })
  const [authError, setAuthError] = useState<string | null>(null)

  const connectWallet = async () => {
    if (!isWalletConnectConfigured) {
      setWallet({
        status: 'error',
        error: 'Set VITE_WALLETCONNECT_PROJECT_ID to enable wallet connection.',
      })
      return
    }

    setWallet({ status: 'connecting' })
    setAuthError(null)
    try {
      const session = await connectHederaWallet()
      setWallet({ status: 'connected', ...session })

      // Authenticate with backend after wallet connects (with retry)
      const ok = await authenticateWithServer(session.accountId, setAuthError)
      if (!ok) {
        // Retry once after a short delay
        await new Promise((r) => setTimeout(r, 1500))
        await authenticateWithServer(session.accountId, setAuthError)
      }
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

  return { wallet, connectWallet, disconnectWallet, sessionAccountId, logout, authError }
}
