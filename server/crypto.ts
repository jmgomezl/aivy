import crypto from 'node:crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 16

let masterKey: Buffer

export function initMasterKey(): void {
  const envKey = process.env.MASTER_ENCRYPTION_KEY
  if (envKey) {
    masterKey = Buffer.from(envKey, 'hex')
    if (masterKey.length !== 32) {
      throw new Error('MASTER_ENCRYPTION_KEY must be 64 hex characters (32 bytes).')
    }
  } else {
    masterKey = crypto.randomBytes(32)
    const hexKey = masterKey.toString('hex')
    console.warn('[Aivy] No MASTER_ENCRYPTION_KEY set. Auto-generated one.')
    console.warn(`[Aivy] Add to .env: MASTER_ENCRYPTION_KEY=${hexKey}`)
  }
}

export function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv(ALGORITHM, masterKey, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`
}

export function decrypt(encoded: string): string {
  const parts = encoded.split(':')
  if (parts.length !== 3) throw new Error('Invalid encrypted format.')
  const [ivB64, tagB64, dataB64] = parts
  const iv = Buffer.from(ivB64, 'base64')
  const authTag = Buffer.from(tagB64, 'base64')
  const encrypted = Buffer.from(dataB64, 'base64')
  const decipher = crypto.createDecipheriv(ALGORITHM, masterKey, iv)
  decipher.setAuthTag(authTag)
  return decipher.update(encrypted).toString('utf8') + decipher.final('utf8')
}

export function isEncrypted(value: string): boolean {
  const parts = value.split(':')
  return parts.length === 3 && parts.every(p => /^[A-Za-z0-9+/]+=*$/.test(p))
}
