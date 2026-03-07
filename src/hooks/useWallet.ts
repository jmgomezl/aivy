import { useState } from 'react'
import type { WalletState } from '../types'
import {
  connectHederaWallet,
  disconnectHederaWallet,
  isWalletConnectConfigured,
} from '../lib/hederaWallet'

export { isWalletConnectConfigured }

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
      setWallet({ status: 'idle' })
    } catch (error) {
      setWallet({
        status: 'error',
        error: error instanceof Error ? error.message : 'Wallet disconnect failed.',
      })
    }
  }

  return { wallet, connectWallet, disconnectWallet }
}
