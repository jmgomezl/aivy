import { describe, it, expect, beforeEach } from 'vitest'
import {
  getToken,
  setToken,
  clearToken,
  getAuthHeaders,
  getSessionAccountId,
} from '../../src/lib/auth'

beforeEach(() => {
  localStorage.clear()
})

// ─── getToken / setToken ──────────────────────────────────
describe('getToken & setToken', () => {
  it('returns null when no token is stored', () => {
    expect(getToken()).toBeNull()
  })

  it('stores and retrieves a token', () => {
    setToken('abc123')
    expect(getToken()).toBe('abc123')
  })

  it('overwrites a previous token', () => {
    setToken('first')
    setToken('second')
    expect(getToken()).toBe('second')
  })
})

// ─── clearToken ───────────────────────────────────────────
describe('clearToken', () => {
  it('removes the stored token', () => {
    setToken('to-be-removed')
    clearToken()
    expect(getToken()).toBeNull()
  })

  it('is safe to call when no token exists', () => {
    expect(() => clearToken()).not.toThrow()
  })
})

// ─── getAuthHeaders ───────────────────────────────────────
describe('getAuthHeaders', () => {
  it('returns empty object when no token', () => {
    expect(getAuthHeaders()).toEqual({})
  })

  it('returns Authorization: Bearer header with token', () => {
    setToken('mytoken')
    expect(getAuthHeaders()).toEqual({ Authorization: 'Bearer mytoken' })
  })
})

// ─── getSessionAccountId ──────────────────────────────────
describe('getSessionAccountId', () => {
  function makeJWT(payload: Record<string, unknown>): string {
    const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
    const body = btoa(JSON.stringify(payload))
    return `${header}.${body}.fake-signature`
  }

  it('returns null when no token is stored', () => {
    expect(getSessionAccountId()).toBeNull()
  })

  it('returns accountId from a valid JWT', () => {
    const token = makeJWT({
      sub: 'user-1',
      accountId: '0.0.12345',
      exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
    })
    setToken(token)
    expect(getSessionAccountId()).toBe('0.0.12345')
  })

  it('returns null for expired JWT and clears the token', () => {
    const token = makeJWT({
      sub: 'user-1',
      accountId: '0.0.12345',
      exp: Math.floor(Date.now() / 1000) - 3600, // 1 hour ago
    })
    setToken(token)
    expect(getSessionAccountId()).toBeNull()
    expect(getToken()).toBeNull() // token was cleared
  })

  it('returns null for malformed token', () => {
    setToken('not-a-jwt')
    expect(getSessionAccountId()).toBeNull()
  })

  it('returns null when accountId is missing from payload', () => {
    const token = makeJWT({
      sub: 'user-1',
      exp: Math.floor(Date.now() / 1000) + 3600,
    })
    setToken(token)
    expect(getSessionAccountId()).toBeNull()
  })

  it('returns accountId when no expiry is set', () => {
    const token = makeJWT({
      sub: 'user-1',
      accountId: '0.0.99999',
    })
    setToken(token)
    expect(getSessionAccountId()).toBe('0.0.99999')
  })
})
