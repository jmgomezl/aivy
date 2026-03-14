import { describe, it, expect, beforeAll, vi } from 'vitest'

// Must set env before import
process.env.MASTER_ENCRYPTION_KEY = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'

import { initMasterKey, encrypt, decrypt, isEncrypted } from '../../server/crypto'

beforeAll(() => {
  initMasterKey()
})

// ─── initMasterKey ────────────────────────────────────────
describe('initMasterKey', () => {
  it('accepts a valid 64-hex-char key', () => {
    expect(() => initMasterKey()).not.toThrow()
  })

  it('throws for wrong-length key', () => {
    const original = process.env.MASTER_ENCRYPTION_KEY
    process.env.MASTER_ENCRYPTION_KEY = 'tooshort'
    expect(() => initMasterKey()).toThrow('64 hex characters')
    process.env.MASTER_ENCRYPTION_KEY = original
  })

  it('auto-generates key when not set (non-production)', () => {
    const original = process.env.MASTER_ENCRYPTION_KEY
    delete process.env.MASTER_ENCRYPTION_KEY
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(() => initMasterKey()).not.toThrow()
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
    // Restore so other tests continue working
    process.env.MASTER_ENCRYPTION_KEY = original
    initMasterKey()
  })

  it('throws in production without key', () => {
    const originalKey = process.env.MASTER_ENCRYPTION_KEY
    const originalEnv = process.env.NODE_ENV
    delete process.env.MASTER_ENCRYPTION_KEY
    process.env.NODE_ENV = 'production'
    expect(() => initMasterKey()).toThrow('required in production')
    process.env.MASTER_ENCRYPTION_KEY = originalKey
    process.env.NODE_ENV = originalEnv
    initMasterKey()
  })
})

// ─── encrypt / decrypt roundtrip ──────────────────────────
describe('encrypt & decrypt', () => {
  it('roundtrips a simple string', () => {
    const plaintext = 'Hello Hedera!'
    const ciphertext = encrypt(plaintext)
    expect(ciphertext).not.toBe(plaintext)
    expect(decrypt(ciphertext)).toBe(plaintext)
  })

  it('roundtrips an empty string', () => {
    const ciphertext = encrypt('')
    expect(decrypt(ciphertext)).toBe('')
  })

  it('roundtrips a long private key', () => {
    const key = '302e020100300506032b6570042204200123456789abcdef0123456789abcdef'
    const ciphertext = encrypt(key)
    expect(decrypt(ciphertext)).toBe(key)
  })

  it('produces different ciphertexts for the same plaintext (random IV)', () => {
    const plaintext = 'same input'
    const a = encrypt(plaintext)
    const b = encrypt(plaintext)
    expect(a).not.toBe(b)
    // But both decrypt to the same value
    expect(decrypt(a)).toBe(plaintext)
    expect(decrypt(b)).toBe(plaintext)
  })

  it('roundtrips unicode and emoji', () => {
    const plaintext = '你好世界 🌍🔑'
    expect(decrypt(encrypt(plaintext))).toBe(plaintext)
  })

  it('ciphertext has iv:tag:data format', () => {
    const ciphertext = encrypt('test')
    const parts = ciphertext.split(':')
    expect(parts).toHaveLength(3)
    // Each part should be valid base64
    for (const part of parts) {
      expect(() => Buffer.from(part, 'base64')).not.toThrow()
    }
  })
})

// ─── decrypt error handling ───────────────────────────────
describe('decrypt errors', () => {
  it('throws on invalid format (not 3 parts)', () => {
    expect(() => decrypt('single-block')).toThrow('Invalid encrypted format')
    expect(() => decrypt('a:b')).toThrow('Invalid encrypted format')
  })

  it('throws on tampered ciphertext', () => {
    const ciphertext = encrypt('secret')
    const parts = ciphertext.split(':')
    parts[2] = 'AAAA' + parts[2].slice(4) // tamper with data
    expect(() => decrypt(parts.join(':'))).toThrow()
  })
})

// ─── isEncrypted ──────────────────────────────────────────
describe('isEncrypted', () => {
  it('returns true for encrypted format', () => {
    const ciphertext = encrypt('hello')
    expect(isEncrypted(ciphertext)).toBe(true)
  })

  it('returns false for plain text', () => {
    expect(isEncrypted('just-a-plain-key')).toBe(false)
  })

  it('returns false for empty string', () => {
    expect(isEncrypted('')).toBe(false)
  })

  it('returns false for two-part string', () => {
    expect(isEncrypted('part1:part2')).toBe(false)
  })

  it('returns false for three parts with non-base64 chars', () => {
    expect(isEncrypted('hello!:world!:test!')).toBe(false)
  })
})
