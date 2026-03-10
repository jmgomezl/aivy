import { useCallback, useEffect, useState } from 'react'
import { requestJson } from '../utils'
import type { AgentSchedule, ScheduleExecution } from '../types'
import './ScheduleManager.css'

const PRESETS = [
  { label: 'Every hour', cron: '0 * * * *' },
  { label: 'Every 6 hours', cron: '0 */6 * * *' },
  { label: 'Daily 9 AM', cron: '0 9 * * *' },
  { label: 'Weekly Monday', cron: '0 9 * * 1' },
]

type Props = {
  agentId: string
}

export default function ScheduleManager({ agentId }: Props) {
  const [schedules, setSchedules] = useState<AgentSchedule[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [cron, setCron] = useState('0 * * * *')
  const [prompt, setPrompt] = useState('')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [executions, setExecutions] = useState<Record<string, ScheduleExecution[]>>({})

  const refresh = useCallback(async () => {
    try {
      const data = await requestJson<{ schedules: AgentSchedule[] }>(
        `/api/agents/${agentId}/schedules`,
      )
      setSchedules(data.schedules)
    } catch { /* silent */ }
    setLoading(false)
  }, [agentId])

  useEffect(() => { void refresh() }, [refresh])

  const handleCreate = async () => {
    setSaving(true)
    try {
      await requestJson(`/api/agents/${agentId}/schedules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cronExpression: cron, prompt, description }),
      })
      setCron('0 * * * *')
      setPrompt('')
      setDescription('')
      setShowForm(false)
      await refresh()
    } catch { /* silent */ }
    setSaving(false)
  }

  const handleToggle = async (schedule: AgentSchedule) => {
    try {
      await requestJson(`/api/agents/${agentId}/schedules/${schedule.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !schedule.enabled }),
      })
      await refresh()
    } catch { /* silent */ }
  }

  const handleDelete = async (scheduleId: string) => {
    try {
      await requestJson(`/api/agents/${agentId}/schedules/${scheduleId}`, {
        method: 'DELETE',
      })
      await refresh()
    } catch { /* silent */ }
  }

  const loadExecutions = async (scheduleId: string) => {
    if (expandedId === scheduleId) {
      setExpandedId(null)
      return
    }
    try {
      const data = await requestJson<{ executions: ScheduleExecution[] }>(
        `/api/agents/${agentId}/schedules/${scheduleId}/executions`,
      )
      setExecutions((prev) => ({ ...prev, [scheduleId]: data.executions }))
      setExpandedId(scheduleId)
    } catch { /* silent */ }
  }

  if (loading) return <p className="sm-empty">Loading schedules...</p>

  return (
    <div className="schedule-manager">
      <div className="sm-header">
        <h4 className="sm-title">Scheduled Tasks</h4>
        <button className="sm-add-btn" onClick={() => setShowForm(!showForm)}>
          {showForm ? 'Cancel' : '+ Add'}
        </button>
      </div>

      {showForm && (
        <div className="sm-form">
          <div className="sm-presets">
            {PRESETS.map((p) => (
              <button
                key={p.cron}
                className={`sm-preset ${cron === p.cron ? 'active' : ''}`}
                onClick={() => setCron(p.cron)}
              >
                {p.label}
              </button>
            ))}
          </div>
          <input
            className="sm-input"
            placeholder="Cron expression (e.g. 0 * * * *)"
            value={cron}
            onChange={(e) => setCron(e.target.value)}
          />
          <input
            className="sm-input"
            placeholder="Short description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <textarea
            className="sm-textarea"
            placeholder="What should the agent do? (e.g. Check my account balance and alert if below 10 HBAR)"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
          />
          <button
            className="sm-save-btn"
            disabled={saving || !prompt.trim()}
            onClick={handleCreate}
          >
            {saving ? 'Creating...' : 'Create Schedule'}
          </button>
        </div>
      )}

      {schedules.length === 0 && !showForm && (
        <p className="sm-empty">No scheduled tasks yet. Add one to run this agent automatically.</p>
      )}

      <div className="sm-list">
        {schedules.map((s) => (
          <div key={s.id} className={`sm-item ${s.enabled ? '' : 'disabled'}`}>
            <div className="sm-item-header">
              <div className="sm-item-info">
                <span className="sm-cron">{s.cronExpression}</span>
                {s.description && <span className="sm-desc">{s.description}</span>}
              </div>
              <div className="sm-item-actions">
                <button
                  className={`sm-toggle ${s.enabled ? 'on' : 'off'}`}
                  onClick={() => handleToggle(s)}
                  title={s.enabled ? 'Pause' : 'Resume'}
                >
                  {s.enabled ? 'ON' : 'OFF'}
                </button>
                <button className="sm-history-btn" onClick={() => loadExecutions(s.id)} title="View history">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                  </svg>
                </button>
                <button className="sm-delete-btn" onClick={() => handleDelete(s.id)} title="Delete">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            </div>
            <p className="sm-prompt-preview">{s.prompt.slice(0, 120)}{s.prompt.length > 120 ? '...' : ''}</p>

            {expandedId === s.id && (
              <div className="sm-executions">
                {(executions[s.id] ?? []).length === 0 ? (
                  <p className="sm-empty">No executions yet</p>
                ) : (
                  (executions[s.id] ?? []).map((exec) => (
                    <div key={exec.id} className={`sm-exec sm-exec-${exec.status}`}>
                      <span className="sm-exec-status">{exec.status}</span>
                      <span className="sm-exec-time">{exec.startedAt ?? ''}</span>
                      {exec.resultSummary && (
                        <p className="sm-exec-summary">{exec.resultSummary.slice(0, 200)}</p>
                      )}
                      {exec.errorMessage && (
                        <p className="sm-exec-error">{exec.errorMessage}</p>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
