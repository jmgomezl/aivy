import rateLimit from 'express-rate-limit'
import type { Request } from 'express'

type AuthRequest = Request & { userId?: string | null }

const keyGenerator = (req: Request): string => {
  const authReq = req as AuthRequest
  return authReq.userId ?? req.ip ?? 'unknown'
}

const skipDemo = (req: Request): boolean => {
  const authReq = req as AuthRequest
  return authReq.userId === 'demo'
}

const sharedOptions = {
  standardHeaders: true,
  legacyHeaders: false,
  validate: { keyGeneratorIpFallback: false },
} as const

export const deployLimiter = rateLimit({
  ...sharedOptions,
  windowMs: 60 * 60 * 1000,
  max: 5,
  keyGenerator,
  skip: skipDemo,
  message: { error: 'Deploy limit exceeded. Max 5 deployments per hour.' },
})

export const chatLimiter = rateLimit({
  ...sharedOptions,
  windowMs: 60 * 1000,
  max: 30,
  keyGenerator,
  skip: skipDemo,
  message: { error: 'Chat rate limit exceeded. Max 30 messages per minute.' },
})

export const toolLimiter = rateLimit({
  ...sharedOptions,
  windowMs: 60 * 1000,
  max: 60,
  keyGenerator,
  skip: skipDemo,
  message: { error: 'Tool invocation limit exceeded. Max 60 per minute.' },
})

export const readLimiter = rateLimit({
  ...sharedOptions,
  windowMs: 60 * 1000,
  max: 120,
  keyGenerator: (req: Request) => req.ip ?? 'unknown',
  message: { error: 'Read rate limit exceeded. Max 120 per minute.' },
})
