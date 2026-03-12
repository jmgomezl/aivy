import rateLimit from 'express-rate-limit'
import type { Request } from 'express'

type AuthRequest = Request & { userId?: string | null }

// In demo mode, key by IP so each visitor gets their own bucket
const keyGenerator = (req: Request): string => {
  const authReq = req as AuthRequest
  if (authReq.userId === 'demo') return req.ip ?? 'demo-unknown'
  return authReq.userId ?? req.ip ?? 'unknown'
}

const sharedOptions = {
  standardHeaders: true,
  legacyHeaders: false,
  validate: { keyGeneratorIpFallback: false },
} as const

export const deployLimiter = rateLimit({
  ...sharedOptions,
  windowMs: 60 * 60 * 1000,
  max: 10,
  keyGenerator,
  message: { error: 'Deploy limit exceeded. Max 10 deployments per hour.' },
})

export const chatLimiter = rateLimit({
  ...sharedOptions,
  windowMs: 60 * 1000,
  max: 40,
  keyGenerator,
  message: { error: 'Chat rate limit exceeded. Max 40 messages per minute.' },
})

export const toolLimiter = rateLimit({
  ...sharedOptions,
  windowMs: 60 * 1000,
  max: 80,
  keyGenerator,
  message: { error: 'Tool invocation limit exceeded. Max 80 per minute.' },
})

export const readLimiter = rateLimit({
  ...sharedOptions,
  windowMs: 60 * 1000,
  max: 150,
  keyGenerator: (req: Request) => req.ip ?? 'unknown',
  message: { error: 'Read rate limit exceeded. Max 150 per minute.' },
})
