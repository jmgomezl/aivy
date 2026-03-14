import { describe, it, expect, beforeAll, vi } from 'vitest'

// Set env before importing modules
process.env.JWT_SECRET = 'a'.repeat(32)

import {
  initAuth,
  generateChallenge,
  consumeChallenge,
  verifyAccountExists,
  issueToken,
  verifyToken,
} from '../../server/auth'

beforeAll(() => {
  initAuth()
})

// ─── initAuth ─────────────────────────────────────────────
describe('initAuth', () => {
  it('succeeds with a valid 32+ char JWT_SECRET', () => {
    expect(() => initAuth()).not.toThrow()
  })

  it('auto-generates secret when not set (non-production)', () => {
    const original = process.env.JWT_SECRET
    delete process.env.JWT_SECRET
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(() => initAuth()).not.toThrow()
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
    process.env.JWT_SECRET = original
    initAuth()
  })

  it('throws in production without JWT_SECRET', () => {
    const originalKey = process.env.JWT_SECRET
    const originalEnv = process.env.NODE_ENV
    delete process.env.JWT_SECRET
    process.env.NODE_ENV = 'production'
    expect(() => initAuth()).toThrow('required in production')
    process.env.NODE_ENV = originalEnv
    process.env.JWT_SECRET = originalKey
    initAuth()
  })

  it('auto-generates when JWT_SECRET is too short', () => {
    const original = process.env.JWT_SECRET
    process.env.JWT_SECRET = 'short'
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(() => initAuth()).not.toThrow()
    warnSpy.mockRestore()
    process.env.JWT_SECRET = original
    initAuth()
  })
})

// ─── generateChallenge ────────────────────────────────────
describe('generateChallenge', () => {
  it('returns an object with a challenge string', () => {
    const result = generateChallenge('0.0.12345')
    expect(result).toHaveProperty('challenge')
    expect(typeof result.challenge).toBe('string')
  })

  it('challenge starts with the Sign-in prefix', () => {
    const { challenge } = generateChallenge('0.0.99999')
    expect(challenge).toMatch(/^Sign-in to Aivy: /)
  })

  it('generates unique nonces each time', () => {
    const a = generateChallenge('0.0.1')
    const b = generateChallenge('0.0.2')
    expect(a.challenge).not.toBe(b.challenge)
  })
})

// ─── consumeChallenge ─────────────────────────────────────
describe('consumeChallenge', () => {
  it('returns the nonce for a valid pending challenge', () => {
    const { challenge } = generateChallenge('0.0.100')
    const nonce = consumeChallenge('0.0.100')
    expect(nonce).toBe(challenge.replace('Sign-in to Aivy: ', ''))
  })

  it('returns null when no challenge exists', () => {
    expect(consumeChallenge('0.0.nonexistent')).toBeNull()
  })

  it('consumes the challenge (cannot use twice)', () => {
    generateChallenge('0.0.200')
    const first = consumeChallenge('0.0.200')
    expect(first).not.toBeNull()
    const second = consumeChallenge('0.0.200')
    expect(second).toBeNull()
  })

  it('returns null for an expired challenge', () => {
    // Manually test expiry by generating then advancing time
    generateChallenge('0.0.300')
    // Spy on Date.now to simulate expiry
    const realNow = Date.now
    vi.spyOn(Date, 'now').mockReturnValue(realNow() + 6 * 60 * 1000) // 6 minutes later
    const result = consumeChallenge('0.0.300')
    expect(result).toBeNull()
    vi.restoreAllMocks()
  })
})

// ─── issueToken / verifyToken ─────────────────────────────
describe('issueToken & verifyToken', () => {
  it('issues a valid JWT that can be verified', () => {
    const token = issueToken('user-abc', '0.0.12345')
    expect(typeof token).toBe('string')
    expect(token.split('.')).toHaveLength(3) // JWT has 3 parts

    const payload = verifyToken(token)
    expect(payload).not.toBeNull()
    expect(payload!.sub).toBe('user-abc')
    expect(payload!.accountId).toBe('0.0.12345')
  })

  it('returns null for a garbage token', () => {
    expect(verifyToken('not-a-jwt')).toBeNull()
  })

  it('returns null for a tampered token', () => {
    const token = issueToken('user-x', '0.0.1')
    const tampered = token.slice(0, -5) + 'XXXXX'
    expect(verifyToken(tampered)).toBeNull()
  })

  it('encodes the accountId and sub correctly', () => {
    const token = issueToken('demo-user', 'guest')
    const payload = verifyToken(token)
    expect(payload).toEqual(expect.objectContaining({
      sub: 'demo-user',
      accountId: 'guest',
    }))
  })
})

// ─── verifyAccountExists ──────────────────────────────────
describe('verifyAccountExists', () => {
  it('returns true when mirror node responds with 200', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ account: '0.0.12345' }), { status: 200 }),
    )
    const exists = await verifyAccountExists('0.0.12345', 'https://testnet.mirrornode.hedera.com/api/v1')
    expect(exists).toBe(true)
    vi.restoreAllMocks()
  })

  it('returns false when mirror node responds with 404', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('not found', { status: 404 }),
    )
    const exists = await verifyAccountExists('0.0.99999', 'https://testnet.mirrornode.hedera.com/api/v1')
    expect(exists).toBe(false)
    vi.restoreAllMocks()
  })

  it('returns false when fetch throws', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('network error'))
    const exists = await verifyAccountExists('0.0.12345', 'https://testnet.mirrornode.hedera.com/api/v1')
    expect(exists).toBe(false)
    vi.restoreAllMocks()
  })
})
