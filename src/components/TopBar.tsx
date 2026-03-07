import type { WalletState } from '../types'
import { isWalletConnectConfigured } from '../hooks/useWallet'
import './TopBar.css'

type TopBarProps = {
  networkLabel: string
  operatorAccountId: string | null
  wallet: WalletState
  onConnectWallet: () => void
  onDisconnectWallet: () => void
  theme: 'dark' | 'light'
  onToggleTheme: () => void
  activeView: 'office' | 'dashboard'
  onChangeView: (view: 'office' | 'dashboard') => void
  demoMode?: boolean
}

export default function TopBar({
  networkLabel,
  operatorAccountId,
  wallet,
  onConnectWallet,
  onDisconnectWallet,
  theme,
  onToggleTheme,
  activeView,
  onChangeView,
  demoMode,
}: TopBarProps) {
  const isConnected = wallet.status === 'connected'

  return (
    <header className="topbar-v2">
      <div className="topbar-left">
        <div className="topbar-brand">A</div>
        <span className="topbar-name">Aivy</span>
      </div>

      <div className="topbar-center">
        <div className="view-toggle">
          <button
            className={`view-toggle-btn ${activeView === 'office' ? 'is-active' : ''}`}
            onClick={() => onChangeView('office')}
            type="button"
            title="Office view"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="7" height="7" />
              <rect x="14" y="3" width="7" height="7" />
              <rect x="3" y="14" width="7" height="7" />
              <rect x="14" y="14" width="7" height="7" />
            </svg>
            Office
          </button>
          <button
            className={`view-toggle-btn ${activeView === 'dashboard' ? 'is-active' : ''}`}
            onClick={() => onChangeView('dashboard')}
            type="button"
            title="Dashboard view"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 20V10M12 20V4M6 20v-6" />
            </svg>
            Stats
          </button>
        </div>
        <span className="topbar-sep" />
        {demoMode && <span className="demo-badge">DEMO</span>}
        <span className="net-dot" />
        <span className="net-label">{networkLabel}</span>
      </div>

      <div className="topbar-right">
        {/* Theme toggle */}
        <button
          className="theme-toggle"
          onClick={onToggleTheme}
          type="button"
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {theme === 'dark' ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="5" />
              <line x1="12" y1="1" x2="12" y2="3" />
              <line x1="12" y1="21" x2="12" y2="23" />
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
              <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
              <line x1="1" y1="12" x2="3" y2="12" />
              <line x1="21" y1="12" x2="23" y2="12" />
              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
              <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
            </svg>
          )}
        </button>

        {/* Show operator chip only when no user wallet is connected */}
        {!isConnected && operatorAccountId && (
          <span className="operator-chip">
            <span className="chip-label">Operator</span>
            <strong>{operatorAccountId}</strong>
          </span>
        )}

        {/* User wallet section */}
        {isConnected ? (
          <div className="wallet-connected-row">
            <span className="wallet-account-chip">
              <span className="wallet-dot" />
              <strong>{wallet.accountId}</strong>
            </span>
            <button
              className="wallet-disconnect-btn"
              onClick={onDisconnectWallet}
              type="button"
            >
              Disconnect
            </button>
          </div>
        ) : (
          <button
            className="wallet-connect-btn"
            onClick={onConnectWallet}
            type="button"
            disabled={!isWalletConnectConfigured}
          >
            {wallet.status === 'connecting'
              ? 'Connecting...'
              : isWalletConnectConfigured
                ? 'Connect Wallet'
                : 'No Wallet Config'}
          </button>
        )}
      </div>
    </header>
  )
}
