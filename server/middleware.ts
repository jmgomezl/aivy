import type { Request, Response, NextFunction } from 'express'
import { verifyToken } from './auth.js'

export type AuthRequest = Request & {
  userId: string | null
  accountId: string | null
}

export function authMiddleware(demoMode: boolean) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const authReq = req as AuthRequest

    if (demoMode) {
      authReq.userId = 'demo'
      authReq.accountId = null
      next()
      return
    }

    const header = req.headers.authorization
    if (header?.startsWith('Bearer ')) {
      const token = header.slice(7)
      const payload = verifyToken(token)
      if (payload) {
        authReq.userId = payload.sub
        authReq.accountId = payload.accountId
        next()
        return
      }
    }

    authReq.userId = null
    authReq.accountId = null
    next()
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const authReq = req as AuthRequest
  if (!authReq.userId) {
    res.status(401).json({ error: 'Authentication required. Connect your wallet to continue.' })
    return
  }
  next()
}
