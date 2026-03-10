import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  LiveAgent,
  ToolCatalogResponse,
  ToolCatalogEntry,
  ToolWorkflow,
  ToolFormField,
  CapabilityGroupId,
} from '../types'
import { toneClass } from '../data'
import { deepClone, pruneToolParams, resolveWorkflowValue, requestJson } from '../utils'
import type { ToolInvokeResponse, ResultDrawerState } from '../types'
import { summarizeResultReferences } from '../utils'
import './ToolLibrary.css'

type ToolLibraryProps = {
  agent: LiveAgent
  catalog: ToolCatalogResponse
  operatorAccountId: string | null
  onClose: () => void
  onResult: (drawer: ResultDrawerState) => void
  onRefresh: () => void
  initialToolName?: string
  initialParams?: Record<string, unknown>
}

export default function ToolLibrary({
  agent,
  catalog,
  operatorAccountId,
  onClose,
  onResult,
  onRefresh,
  initialToolName,
  initialParams,
}: ToolLibraryProps) {
  const [toolSearch, setToolSearch] = useState('')
  const [activeGroupId, setActiveGroupId] = useState<CapabilityGroupId | ''>('')
  const [selectedToolName, setSelectedToolName] = useState(initialToolName ?? '')
  const [formValues, setFormValues] = useState<Record<string, unknown>>(initialParams ?? {})
  const [paramsText, setParamsText] = useState(JSON.stringify(initialParams ?? {}, null, 2))
  const [editorMode, setEditorMode] = useState<'guided' | 'json'>('guided')
  const [resultMessage, setResultMessage] = useState('')
  const [isRunning, setIsRunning] = useState(false)

  const toolGroups = catalog.groups
  const toolEntries = catalog.tools

  const enabledGroups = new Set(agent.capabilityGroups)

  const availableTools = useMemo(
    () => toolEntries.filter((e) => enabledGroups.has(e.groupId)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- enabledGroups is derived from agent.capabilityGroups
    [toolEntries, agent.capabilityGroups],
  )

  const filteredTools = useMemo(() => {
    const query = toolSearch.trim().toLowerCase()
    return availableTools.filter((entry) => {
      const matchGroup = !activeGroupId || entry.groupId === activeGroupId
      const matchQuery =
        !query ||
        entry.label.toLowerCase().includes(query) ||
        entry.description.toLowerCase().includes(query)
      return matchGroup && matchQuery
    })
  }, [availableTools, activeGroupId, toolSearch])

  const selectedTool = toolEntries.find((e) => e.name === selectedToolName) ?? null
  const selectedGroup = toolGroups.find(
    (g) => g.id === (selectedTool?.groupId ?? activeGroupId),
  )

  const workflows = useMemo(
    () => catalog.workflowsByTemplate[agent.templateId] ?? [],
    [catalog, agent.templateId],
  )

  const primeToolState = useCallback(
    (entry: ToolCatalogEntry, params?: Record<string, unknown>) => {
      const nextParams = deepClone(params ?? entry.example ?? {})
      setSelectedToolName(entry.name)
      setFormValues(nextParams)
      setParamsText(JSON.stringify(nextParams, null, 2))
      setEditorMode(entry.form ? 'guided' : 'json')
      setResultMessage('')
    },
    [],
  )

  // Initialize
  useEffect(() => {
    if (initialToolName) {
      const entry = toolEntries.find((e) => e.name === initialToolName)
      if (entry) {
        setActiveGroupId(entry.groupId)
        primeToolState(entry, initialParams)
        return
      }
    }
    if (availableTools.length > 0 && !selectedToolName) {
      setActiveGroupId(availableTools[0].groupId)
      primeToolState(availableTools[0])
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount
  }, [])

  const updateField = (id: string, value: unknown) => {
    setFormValues((current) => {
      const next = { ...current, [id]: value }
      setParamsText(JSON.stringify(next, null, 2))
      return next
    })
  }

  const updateTransferRow = (index: number, field: 'accountId' | 'amount', value: string) => {
    const transfers = Array.isArray(formValues['transfers'])
      ? deepClone(formValues['transfers'])
      : [{ accountId: '', amount: 1 }]
    const next = transfers.map((item, i) => {
      if (i !== index || !item || typeof item !== 'object') return item
      return { ...(item as Record<string, unknown>), [field]: field === 'amount' ? (value === '' ? '' : Number(value)) : value }
    })
    updateField('transfers', next)
  }

  const addTransferRow = () => {
    const transfers = Array.isArray(formValues['transfers'])
      ? deepClone(formValues['transfers'])
      : []
    transfers.push({ accountId: '', amount: 1 })
    updateField('transfers', transfers)
  }

  const removeTransferRow = (index: number) => {
    const transfers = Array.isArray(formValues['transfers'])
      ? deepClone(formValues['transfers'])
      : []
    const next = transfers.filter((_: unknown, i: number) => i !== index)
    updateField('transfers', next.length > 0 ? next : [{ accountId: '', amount: 1 }])
  }

  const runWorkflow = (wf: ToolWorkflow) => {
    const resolved = resolveWorkflowValue(wf.params, {
      operatorAccountId,
      selectedAgent: agent,
    }) as Record<string, unknown>
    const entry = toolEntries.find((e) => e.name === wf.toolName)
    if (entry) {
      setActiveGroupId(entry.groupId)
      primeToolState(entry, resolved)
    }
  }

  const switchMode = (mode: 'guided' | 'json') => {
    if (mode === 'guided' && selectedTool?.form) {
      try {
        const parsed = paramsText.trim() ? JSON.parse(paramsText) : {}
        setFormValues(parsed)
      } catch {
        setResultMessage('JSON must be valid before switching to guided mode.')
        return
      }
    }
    if (mode === 'json') {
      const nextParams = selectedTool?.form && editorMode === 'guided'
        ? ((pruneToolParams(formValues) as Record<string, unknown>) ?? {})
        : formValues
      setParamsText(JSON.stringify(nextParams, null, 2))
    }
    setEditorMode(mode)
  }

  const handleRun = async () => {
    if (!selectedTool) return

    let parsedParams: Record<string, unknown> = {}
    if (selectedTool.form && editorMode === 'guided') {
      parsedParams = (pruneToolParams(formValues) as Record<string, unknown>) ?? {}
    } else {
      try {
        parsedParams = paramsText.trim() ? JSON.parse(paramsText) : {}
      } catch {
        setResultMessage('Parameters must be valid JSON before running a tool.')
        return
      }
    }

    setIsRunning(true)
    try {
      const result = await requestJson<ToolInvokeResponse>(
        `/api/agents/${agent.id}/tools/${selectedTool.name}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ params: parsedParams }),
        },
      )
      const message = result.result.humanMessage ?? `${result.tool.label} finished successfully.`
      setResultMessage(message)
      onResult({
        title: result.tool.label,
        message: `${message} ${summarizeResultReferences(result.references)}`,
        references: result.references,
      })
      await onRefresh()
    } catch (error) {
      setResultMessage(error instanceof Error ? error.message : 'Tool execution failed.')
    } finally {
      setIsRunning(false)
    }
  }

  const renderField = (field: ToolFormField) => {
    const value = formValues[field.id]

    if (field.input === 'lineList') {
      return (
        <label className="tl-field tl-field-full" key={field.id}>
          <span>{field.label}</span>
          <textarea
            onChange={(e) => updateField(field.id, e.target.value.split('\n').map((l) => l.trim()).filter(Boolean))}
            placeholder={field.placeholder ?? 'One item per line'}
            value={Array.isArray(value) ? value.join('\n') : ''}
          />
          {field.help && <small>{field.help}</small>}
        </label>
      )
    }

    if (field.input === 'textarea') {
      return (
        <label className="tl-field" key={field.id}>
          <span>{field.label}</span>
          <textarea onChange={(e) => updateField(field.id, e.target.value)} placeholder={field.placeholder} value={typeof value === 'string' ? value : ''} />
          {field.help && <small>{field.help}</small>}
        </label>
      )
    }

    if (field.input === 'boolean') {
      return (
        <label className="tl-field tl-field-bool" key={field.id}>
          <div><span>{field.label}</span>{field.help && <small>{field.help}</small>}</div>
          <button className={value ? 'dm-toggle is-on' : 'dm-toggle'} onClick={() => updateField(field.id, !value)} type="button">
            {value ? 'ON' : 'OFF'}
          </button>
        </label>
      )
    }

    if (field.input === 'select') {
      return (
        <label className="tl-field" key={field.id}>
          <span>{field.label}</span>
          <select onChange={(e) => updateField(field.id, e.target.value)} value={typeof value === 'string' ? value : ''}>
            <option value="">Select</option>
            {field.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          {field.help && <small>{field.help}</small>}
        </label>
      )
    }

    if (field.input === 'hbarTransfers') {
      const transfers = Array.isArray(value) && value.length > 0 ? value : [{ accountId: '', amount: 1 }]
      return (
        <div className="tl-field tl-field-full" key={field.id}>
          <div className="tl-transfer-head">
            <div><span>{field.label}</span>{field.help && <small>{field.help}</small>}</div>
            <button className="tl-small-btn" onClick={addTransferRow} type="button">Add row</button>
          </div>
          <div className="tl-transfer-list">
            {transfers.map((item, index) => {
              const t = item && typeof item === 'object' ? (item as Record<string, unknown>) : { accountId: '', amount: 1 }
              return (
                <div className="tl-transfer-row" key={`${field.id}-${index}`}>
                  <input type="text" placeholder="Recipient" value={typeof t.accountId === 'string' ? t.accountId : ''} onChange={(e) => updateTransferRow(index, 'accountId', e.target.value)} />
                  <input type="number" placeholder="HBAR" step="0.01" min="0" value={typeof t.amount === 'number' || typeof t.amount === 'string' ? String(t.amount) : ''} onChange={(e) => updateTransferRow(index, 'amount', e.target.value)} />
                  <button className="tl-small-btn" onClick={() => removeTransferRow(index)} type="button">-</button>
                </div>
              )
            })}
          </div>
        </div>
      )
    }

    return (
      <label className="tl-field" key={field.id}>
        <span>{field.label}</span>
        <input
          type={field.input === 'number' ? 'number' : 'text'}
          min={field.input === 'number' ? '0' : undefined}
          onChange={(e) => updateField(field.id, field.input === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value)}
          placeholder={field.placeholder}
          value={typeof value === 'number' || typeof value === 'string' ? String(value) : ''}
        />
        {field.help && <small>{field.help}</small>}
      </label>
    )
  }

  return (
    <div className="tl-overlay" onClick={onClose}>
      <div className="tl-modal" onClick={(e) => e.stopPropagation()}>
        <div className="tl-header">
          <div>
            <span className="tl-kicker">Tool Library</span>
            <h2>{agent.name}</h2>
          </div>
          <button className="dm-close" onClick={onClose} type="button">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="tl-layout">
          <aside className="tl-sidebar">
            <input
              className="tl-search"
              onChange={(e) => setToolSearch(e.target.value)}
              placeholder="Search tools"
              type="text"
              value={toolSearch}
            />

            <div className="tl-group-chips">
              {toolGroups
                .filter((g) => enabledGroups.has(g.id))
                .map((g) => (
                  <button
                    className={activeGroupId === g.id ? `ap-chip ${toneClass[g.tone]} is-active-chip` : `ap-chip ${toneClass[g.tone]}`}
                    key={g.id}
                    onClick={() => setActiveGroupId(g.id)}
                    type="button"
                  >
                    {g.label}
                  </button>
                ))}
            </div>

            <div className="tl-tool-list">
              {filteredTools.map((tool) => (
                <button
                  className={selectedToolName === tool.name ? 'tl-tool-card is-active' : 'tl-tool-card'}
                  key={tool.name}
                  onClick={() => primeToolState(tool)}
                  type="button"
                >
                  <strong>{tool.label}</strong>
                  <span>{tool.kind === 'query' ? 'Query' : 'Mutation'}</span>
                </button>
              ))}
            </div>
          </aside>

          <section className="tl-detail">
            {selectedTool ? (
              <>
                <div className="tl-detail-head">
                  <div>
                    <span className="tl-kicker">{selectedGroup?.label ?? 'Tool'}</span>
                    <h3>{selectedTool.label}</h3>
                  </div>
                  <span className="tl-badge">{selectedTool.kind === 'query' ? 'Read' : 'Write'}</span>
                </div>

                <p className="tl-desc">{selectedTool.description}</p>

                {workflows.some((w) => w.toolName === selectedTool.name) && (
                  <div className="tl-flows">
                    <span className="tl-kicker">Ready-made flows</span>
                    <div className="tl-flow-row">
                      {workflows.filter((w) => w.toolName === selectedTool.name).map((w) => (
                        <button className="ap-workflow" key={w.id} onClick={() => runWorkflow(w)} type="button">
                          <strong>{w.title}</strong>
                          <p>{w.description}</p>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {selectedTool.parameterHints.length > 0 && (
                  <div className="tl-hints">
                    {selectedTool.parameterHints.map((h) => <div className="tl-hint" key={h}>{h}</div>)}
                  </div>
                )}

                <div className="tl-editor">
                  <div className="tl-editor-head">
                    <span className="tl-kicker">{selectedTool.form && editorMode === 'guided' ? 'Guided form' : 'Advanced JSON'}</span>
                    <div className="tl-editor-actions">
                      {selectedTool.form && (
                        <>
                          <button className={editorMode === 'guided' ? 'tl-small-btn is-active' : 'tl-small-btn'} onClick={() => switchMode('guided')} type="button">Guided</button>
                          <button className={editorMode === 'json' ? 'tl-small-btn is-active' : 'tl-small-btn'} onClick={() => switchMode('json')} type="button">JSON</button>
                        </>
                      )}
                      <button className="tl-small-btn" onClick={() => primeToolState(selectedTool)} type="button">Reset</button>
                    </div>
                  </div>

                  {selectedTool.form && editorMode === 'guided' ? (
                    <div className="tl-form-grid">{selectedTool.form.fields.map((f) => renderField(f))}</div>
                  ) : (
                    <textarea className="tl-json" onChange={(e) => setParamsText(e.target.value)} value={paramsText} />
                  )}
                </div>

                {isRunning && (
                  <div className="tl-running-indicator">
                    <span className="tl-spinner" />
                    <span>Executing on Hedera testnet...</span>
                  </div>
                )}

                {resultMessage && !isRunning && <div className="tl-result">{resultMessage}</div>}

                <div className="tl-footer">
                  <button className="dm-deploy" onClick={handleRun} disabled={isRunning} type="button">
                    {isRunning ? 'Executing...' : `Run ${selectedTool.label}`}
                  </button>
                </div>
              </>
            ) : (
              <div className="tl-empty">
                <p>Select a tool to configure and run it.</p>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
