/**
 * AWS KMS Key Management for Hedera Agent Accounts
 *
 * Architecture:
 * - ONE shared symmetric KMS key (alias/aivy-agent-keystore) encrypts ALL agent private keys.
 * - Each agent's 32-byte Ed25519 private key is encrypted directly with KMS Encrypt.
 * - The KMS ciphertext blob is stored in the DB — plaintext never touches disk.
 * - EncryptionContext binds each ciphertext to its specific agent ID (AAD).
 * - Decrypt in memory only; wipe buffers immediately after use.
 *
 * Cost: ~$1/month for the single shared key (vs $1/month per agent previously).
 */

import {
  KMSClient,
  CreateKeyCommand,
  EncryptCommand,
  DecryptCommand,
  DescribeKeyCommand,
  EnableKeyRotationCommand,
  ScheduleKeyDeletionCommand,
  ListKeysCommand,
  CreateAliasCommand,
  DescribeKeyCommandOutput,
  type KeyMetadata,
} from '@aws-sdk/client-kms'
import { PrivateKey, Transaction } from '@hashgraph/sdk'

// ─── KMS Client Setup ─────────────────────────────────
let kmsClient: KMSClient | null = null

function getKmsConfig() {
  return {
    region: process.env.AWS_REGION || 'us-east-1',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  }
}

export function getKmsClient(): KMSClient {
  if (!kmsClient) {
    const cfg = getKmsConfig()
    if (!cfg.accessKeyId || !cfg.secretAccessKey) {
      throw new Error('[KMS] AWS credentials not configured. Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY.')
    }
    kmsClient = new KMSClient({
      region: cfg.region,
      credentials: {
        accessKeyId: cfg.accessKeyId,
        secretAccessKey: cfg.secretAccessKey,
      },
    })
    console.log(`[KMS] Client initialized (region: ${cfg.region})`)
  }
  return kmsClient
}

export function isKmsConfigured(): boolean {
  const cfg = getKmsConfig()
  return !!(cfg.accessKeyId && cfg.secretAccessKey)
}

// ─── Shared Key ────────────────────────────────────────
const SHARED_KEY_ALIAS = 'alias/aivy-agent-keystore'
let sharedKeyId: string | null = null

/**
 * Returns the ID of the single shared Aivy KMS key, creating it if needed.
 * Result is cached in memory for the lifetime of the process.
 */
export async function getOrCreateSharedKey(): Promise<string> {
  if (sharedKeyId) return sharedKeyId

  const client = getKmsClient()

  // Try to resolve existing alias
  try {
    const result = await client.send(new DescribeKeyCommand({ KeyId: SHARED_KEY_ALIAS }))
    sharedKeyId = result.KeyMetadata!.KeyId!
    console.log(`[KMS] Using shared key ${sharedKeyId} (${SHARED_KEY_ALIAS})`)
    return sharedKeyId
  } catch {
    // Alias not found — create the key
  }

  const createResult = await client.send(new CreateKeyCommand({
    Description: 'Aivy shared agent keystore — encrypts all agent Ed25519 private keys',
    KeyUsage: 'ENCRYPT_DECRYPT',
    KeySpec: 'SYMMETRIC_DEFAULT',
    Tags: [
      { TagKey: 'Platform', TagValue: 'Aivy' },
      { TagKey: 'Purpose', TagValue: 'SharedAgentKeystore' },
    ],
  }))

  sharedKeyId = createResult.KeyMetadata?.KeyId
  if (!sharedKeyId) throw new Error('[KMS] Failed to create shared key')

  await client.send(new CreateAliasCommand({
    AliasName: SHARED_KEY_ALIAS,
    TargetKeyId: sharedKeyId,
  }))

  try {
    await client.send(new EnableKeyRotationCommand({ KeyId: sharedKeyId }))
  } catch {
    console.warn('[KMS] Could not enable auto-rotation on shared key')
  }

  console.log(`[KMS] Created shared key ${sharedKeyId} (${SHARED_KEY_ALIAS})`)
  return sharedKeyId
}

// ─── Types ────────────────────────────────────────────
export type KmsAgentKey = {
  kmsKeyId: string           // Shared KMS key ID
  encryptedPrivateKey: string // Base64 KMS ciphertext of the Ed25519 private key
  publicKey: string          // Hedera public key (DER hex)
  hederaAccountId?: string
}

export type KmsKeyInfo = {
  keyId: string
  arn: string
  creationDate: Date
  enabled: boolean
  description: string
  keyRotationEnabled: boolean
}

// ─── Core Operations ──────────────────────────────────

/**
 * Create a new KMS-protected agent key using the shared keystore key.
 *
 * 1. Resolves the shared KMS key (creates it on first call)
 * 2. Generates a Hedera Ed25519 keypair
 * 3. Encrypts the 32-byte private key with KMS (EncryptionContext binds it to agentId)
 * 4. Returns ciphertext — plaintext key is wiped from memory
 */
export async function createAgentKmsKey(agentName: string, agentId: string): Promise<KmsAgentKey> {
  const client = getKmsClient()
  const keyId = await getOrCreateSharedKey()

  const hederaPrivateKey = PrivateKey.generateED25519()
  const hederaPublicKey = hederaPrivateKey.publicKey

  const privateKeyBytes = Buffer.from(hederaPrivateKey.toStringRaw(), 'hex')
  const encryptResult = await client.send(new EncryptCommand({
    KeyId: keyId,
    Plaintext: privateKeyBytes,
    EncryptionContext: {
      platform: 'aivy',
      keyType: 'hedera-ed25519',
      agentId,
    },
  }))

  if (!encryptResult.CiphertextBlob) {
    throw new Error('[KMS] Encryption failed — no ciphertext returned')
  }

  const encryptedPrivateKey = Buffer.from(encryptResult.CiphertextBlob).toString('base64')
  privateKeyBytes.fill(0)

  console.log(`[KMS] Agent key created for ${agentName} (${agentId}) via shared key ${keyId.slice(0, 8)}...`)

  return {
    kmsKeyId: keyId,
    encryptedPrivateKey,
    publicKey: hederaPublicKey.toStringDer(),
  }
}

/**
 * Decrypt an agent's Ed25519 private key from KMS ciphertext.
 * The returned PrivateKey should be used immediately and allowed to GC.
 */
export async function decryptAgentKey(
  kmsKeyId: string,
  encryptedPrivateKey: string,
  agentId: string,
): Promise<PrivateKey> {
  const client = getKmsClient()

  const ciphertext = Buffer.from(encryptedPrivateKey, 'base64')
  const decryptResult = await client.send(new DecryptCommand({
    KeyId: kmsKeyId,
    CiphertextBlob: ciphertext,
    EncryptionContext: {
      platform: 'aivy',
      keyType: 'hedera-ed25519',
      agentId,
    },
  }))

  if (!decryptResult.Plaintext) {
    throw new Error(`[KMS] Decryption failed for agent ${agentId}`)
  }

  const privateKeyHex = Buffer.from(decryptResult.Plaintext).toString('hex')
  const privateKey = PrivateKey.fromStringED25519(privateKeyHex)

  // Zero the decrypted bytes (the JS string privateKeyHex cannot be zeroed, but we limit exposure)
  ;(decryptResult.Plaintext as Buffer).fill(0)

  return privateKey
}

/**
 * Sign a Hedera transaction using the KMS-protected agent key.
 */
export async function signTransactionWithKms(
  transaction: Transaction,
  kmsKeyId: string,
  encryptedPrivateKey: string,
  agentId: string,
): Promise<Transaction> {
  const privateKey = await decryptAgentKey(kmsKeyId, encryptedPrivateKey, agentId)
  const signed = await transaction.sign(privateKey)
  console.log(`[KMS] Transaction signed for agent ${agentId} via shared key ${kmsKeyId.slice(0, 8)}...`)
  return signed
}

/**
 * Rotate an agent's Hedera key.
 * Generates a new Ed25519 keypair and encrypts it under the same shared key.
 * Caller must also update the Hedera account key on-chain via AccountUpdateTransaction.
 */
export async function rotateAgentKey(
  kmsKeyId: string,
  agentId: string,
): Promise<{ encryptedPrivateKey: string; publicKey: string; newPrivateKey: PrivateKey }> {
  const client = getKmsClient()

  const newPrivateKey = PrivateKey.generateED25519()
  const privateKeyBytes = Buffer.from(newPrivateKey.toStringRaw(), 'hex')

  const encryptResult = await client.send(new EncryptCommand({
    KeyId: kmsKeyId,
    Plaintext: privateKeyBytes,
    EncryptionContext: {
      platform: 'aivy',
      keyType: 'hedera-ed25519',
      agentId,
    },
  }))

  if (!encryptResult.CiphertextBlob) throw new Error('[KMS] Key rotation encryption failed')

  const encryptedPrivateKey = Buffer.from(encryptResult.CiphertextBlob).toString('base64')
  privateKeyBytes.fill(0)

  console.log(`[KMS] Key rotated for agent ${agentId}`)

  return {
    encryptedPrivateKey,
    publicKey: newPrivateKey.publicKey.toStringDer(),
    newPrivateKey,
  }
}

/**
 * Get metadata for a KMS key.
 */
export async function getKeyInfo(kmsKeyId: string): Promise<KmsKeyInfo> {
  const client = getKmsClient()
  const result: DescribeKeyCommandOutput = await client.send(new DescribeKeyCommand({ KeyId: kmsKeyId }))
  const meta = result.KeyMetadata as KeyMetadata

  return {
    keyId: meta.KeyId ?? kmsKeyId,
    arn: meta.Arn ?? '',
    creationDate: meta.CreationDate ?? new Date(),
    enabled: meta.Enabled ?? false,
    description: meta.Description ?? '',
    keyRotationEnabled: false,
  }
}

/**
 * Schedule a KMS key for deletion (minimum 7-day waiting period).
 */
export async function scheduleKeyDeletion(kmsKeyId: string, waitingDays = 7): Promise<void> {
  const client = getKmsClient()
  await client.send(new ScheduleKeyDeletionCommand({
    KeyId: kmsKeyId,
    PendingWindowInDays: waitingDays,
  }))
  console.log(`[KMS] Key ${kmsKeyId} scheduled for deletion in ${waitingDays} days`)
}

/**
 * List all KMS key IDs in the account (up to 100).
 */
export async function listAgentKeys(): Promise<string[]> {
  const client = getKmsClient()
  const result = await client.send(new ListKeysCommand({ Limit: 100 }))
  return (result.Keys ?? []).map(k => k.KeyId ?? '').filter(Boolean)
}
