import { useState, useMemo } from 'react'
import type { CapabilityGroupId, ToolCatalogResponse } from '../types'
import { templates, launchWizardByTemplate, toneClass } from '../data'
import { deepClone, buildLaunchPayload } from '../utils'
import './DeployModal.css'

type DeployModalProps = {
  templateId: string
  catalog: ToolCatalogResponse | null
  isDeploying: boolean
  existingNames: string[]
  deployError?: string
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
  }) => void
  onClose: () => void
}

export default function DeployModal({
  templateId,
  catalog,
  isDeploying,
  existingNames,
  deployError,
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
  const [initialFundingHbar, setInitialFundingHbar] = useState(10)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [wizardValues, setWizardValues] = useState<Record<string, unknown>>(
    wizard ? deepClone(wizard.defaults) : {},
  )
  const [capabilityGroups, setCapabilityGroups] = useState<CapabilityGroupId[]>(
    catalog?.defaultCapabilityGroupsByTemplate[template.id] ?? [],
  )

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
    <div className="deploy-overlay" onClick={onClose}>
      <div className="deploy-modal" onClick={(e) => e.stopPropagation()}>
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
              <label className="dm-field">
                <span>
                  Initial Funding (HBAR)
                  <span className="dm-tooltip-wrap">?<span className="dm-tooltip-body">The platform operator sends this amount of HBAR to the agent's new dedicated account during deployment. This is the agent's starting balance for autonomous operations.</span></span>
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
                <small>Platform sends this HBAR to the agent's new account</small>
              </label>
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
            disabled={isDeploying || capabilityGroups.length === 0 || isDuplicateName || !agentName.trim()}
            type="button"
          >
            {isDeploying ? 'Deploying...' : 'Deploy to Hedera'}
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}
