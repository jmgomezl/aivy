import crypto from 'node:crypto'
import jwt from 'jsonwebtoken'

const CHALLENGE_TTL_MS = 5 * 60 * 1000
const pendingChallenges = new Map<string, { nonce: string; expiresAt: number }>()

let jwtSecret: string

export function initAuth(): void {
  const envSecret = process.env.JWT_SECRET
  if (envSecret && envSecret.length >= 32) {
    jwtSecret = envSecret
  } else if (process.env.NODE_ENV === 'production') {
    throw new Error('[Aivy] JWT_SECRET is required in production. Set a 32+ char secret in .env')
  } else {
    jwtSecret = crypto.randomBytes(48).toString('hex')
    console.warn('[Aivy] No JWT_SECRET set. Auto-generated one (sessions reset on restart).')
    console.warn(`[Aivy] Add to .env: JWT_SECRET=${jwtSecret}`)
  }

  // Cleanup expired challenges every 5 minutes
  setInterval(() => {
    const now = Date.now()
    for (const [key, val] of pendingChallenges) {
      if (val.expiresAt < now) pendingChallenges.delete(key)
    }
  }, 5 * 60 * 1000)
}

export function generateChallenge(accountId: string): { challenge: string } {
  const nonce = crypto.randomBytes(24).toString('hex')
  const challenge = `Sign-in to Aivy: ${nonce}`
  pendingChallenges.set(accountId, { nonce, expiresAt: Date.now() + CHALLENGE_TTL_MS })
  return { challenge }
}

export function consumeChallenge(accountId: string): string | null {
  const entry = pendingChallenges.get(accountId)
  if (!entry) return null
  pendingChallenges.delete(accountId)
  if (entry.expiresAt < Date.now()) return null
  return entry.nonce
}

export async function verifyAccountExists(
  accountId: string,
  mirrorNodeUrl: string,
): Promise<boolean> {
  try {
    const resp = await fetch(`${mirrorNodeUrl}/accounts/${accountId}`, {
      signal: AbortSignal.timeout(8000),
    })
    return resp.ok
  } catch {
    return false
  }
}

export function issueToken(userId: string, accountId: string): string {
  return jwt.sign(
    { sub: userId, accountId },
    jwtSecret,
    { expiresIn: '24h' },
  )
}

export function verifyToken(token: string): { sub: string; accountId: string } | null {
  try {
    const payload = jwt.verify(token, jwtSecret) as { sub: string; accountId: string }
    return payload
  } catch {
    return null
  }
}
