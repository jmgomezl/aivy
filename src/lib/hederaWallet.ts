export type WalletSessionInfo = {
  accountId: string
  balance: string
}

type HashConnectModule = typeof import('hashconnect')
type SdkModule = typeof import('@hashgraph/sdk')
type SessionData = import('hashconnect').SessionData

type HashConnectInstance = InstanceType<HashConnectModule['HashConnect']>

type HashConnectState = {
  hashconnect: HashConnectInstance
  sdk: SdkModule
}

export const isWalletConnectConfigured = Boolean(
  import.meta.env.VITE_WALLETCONNECT_PROJECT_ID,
)

const CONNECT_TIMEOUT_MS = 45_000
const POLL_INTERVAL_MS = 1_500

let activeState: HashConnectState | null = null

const createHashConnectState = async (): Promise<HashConnectState> => {
  if (!isWalletConnectConfigured) {
    throw new Error(
      'Set VITE_WALLETCONNECT_PROJECT_ID to enable HashPack connection.',
    )
  }

  const hashconnectModule = await import('hashconnect')
  const sdkModule = await import('@hashgraph/sdk')

  const hashconnect = new hashconnectModule.HashConnect(
    sdkModule.LedgerId.TESTNET,
    import.meta.env.VITE_WALLETCONNECT_PROJECT_ID,
    {
      name: 'Aivy',
      description: 'HashPack connection for Aivy',
      icons: ['https://hedera.com/favicon.ico'],
      url: window.location.origin,
    },
    false,
  )

  return {
    hashconnect,
    sdk: sdkModule,
  }
}

const getHashPackHelpMessage = () => {
  if (
    window.location.protocol === 'https:' ||
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1'
  ) {
    return ' If HashPack still does not appear, reload the extension and retry from the secure app URL.'
  }

  return ' Use the secure HTTPS dev URL, then retry the pairing request.'
}

const resolveWalletSession = async (
  state: HashConnectState,
  sessionAccountId?: string,
): Promise<WalletSessionInfo> => {
  const { hashconnect } = state
  const accountId =
    sessionAccountId ??
    hashconnect.connectedAccountIds[0]?.toString()

  if (!accountId) {
    throw new Error('HashPack connected but no Hedera account was returned.')
  }

  if (sessionAccountId) {
    return {
      accountId,
      balance: 'Balance unavailable',
    }
  }

  try {
    const signer = hashconnect.getSigner(hashconnect.connectedAccountIds[0])
    const balance = await signer.getAccountBalance()

    return {
      accountId: signer.getAccountId().toString(),
      balance: balance.hbars.toString(),
    }
  } catch {
    return {
      accountId,
      balance: 'Balance unavailable',
    }
  }
}

const dismissPairingModal = () => {
  document.querySelector('wcm-modal')?.remove()
}

export const connectHederaWallet = async (): Promise<WalletSessionInfo> => {
  // Fast path: already connected on this instance
  if (activeState?.hashconnect.connectedAccountIds.length) {
    return resolveWalletSession(activeState)
  }

  const state = await createHashConnectState()
  const { hashconnect } = state
  activeState = state

  let cleanup = () => {}

  try {
    // ── Event-based detection (primary) ──────────────────────
    let settled = false
    let resolveOuter: (v: WalletSessionInfo) => void
    let rejectOuter: (e: Error) => void

    const resultPromise = new Promise<WalletSessionInfo>((res, rej) => {
      resolveOuter = res
      rejectOuter = rej
    })

    const settle = (fn: () => void) => {
      if (settled) return
      settled = true
      fn()
    }

    const onPairing = (session: SessionData) => {
      settle(() => {
        void resolveWalletSession(state, session.accountIds[0])
          .then(resolveOuter)
          .catch(rejectOuter)
          .finally(cleanup)
      })
    }

    const onDisconnect = () => {
      settle(() => {
        cleanup()
        rejectOuter(new Error('HashPack disconnected before pairing completed.'))
      })
    }

    const onStatusChange = (status: unknown) => {
      const label = String(status)
      // Only settle when accounts exist — "Connected" fires without accounts during init()
      if ((label === 'Connected' || label === 'Paired') && hashconnect.connectedAccountIds.length > 0) {
        settle(() => {
          void resolveWalletSession(state)
            .then(resolveOuter)
            .catch(rejectOuter)
            .finally(cleanup)
        })
      }
    }

    // ── Polling fallback: check connectedAccountIds on existing instance ─
    const pollInterval = window.setInterval(() => {
      if (settled) return
      if (hashconnect.connectedAccountIds.length > 0) {
        settle(() => {
          void resolveWalletSession(state)
            .then(resolveOuter)
            .catch(rejectOuter)
            .finally(cleanup)
        })
      }
    }, POLL_INTERVAL_MS)

    // ── Timeout ──────────────────────────────────────────────
    const timeoutId = window.setTimeout(() => {
      settle(() => {
        cleanup()
        activeState = null
        rejectOuter(
          new Error(
            `HashPack connection timed out after ${Math.round(
              CONNECT_TIMEOUT_MS / 1000,
            )} seconds. Open HashPack, unlock it, and approve the pairing request.${getHashPackHelpMessage()}`,
          ),
        )
      })
    }, CONNECT_TIMEOUT_MS)

    cleanup = () => {
      window.clearInterval(pollInterval)
      window.clearTimeout(timeoutId)
      hashconnect.pairingEvent.off(onPairing)
      hashconnect.disconnectionEvent.off(onDisconnect)
      hashconnect.connectionStatusChangeEvent.off(onStatusChange)
      dismissPairingModal()
    }

    hashconnect.pairingEvent.on(onPairing)
    hashconnect.disconnectionEvent.on(onDisconnect)
    hashconnect.connectionStatusChangeEvent.on(onStatusChange)

    // ── Init & check for existing session ────────────────────
    await hashconnect.init()

    if (hashconnect.connectedAccountIds.length > 0) {
      settle(() => {
        void resolveWalletSession(state)
          .then(resolveOuter)
          .catch(rejectOuter)
          .finally(cleanup)
      })
      return resultPromise
    }

    // ── Open pairing modal ───────────────────────────────────
    // HashPack extension auto-detects the WC relay — no need for a separate
    // connectToExtension() call which causes duplicate pairing dialogs.
    if (!settled) {
      void hashconnect.openPairingModal(
        'dark', '#08111d', '#61d6bf', '#f3c35f', '18px',
      )
    }

    return resultPromise
  } catch (error) {
    cleanup()
    activeState = null
    throw error
  }
}

export const fundAgentAccount = async (
  agentAccountId: string,
  amountHbar: number,
): Promise<{ transactionId: string }> => {
  if (!activeState) {
    throw new Error('Wallet not connected. Connect HashPack first.')
  }

  const { hashconnect, sdk } = activeState
  const connectedId = hashconnect.connectedAccountIds[0]
  if (!connectedId) {
    throw new Error('No connected account found. Reconnect your wallet.')
  }

  const signer = hashconnect.getSigner(connectedId)

  const tx = await new sdk.TransferTransaction()
    .addHbarTransfer(signer.getAccountId(), new sdk.Hbar(-amountHbar))
    .addHbarTransfer(sdk.AccountId.fromString(agentAccountId), new sdk.Hbar(amountHbar))
    .freezeWithSigner(signer)

  const signedTx = await tx.executeWithSigner(signer)

  return {
    transactionId: signedTx.transactionId?.toString() ?? 'unknown',
  }
}

export const disconnectHederaWallet = async () => {
  if (!activeState) {
    return
  }

  await activeState.hashconnect.disconnect()
  activeState = null
}
