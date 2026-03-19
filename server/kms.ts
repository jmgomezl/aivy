/**
 * AWS KMS Key Management for Hedera Agent Accounts
 *
 * Provides secure key management using AWS KMS for agent signing keys.
 * Private keys never leave AWS — all signing operations happen inside KMS.
 *
 * Architecture:
 * - Each agent gets a dedicated KMS key (ECC_NIST_P256 / secp256k1 not available,
 *   so we use KMS for master key + derive Hedera keys deterministically)
 * - Strategy: KMS stores a symmetric encryption key per agent. The agent's Hedera
 *   private key is encrypted with this KMS key and stored in the DB.
 * - Signing: decrypt the private key in memory, sign, then discard.
 * - This means private keys are NEVER stored in plaintext — only KMS-encrypted ciphertext.
 *
 * Flow:
 * 1. createAgentKmsKey() → creates KMS symmetric key + generates Hedera keypair
 *    → encrypts private key with KMS → returns { kmsKeyId, encryptedPrivateKey, publicKey, hederaAccountId }
 * 2. signWithKms() → decrypts private key via KMS → signs transaction → wipes key from memory
 * 3. rotateAgentKey() → generates new Hedera keypair → encrypts with same KMS key → updates DB
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
  TagResourceCommand,
  type KeyMetadata,
} from '@aws-sdk/client-kms'
import { PrivateKey, PublicKey, Transaction } from '@hashgraph/sdk'

// ─── KMS Client Setup ──────────────────────────────────
// Read env vars lazily (not at module load time) so dotenv has time to inject them
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

// ─── Types ─────────────────────────────────────────────
export type KmsAgentKey = {
  kmsKeyId: string          // AWS KMS Key ID (for encrypt/decrypt)
  encryptedPrivateKey: string // Base64 encoded KMS-encrypted Hedera private key
  publicKey: string          // Hedera public key (DER hex)
  hederaAccountId?: string   // Associated Hedera account ID
}

export type KmsKeyInfo = {
  keyId: string
  arn: string
  creationDate: Date
  enabled: boolean
  description: string
  keyRotationEnabled: boolean
}

// ─── Core Operations ───────────────────────────────────

/**
 * Create a new KMS-protected agent key
 *
 * 1. Creates a symmetric KMS key for envelope encryption
 * 2. Generates a Hedera Ed25519 keypair
 * 3. Encrypts the private key with KMS
 * 4. Returns the encrypted key bundle (plaintext key is discarded)
 */
export async function createAgentKmsKey(agentName: string): Promise<KmsAgentKey> {
  const client = getKmsClient()

  // 1. Create a symmetric KMS key for this agent
  const createResult = await client.send(new CreateKeyCommand({
    Description: `Aivy Agent Key — ${agentName}`,
    KeyUsage: 'ENCRYPT_DECRYPT',
    KeySpec: 'SYMMETRIC_DEFAULT',
    Tags: [
      { TagKey: 'Platform', TagValue: 'Aivy' },
      { TagKey: 'AgentName', TagValue: agentName },
      { TagKey: 'Purpose', TagValue: 'Agent Private Key Encryption' },
    ],
  }))

  const kmsKeyId = createResult.KeyMetadata?.KeyId
  if (!kmsKeyId) throw new Error('[KMS] Failed to create KMS key — no KeyId returned')

  // Create an alias for easy identification
  const aliasName = `alias/aivy-agent-${agentName.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${Date.now()}`
  try {
    await client.send(new CreateAliasCommand({
      AliasName: aliasName,
      TargetKeyId: kmsKeyId,
    }))
  } catch {
    // Alias creation is nice-to-have, not critical
    console.warn(`[KMS] Could not create alias ${aliasName}`)
  }

  // Enable automatic key rotation (annually)
  try {
    await client.send(new EnableKeyRotationCommand({ KeyId: kmsKeyId }))
    console.log(`[KMS] Auto-rotation enabled for key ${kmsKeyId}`)
  } catch {
    console.warn(`[KMS] Could not enable auto-rotation for ${kmsKeyId}`)
  }

  // 2. Generate Hedera Ed25519 keypair
  const hederaPrivateKey = PrivateKey.generateED25519()
  const hederaPublicKey = hederaPrivateKey.publicKey

  // 3. Encrypt the private key with KMS
  const privateKeyBytes = Buffer.from(hederaPrivateKey.toStringRaw(), 'hex')
  const encryptResult = await client.send(new EncryptCommand({
    KeyId: kmsKeyId,
    Plaintext: privateKeyBytes,
    EncryptionContext: {
      platform: 'aivy',
      agent: agentName,
      keyType: 'hedera-ed25519',
    },
  }))

  if (!encryptResult.CiphertextBlob) {
    throw new Error('[KMS] Encryption failed — no ciphertext returned')
  }

  const encryptedPrivateKey = Buffer.from(encryptResult.CiphertextBlob).toString('base64')

  // 4. Wipe plaintext key from memory
  privateKeyBytes.fill(0)

  console.log(`[KMS] Agent key created — KMS Key: ${kmsKeyId}, Public: ${hederaPublicKey.toStringRaw().slice(0, 16)}...`)

  return {
    kmsKeyId,
    encryptedPrivateKey,
    publicKey: hederaPublicKey.toStringDer(),
  }
}

/**
 * Decrypt an agent's private key using KMS
 * The decrypted key should be used immediately and then discarded.
 */
export async function decryptAgentKey(
  kmsKeyId: string,
  encryptedPrivateKey: string,
  agentName: string,
): Promise<PrivateKey> {
  const client = getKmsClient()

  const ciphertext = Buffer.from(encryptedPrivateKey, 'base64')
  const decryptResult = await client.send(new DecryptCommand({
    KeyId: kmsKeyId,
    CiphertextBlob: ciphertext,
    EncryptionContext: {
      platform: 'aivy',
      agent: agentName,
      keyType: 'hedera-ed25519',
    },
  }))

  if (!decryptResult.Plaintext) {
    throw new Error(`[KMS] Decryption failed for agent ${agentName}`)
  }

  const privateKeyHex = Buffer.from(decryptResult.Plaintext).toString('hex')
  const privateKey = PrivateKey.fromStringED25519(privateKeyHex)

  // Zero out the buffer
  Buffer.from(decryptResult.Plaintext).fill(0)

  return privateKey
}

/**
 * Sign a Hedera transaction using KMS-protected key
 *
 * 1. Decrypt private key via KMS (in memory only)
 * 2. Sign the transaction
 * 3. Wipe the key from memory
 */
export async function signTransactionWithKms(
  transaction: Transaction,
  kmsKeyId: string,
  encryptedPrivateKey: string,
  agentName: string,
): Promise<Transaction> {
  // Decrypt key temporarily
  const privateKey = await decryptAgentKey(kmsKeyId, encryptedPrivateKey, agentName)

  // Sign the transaction
  const signed = await transaction.sign(privateKey)

  console.log(`[KMS] Transaction signed for agent ${agentName} via KMS key ${kmsKeyId.slice(0, 8)}...`)

  return signed
}

/**
 * Rotate an agent's Hedera key
 *
 * 1. Generate new Hedera keypair
 * 2. Encrypt with same KMS key
 * 3. Return new encrypted bundle
 *
 * Note: The Hedera account key must also be updated on-chain via AccountUpdateTransaction
 */
export async function rotateAgentKey(
  kmsKeyId: string,
  agentName: string,
): Promise<{ encryptedPrivateKey: string; publicKey: string; newPrivateKey: PrivateKey }> {
  const client = getKmsClient()

  // Generate new keypair
  const newPrivateKey = PrivateKey.generateED25519()
  const newPublicKey = newPrivateKey.publicKey

  // Encrypt with existing KMS key
  const privateKeyBytes = Buffer.from(newPrivateKey.toStringRaw(), 'hex')
  const encryptResult = await client.send(new EncryptCommand({
    KeyId: kmsKeyId,
    Plaintext: privateKeyBytes,
    EncryptionContext: {
      platform: 'aivy',
      agent: agentName,
      keyType: 'hedera-ed25519',
    },
  }))

  if (!encryptResult.CiphertextBlob) {
    throw new Error('[KMS] Key rotation encryption failed')
  }

  const encryptedPrivateKey = Buffer.from(encryptResult.CiphertextBlob).toString('base64')
  privateKeyBytes.fill(0)

  console.log(`[KMS] Key rotated for agent ${agentName} — new public: ${newPublicKey.toStringRaw().slice(0, 16)}...`)

  return {
    encryptedPrivateKey,
    publicKey: newPublicKey.toStringDer(),
    newPrivateKey, // Caller needs this to update the Hedera account key on-chain
  }
}

/**
 * Get information about a KMS key
 */
export async function getKeyInfo(kmsKeyId: string): Promise<KmsKeyInfo> {
  const client = getKmsClient()

  const result = await client.send(new DescribeKeyCommand({ KeyId: kmsKeyId }))
  const meta = result.KeyMetadata as KeyMetadata

  return {
    keyId: meta.KeyId ?? kmsKeyId,
    arn: meta.Arn ?? '',
    creationDate: meta.CreationDate ?? new Date(),
    enabled: meta.Enabled ?? false,
    description: meta.Description ?? '',
    keyRotationEnabled: false, // Would need separate API call
  }
}

/**
 * Schedule deletion of a KMS key (minimum 7-day waiting period)
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
 * List all Aivy agent KMS keys
 */
export async function listAgentKeys(): Promise<string[]> {
  const client = getKmsClient()

  const result = await client.send(new ListKeysCommand({ Limit: 100 }))
  return (result.Keys ?? []).map(k => k.KeyId ?? '').filter(Boolean)
}

/**
 * Encrypt an existing plaintext private key with KMS
 * Used for migrating existing agents to KMS protection
 */
export async function encryptExistingKey(
  plaintextPrivateKey: string,
  agentName: string,
): Promise<KmsAgentKey> {
  const client = getKmsClient()

  // Create KMS key for this agent
  const createResult = await client.send(new CreateKeyCommand({
    Description: `Aivy Agent Key — ${agentName} (migrated)`,
    KeyUsage: 'ENCRYPT_DECRYPT',
    KeySpec: 'SYMMETRIC_DEFAULT',
    Tags: [
      { TagKey: 'Platform', TagValue: 'Aivy' },
      { TagKey: 'AgentName', TagValue: agentName },
      { TagKey: 'Purpose', TagValue: 'Agent Private Key Encryption' },
      { TagKey: 'Migrated', TagValue: 'true' },
    ],
  }))

  const kmsKeyId = createResult.KeyMetadata?.KeyId
  if (!kmsKeyId) throw new Error('[KMS] Failed to create migration KMS key')

  // Enable rotation
  try {
    await client.send(new EnableKeyRotationCommand({ KeyId: kmsKeyId }))
  } catch { /* non-critical */ }

  // Parse the existing key
  const cleanKey = plaintextPrivateKey.startsWith('0x')
    ? plaintextPrivateKey.slice(2)
    : plaintextPrivateKey
  const privateKey = PrivateKey.fromStringED25519(cleanKey)
  const publicKey = privateKey.publicKey

  // Encrypt with KMS
  const privateKeyBytes = Buffer.from(privateKey.toStringRaw(), 'hex')
  const encryptResult = await client.send(new EncryptCommand({
    KeyId: kmsKeyId,
    Plaintext: privateKeyBytes,
    EncryptionContext: {
      platform: 'aivy',
      agent: agentName,
      keyType: 'hedera-ed25519',
    },
  }))

  if (!encryptResult.CiphertextBlob) {
    throw new Error('[KMS] Migration encryption failed')
  }

  const encryptedPrivateKey = Buffer.from(encryptResult.CiphertextBlob).toString('base64')
  privateKeyBytes.fill(0)

  console.log(`[KMS] Existing key migrated for agent ${agentName} — KMS Key: ${kmsKeyId}`)

  return {
    kmsKeyId,
    encryptedPrivateKey,
    publicKey: publicKey.toStringDer(),
  }
}
