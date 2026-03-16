import { Component, useCallback, useEffect, useState } from 'react'
import type { ReactNode, ErrorInfo } from 'react'
import { playDeploy, playSuccess, playError } from './lib/sounds'
import './animations.css'
import './App.css'

import type {
  CapabilityGroupId,
  ResultDrawerState,
  DeployResponse,
  AgentMutationResponse,
  ToolWorkflow,
} from './types'
import { templates } from './data'
import { requestJson, summarizeResultReferences, resolveWorkflowValue } from './utils'

import { useLiveData } from './hooks/useLiveData'
import { useToolCatalog } from './hooks/useToolCatalog'
import { WalletProvider, useWalletContext } from './contexts/WalletContext'
import { useToast } from './hooks/useToast'

import Landing from './components/Landing'
import TopBar from './components/TopBar'
import PhaserOffice, { type CoordTrigger } from './phaser/PhaserOffice'
import AgentPanel from './components/AgentPanel'
import DeployModal from './components/DeployModal'
import ToolLibrary from './components/ToolLibrary'
import ResultDrawer from './components/ResultDrawer'
import OnboardingTour from './components/OnboardingTour'
import DemoCoach from './components/DemoCoach'
import Dashboard from './components/Dashboard'
import FundModal from './components/FundModal'
import AboutModal from './components/AboutModal'
import { ToastProvider } from './components/Toast'

// ─── Error Boundary ────────────────────────────
class ErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: ReactNode }) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[Aivy] Render crash:', error, info.componentStack)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', minHeight: '100vh', padding: '2rem',
          background: '#0f172a', color: '#e2e8f0', fontFamily: 'Inter, system-ui, sans-serif',
          textAlign: 'center',
        }}>
          <h1 style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>Something went wrong</h1>
          <p style={{ color: '#94a3b8', marginBottom: '1.5rem', maxWidth: '420px' }}>
            {this.state.error?.message || 'An unexpected error occurred.'}
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              padding: '0.6rem 1.5rem', borderRadius: '8px', border: 'none',
              background: '#6366f1', color: '#fff', cursor: 'pointer', fontSize: '0.95rem',
            }}
          >
            Reload Aivy
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

function App() {
  // ─── View State ───────────────────────────────
  const [view, setView] = useState<'landing' | 'office' | 'dashboard'>('landing')
  const [selectedAgentId, setSelectedAgentId] = useState('')
  const [deployModalOpen, setDeployModalOpen] = useState(false)
  const [fundModalAgentId, setFundModalAgentId] = useState('')
  const [deployTemplateId, setDeployTemplateId] = useState(templates[0].id)
  const [toolModalOpen, setToolModalOpen] = useState(false)
  const [toolInitialName, setToolInitialName] = useState<string | undefined>()
  const [toolInitialParams, setToolInitialParams] = useState<Record<string, unknown> | undefined>()
  const [resultDrawer, setResultDrawer] = useState<ResultDrawerState | null>(null)
  const [isMutating, setIsMutating] = useState(false)
  const [isDeploying, setIsDeploying] = useState(false)
  const [deployingStatus, setDeployingStatus] = useState('')
  const [deployError, setDeployError] = useState('')
  const [lastChatMessages, setLastChatMessages] = useState<Record<string, string>>({})
  const [activeAgentIds, setActiveAgentIds] = useState<Set<string>>(new Set())
  const [showOnboarding, setShowOnboarding] = useState(
    () => !localStorage.getItem('aivy-onboarded'),
  )
  const [demoCoachActive, setDemoCoachActive] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [theme, setTheme] = useState<'dark' | 'light'>(() =>
    (localStorage.getItem('aivy-theme') as 'dark' | 'light') ?? 'dark',
  )

  // ─── Theme ──────────────────────────────────────
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('aivy-theme', theme)
  }, [theme])

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))
  }, [])

  // ─── Hooks ────────────────────────────────────
  const live = useLiveData()
  const toolCatalog = useToolCatalog()
  const { wallet, connectWallet, disconnectWallet, sessionAccountId, logout, authError, authVersion, balanceVersion, invalidateBalances } = useWalletContext()

  // Derive user account ID from connected wallet or persisted session
  const userAccountId = wallet.status === 'connected' ? wallet.accountId : sessionAccountId

  // Refresh agents after auth token changes (e.g. wallet login replaces demo guest token)
  useEffect(() => {
    if (authVersion > 0) void live.refreshLive()
  }, [authVersion]) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Derived State ────────────────────────────
  const selectedAgent = live.agents.find((a) => a.id === selectedAgentId) ?? null
  const fundAgent = live.agents.find((a) => a.id === fundModalAgentId) ?? null

  // ─── Deploy Handler ───────────────────────────
  const handleDeploy = useCallback(async (payload: {
    templateId: string
    name: string
    room: string
    guardrail: string
    vaultProtected: boolean
    vaultCapHbar: number
    launchNote: string
    capabilityGroups: CapabilityGroupId[]
    walletType: 'platform' | 'dedicated'
    initialFundingHbar?: number
    fundingSource?: 'platform' | 'wallet'
    coordinationPartners?: string[]
  }) => {
    setIsDeploying(true)
    setDeployingStatus('Creating agent on Hedera...')
    try {
      const { coordinationPartners, fundingSource, ...deployPayload } = payload
      const result = await requestJson<DeployResponse>('/api/deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...deployPayload, fundingSource }),
      })

      // If user chose wallet funding, sign the transfer via HashPack
      let walletFunded = false
      if (fundingSource === 'wallet' && payload.initialFundingHbar && result.deployment.agentAccountId) {
        setDeployingStatus('⏳ Sign the transfer in HashPack to fund your agent...')
        try {
          const { fundAgentAccount } = await import('./lib/hederaWallet')
          const { transactionId } = await fundAgentAccount(result.deployment.agentAccountId, payload.initialFundingHbar)

          setDeployingStatus('Recording funding...')
          await requestJson(`/api/agents/${result.deployment.id}/fund`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              amountHbar: payload.initialFundingHbar,
              txId: transactionId,
              funderAccountId: wallet.status === 'connected' ? wallet.accountId : 'unknown',
            }),
          })
          walletFunded = true
        } catch (fundError) {
          const msg = fundError instanceof Error ? fundError.message : 'Unknown error'
          if (msg.includes('not connected') || msg.includes('No connected account') || msg.includes('USER_REJECTED')) {
            alert('Wallet funding cancelled. Your agent was created but not funded.\n\nYou can fund it from the agent\'s Info tab.')
          } else {
            alert(`Agent created but funding failed: ${msg}\n\nYou can fund it from the agent's Info tab.`)
          }
        }
      }

      // Send coordination introductions to selected partners
      if (coordinationPartners?.length) {
        for (const partnerId of coordinationPartners) {
          void requestJson(`/api/agents/${result.deployment.id}/coordinate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              targetAgentId: partnerId,
              message: `Hello! I'm ${payload.name}, a newly deployed agent. I've been linked to coordinate with you.`,
            }),
          }).catch(() => { /* coordination greeting failed — non-critical */ })
        }
      }

      const template = templates.find((t) => t.id === payload.templateId)
      setSelectedAgentId(result.deployment.id)
      setDeployModalOpen(false)

      const fundingNote = fundingSource === 'wallet'
        ? walletFunded
          ? ` Funded with ${payload.initialFundingHbar} ℏ from your wallet.`
          : ' Agent created — fund it from the Info tab.'
        : ' Funded with 5 ℏ from the platform.'

      setResultDrawer({
        title: `${template?.name ?? 'Agent'} launched`,
        message: `${payload.name} is live with ${payload.capabilityGroups.length} capability bundles.${fundingNote}${coordinationPartners?.length ? ` Linked to ${coordinationPartners.length} partner${coordinationPartners.length > 1 ? 's' : ''}.` : ''} ${summarizeResultReferences(result.references)}`,
        references: result.references,
      })
      playDeploy()
      await live.refreshLive()
    } catch (error) {
      playError()
      setDeployError(error instanceof Error ? error.message : 'Deployment failed. Is the backend running?')
    } finally {
      setIsDeploying(false)
      setDeployingStatus('')
    }
  }, [live, wallet])

  // ─── Agent Actions ────────────────────────────
  const runSelectedAgent = useCallback(async () => {
    if (!selectedAgent) return
    setIsMutating(true)
    try {
      const result = await requestJson<AgentMutationResponse>(
        `/api/agents/${selectedAgent.id}/run`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'vault approved execution',
            amountHbar: 12,
            targetAccountId: live.operatorAccountId ?? '0.0.0',
          }),
        },
      )
      setResultDrawer({
        title: 'Recommended action complete',
        message: `${result.result.humanMessage ?? `${selectedAgent.name} completed its recommended action.`} ${summarizeResultReferences(result.references)}`,
        references: result.references,
      })
      playSuccess()
      await live.refreshLive()
    } catch (error) {
      playError()
      live.setServerMessage(error instanceof Error ? error.message : 'Execution failed.')
    } finally {
      setIsMutating(false)
    }
  }, [selectedAgent, live])

  const toggleSelectedAgent = useCallback(async () => {
    if (!selectedAgent) return
    setIsMutating(true)
    try {
      const result = await requestJson<AgentMutationResponse>(
        `/api/agents/${selectedAgent.id}/pause`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ paused: selectedAgent.status !== 'paused' }),
        },
      )
      setResultDrawer({
        title: selectedAgent.status === 'paused' ? 'Agent resumed' : 'Agent paused',
        message: `${result.result.humanMessage ?? `${selectedAgent.name} ${selectedAgent.status === 'paused' ? 'resumed' : 'paused'}.`} ${summarizeResultReferences(result.references)}`,
        references: result.references,
      })
      await live.refreshLive()
    } catch (error) {
      live.setServerMessage(error instanceof Error ? error.message : 'Update failed.')
    } finally {
      setIsMutating(false)
    }
  }, [selectedAgent, live])

  const removeSelectedAgent = useCallback(async () => {
    if (!selectedAgent) return
    setIsMutating(true)
    try {
      const result = await requestJson<{ ok: boolean; refundedHbar?: number; refundTxId?: string | null }>(
        `/api/agents/${selectedAgent.id}`,
        { method: 'DELETE' },
      )
      const refundMsg = result.refundedHbar && result.refundedHbar > 0
        ? ` ${result.refundedHbar} HBAR refunded to your wallet.`
        : ''
      setResultDrawer({
        title: 'Agent destroyed',
        message: `${selectedAgent.name} was permanently removed.${refundMsg}`,
        references: result.refundTxId ? [{ type: 'transaction' as const, value: result.refundTxId, mirrorUrl: `https://hashscan.io/testnet/transaction/${result.refundTxId}` }] : [],
      })
      setSelectedAgentId('')
      await live.refreshLive()
    } catch (error) {
      live.setServerMessage(error instanceof Error ? error.message : 'Destroy failed.')
    } finally {
      setIsMutating(false)
    }
  }, [selectedAgent, live])

  // ─── Tool Library Handlers ────────────────────
  const openToolLibrary = useCallback((toolName?: string, params?: Record<string, unknown>) => {
    setToolInitialName(toolName)
    setToolInitialParams(params)
    setToolModalOpen(true)
  }, [])

  const handleRunWorkflow = useCallback((workflow: ToolWorkflow) => {
    if (!selectedAgent) return
    const resolved = resolveWorkflowValue(workflow.params, {
      operatorAccountId: live.operatorAccountId,
      selectedAgent,
    }) as Record<string, unknown>
    openToolLibrary(workflow.toolName, resolved)
  }, [selectedAgent, live.operatorAccountId, openToolLibrary])

  // ─── Chat Reply Handler ─────────────────────────
  const [coordTrigger, setCoordTrigger] = useState<CoordTrigger>(null)

  const ADJACENT_ROOMS: Record<string, string[]> = {
    'Launch Bay': ['Strategy Pit', 'Forum Deck'],
    'Strategy Pit': ['Launch Bay', 'War Room'],
    'Forum Deck': ['Launch Bay', 'War Room'],
    'War Room': ['Strategy Pit', 'Forum Deck'],
  }

  const handleAgentReply = useCallback((agentId: string, message: string) => {
    setLastChatMessages((prev) => ({ ...prev, [agentId]: message }))

    // Fire a real coordination animation from the replying agent to an adjacent neighbor
    const agent = live.agents.find((a) => a.id === agentId)
    if (!agent) return

    const adjRooms = ADJACENT_ROOMS[agent.room] ?? []
    const candidates = live.agents.filter((a) => a.id !== agentId && adjRooms.includes(a.room))
    if (candidates.length === 0) return

    const target = candidates[Math.floor(Math.random() * candidates.length)]
    const truncated = message.length > 35 ? message.slice(0, 35) + '...' : message

    setCoordTrigger({
      srcId: agent.id,
      tgtId: target.id,
      action: 'cross_room_relay',
      label: `${agent.name}: ${truncated}`,
    })
  }, [live.agents])

  // ─── Keyboard Shortcuts ──────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

      if (e.key === 'Escape') {
        if (fundModalAgentId) { setFundModalAgentId(''); return }
        if (resultDrawer) { setResultDrawer(null); return }
        if (toolModalOpen) { setToolModalOpen(false); return }
        if (deployModalOpen) { setDeployModalOpen(false); return }
        if (selectedAgentId) { setSelectedAgentId(''); return }
      }

      if (e.key === 'd' || e.key === 'D') {
        if (!deployModalOpen && view === 'office') {
          setDeployTemplateId(templates[0].id)
          setDeployError('')
          setDeployModalOpen(true)
        }
        return
      }

      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        if (live.agents.length === 0) return
        const idx = live.agents.findIndex((a) => a.id === selectedAgentId)
        const next = idx < 0 ? 0 : (idx + 1) % live.agents.length
        setSelectedAgentId(live.agents[next].id)
        return
      }

      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        if (live.agents.length === 0) return
        const idx = live.agents.findIndex((a) => a.id === selectedAgentId)
        const prev = idx <= 0 ? live.agents.length - 1 : idx - 1
        setSelectedAgentId(live.agents[prev].id)
        return
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [view, selectedAgentId, deployModalOpen, toolModalOpen, resultDrawer, fundModalAgentId, live.agents])

  // ─── Agent Activity Tracking (for overlay animation) ──
  const markAgentActive = useCallback((agentId: string) => {
    setActiveAgentIds((prev) => new Set(prev).add(agentId))
    // Auto-clear after 3 seconds
    setTimeout(() => {
      setActiveAgentIds((prev) => {
        const next = new Set(prev)
        next.delete(agentId)
        return next
      })
    }, 3000)
  }, [])

  // ─── Demo Seed Handler ──────────────────────────
  const handleTryDemo = useCallback(async () => {
    try {
      // Disconnect wallet and clear session so demo starts fresh
      if (wallet.status === 'connected') await disconnectWallet()
      const { clearToken } = await import('./lib/auth')
      clearToken()
      const result = await requestJson<{ seeded: number; token?: string }>('/api/demo/seed', { method: 'POST' })
      // Store guest token so subsequent API calls are authenticated
      if (result.token) {
        const { setToken } = await import('./lib/auth')
        setToken(result.token)
      }
      await live.refreshLive()
      setShowOnboarding(false)
      setSelectedAgentId('')
      setView('office')
      setDemoCoachActive(true)
    } catch {
      live.setServerMessage('Could not start demo. Make sure the backend server is running.')
    }
  }, [live, wallet.status, disconnectWallet])

  // ─── Landing View ─────────────────────────────
  if (view === 'landing') {
    return (
      <>
        <Landing onEnter={() => setView('office')} onTryDemo={handleTryDemo} onAbout={() => setAboutOpen(true)} />
        <AboutModal open={aboutOpen} onClose={() => setAboutOpen(false)} />
      </>
    )
  }

  // ─── Office View ──────────────────────────────
  return (
    <ToastProvider>
    <AuthErrorNotifier authError={authError} />
    <div className="app-v2">
      <TopBar
        networkLabel={live.networkLabel}
        operatorAccountId={live.operatorAccountId}
        theme={theme}
        onToggleTheme={toggleTheme}
        activeView={view === 'dashboard' ? 'dashboard' : 'office'}
        onChangeView={(v) => setView(v)}
        onGoHome={() => setView('landing')}
        onAbout={() => setAboutOpen(true)}
        demoMode={live.demoMode}
      />

      {live.isOffline && (
        <div className="offline-banner">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          Backend server is offline. Retrying automatically&hellip;
          <button className="offline-retry-btn" onClick={() => void live.refreshLive()} type="button">
            Retry Now
          </button>
        </div>
      )}

      <main className="office-main">
        {view === 'dashboard' ? (
          <Dashboard />
        ) : (
          <PhaserOffice
            agents={live.agents}
            stats={live.stats}
            events={live.events}
            coordinations={live.coordinations}
            selectedAgentId={selectedAgentId}
            lastChatMessages={lastChatMessages}
            activeAgentIds={activeAgentIds}
            coordTrigger={coordTrigger}
            userAccountId={userAccountId}
            mirrorNodeUrl={live.mirrorNodeUrl}
            onSelectAgent={setSelectedAgentId}
            onDeploy={(templateId) => {
              setDeployTemplateId(templateId)
              setDeployError('')
              setDeployModalOpen(true)
            }}
            onFundAgent={setFundModalAgentId}
            onAgentReply={handleAgentReply}
            onRefresh={live.refreshLive}
          />
        )}
      </main>

      {/* ─── Agent Detail Panel ──────────────── */}
      {selectedAgent && (
        <AgentPanel
          agent={selectedAgent}
          catalog={toolCatalog.catalog}
          userAccountId={userAccountId}
          isMutating={isMutating}
          chatEnabled={live.chatEnabled}
          events={live.events}
          allAgents={live.agents}
          onClose={() => setSelectedAgentId('')}
          onRunAgent={runSelectedAgent}
          onToggleAgent={toggleSelectedAgent}
          onRemoveAgent={removeSelectedAgent}
          onOpenToolLibrary={openToolLibrary}
          onRunWorkflow={handleRunWorkflow}
          onAgentReply={handleAgentReply}
          onRefresh={live.refreshLive}
          onMarkActive={markAgentActive}
          onFund={selectedAgent.walletType === 'dedicated' && selectedAgent.agentAccountId
            ? () => setFundModalAgentId(selectedAgent.id)
            : undefined}
        />
      )}

      {/* ─── Deploy Modal ────────────────────── */}
      {deployModalOpen && (
        <DeployModal
          templateId={deployTemplateId}
          catalog={toolCatalog.catalog}
          isDeploying={isDeploying}
          deployingStatus={deployingStatus}
          existingNames={live.agents.map((a) => a.name)}
          existingAgents={live.agents}
          operatorAccountId={live.operatorAccountId}
          mirrorNodeUrl={live.mirrorNodeUrl}
          deployError={deployError}
          onDeploy={handleDeploy}
          onClose={() => setDeployModalOpen(false)}
        />
      )}

      {/* ─── Quick Fund Modal ──────────────────── */}
      {fundAgent && fundAgent.walletType === 'dedicated' && fundAgent.agentAccountId && (
        <FundModal
          agent={fundAgent}
          allAgents={live.agents}
          onSelectAgent={setFundModalAgentId}
          mirrorNodeUrl={live.mirrorNodeUrl}
          onClose={() => setFundModalAgentId('')}
          onSuccess={() => { live.refreshLive(); invalidateBalances() }}
        />
      )}

      {/* ─── Tool Library Modal ──────────────── */}
      {toolModalOpen && selectedAgent && toolCatalog.catalog && (
        <ToolLibrary
          agent={selectedAgent}
          catalog={toolCatalog.catalog}
          operatorAccountId={live.operatorAccountId}
          onClose={() => setToolModalOpen(false)}
          onResult={setResultDrawer}
          onRefresh={live.refreshLive}
          initialToolName={toolInitialName}
          initialParams={toolInitialParams}
        />
      )}

      {/* ─── Result Drawer ───────────────────── */}
      {resultDrawer && (
        <ResultDrawer
          drawer={resultDrawer}
          onClose={() => setResultDrawer(null)}
        />
      )}

      {/* ─── Onboarding Tour ───────────────────── */}
      {showOnboarding && !demoCoachActive && (
        <OnboardingTour onComplete={() => setShowOnboarding(false)} />
      )}

      {/* ─── Demo Coach (guided tutorial) ────────── */}
      {demoCoachActive && (
        <DemoCoach
          selectedAgentId={selectedAgentId}
          deployModalOpen={deployModalOpen}
          lastChatMessages={lastChatMessages}
          onDismiss={() => setDemoCoachActive(false)}
        />
      )}

      {/* ─── About Modal ────────────────────────── */}
      <AboutModal open={aboutOpen} onClose={() => setAboutOpen(false)} />
    </div>
    </ToastProvider>
  )
}

/** Surfaces wallet auth errors as toasts (must be inside ToastProvider) */
function AuthErrorNotifier({ authError }: { authError: string | null }) {
  const { addToast } = useToast()
  useEffect(() => {
    if (authError) addToast(authError, 'error')
  }, [authError, addToast])
  return null
}

function AppWithBoundary() {
  return (
    <ErrorBoundary>
      <WalletProvider>
        <App />
      </WalletProvider>
    </ErrorBoundary>
  )
}

export default AppWithBoundary
