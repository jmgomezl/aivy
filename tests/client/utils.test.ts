import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  requestJson,
  deepClone,
  pruneToolParams,
  resolveWorkflowValue,
  buildLaunchPayload,
  summarizeResultReferences,
} from '../../src/utils'
import type { AgentTemplate, ResultReference, LiveAgent } from '../../src/types'

// ─── requestJson ──────────────────────────────────────────
describe('requestJson', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns parsed JSON on success', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ data: 'hello' }), { status: 200 }),
    )
    const result = await requestJson<{ data: string }>('/api/test')
    expect(result.data).toBe('hello')
  })

  it('includes auth headers from localStorage token', async () => {
    localStorage.setItem('aivy-token', 'test-jwt-token')
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({}), { status: 200 }),
    )
    await requestJson('/api/test')
    const call = vi.mocked(fetch).mock.calls[0]
    const headers = call[1]?.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer test-jwt-token')
    localStorage.clear()
  })

  it('throws when fetch rejects (network error)', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('network down'))
    await expect(requestJson('/api/test')).rejects.toThrow('Cannot reach the backend server')
  })

  it('throws on 502 with backend offline message', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('<html>Bad Gateway</html>', { status: 502 }),
    )
    await expect(requestJson('/api/test')).rejects.toThrow('Backend server is offline')
  })

  it('throws on 504 with backend offline message', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('<html>Gateway Timeout</html>', { status: 504 }),
    )
    await expect(requestJson('/api/test')).rejects.toThrow('Backend server is offline')
  })

  it('throws with error message from JSON body', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Agent not found' }), { status: 404 }),
    )
    await expect(requestJson('/api/test')).rejects.toThrow('Agent not found')
  })

  it('throws with formErrors from Zod validation', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { formErrors: ['Name is required'] } }), { status: 400 }),
    )
    await expect(requestJson('/api/test')).rejects.toThrow('Name is required')
  })

  it('throws generic message when error body is not JSON', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('plain text error', {
        status: 422,
        headers: { 'Content-Type': 'text/plain' },
      }),
    )
    await expect(requestJson('/api/test')).rejects.toThrow('Request failed with status 422')
  })

  it('returns undefined for 204 No Content', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(null, { status: 204 }),
    )
    const result = await requestJson('/api/test')
    expect(result).toBeUndefined()
  })

  it('merges custom headers with auth headers', async () => {
    localStorage.setItem('aivy-token', 'jwt-abc')
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({}), { status: 200 }),
    )
    await requestJson('/api/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    const call = vi.mocked(fetch).mock.calls[0]
    const headers = call[1]?.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer jwt-abc')
    expect(headers['Content-Type']).toBe('application/json')
    localStorage.clear()
  })
})

// ─── deepClone ────────────────────────────────────────────
describe('deepClone', () => {
  it('clones a simple object', () => {
    const original = { a: 1, b: 'hello' }
    const cloned = deepClone(original)
    expect(cloned).toEqual(original)
    expect(cloned).not.toBe(original)
  })

  it('deep clones nested objects', () => {
    const original = { a: { b: { c: 42 } } }
    const cloned = deepClone(original)
    expect(cloned.a.b.c).toBe(42)
    cloned.a.b.c = 99
    expect(original.a.b.c).toBe(42) // original unchanged
  })

  it('clones arrays', () => {
    const original = [1, 2, [3, 4]]
    const cloned = deepClone(original)
    expect(cloned).toEqual(original)
    expect(cloned).not.toBe(original)
    expect(cloned[2]).not.toBe(original[2])
  })

  it('handles null and primitives', () => {
    expect(deepClone(null)).toBeNull()
    expect(deepClone(42)).toBe(42)
    expect(deepClone('string')).toBe('string')
  })
})

// ─── pruneToolParams ──────────────────────────────────────
describe('pruneToolParams', () => {
  it('trims and returns non-empty strings', () => {
    expect(pruneToolParams('  hello  ')).toBe('hello')
  })

  it('returns undefined for empty/whitespace strings', () => {
    expect(pruneToolParams('')).toBeUndefined()
    expect(pruneToolParams('   ')).toBeUndefined()
  })

  it('returns finite numbers', () => {
    expect(pruneToolParams(42)).toBe(42)
    expect(pruneToolParams(0)).toBe(0)
    expect(pruneToolParams(-5.5)).toBe(-5.5)
  })

  it('returns undefined for non-finite numbers', () => {
    expect(pruneToolParams(Infinity)).toBeUndefined()
    expect(pruneToolParams(NaN)).toBeUndefined()
  })

  it('returns booleans as-is', () => {
    expect(pruneToolParams(true)).toBe(true)
    expect(pruneToolParams(false)).toBe(false)
  })

  it('prunes empty arrays to undefined', () => {
    expect(pruneToolParams([])).toBeUndefined()
  })

  it('removes undefined items from arrays', () => {
    expect(pruneToolParams(['hello', '', 'world'])).toEqual(['hello', 'world'])
  })

  it('prunes empty objects to undefined', () => {
    expect(pruneToolParams({})).toBeUndefined()
    expect(pruneToolParams({ a: '', b: '' })).toBeUndefined()
  })

  it('removes undefined entries from objects', () => {
    expect(pruneToolParams({ a: 'keep', b: '', c: 42 })).toEqual({ a: 'keep', c: 42 })
  })

  it('handles nested structures', () => {
    const input = {
      name: 'test',
      empty: '',
      nested: {
        value: 42,
        trash: '   ',
        list: ['good', '', 'items'],
      },
    }
    expect(pruneToolParams(input)).toEqual({
      name: 'test',
      nested: {
        value: 42,
        list: ['good', 'items'],
      },
    })
  })

  it('returns undefined for null/undefined', () => {
    expect(pruneToolParams(null)).toBeUndefined()
    expect(pruneToolParams(undefined)).toBeUndefined()
  })
})

// ─── resolveWorkflowValue ─────────────────────────────────
describe('resolveWorkflowValue', () => {
  const context = {
    operatorAccountId: '0.0.100',
    selectedAgent: {
      topicId: '0.0.200',
      deploymentTxId: '0.0.300@123',
    } as unknown as LiveAgent,
  }

  it('replaces {{operatorAccountId}} in strings', () => {
    expect(resolveWorkflowValue('Account: {{operatorAccountId}}', context)).toBe('Account: 0.0.100')
  })

  it('replaces {{selectedAgent.topicId}} in strings', () => {
    expect(resolveWorkflowValue('Topic: {{selectedAgent.topicId}}', context)).toBe('Topic: 0.0.200')
  })

  it('replaces {{selectedAgent.deploymentTxId}}', () => {
    expect(resolveWorkflowValue('Tx: {{selectedAgent.deploymentTxId}}', context)).toBe('Tx: 0.0.300@123')
  })

  it('replaces multiple placeholders in one string', () => {
    const input = '{{operatorAccountId}} owns topic {{selectedAgent.topicId}}'
    expect(resolveWorkflowValue(input, context)).toBe('0.0.100 owns topic 0.0.200')
  })

  it('handles null context values gracefully', () => {
    const nullCtx = { operatorAccountId: null, selectedAgent: null }
    expect(resolveWorkflowValue('ID: {{operatorAccountId}}', nullCtx)).toBe('ID: ')
  })

  it('recursively resolves arrays', () => {
    const input = ['{{operatorAccountId}}', '{{selectedAgent.topicId}}']
    expect(resolveWorkflowValue(input, context)).toEqual(['0.0.100', '0.0.200'])
  })

  it('recursively resolves objects', () => {
    const input = { id: '{{operatorAccountId}}', topic: '{{selectedAgent.topicId}}' }
    expect(resolveWorkflowValue(input, context)).toEqual({ id: '0.0.100', topic: '0.0.200' })
  })

  it('returns non-string primitives as-is', () => {
    expect(resolveWorkflowValue(42, context)).toBe(42)
    expect(resolveWorkflowValue(true, context)).toBe(true)
    expect(resolveWorkflowValue(null, context)).toBeNull()
  })
})

// ─── buildLaunchPayload ───────────────────────────────────
describe('buildLaunchPayload', () => {
  const makeTemplate = (id: string): AgentTemplate => ({
    id,
    name: 'Test Agent',
    glyph: 'TA',
    sprite: '/sprite.svg',
    color: '#fff',
    room: 'Launch Bay',
    mission: 'Test mission.',
    description: 'Test description.',
    guardrail: 'Test guardrail',
  })

  it('treasury-sentinel: uses vaultCapHbar and policyMode', () => {
    const result = buildLaunchPayload(
      makeTemplate('treasury-sentinel'),
      { agentLabel: 'My Treasury', vaultCapHbar: 100, policyMode: 'treasury team only', launchNote: 'Custom note' },
      1,
      true,
    )
    expect(result.name).toBe('My Treasury')
    expect(result.vaultCapHbar).toBe(100)
    expect(result.guardrail).toContain('100 HBAR')
    expect(result.guardrail).toContain('treasury team only')
    expect(result.launchNote).toBe('Custom note')
  })

  it('treasury-sentinel: uses defaults when values missing', () => {
    const result = buildLaunchPayload(
      makeTemplate('treasury-sentinel'),
      {},
      3,
      true,
    )
    expect(result.name).toBe('Test Agent 3')
    expect(result.vaultCapHbar).toBe(250) // default
    expect(result.launchNote).toBe('Test mission.') // falls back to mission
  })

  it('yield-router: includes slippage', () => {
    const result = buildLaunchPayload(
      makeTemplate('yield-router'),
      { agentLabel: 'Yield Bot', vaultCapHbar: 50, slippageBps: 100, policyMode: 'blue-chip DeFi' },
      1,
      true,
    )
    expect(result.guardrail).toContain('50 HBAR')
    expect(result.guardrail).toContain('100 bps')
    expect(result.guardrail).toContain('blue-chip DeFi')
  })

  it('yield-router: vaultCapHbar is 0 when vaultRequired is false', () => {
    const result = buildLaunchPayload(makeTemplate('yield-router'), {}, 1, false)
    expect(result.vaultCapHbar).toBe(0)
  })

  it('compliance-clerk: includes evidence mode', () => {
    const result = buildLaunchPayload(
      makeTemplate('compliance-clerk'),
      { agentLabel: 'Auditor', policyMode: 'high-value actions', evidenceMode: 'topic only' },
      1,
      true,
    )
    expect(result.guardrail).toContain('high-value actions')
    expect(result.guardrail).toContain('topic only')
  })

  it('governance-relay: uses threshold and timelock', () => {
    const result = buildLaunchPayload(
      makeTemplate('governance-relay'),
      { agentLabel: 'Gov Bot', threshold: 5, timelockHours: 48 },
      1,
      true,
    )
    expect(result.guardrail).toContain('5 approvals')
    expect(result.guardrail).toContain('48 hour timelock')
  })

  it('trims agent label whitespace', () => {
    const result = buildLaunchPayload(
      makeTemplate('treasury-sentinel'),
      { agentLabel: '  Spaced Name  ' },
      1,
      true,
    )
    expect(result.name).toBe('Spaced Name')
  })
})

// ─── summarizeResultReferences ────────────────────────────
describe('summarizeResultReferences', () => {
  const ref = (label: string): ResultReference => ({
    label,
    entityId: '0.0.1',
    url: 'https://example.com',
  })

  it('returns fallback for empty array', () => {
    expect(summarizeResultReferences([])).toContain('No on-chain objects')
  })

  it('identifies contract deployments', () => {
    expect(summarizeResultReferences([ref('Contract')])).toContain('Contract deployment')
  })

  it('identifies contract address references', () => {
    expect(summarizeResultReferences([ref('Contract Address')])).toContain('Contract deployment')
  })

  it('identifies topic references', () => {
    expect(summarizeResultReferences([ref('Topic')])).toContain('Consensus')
  })

  it('identifies token references', () => {
    expect(summarizeResultReferences([ref('Token')])).toContain('Token state')
  })

  it('identifies transaction references', () => {
    expect(summarizeResultReferences([ref('Transaction')])).toContain('transaction settled')
  })

  it('returns generic message for unknown types', () => {
    expect(summarizeResultReferences([ref('Something Else')])).toContain('Hedera references')
  })
})
