import { describe, it, expect, beforeAll, vi } from 'vitest'
import type { Request, Response, NextFunction } from 'express'

// Set env before import
process.env.JWT_SECRET = 'b'.repeat(32)

import { initAuth, issueToken } from '../../server/auth'
import { authMiddleware, requireAuth, type AuthRequest } from '../../server/middleware'

beforeAll(() => {
  initAuth()
})

function mockReq(headers: Record<string, string> = {}): Request {
  return { headers } as unknown as Request
}

function mockRes(): Response & { statusCode: number; body: unknown } {
  const res: Record<string, unknown> = {
    statusCode: 0,
    body: null,
  }
  res.status = (code: number) => { res.statusCode = code; return res }
  res.json = (data: unknown) => { res.body = data; return res }
  return res as Response & { statusCode: number; body: unknown }
}

// ─── authMiddleware (normal mode) ─────────────────────────
describe('authMiddleware (auth mode)', () => {
  const middleware = authMiddleware(false)

  it('attaches userId and accountId from a valid Bearer token', () => {
    const token = issueToken('user-1', '0.0.12345')
    const req = mockReq({ authorization: `Bearer ${token}` })
    const next = vi.fn()

    middleware(req, mockRes() as unknown as Response, next)

    const authReq = req as AuthRequest
    expect(authReq.userId).toBe('user-1')
    expect(authReq.accountId).toBe('0.0.12345')
    expect(next).toHaveBeenCalledOnce()
  })

  it('sets userId=null for missing Authorization header', () => {
    const req = mockReq()
    const next = vi.fn()

    middleware(req, mockRes() as unknown as Response, next)

    const authReq = req as AuthRequest
    expect(authReq.userId).toBeNull()
    expect(authReq.accountId).toBeNull()
    expect(next).toHaveBeenCalledOnce()
  })

  it('sets userId=null for an invalid token', () => {
    const req = mockReq({ authorization: 'Bearer garbage.token.here' })
    const next = vi.fn()

    middleware(req, mockRes() as unknown as Response, next)

    const authReq = req as AuthRequest
    expect(authReq.userId).toBeNull()
    expect(next).toHaveBeenCalledOnce()
  })

  it('sets userId=null for non-Bearer scheme', () => {
    const token = issueToken('user-1', '0.0.12345')
    const req = mockReq({ authorization: `Basic ${token}` })
    const next = vi.fn()

    middleware(req, mockRes() as unknown as Response, next)

    const authReq = req as AuthRequest
    expect(authReq.userId).toBeNull()
    expect(next).toHaveBeenCalledOnce()
  })
})

// ─── authMiddleware (demo mode) ───────────────────────────
describe('authMiddleware (demo mode)', () => {
  const middleware = authMiddleware(true)

  it('always sets userId to "demo" in demo mode', () => {
    const req = mockReq()
    const next = vi.fn()

    middleware(req, mockRes() as unknown as Response, next)

    const authReq = req as AuthRequest
    expect(authReq.userId).toBe('demo')
    expect(authReq.accountId).toBeNull()
    expect(next).toHaveBeenCalledOnce()
  })

  it('ignores Authorization header in demo mode', () => {
    const token = issueToken('real-user', '0.0.99999')
    const req = mockReq({ authorization: `Bearer ${token}` })
    const next = vi.fn()

    middleware(req, mockRes() as unknown as Response, next)

    const authReq = req as AuthRequest
    expect(authReq.userId).toBe('demo')
    expect(next).toHaveBeenCalledOnce()
  })
})

// ─── requireAuth ──────────────────────────────────────────
describe('requireAuth', () => {
  it('calls next when userId is present', () => {
    const req = mockReq() as unknown as AuthRequest
    req.userId = 'some-user'
    const res = mockRes()
    const next = vi.fn()

    requireAuth(req as unknown as Request, res as unknown as Response, next)

    expect(next).toHaveBeenCalledOnce()
    expect(res.statusCode).toBe(0) // no error response
  })

  it('returns 401 when userId is null', () => {
    const req = mockReq() as unknown as AuthRequest
    req.userId = null
    const res = mockRes()
    const next = vi.fn()

    requireAuth(req as unknown as Request, res as unknown as Response, next)

    expect(next).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(401)
    expect(res.body).toEqual(expect.objectContaining({ error: expect.any(String) }))
  })
})
