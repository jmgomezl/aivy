import { useCallback, useEffect, useState } from 'react'
import { requestJson } from '../utils'
import { useToast } from '../hooks/useToast'
import type { AgentSchedule, ScheduleExecution } from '../types'
import './ScheduleManager.css'

const PRESETS = [
  { label: 'Every hour', cron: '0 * * * *' },
  { label: 'Every 6 hours', cron: '0 */6 * * *' },
  { label: 'Daily 9 AM', cron: '0 9 * * *' },
  { label: 'Weekly Monday', cron: '0 9 * * 1' },
]

/** Human-readable description of a cron expression */
function describeCron(cron: string): string {
  const cronMap: Record<string, string> = {
    '0 * * * *': 'Every hour',
    '*/30 * * * *': 'Every 30 minutes',
    '*/15 * * * *': 'Every 15 minutes',
    '*/5 * * * *': 'Every 5 minutes',
    '0 */2 * * *': 'Every 2 hours',
    '0 */3 * * *': 'Every 3 hours',
    '0 */6 * * *': 'Every 6 hours',
    '0 */12 * * *': 'Every 12 hours',
    '0 0 * * *': 'Daily at midnight',
    '0 9 * * *': 'Daily at 9 AM',
    '0 9 * * 1': 'Every Monday at 9 AM',
    '0 9 * * 1-5': 'Weekdays at 9 AM',
  }
  return cronMap[cron] ?? cron
}

type Props = {
  agentId: string
}

export default function ScheduleManager({ agentId }: Props) {
  const { addToast } = useToast()
  const [schedules, setSchedules] = useState<AgentSchedule[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [cron, setCron] = useState('0 * * * *')
  const [prompt, setPrompt] = useState('')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [runningId, setRunningId] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [executions, setExecutions] = useState<Record<string, ScheduleExecution[]>>({})

  const refresh = useCallback(async () => {
    try {
      const data = await requestJson<{ schedules: AgentSchedule[] }>(
        `/api/agents/${agentId}/schedules`,
      )
      setSchedules(data.schedules)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load schedules')
    }
    setLoading(false)
  }, [agentId])

  useEffect(() => { void refresh() }, [refresh])

  const handleCreate = async () => {
    setSaving(true)
    setError(null)
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
      addToast('Schedule created', 'success')
      await refresh()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create schedule'
      setError(msg)
      addToast(msg, 'error')
    }
    setSaving(false)
  }

  const handleToggle = async (schedule: AgentSchedule) => {
    setError(null)
    try {
      await requestJson(`/api/agents/${agentId}/schedules/${schedule.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !schedule.enabled }),
      })
      await refresh()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to toggle schedule'
      setError(msg)
      addToast(msg, 'error')
    }
  }

  const handleDelete = async (scheduleId: string) => {
    setError(null)
    try {
      await requestJson(`/api/agents/${agentId}/schedules/${scheduleId}`, {
        method: 'DELETE',
      })
      addToast('Schedule deleted', 'success')
      await refresh()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to delete schedule'
      setError(msg)
      addToast(msg, 'error')
    }
  }

  const handleRunNow = async (schedule: AgentSchedule) => {
    setRunningId(schedule.id)
    setError(null)
    try {
      const data = await requestJson<{ status: string; result?: string; error?: string }>(
        `/api/agents/${agentId}/schedules/${schedule.id}/run`,
        { method: 'POST' },
      )
      if (data.status === 'completed') {
        addToast('Schedule executed successfully', 'success')
      } else {
        addToast(data.error ?? 'Execution failed', 'error')
      }
      await refresh()
      // Auto-expand execution history (capture id to avoid race condition)
      const sid = schedule.id
      try {
        const execData = await requestJson<{ executions: ScheduleExecution[] }>(
          `/api/agents/${agentId}/schedules/${sid}/executions`,
        )
        setExecutions((prev) => ({ ...prev, [sid]: execData.executions }))
        setExpandedId(sid)
      } catch { /* non-critical */ }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to run schedule'
      setError(msg)
      addToast(msg, 'error')
    }
    setRunningId(null)
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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load executions')
    }
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

      {error && <p className="sm-error">{error}</p>}

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
                <span className="sm-schedule-label">{describeCron(s.cronExpression)}</span>
                {s.description && <span className="sm-desc">{s.description}</span>}
                <span className="sm-status-line">
                  {s.enabled ? (
                    <span className="sm-active-dot" />
                  ) : (
                    <span className="sm-paused-dot" />
                  )}
                  {s.enabled ? 'Active' : 'Paused'}
                </span>
              </div>
              <div className="sm-item-actions">
                <button
                  className="sm-run-now-btn"
                  onClick={() => handleRunNow(s)}
                  disabled={runningId === s.id}
                >
                  {runningId === s.id ? 'Running...' : 'Run Now'}
                </button>
                <button
                  className={`sm-toggle ${s.enabled ? 'on' : 'off'}`}
                  onClick={() => handleToggle(s)}
                  title={s.enabled ? 'Pause schedule' : 'Resume schedule'}
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
                  (executions[s.id] ?? []).map((exec) => {
                    const statusLabel = exec.status === 'cap_exceeded' ? 'CAP EXCEEDED' : exec.status
                    return (
                      <div key={exec.id} className={`sm-exec sm-exec-${exec.status}`}>
                        <span className="sm-exec-status">{statusLabel}</span>
                        <span className="sm-exec-time">{exec.startedAt ?? ''}</span>
                        {exec.resultSummary && (
                          <p className="sm-exec-summary">{exec.resultSummary}</p>
                        )}
                        {exec.errorMessage && (
                          <p className="sm-exec-error">{exec.errorMessage}</p>
                        )}
                      </div>
                    )
                  })
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
