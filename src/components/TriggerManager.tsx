import { useCallback, useEffect, useState } from 'react'
import { requestJson } from '../utils'
import type { EventTrigger } from '../types'
import './TriggerManager.css'

const EVENT_TYPES = [
  { value: 'hbar_inflow', label: 'HBAR Incoming', variables: ['amount', 'sender', 'txId'] },
  { value: 'hcs_message', label: 'HCS Message', variables: ['message', 'sender', 'topicId', 'sequenceNumber'] },
  { value: 'token_transfer', label: 'Token Transfer', variables: ['amount', 'tokenId', 'sender', 'txId'] },
] as const

type Props = {
  agentId: string
  agentAccountId: string | null
  agentTopicId: string | null
}

export default function TriggerManager({ agentId, agentAccountId, agentTopicId }: Props) {
  const [triggers, setTriggers] = useState<EventTrigger[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [eventType, setEventType] = useState<EventTrigger['eventType']>('hbar_inflow')
  const [configAccountId, setConfigAccountId] = useState(agentAccountId ?? '')
  const [configTopicId, setConfigTopicId] = useState(agentTopicId ?? '')
  const [configTokenId, setConfigTokenId] = useState('')
  const [configMinAmount, setConfigMinAmount] = useState('')
  const [promptTemplate, setPromptTemplate] = useState('')
  const [saving, setSaving] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const data = await requestJson<{ triggers: EventTrigger[] }>(
        `/api/agents/${agentId}/triggers`,
      )
      setTriggers(data.triggers)
    } catch { /* silent */ }
    setLoading(false)
  }, [agentId])

  useEffect(() => { void refresh() }, [refresh])

  const handleCreate = async () => {
    setSaving(true)
    const config: Record<string, unknown> = {}
    if (eventType === 'hbar_inflow') {
      config.accountId = configAccountId || agentAccountId
      if (configMinAmount) config.minAmount = Number(configMinAmount)
    } else if (eventType === 'hcs_message') {
      config.topicId = configTopicId || agentTopicId
    } else if (eventType === 'token_transfer') {
      config.accountId = configAccountId || agentAccountId
      if (configTokenId) config.tokenId = configTokenId
    }

    try {
      await requestJson(`/api/agents/${agentId}/triggers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventType, config, promptTemplate }),
      })
      setPromptTemplate('')
      setShowForm(false)
      await refresh()
    } catch { /* silent */ }
    setSaving(false)
  }

  const handleToggle = async (trigger: EventTrigger) => {
    try {
      await requestJson(`/api/agents/${agentId}/triggers/${trigger.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !trigger.enabled }),
      })
      await refresh()
    } catch { /* silent */ }
  }

  const handleDelete = async (triggerId: string) => {
    try {
      await requestJson(`/api/agents/${agentId}/triggers/${triggerId}`, {
        method: 'DELETE',
      })
      await refresh()
    } catch { /* silent */ }
  }

  const currentEventType = EVENT_TYPES.find((e) => e.value === eventType)

  const insertVariable = (varName: string) => {
    setPromptTemplate((prev) => prev + `{{${varName}}}`)
  }

  if (loading) return <p className="tm-empty">Loading triggers...</p>

  return (
    <div className="trigger-manager">
      <div className="tm-header">
        <h4 className="tm-title">Event Triggers</h4>
        <button className="tm-add-btn" onClick={() => setShowForm(!showForm)}>
          {showForm ? 'Cancel' : '+ Add'}
        </button>
      </div>

      {showForm && (
        <div className="tm-form">
          <label className="tm-label">Event Type</label>
          <select
            className="tm-select"
            value={eventType}
            onChange={(e) => setEventType(e.target.value as EventTrigger['eventType'])}
          >
            {EVENT_TYPES.map((et) => (
              <option key={et.value} value={et.value}>{et.label}</option>
            ))}
          </select>

          {eventType === 'hbar_inflow' && (
            <>
              <input
                className="tm-input"
                placeholder={`Account ID (default: ${agentAccountId ?? 'agent account'})`}
                value={configAccountId}
                onChange={(e) => setConfigAccountId(e.target.value)}
              />
              <input
                className="tm-input"
                placeholder="Min amount HBAR (optional)"
                type="number"
                value={configMinAmount}
                onChange={(e) => setConfigMinAmount(e.target.value)}
              />
            </>
          )}

          {eventType === 'hcs_message' && (
            <input
              className="tm-input"
              placeholder={`Topic ID (default: ${agentTopicId ?? 'agent topic'})`}
              value={configTopicId}
              onChange={(e) => setConfigTopicId(e.target.value)}
            />
          )}

          {eventType === 'token_transfer' && (
            <>
              <input
                className="tm-input"
                placeholder={`Account ID (default: ${agentAccountId ?? 'agent account'})`}
                value={configAccountId}
                onChange={(e) => setConfigAccountId(e.target.value)}
              />
              <input
                className="tm-input"
                placeholder="Token ID (optional, e.g. 0.0.12345)"
                value={configTokenId}
                onChange={(e) => setConfigTokenId(e.target.value)}
              />
            </>
          )}

          <label className="tm-label">Prompt Template</label>
          <div className="tm-variables">
            {currentEventType?.variables.map((v) => (
              <button key={v} className="tm-var-chip" onClick={() => insertVariable(v)}>
                {`{{${v}}}`}
              </button>
            ))}
          </div>
          <textarea
            className="tm-textarea"
            placeholder="e.g. I received {{amount}} HBAR from {{sender}}. Check the transaction and log it."
            value={promptTemplate}
            onChange={(e) => setPromptTemplate(e.target.value)}
            rows={3}
          />
          <button
            className="tm-save-btn"
            disabled={saving || !promptTemplate.trim()}
            onClick={handleCreate}
          >
            {saving ? 'Creating...' : 'Create Trigger'}
          </button>
        </div>
      )}

      {triggers.length === 0 && !showForm && (
        <p className="tm-empty">No event triggers yet. Add one to react to on-chain events automatically.</p>
      )}

      <div className="tm-list">
        {triggers.map((t) => {
          const etLabel = EVENT_TYPES.find((e) => e.value === t.eventType)?.label ?? t.eventType
          return (
            <div key={t.id} className={`tm-item ${t.enabled ? '' : 'disabled'}`}>
              <div className="tm-item-header">
                <div className="tm-item-info">
                  <span className="tm-event-type">{etLabel}</span>
                  {t.lastTriggeredAt && (
                    <span className="tm-last-triggered">Last: {new Date(t.lastTriggeredAt).toLocaleString()}</span>
                  )}
                </div>
                <div className="tm-item-actions">
                  <button
                    className={`tm-toggle ${t.enabled ? 'on' : 'off'}`}
                    onClick={() => handleToggle(t)}
                  >
                    {t.enabled ? 'ON' : 'OFF'}
                  </button>
                  <button className="tm-delete-btn" onClick={() => handleDelete(t.id)}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
              </div>
              <p className="tm-prompt-preview">{t.promptTemplate.slice(0, 120)}{t.promptTemplate.length > 120 ? '...' : ''}</p>
            </div>
          )
        })}
      </div>
    </div>
  )
}
