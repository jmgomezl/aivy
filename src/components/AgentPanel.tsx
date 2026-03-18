import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { LiveAgent, ToolCatalogResponse, ToolCatalogEntry, ToolWorkflow, ToolCatalogGroup, ActivityEvent, AgentSpendingResponse, JobRecord } from '../types'
import { statusMeta, toneClass, templates } from '../data'
import { requestJson } from '../utils'
import { getAuthHeaders } from '../lib/auth'
import { useToast } from '../hooks/useToast'
import { useWalletContext } from '../contexts/WalletContext'
import ChatPanel from './ChatPanel'
import ScheduleManager from './ScheduleManager'
import TriggerManager from './TriggerManager'
import type { CapabilityGroupId } from '../types'
import './AgentPanel.css'

const comingSoonGroups = new Set<CapabilityGroupId>(['saucerswap', 'memejob', 'coincap'])

type AgentPanelProps = {
  agent: LiveAgent
  catalog: ToolCatalogResponse | null
  userAccountId: string | null
  isMutating: boolean
  chatEnabled: boolean
  events: ActivityEvent[]
  allAgents: LiveAgent[]
  onClose: () => void
  onRunAgent: () => void
  onToggleAgent: () => void
  onRemoveAgent: () => void
  onOpenToolLibrary: (toolName?: string, params?: Record<string, unknown>) => void
  onRunWorkflow: (workflow: ToolWorkflow) => void
  onAgentReply?: (agentId: string, message: string) => void
  onRefresh?: () => void
  onMarkActive?: (agentId: string) => void
  onFund?: () => void
}

export default function AgentPanel({
  agent,
  catalog,
  userAccountId,
  isMutating,
  chatEnabled,
  events,
  allAgents,
  onClose,
  onRunAgent,
  onToggleAgent,
  onRemoveAgent,
  onOpenToolLibrary,
  onRunWorkflow,
  onAgentReply,
  onRefresh,
  onMarkActive,
  onFund,
}: AgentPanelProps) {
  const { wallet, connectWallet, agentBalances } = useWalletContext()
  const [activeTab, setActiveTab] = useState<'info' | 'chat' | 'history' | 'spending' | 'automation' | 'jobs'>(chatEnabled ? 'chat' : 'info')
  const [isExporting, setIsExporting] = useState(false)
  const [showDestroyConfirm, setShowDestroyConfirm] = useState(false)
  const [coordTarget, setCoordTarget] = useState('')
  const [coordMsg, setCoordMsg] = useState('')
  const [coordSending, setCoordSending] = useState(false)
  const [coordResult, setCoordResult] = useState<string | null>(null)
  const [fundAmount, setFundAmount] = useState('')
  const [fundingInProgress, setFundingInProgress] = useState(false)
  const [fundResult, setFundResult] = useState<string | null>(null)
  const [withdrawAmount, setWithdrawAmount] = useState('')
  const [withdrawInProgress, setWithdrawInProgress] = useState(false)
  const [withdrawResult, setWithdrawResult] = useState<string | null>(null)
  const [spendingData, setSpendingData] = useState<AgentSpendingResponse | null>(null)
  const [spendingLoading, setSpendingLoading] = useState(false)
  const [addressCopied, setAddressCopied] = useState(false)
  const [jobs, setJobs] = useState<JobRecord[]>([])
  const [jobsLoading, setJobsLoading] = useState(false)
  const [jobCreateOpen, setJobCreateOpen] = useState(false)
  const [jobForm, setJobForm] = useState({ providerAgentId: '', description: '', budgetHbar: '5', expiresInMinutes: '1440' })
  const [jobSubmitting, setJobSubmitting] = useState(false)
  const [jobActionLoading, setJobActionLoading] = useState<string | null>(null)
  const { addToast } = useToast()
  const lastSeenEventRef = useRef<string | null>(null)

  // Toast on background automation events
  useEffect(() => {
    if (events.length === 0) return
    // On first render, just record the latest event ID
    if (lastSeenEventRef.current === null) {
      lastSeenEventRef.current = events[0]?.id ?? null
      return
    }
    for (const evt of events) {
      if (evt.id === lastSeenEventRef.current) break
      if (evt.label.includes(agent.name) && (evt.label.includes('(schedule)') || evt.label.includes('(trigger)'))) {
        addToast(evt.label, 'info')
      }
    }
    lastSeenEventRef.current = events[0]?.id ?? null
  }, [events, agent.name, addToast])

  useEffect(() => {
    if (activeTab === 'spending') {
      setSpendingLoading(true)
      requestJson<AgentSpendingResponse>(`/api/agents/${agent.id}/spending`)
        .then(setSpendingData)
        .catch(() => { setSpendingData(null) })
        .finally(() => setSpendingLoading(false))
    }
  }, [agent.id, activeTab])

  const fetchJobs = useCallback(() => {
    setJobsLoading(true)
    requestJson<{ jobs: JobRecord[] }>('/api/jobs')
      .then((res) => {
        const agentJobs = res.jobs.filter(
          (j) => j.clientAgentId === agent.id || j.providerAgentId === agent.id,
        )
        setJobs(agentJobs)
      })
      .catch(() => setJobs([]))
      .finally(() => setJobsLoading(false))
  }, [agent.id])

  useEffect(() => {
    fetchJobs() // Eagerly load for badge count
  }, [fetchJobs])

  useEffect(() => {
    if (activeTab === 'jobs') fetchJobs()
  }, [activeTab, fetchJobs])

  // Read pre-fetched balance from context (populated by PhaserOffice batch-fetch)
  const walletBalance = agent.agentAccountId ? agentBalances.get(agent.agentAccountId) ?? null : null

  const otherAgents = useMemo(
    () => allAgents.filter(a => a.id !== agent.id && a.status !== 'paused'),
    [allAgents, agent.id],
  )

  const handleCoordinate = async () => {
    if (!coordTarget || !coordMsg.trim()) return
    setCoordSending(true)
    setCoordResult(null)
    try {
      const res = await requestJson<{ message: string }>(
        `/api/agents/${agent.id}/coordinate`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ targetAgentId: coordTarget, message: coordMsg }),
        },
      )
      setCoordResult(res.message)
      setCoordMsg('')
      onRefresh?.()
    } catch (err) {
      setCoordResult(err instanceof Error ? err.message : 'Failed')
    } finally {
      setCoordSending(false)
    }
  }
  const toolGroups = useMemo(() => catalog?.groups ?? [], [catalog])

  const agentEvents = useMemo(() =>
    events.filter((e) => e.label.toLowerCase().includes(agent.name.toLowerCase())),
    [events, agent.name],
  )

  const handleExportAudit = async () => {
    setIsExporting(true)
    try {
      const resp = await fetch(`/api/agents/${agent.id}/export-audit`, {
        headers: getAuthHeaders(),
      })
      if (!resp.ok) throw new Error('Export failed')
      const blob = await resp.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `audit-${agent.name.replace(/\s+/g, '-').toLowerCase()}-${Date.now()}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch {
      // Silent fail for hackathon
    } finally {
      setIsExporting(false)
    }
  }

  const handleFundAgent = async () => {
    const amount = parseFloat(fundAmount)
    if (!amount || amount <= 0 || !agent.agentAccountId) return
    setFundingInProgress(true)
    setFundResult(null)
    try {
      const { fundAgentAccount } = await import('../lib/hederaWallet')
      const { transactionId } = await fundAgentAccount(agent.agentAccountId, amount)
      await requestJson(`/api/agents/${agent.id}/fund`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amountHbar: amount,
          txId: transactionId,
          funderAccountId: wallet.status === 'connected' ? wallet.accountId : 'unknown',
        }),
      })
      setFundResult(`Funded ${amount} HBAR!`)
      setFundAmount('')
      onRefresh?.()
    } catch (err) {
      setFundResult(err instanceof Error ? err.message : 'Funding failed')
    } finally {
      setFundingInProgress(false)
    }
  }

  const handleWithdraw = async () => {
    const amount = parseFloat(withdrawAmount)
    if (!amount || amount <= 0 || !agent.agentAccountId) return
    if (wallet.status !== 'connected') return
    setWithdrawInProgress(true)
    setWithdrawResult(null)
    try {
      const res = await requestJson<{ txId: string; amountHbar: number }>(
        `/api/agents/${agent.id}/withdraw`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            amountHbar: amount,
            recipientAccountId: wallet.accountId,
          }),
        },
      )
      setWithdrawResult(`Withdrew ${res.amountHbar} HBAR to your wallet!`)
      setWithdrawAmount('')
      onRefresh?.()
    } catch (err) {
      setWithdrawResult(err instanceof Error ? err.message : 'Withdrawal failed')
    } finally {
      setWithdrawInProgress(false)
    }
  }

  const handleCopyAddress = useCallback(async () => {
    if (!agent.agentAccountId) return
    try {
      await navigator.clipboard.writeText(agent.agentAccountId)
      setAddressCopied(true)
      addToast('Address copied!', 'success')
      setTimeout(() => setAddressCopied(false), 1600)
    } catch {
      // clipboard access not available
    }
  }, [agent.agentAccountId, addToast])

  const handleCreateJob = async () => {
    if (!jobForm.providerAgentId || !jobForm.description.trim()) return
    setJobSubmitting(true)
    try {
      await requestJson('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientAgentId: agent.id,
          providerAgentId: jobForm.providerAgentId,
          description: jobForm.description,
          budgetHbar: parseFloat(jobForm.budgetHbar) || 5,
          expiresInMinutes: parseInt(jobForm.expiresInMinutes) || 1440,
        }),
      })
      setJobForm({ providerAgentId: '', description: '', budgetHbar: '5', expiresInMinutes: '1440' })
      setJobCreateOpen(false)
      fetchJobs()
      addToast('Job created!', 'success')
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to create job', 'info')
    } finally {
      setJobSubmitting(false)
    }
  }

  const handleJobAction = async (jobId: string, action: 'fund' | 'submit' | 'complete' | 'reject', body?: Record<string, unknown>) => {
    setJobActionLoading(jobId)
    try {
      await requestJson(`/api/jobs/${jobId}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      })
      fetchJobs()
      addToast(`Job ${action}ed!`, 'success')
    } catch (err) {
      addToast(err instanceof Error ? err.message : `Failed to ${action} job`, 'info')
    } finally {
      setJobActionLoading(null)
    }
  }

  const workflows = useMemo(() => {
    if (!catalog) return []
    return catalog.workflowsByTemplate[agent.templateId] ?? []
  }, [catalog, agent.templateId])

  const suggestedTools: ToolCatalogEntry[] = useMemo(() => {
    if (!catalog) return []
    const enabledGroups = new Set(agent.capabilityGroups)
    const toolEntries = catalog.tools
    return (catalog.suggestedToolsByTemplate[agent.templateId] ?? []).flatMap(
      (name) => {
        const entry = toolEntries.find((t) => t.name === name)
        return entry && enabledGroups.has(entry.groupId) ? [entry] : []
      },
    )
  }, [catalog, agent])

  return (
    <div className="agent-panel-overlay" onClick={onClose}>
      <aside className="agent-panel" onClick={(e) => e.stopPropagation()}>
        {/* ─── Header ──────────────────────────── */}
        <div className="ap-header">
          <div className="ap-header-left">
            <span className="ap-portrait">
              <img alt="" className="pixel-image" src={agent.sprite} />
            </span>
            <div>
              <h2 className="ap-name">{agent.name}</h2>
              <span
                className="ap-status"
                style={{ color: statusMeta[agent.status].accent }}
              >
                {statusMeta[agent.status].label}
              </span>
              {agent.agentAccountId && (
                <div className="ap-header-wallet">
                  <button
                    className="ap-header-wallet-id"
                    onClick={() => void handleCopyAddress()}
                    title="Click to copy full address"
                    type="button"
                  >
                    {addressCopied ? (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    ) : (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                        <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                      </svg>
                    )}
                    {agent.agentAccountId.length > 12
                      ? `${agent.agentAccountId.slice(0, 7)}...${agent.agentAccountId.slice(-4)}`
                      : agent.agentAccountId}
                  </button>
                  <a
                    className="ap-header-wallet-bal"
                    href={`https://hashscan.io/testnet/account/${agent.agentAccountId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="View on Hashscan"
                  >
                    {walletBalance !== null ? `${walletBalance} ℏ` : '--'}
                  </a>
                  {agent.walletType === 'dedicated' && onFund && (
                    <button
                      className="ap-fund-btn"
                      onClick={onFund}
                      type="button"
                      title="Fund this agent"
                    >
                      Fund ℏ
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
          <button className="ap-close" onClick={onClose} type="button" aria-label="Close agent panel">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* ─── Tabs ──────────────────────────── */}
        <div className="ap-tabs">
          {chatEnabled && (
            <button
              className={`ap-tab ${activeTab === 'chat' ? 'is-active' : ''}`}
              onClick={() => setActiveTab('chat')}
              type="button"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
              </svg>
              Chat
            </button>
          )}
          <button
            className={`ap-tab ${activeTab === 'info' ? 'is-active' : ''}`}
            onClick={() => setActiveTab('info')}
            type="button"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
            Info
          </button>
          <button
            className={`ap-tab ${activeTab === 'history' ? 'is-active' : ''}`}
            onClick={() => setActiveTab('history')}
            type="button"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
            History
            {agentEvents.length > 0 && (
              <span className="ap-tab-badge">{agentEvents.length}</span>
            )}
          </button>
          <button
            className={`ap-tab ${activeTab === 'spending' ? 'is-active' : ''}`}
            onClick={() => setActiveTab('spending')}
            type="button"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="1" x2="12" y2="23" />
              <path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
            </svg>
            Spending
          </button>
          <button
            className={`ap-tab ${activeTab === 'jobs' ? 'is-active' : ''}`}
            onClick={() => setActiveTab('jobs')}
            type="button"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2" />
              <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
              <path d="M9 14l2 2 4-4" />
            </svg>
            Jobs
            {jobs.length > 0 && activeTab !== 'jobs' && (
              <span className="ap-tab-badge">{jobs.length}</span>
            )}
          </button>
          <button
            className={`ap-tab ${activeTab === 'automation' ? 'is-active' : ''}`}
            onClick={() => setActiveTab('automation')}
            type="button"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
            </svg>
            Auto
          </button>
        </div>

        {/* ─── Tab Content (scrollable) ────── */}
        <div className="ap-tab-content">

        {/* ─── Chat Tab ──────────────────────── */}
        {activeTab === 'chat' && chatEnabled && (
          <ChatPanel
            agent={agent}
            userAccountId={userAccountId}
            onAgentReply={onAgentReply}
            onRefresh={onRefresh}
            onMarkActive={onMarkActive}
          />
        )}

        {/* ─── Info Tab ──────────────────────── */}
        {activeTab === 'info' && (
          <>
            {/* ─── Mission ─────────────────────────── */}
            <p className="ap-mission">{agent.mission}</p>

            {/* ─── Stats Grid ──────────────────────── */}
            <div className="ap-stats">
              <div className="ap-stat">
                <span>Topic</span>
                {agent.topicId ? (
                  <a href={`https://hashscan.io/testnet/topic/${agent.topicId}`} target="_blank" rel="noopener noreferrer" className="ap-stat-link">
                    {agent.topicId}
                  </a>
                ) : (
                  <strong>Pending</strong>
                )}
              </div>
              <div className="ap-stat">
                <span>Vault</span>
                {agent.contractId ? (
                  <a href={`https://hashscan.io/testnet/contract/${agent.contractId}`} target="_blank" rel="noopener noreferrer" className="ap-stat-link">
                    {agent.contractId}
                  </a>
                ) : (
                  <strong>Pending</strong>
                )}
              </div>
              <div className="ap-stat">
                <span>Runs</span>
                <strong>{agent.executions}</strong>
              </div>
              <div className="ap-stat">
                <span>Cap</span>
                <strong>{agent.vaultCapHbar} HBAR</strong>
              </div>
              {agent.deploymentTxId && (
                <div className="ap-stat ap-stat--wide">
                  <span>Deploy Tx</span>
                  <a href={`https://hashscan.io/testnet/transaction/${agent.deploymentTxId}`} target="_blank" rel="noopener noreferrer" className="ap-stat-link">
                    {agent.deploymentTxId}
                  </a>
                </div>
              )}
            </div>

            {/* ─── Wallet ──────────────────────────── */}
            <div className="ap-wallet-section">
              <div className="ap-wallet-header">
                <span className="ap-section-label">
                  {agent.walletType === 'dedicated' ? 'Dedicated Wallet' : 'Shared Wallet'}
                </span>
                {agent.walletType === 'dedicated' && (
                  <span className="ap-wallet-badge">Own Account</span>
                )}
              </div>
              {agent.agentAccountId && (
                <div className="ap-wallet-account">
                  <div className="ap-wallet-id-row">
                    <a
                      href={`https://hashscan.io/testnet/account/${agent.agentAccountId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ap-wallet-id"
                    >
                      {agent.agentAccountId}
                    </a>
                    <button
                      className="ap-copy-btn"
                      onClick={() => void handleCopyAddress()}
                      title="Copy address"
                      type="button"
                    >
                      {addressCopied ? (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5ad6b5" strokeWidth="2.5">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      ) : (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                          <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                        </svg>
                      )}
                    </button>
                  </div>
                  <span className="ap-wallet-balance">
                    {walletBalance !== null ? `${walletBalance} HBAR` : '--'}
                  </span>
                </div>
              )}
              {agent.walletType === 'dedicated' && agent.agentAccountId && (
                <div className="ap-fund-form">
                  {wallet.status === 'connected' ? (
                    <>
                      {/* ─── Fund Row ─── */}
                      <div className="ap-fund-row">
                        <input
                          type="number"
                          className="ap-fund-input"
                          placeholder="HBAR"
                          value={fundAmount}
                          onChange={(e) => setFundAmount(e.target.value)}
                          min="0.01"
                          step="0.1"
                        />
                        <button
                          className="ap-fund-btn"
                          onClick={() => void handleFundAgent()}
                          disabled={fundingInProgress || !fundAmount}
                          type="button"
                        >
                          {fundingInProgress ? 'Sending...' : `Fund ${fundAmount || '0'} ℏ`}
                        </button>
                      </div>
                      {fundResult && <span className={`ap-fund-result ${fundResult.includes('Funded') ? 'success' : 'error'}`}>{fundResult}</span>}

                      {/* ─── Withdraw Row ─── */}
                      <div className="ap-withdraw-row">
                        <input
                          type="number"
                          className="ap-withdraw-input"
                          placeholder="HBAR"
                          value={withdrawAmount}
                          onChange={(e) => setWithdrawAmount(e.target.value)}
                          min="0.01"
                          step="0.1"
                        />
                        <button
                          className="ap-withdraw-btn"
                          onClick={() => void handleWithdraw()}
                          disabled={withdrawInProgress || !withdrawAmount || walletBalance === null || parseFloat(withdrawAmount) > (walletBalance ?? 0)}
                          type="button"
                          title="Withdraw HBAR from agent to your wallet"
                        >
                          {withdrawInProgress ? 'Withdrawing...' : (
                            <>
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                <path d="M12 19V5M5 12l7-7 7 7" />
                              </svg>
                              Withdraw {withdrawAmount || '0'} ℏ
                            </>
                          )}
                        </button>
                      </div>
                      {withdrawResult && <span className={`ap-fund-result ${withdrawResult.includes('Withdrew') ? 'success' : 'error'}`}>{withdrawResult}</span>}
                    </>
                  ) : (
                    <button
                      className="ap-fund-btn"
                      onClick={() => void connectWallet()}
                      type="button"
                    >
                      Connect wallet to manage funds
                    </button>
                  )}
                </div>
              )}
              {agent.walletType === 'dedicated' && agent.agentAccountId && (
                <div className="ap-faucet-hint">
                  <span>Need testnet HBAR?</span>
                  <a
                    href="https://portal.hedera.com/faucet"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ap-faucet-link"
                  >
                    Get free HBAR
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3" />
                    </svg>
                  </a>
                </div>
              )}
            </div>

            {/* ─── Export Audit ────────────────────── */}
            <button
              className="ap-btn-export"
              onClick={() => void handleExportAudit()}
              disabled={isExporting}
              type="button"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
              </svg>
              {isExporting ? 'Exporting...' : 'Export Audit Report'}
            </button>

            {/* ─── Coordination ────────────────────── */}
            {otherAgents.length > 0 && (
              <div className="ap-coord-section">
                <div className="ap-coord-header">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5ad6b5" strokeWidth="2">
                    <path d="M8 12h8M12 8v8" />
                    <circle cx="5" cy="5" r="3" />
                    <circle cx="19" cy="5" r="3" />
                    <circle cx="19" cy="19" r="3" />
                    <circle cx="5" cy="19" r="3" />
                  </svg>
                  <span className="ap-section-label">Agent Coordination</span>
                </div>
                <div className="ap-coord-form">
                  <select
                    className="ap-coord-select"
                    value={coordTarget}
                    onChange={(e) => setCoordTarget(e.target.value)}
                  >
                    <option value="">Select target agent...</option>
                    {otherAgents.map(a => {
                      const tpl = templates.find(t => t.id === a.templateId)
                      return (
                        <option key={a.id} value={a.id}>
                          {a.name} — {tpl?.room ?? 'Office'}
                        </option>
                      )
                    })}
                  </select>
                  <div className="ap-coord-input-row">
                    <input
                      className="ap-coord-input"
                      placeholder="Send a coordination message..."
                      value={coordMsg}
                      onChange={(e) => setCoordMsg(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') void handleCoordinate() }}
                    />
                    <button
                      className="ap-coord-send"
                      onClick={() => void handleCoordinate()}
                      disabled={coordSending || !coordTarget || !coordMsg.trim()}
                      type="button"
                      title="Send coordination message"
                    >
                      {coordSending ? (
                        <span className="ap-coord-spinner" />
                      ) : (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>
                {coordResult && (
                  <p className={`ap-coord-result ${coordResult.includes('delivered') ? 'success' : ''}`}>{coordResult}</p>
                )}
              </div>
            )}

            {/* ─── Capabilities ────────────────────── */}
            <div className="ap-section">
              <div className="ap-section-header">
                <span className="ap-section-label">Capabilities</span>
                <button
                  className="ap-link"
                  onClick={() => onOpenToolLibrary()}
                  type="button"
                >
                  Open tool library
                </button>
              </div>
              <div className="ap-chips">
                {agent.capabilityGroups.map((groupId) => {
                  const group: ToolCatalogGroup | undefined = toolGroups.find((g) => g.id === groupId)
                  if (!group) return null
                  const isSoon = comingSoonGroups.has(groupId)
                  return (
                    <span
                      className={`ap-chip ${toneClass[group.tone]}${isSoon ? ' is-coming-soon' : ''}`}
                      key={group.id}
                      title={isSoon ? 'Coming soon — requires API key' : group.description}
                    >
                      {group.label}
                      {isSoon && <span className="ap-chip-soon">Soon</span>}
                    </span>
                  )
                })}
              </div>
            </div>

            {/* ─── Workflows ───────────────────────── */}
            {workflows.length > 0 && (
              <div className="ap-section">
                <span className="ap-section-label">Quick workflows</span>
                <div className="ap-workflows">
                  {workflows.map((wf) => (
                    <button
                      className="ap-workflow"
                      key={wf.id}
                      onClick={() => onRunWorkflow(wf)}
                      type="button"
                    >
                      <strong>{wf.title}</strong>
                      <p>{wf.description}</p>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* ─── Suggested Tools ─────────────────── */}
            {suggestedTools.length > 0 && (
              <div className="ap-section">
                <span className="ap-section-label">Popular tools</span>
                <div className="ap-quick-tools">
                  {suggestedTools.map((tool) => (
                    <button
                      className="ap-quick-tool"
                      key={tool.name}
                      onClick={() => onOpenToolLibrary(tool.name)}
                      type="button"
                    >
                      {tool.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* ─── Guardrail ───────────────────────── */}
            <div className="ap-info">
              <span>Guardrail</span>
              <p>{agent.guardrail}</p>
            </div>

            {agent.lastAction && (
              <div className="ap-info">
                <span>Last action</span>
                <p>{agent.lastAction}</p>
              </div>
            )}

            {/* ─── Actions ─────────────────────────── */}
            <div className="ap-actions">
              <button className="ap-btn-primary" onClick={onRunAgent} type="button">
                {isMutating ? 'Running...' : 'Run recommended action'}
              </button>
              <button className="ap-btn-secondary" onClick={onToggleAgent} type="button">
                {agent.status === 'paused' ? 'Resume' : 'Pause'}
              </button>
              {!showDestroyConfirm ? (
                <button className="ap-btn-destroy" onClick={() => setShowDestroyConfirm(true)} type="button">
                  Destroy Agent
                </button>
              ) : (
                <div className="ap-destroy-confirm">
                  <p className="ap-destroy-warn">
                    This will permanently delete <strong>{agent.name}</strong>.
                    {agent.walletType === 'dedicated' && walletBalance !== null && walletBalance > 0
                      ? ` Remaining ${walletBalance} HBAR will be refunded to your wallet.`
                      : ''
                    }
                  </p>
                  <div className="ap-destroy-btns">
                    <button className="ap-btn-destroy-confirm" onClick={onRemoveAgent} type="button">
                      Confirm Destroy
                    </button>
                    <button className="ap-btn-secondary" onClick={() => setShowDestroyConfirm(false)} type="button">
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        {/* ─── History Tab ─────────────────────── */}
        {activeTab === 'history' && (
          <div className="ap-history">
            {agentEvents.length === 0 ? (
              <p className="ap-history-empty">No activity recorded yet. Run an action or chat with this agent to see its history.</p>
            ) : (
              <div className="ap-timeline">
                {agentEvents.map((event) => (
                  <div className={`ap-timeline-item tone-${event.tone}`} key={event.id}>
                    <span className="ap-timeline-dot" />
                    <div className="ap-timeline-content">
                      <p>{event.label}</p>
                      <span className="ap-timeline-time">{event.timestamp}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ─── Spending Tab ────────────────────── */}
        {activeTab === 'spending' && (
          <div className="ap-spending">
            {spendingLoading ? (
              <p className="ap-history-empty">Loading spending data...</p>
            ) : !spendingData || spendingData.summary.txCount === 0 ? (
              <p className="ap-history-empty">No spending recorded yet. Execute HBAR transfers via chat or tools to track spending.</p>
            ) : (
              <>
                <div className="ap-spending-summary">
                  <div className="ap-spending-card outflow">
                    <span className="ap-spending-label">Total Spent</span>
                    <strong>{spendingData.summary.totalSpent.toFixed(2)} HBAR</strong>
                  </div>
                  <div className="ap-spending-card inflow">
                    <span className="ap-spending-label">Total Funded</span>
                    <strong>{spendingData.summary.totalFunded.toFixed(2)} HBAR</strong>
                  </div>
                  <div className="ap-spending-card">
                    <span className="ap-spending-label">Burn Rate</span>
                    <strong>{spendingData.burnRatePerDay} HBAR/day</strong>
                  </div>
                  {spendingData.burnRatePerDay > 0 && (
                    <div className="ap-spending-card">
                      <span className="ap-spending-label">Est. Runway</span>
                      <strong>
                        {Math.max(0, Math.round((spendingData.summary.totalFunded - spendingData.summary.totalSpent) / spendingData.burnRatePerDay))} days
                      </strong>
                    </div>
                  )}
                </div>
                <div className="ap-spending-list">
                  {spendingData.records.map((r) => (
                    <div className={`ap-spending-row ${r.direction}`} key={r.id}>
                      <span className="ap-spending-dir">{r.direction === 'inflow' ? '+' : '−'}</span>
                      <span className="ap-spending-amount">{r.amountHbar.toFixed(2)} HBAR</span>
                      <span className="ap-spending-meta">
                        {r.toolName ?? r.source}
                        {r.txId && <span className="ap-spending-tx"> · {r.txId.slice(0, 20)}…</span>}
                      </span>
                      <span className="ap-spending-time">{new Date(r.createdAt).toLocaleDateString()}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* ─── Jobs Tab (ERC-8183) ──────────────── */}
        {activeTab === 'jobs' && (
          <div className="ap-jobs">
            <div className="ap-jobs-header">
              <span className="ap-section-label">ERC-8183 Agent Jobs</span>
              <button className="ap-link" onClick={() => setJobCreateOpen(!jobCreateOpen)} type="button">
                {jobCreateOpen ? 'Cancel' : '+ New Job'}
              </button>
            </div>

            {jobCreateOpen && (
              <div className="ap-job-create">
                <select
                  className="ap-coord-select"
                  value={jobForm.providerAgentId}
                  onChange={(e) => setJobForm({ ...jobForm, providerAgentId: e.target.value })}
                >
                  <option value="">Select provider agent...</option>
                  {otherAgents.map(a => {
                    const tpl = templates.find(t => t.id === a.templateId)
                    return (
                      <option key={a.id} value={a.id}>
                        {a.name} — {tpl?.room ?? 'Office'}
                      </option>
                    )
                  })}
                </select>
                <input
                  className="ap-coord-input"
                  placeholder="Job description..."
                  value={jobForm.description}
                  onChange={(e) => setJobForm({ ...jobForm, description: e.target.value })}
                />
                <div className="ap-job-create-row">
                  <input
                    type="number"
                    className="ap-fund-input"
                    placeholder="Budget HBAR"
                    value={jobForm.budgetHbar}
                    onChange={(e) => setJobForm({ ...jobForm, budgetHbar: e.target.value })}
                    min="0.1"
                    step="1"
                  />
                  <button
                    className="ap-fund-btn"
                    onClick={() => void handleCreateJob()}
                    disabled={jobSubmitting || !jobForm.providerAgentId || !jobForm.description.trim()}
                    type="button"
                  >
                    {jobSubmitting ? 'Creating...' : `Create Job (${jobForm.budgetHbar} ℏ)`}
                  </button>
                </div>
              </div>
            )}

            {jobsLoading ? (
              <p className="ap-history-empty">Loading jobs...</p>
            ) : jobs.length === 0 ? (
              <p className="ap-history-empty">No ERC-8183 jobs yet. Create a job to assign work to another agent with escrowed HBAR payment.</p>
            ) : (
              <div className="ap-job-list">
                {jobs.map((job) => {
                  const isClient = job.clientAgentId === agent.id
                  const otherAgent = allAgents.find(a => a.id === (isClient ? job.providerAgentId : job.clientAgentId))
                  const statusColor = {
                    Open: '#8390ad', Funded: '#f3c35f', Submitted: '#4ecdc4',
                    Completed: '#8ae18f', Rejected: '#f25f5c', Expired: '#666',
                  }[job.status] || '#8390ad'

                  return (
                    <div className="ap-job-card" key={job.id}>
                      <div className="ap-job-card-header">
                        <span className="ap-job-role">{isClient ? 'Client' : 'Provider'}</span>
                        <span className="ap-job-status" style={{ color: statusColor }}>
                          {job.status}
                        </span>
                      </div>
                      <p className="ap-job-desc">{job.description}</p>
                      <div className="ap-job-meta">
                        <span>{isClient ? 'To' : 'From'}: {otherAgent?.name ?? 'Unknown'}</span>
                        <span className="ap-job-budget">{job.budgetHbar} ℏ</span>
                      </div>
                      {job.deliverable && (
                        <div className="ap-job-deliverable">
                          <span className="ap-job-deliverable-label">Deliverable:</span>
                          <p>{job.deliverable}</p>
                        </div>
                      )}
                      <div className="ap-job-actions">
                        {isClient && job.status === 'Open' && (
                          <button
                            className="ap-btn-small primary"
                            onClick={() => void handleJobAction(job.id, 'fund')}
                            disabled={jobActionLoading === job.id}
                            type="button"
                          >
                            {jobActionLoading === job.id ? '...' : `Fund ${job.budgetHbar} ℏ`}
                          </button>
                        )}
                        {!isClient && job.status === 'Funded' && (
                          <button
                            className="ap-btn-small primary"
                            onClick={() => {
                              const deliverable = prompt('Enter deliverable:')
                              if (deliverable) void handleJobAction(job.id, 'submit', { deliverable })
                            }}
                            disabled={jobActionLoading === job.id}
                            type="button"
                          >
                            Submit Work
                          </button>
                        )}
                        {job.status === 'Submitted' && (
                          <>
                            <button
                              className="ap-btn-small primary"
                              onClick={() => void handleJobAction(job.id, 'complete')}
                              disabled={jobActionLoading === job.id}
                              type="button"
                            >
                              Approve
                            </button>
                            <button
                              className="ap-btn-small"
                              onClick={() => void handleJobAction(job.id, 'reject', { reason: 'Quality not met' })}
                              disabled={jobActionLoading === job.id}
                              type="button"
                            >
                              Reject
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* ─── Automation Tab ─────────────────── */}
        {activeTab === 'automation' && (
          <div className="ap-automation">
            <ScheduleManager agentId={agent.id} />
            <div className="ap-automation-divider" />
            <TriggerManager
              agentId={agent.id}
              agentAccountId={agent.agentAccountId ?? null}
              agentTopicId={agent.topicId ?? null}
            />
          </div>
        )}

        </div>{/* end .ap-tab-content */}
      </aside>
    </div>
  )
}
