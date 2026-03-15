import { isWalletConnectConfigured } from '../hooks/useWallet'
import { useWalletContext } from '../contexts/WalletContext'
import './TopBar.css'

type TopBarProps = {
  networkLabel: string
  operatorAccountId: string | null
  theme: 'dark' | 'light'
  onToggleTheme: () => void
  activeView: 'office' | 'dashboard'
  onChangeView: (view: 'office' | 'dashboard') => void
  onGoHome: () => void
  demoMode?: boolean
}

export default function TopBar({
  networkLabel,
  operatorAccountId,
  theme,
  onToggleTheme,
  activeView,
  onChangeView,
  onGoHome,
  demoMode,
}: TopBarProps) {
  const { wallet, connectWallet, disconnectWallet, sessionAccountId, logout } = useWalletContext()
  const isConnected = wallet.status === 'connected'

  return (
    <header className="topbar-v2">
      <button className="topbar-home" onClick={onGoHome} type="button" title="Back to home">
        <img className="topbar-brand-logo" src="/logo-192.png" alt="Aivy" />
        <span className="topbar-name">Aivy</span>
      </button>

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

        {/* Show operator chip only when no user is logged in */}
        {!isConnected && !sessionAccountId && operatorAccountId && (
          <span className="operator-chip">
            <span className="chip-label">Operator</span>
            <strong>{operatorAccountId}</strong>
          </span>
        )}

        {/* User wallet section — 3 states: wallet connected, session active, or not logged in */}
        {isConnected ? (
          <div className="wallet-connected-row">
            <span className="wallet-account-chip">
              <span className="wallet-dot" />
              <strong>{wallet.accountId}</strong>
            </span>
            <button
              className="wallet-disconnect-btn"
              onClick={() => void disconnectWallet()}
              type="button"
            >
              Disconnect
            </button>
          </div>
        ) : sessionAccountId ? (
          <div className="wallet-connected-row">
            <span className="wallet-session-chip">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
              <strong>{sessionAccountId}</strong>
            </span>
            <button
              className="wallet-connect-btn wallet-connect-btn--small"
              onClick={() => void connectWallet()}
              type="button"
              title="Reconnect wallet for signing transactions"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="2" y="4" width="20" height="16" rx="2" />
                <path d="M22 10H18a2 2 0 000 4h4" />
              </svg>
            </button>
            <button
              className="wallet-disconnect-btn"
              onClick={logout}
              type="button"
            >
              Log out
            </button>
          </div>
        ) : (
          <button
            className="wallet-connect-btn"
            onClick={() => void connectWallet()}
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
