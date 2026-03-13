import { useState, useMemo, useEffect } from 'react'
import type { CapabilityGroupId, LiveAgent, ToolCatalogResponse, WalletState } from '../types'
import { templates, launchWizardByTemplate, toneClass } from '../data'
import { deepClone, buildLaunchPayload } from '../utils'
import './DeployModal.css'

type DeployModalProps = {
  templateId: string
  catalog: ToolCatalogResponse | null
  isDeploying: boolean
  deployingStatus?: string
  existingNames: string[]
  existingAgents?: LiveAgent[]
  operatorAccountId?: string | null
  mirrorNodeUrl?: string
  deployError?: string
  wallet?: WalletState
  onConnectWallet?: () => void
  onDeploy: (payload: {
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
  }) => void
  onClose: () => void
}

export default function DeployModal({
  templateId,
  catalog,
  isDeploying,
  deployingStatus,
  existingNames,
  existingAgents = [],
  operatorAccountId,
  mirrorNodeUrl,
  deployError,
  wallet,
  onConnectWallet,
  onDeploy,
  onClose,
}: DeployModalProps) {
  const template = templates.find((t) => t.id === templateId) ?? templates[0]
  const wizard = launchWizardByTemplate[template.id]

  const [agentName, setAgentName] = useState(
    (wizard?.defaults.agentLabel as string) ?? template.name,
  )
  const [vaultRequired, setVaultRequired] = useState(template.id !== 'governance-relay')
  const [walletType, setWalletType] = useState<'platform' | 'dedicated'>('dedicated')
  const PLATFORM_FUNDING_CAP = 5
  const [initialFundingHbar, setInitialFundingHbar] = useState(10)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [wizardValues, setWizardValues] = useState<Record<string, unknown>>(
    wizard ? deepClone(wizard.defaults) : {},
  )
  const [capabilityGroups, setCapabilityGroups] = useState<CapabilityGroupId[]>(
    catalog?.defaultCapabilityGroupsByTemplate[template.id] ?? [],
  )
  const [coordinationPartners, setCoordinationPartners] = useState<string[]>([])
  const [fundingSource, setFundingSource] = useState<'wallet' | 'platform'>('wallet')
  const [operatorBalance, setOperatorBalance] = useState<number | null>(null)
  const [userWalletBalance, setUserWalletBalance] = useState<number | null>(null)

  const isWalletConnected = wallet?.status === 'connected'
  const userAccountId = isWalletConnected ? wallet.accountId : null

  // Fetch operator balance from Mirror Node
  useEffect(() => {
    if (!operatorAccountId || !mirrorNodeUrl) return
    const base = mirrorNodeUrl.replace(/\/api\/v1\/?$/, '')
    const url = `${base}/api/v1/balances?account.id=${operatorAccountId}&limit=1`
    fetch(url, { signal: AbortSignal.timeout(8_000) })
      .then(r => r.json())
      .then((data: { balances?: Array<{ balance: number }> }) => {
        const bal = data.balances?.[0]?.balance
        if (typeof bal === 'number') setOperatorBalance(bal / 1e8)
      })
      .catch(() => setOperatorBalance(null))
  }, [operatorAccountId, mirrorNodeUrl])

  // Fetch user wallet balance from Mirror Node
  useEffect(() => {
    if (!userAccountId || !mirrorNodeUrl) return
    const base = mirrorNodeUrl.replace(/\/api\/v1\/?$/, '')
    const url = `${base}/api/v1/balances?account.id=${userAccountId}&limit=1`
    fetch(url, { signal: AbortSignal.timeout(8_000) })
      .then(r => r.json())
      .then((data: { balances?: Array<{ balance: number }> }) => {
        const bal = data.balances?.[0]?.balance
        if (typeof bal === 'number') setUserWalletBalance(bal / 1e8)
      })
      .catch(() => setUserWalletBalance(null))
  }, [userAccountId, mirrorNodeUrl])

  const isDuplicateName = existingNames.some(
    (n) => n.toLowerCase() === agentName.trim().toLowerCase(),
  )

  const launchPreview = useMemo(
    () => buildLaunchPayload(template, { ...wizardValues, agentLabel: agentName }, 1, vaultRequired),
    [template, wizardValues, agentName, vaultRequired],
  )

  const handleDeploy = () => {
    if (capabilityGroups.length === 0 || isDuplicateName || !agentName.trim()) return

    onDeploy({
      templateId: template.id,
      name: launchPreview.name,
      room: template.room,
      guardrail: launchPreview.guardrail,
      vaultProtected: vaultRequired,
      vaultCapHbar: launchPreview.vaultCapHbar,
      launchNote: launchPreview.launchNote,
      capabilityGroups,
      walletType,
      initialFundingHbar: walletType === 'dedicated' ? initialFundingHbar : undefined,
      fundingSource: walletType === 'dedicated' ? fundingSource : undefined,
      coordinationPartners: coordinationPartners.length > 0 ? coordinationPartners : undefined,
    })
  }

  const toggleCapability = (groupId: CapabilityGroupId) => {
    setCapabilityGroups((current) =>
      current.includes(groupId)
        ? current.filter((g) => g !== groupId)
        : [...current, groupId],
    )
  }

  const updateField = (id: string, value: unknown) => {
    setWizardValues((current) => ({ ...current, [id]: value }))
  }

  return (
    <div className="deploy-overlay">
      <div className="deploy-modal">
        {/* ─── Header ──────────────────────────── */}
        <div className="dm-header">
          <div className="dm-header-left">
            <span className="dm-portrait">
              <img alt="" className="pixel-image" src={template.sprite} />
            </span>
            <div>
              <h2>Deploy {template.name}</h2>
              <p>{template.mission}</p>
            </div>
          </div>
          <button className="dm-close" onClick={onClose} type="button">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* ─── Quick Fields ────────────────────── */}
        <div className="dm-fields">
          <label className="dm-field">
            <span>Agent Name</span>
            <input
              type="text"
              value={agentName}
              onChange={(e) => setAgentName(e.target.value)}
              placeholder={template.name}
              className={isDuplicateName ? 'dm-input-error' : ''}
            />
            {isDuplicateName && (
              <span className="dm-error-hint">An agent with this name already exists</span>
            )}
          </label>

          <label className="dm-field dm-toggle-field">
            <div>
              <span>
                Dedicated Wallet
                <span className="dm-tooltip-wrap">?<span className="dm-tooltip-body">Creates a unique Hedera account for this agent with its own balance and key pair. The agent operates autonomously with its own on-chain identity instead of sharing the platform operator wallet.</span></span>
              </span>
              <small>Own Hedera account with separate balance <strong style={{ color: '#5ad6b5' }}>(Recommended)</strong></small>
            </div>
            <button
              className={walletType === 'dedicated' ? 'dm-toggle is-on' : 'dm-toggle'}
              onClick={() => setWalletType((v) => v === 'dedicated' ? 'platform' : 'dedicated')}
              type="button"
            >
              {walletType === 'dedicated' ? 'ON' : 'OFF'}
            </button>
          </label>

          {walletType === 'dedicated' && (
            <div className="dm-funding-field">
              {/* ─── Funding Source Selector ─────── */}
              <div className="dm-funding-source">
                <span className="dm-funding-source-label">
                  Who funds this agent?
                  <span className="dm-tooltip-wrap">?<span className="dm-tooltip-body">"My Wallet" signs a transfer from your connected HashPack wallet. "Platform" uses the platform operator's balance (capped at {PLATFORM_FUNDING_CAP} ℏ for testing).</span></span>
                </span>
                <div className="dm-funding-tabs">
                  <button
                    className={`dm-funding-tab ${fundingSource === 'wallet' ? 'is-active' : ''}`}
                    onClick={() => { setFundingSource('wallet'); setInitialFundingHbar(10) }}
                    type="button"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="2" y="4" width="20" height="16" rx="2" />
                      <path d="M22 10H18a2 2 0 000 4h4" />
                    </svg>
                    My Wallet
                  </button>
                  <button
                    className={`dm-funding-tab ${fundingSource === 'platform' ? 'is-active' : ''}`}
                    onClick={() => { setFundingSource('platform'); setInitialFundingHbar(PLATFORM_FUNDING_CAP) }}
                    type="button"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
                      <path d="M16 7V5a4 4 0 00-8 0v2" />
                    </svg>
                    Platform
                  </button>
                </div>
              </div>

              {/* ─── Wallet connect prompt ─────── */}
              {fundingSource === 'wallet' && !isWalletConnected && (
                <div className="dm-wallet-connect">
                  <p>Connect your HashPack wallet to fund this agent from your account</p>
                  <button
                    className="dm-wallet-connect-btn"
                    onClick={() => onConnectWallet?.()}
                    type="button"
                    disabled={wallet?.status === 'connecting'}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="2" y="4" width="20" height="16" rx="2" />
                      <path d="M22 10H18a2 2 0 000 4h4" />
                    </svg>
                    {wallet?.status === 'connecting' ? 'Connecting...' : 'Connect HashPack'}
                  </button>
                </div>
              )}

              {/* ─── Wallet connected badge ─────── */}
              {fundingSource === 'wallet' && isWalletConnected && (
                <div className="dm-wallet-connected">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5ad6b5" strokeWidth="2.5">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  <span className="dm-wallet-id">{wallet.accountId}</span>
                  {userWalletBalance !== null && (
                    <span className="dm-wallet-bal">{userWalletBalance.toFixed(2)} ℏ</span>
                  )}
                </div>
              )}

              {/* ─── Amount input / Platform display ─────── */}
              {fundingSource === 'wallet' ? (
                <label className="dm-field">
                  <span>
                    Initial Funding (HBAR)
                    <span className="dm-tooltip-wrap">?<span className="dm-tooltip-body">You will sign a transfer in HashPack to send this HBAR to the agent after deployment.</span></span>
                  </span>
                  <input
                    type="number"
                    value={initialFundingHbar}
                    onChange={(e) => setInitialFundingHbar(Math.max(1, Math.min(1000, Number(e.target.value) || 1)))}
                    min={1}
                    max={1000}
                    step={1}
                    placeholder="10"
                  />
                  <div className="dm-funding-meta">
                    <small>You'll approve this transfer in HashPack after deploy</small>
                    {isWalletConnected && userWalletBalance !== null && initialFundingHbar > userWalletBalance && (
                      <span className="dm-bal-warn">Insufficient wallet balance ({userWalletBalance.toFixed(2)} ℏ available)</span>
                    )}
                  </div>
                </label>
              ) : (
                <div className="dm-field dm-platform-funding-info">
                  <span>
                    Initial Funding
                    <span className="dm-tooltip-wrap">?<span className="dm-tooltip-body">The platform provides {PLATFORM_FUNDING_CAP} ℏ for testing. For larger amounts, use your own wallet.</span></span>
                  </span>
                  <div className="dm-platform-amount">{PLATFORM_FUNDING_CAP} ℏ <small>provided by platform</small></div>
                  {operatorBalance !== null && (
                    <span className={`dm-operator-bal ${PLATFORM_FUNDING_CAP > operatorBalance ? 'low' : ''}`}>
                      Operator balance: <strong>{operatorBalance.toFixed(2)} ℏ</strong>
                    </span>
                  )}
                </div>
              )}
            </div>
          )}

          <label className="dm-field dm-toggle-field">
            <div>
              <span>
                Vault Safety
                <span className="dm-tooltip-wrap">?<span className="dm-tooltip-body">Deploys a Solidity smart contract on Hedera that enforces an on-chain spending cap. The agent cannot exceed the HBAR limit you set, and all transactions are logged to HCS for a full audit trail.</span></span>
              </span>
              <small>On-chain spending cap and guardrails <strong style={{ color: '#5ad6b5' }}>(Recommended)</strong></small>
            </div>
            <button
              className={vaultRequired ? 'dm-toggle is-on' : 'dm-toggle'}
              onClick={() => setVaultRequired((v) => !v)}
              type="button"
            >
              {vaultRequired ? 'ON' : 'OFF'}
            </button>
          </label>
        </div>

        {/* ─── Coordination Partners ──────────── */}
        {existingAgents.length > 0 && (
          <div className="dm-coordination">
            <span className="dm-coord-label">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5ad6b5" strokeWidth="2">
                <path d="M8 12h8M12 8v8" />
                <circle cx="5" cy="5" r="3" />
                <circle cx="19" cy="5" r="3" />
                <circle cx="19" cy="19" r="3" />
                <circle cx="5" cy="19" r="3" />
              </svg>
              Coordinate with existing agents
              <span className="dm-tooltip-wrap">?<span className="dm-tooltip-body">Link this agent to existing agents for cross-agent coordination. Linked agents can send each other instructions and collaborate on tasks automatically.</span></span>
            </span>
            <div className="dm-coord-grid">
              {existingAgents.filter(a => a.status !== 'paused').map(a => {
                const agentTemplate = templates.find(t => t.id === a.templateId)
                const isSelected = coordinationPartners.includes(a.id)
                return (
                  <button
                    className={isSelected ? 'dm-coord-card is-active' : 'dm-coord-card'}
                    key={a.id}
                    onClick={() => setCoordinationPartners(prev =>
                      prev.includes(a.id) ? prev.filter(id => id !== a.id) : [...prev, a.id]
                    )}
                    type="button"
                  >
                    <img
                      alt=""
                      className="pixel-image"
                      src={a.sprite}
                      style={{ width: 22, height: 22, imageRendering: 'pixelated' }}
                    />
                    <div className="dm-coord-info">
                      <strong>{a.name}</strong>
                      <span>{agentTemplate?.room ?? 'Office'}</span>
                    </div>
                    {isSelected && (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5ad6b5" strokeWidth="2.5">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* ─── Advanced Options ────────────────── */}
        <button
          className="dm-advanced-toggle"
          onClick={() => setShowAdvanced((v) => !v)}
          type="button"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            style={{ transform: showAdvanced ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }}
          >
            <path d="M9 18l6-6-6-6" />
          </svg>
          Advanced options
        </button>

        {showAdvanced && (
          <div className="dm-advanced">
            {/* Wizard fields */}
            {wizard && (
              <div className="dm-wizard-fields">
                {wizard.fields
                  .filter((f) => f.id !== 'agentLabel')
                  .map((field) => (
                    <label className="dm-field" key={field.id}>
                      <span>{field.label}</span>
                      {field.input === 'select' ? (
                        <select
                          value={String(wizardValues[field.id] ?? '')}
                          onChange={(e) => updateField(field.id, e.target.value)}
                        >
                          <option value="">Select</option>
                          {field.options?.map((opt) => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </select>
                      ) : field.input === 'textarea' ? (
                        <textarea
                          value={String(wizardValues[field.id] ?? '')}
                          onChange={(e) => updateField(field.id, e.target.value)}
                          placeholder={field.placeholder}
                        />
                      ) : (
                        <input
                          type={field.input === 'number' ? 'number' : 'text'}
                          value={String(wizardValues[field.id] ?? '')}
                          onChange={(e) =>
                            updateField(
                              field.id,
                              field.input === 'number'
                                ? e.target.value === '' ? '' : Number(e.target.value)
                                : e.target.value,
                            )
                          }
                          placeholder={field.placeholder}
                        />
                      )}
                    </label>
                  ))}
              </div>
            )}

            {/* Capability groups */}
            {catalog && (
              <div className="dm-capabilities">
                <span className="dm-cap-label">Capability bundles</span>
                <div className="dm-cap-grid">
                  {catalog.groups.map((group) => {
                    const enabled = capabilityGroups.includes(group.id)
                    return (
                      <button
                        className={enabled ? 'dm-cap-card is-active' : 'dm-cap-card'}
                        key={group.id}
                        onClick={() => toggleCapability(group.id)}
                        type="button"
                      >
                        <span className={`ap-chip ${toneClass[group.tone]}`}>
                          {group.label}
                        </span>
                        <span className="dm-cap-count">{group.tools.length} tools</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ─── Footer ─────────────────────────── */}
        {deployError && (
          <p className="dm-deploy-error">{deployError}</p>
        )}
        <div className="dm-footer">
          <button className="dm-cancel" onClick={onClose} type="button">
            Cancel
          </button>
          <button
            className="dm-deploy"
            onClick={handleDeploy}
            disabled={isDeploying || capabilityGroups.length === 0 || isDuplicateName || !agentName.trim() || (walletType === 'dedicated' && fundingSource === 'wallet' && !isWalletConnected)}
            type="button"
          >
            {isDeploying ? (deployingStatus || 'Deploying...') : fundingSource === 'wallet' && walletType === 'dedicated' ? 'Deploy & Fund via Wallet' : 'Deploy to Hedera'}
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}
