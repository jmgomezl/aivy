/**
 * AWS KMS Envelope Encryption for Aivy Agent Keys
 *
 * Each agent gets a dedicated KMS symmetric key. The agent's Ed25519
 * private key is encrypted by KMS and stored as ciphertext — the raw
 * key NEVER touches disk.
 *
 * Flow:
 *   1. Create KMS symmetric key (per agent)
 *   2. Generate Ed25519 key pair locally
 *   3. Encrypt private key bytes via KMS EncryptCommand
 *   4. Store only ciphertext + kmsKeyId in DB
 *   5. At signing time: DecryptCommand → sign → Buffer.fill(0)
 */

import {
  KMSClient,
  CreateKeyCommand,
  EncryptCommand,
  DecryptCommand,
  ScheduleKeyDeletionCommand,
  KeySpec,
  KeyUsageType,
} from '@aws-sdk/client-kms'

// ─── KMS Client (lazy singleton) ─────────────────────
let _kms: KMSClient | null = null

function getKmsClient(): KMSClient | null {
  if (_kms) return _kms

  const accessKeyId = process.env.AWS_ACCESS_KEY_ID
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY
  const region = process.env.AWS_REGION || 'us-east-1'

  if (!accessKeyId || !secretAccessKey) {
    return null // KMS not configured — fall back to local encryption
  }

  _kms = new KMSClient({
    region,
    credentials: { accessKeyId, secretAccessKey },
  })
  return _kms
}

/** Whether KMS is available (AWS credentials configured) */
export function isKmsAvailable(): boolean {
  return getKmsClient() !== null
}

/**
 * Create a dedicated KMS symmetric key for an agent.
 * Returns the KMS Key ID (UUID).
 */
export async function createAgentKmsKey(agentId: string, agentName: string): Promise<string> {
  const kms = getKmsClient()
  if (!kms) throw new Error('KMS is not configured. Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY.')

  const result = await kms.send(new CreateKeyCommand({
    KeySpec: KeySpec.SYMMETRIC_DEFAULT,
    KeyUsage: KeyUsageType.ENCRYPT_DECRYPT,
    Description: `Aivy agent key: ${agentName} (${agentId})`,
    Tags: [
      { TagKey: 'Platform', TagValue: 'aivy' },
      { TagKey: 'AgentId', TagValue: agentId },
      { TagKey: 'AgentName', TagValue: agentName.slice(0, 256) },
    ],
  }))

  const keyId = result.KeyMetadata?.KeyId
  if (!keyId) throw new Error('KMS CreateKey did not return a KeyId')

  console.log(`[KMS] Created symmetric key ${keyId} for agent ${agentName}`)
  return keyId
}

/**
 * Encrypt a private key using a KMS symmetric key.
 * Returns base64-encoded ciphertext.
 */
export async function kmsEncryptKey(
  kmsKeyId: string,
  privateKeyBytes: Uint8Array,
  agentId: string,
): Promise<string> {
  const kms = getKmsClient()
  if (!kms) throw new Error('KMS is not configured.')

  const result = await kms.send(new EncryptCommand({
    KeyId: kmsKeyId,
    Plaintext: privateKeyBytes,
    EncryptionContext: {
      platform: 'aivy',
      agent: agentId,
      keyType: 'ed25519-signing',
    },
  }))

  if (!result.CiphertextBlob) throw new Error('KMS Encrypt did not return CiphertextBlob')

  // Wipe the input plaintext buffer
  if (privateKeyBytes instanceof Buffer) {
    privateKeyBytes.fill(0)
  } else {
    new Uint8Array(privateKeyBytes.buffer).fill(0)
  }

  return Buffer.from(result.CiphertextBlob).toString('base64')
}

/**
 * Decrypt a private key using a KMS symmetric key.
 * Returns the raw private key bytes.
 * CALLER IS RESPONSIBLE FOR WIPING THE RETURNED BUFFER AFTER USE.
 */
export async function kmsDecryptKey(
  kmsKeyId: string,
  ciphertextBase64: string,
  agentId: string,
): Promise<Buffer> {
  const kms = getKmsClient()
  if (!kms) throw new Error('KMS is not configured.')

  const result = await kms.send(new DecryptCommand({
    KeyId: kmsKeyId,
    CiphertextBlob: Buffer.from(ciphertextBase64, 'base64'),
    EncryptionContext: {
      platform: 'aivy',
      agent: agentId,
      keyType: 'ed25519-signing',
    },
  }))

  if (!result.Plaintext) throw new Error('KMS Decrypt did not return Plaintext')
  return Buffer.from(result.Plaintext)
}

/**
 * Schedule a KMS key for deletion (7-day minimum waiting period).
 * Used during demo cleanup.
 */
export async function scheduleKmsKeyDeletion(kmsKeyId: string): Promise<void> {
  const kms = getKmsClient()
  if (!kms) return

  try {
    await kms.send(new ScheduleKeyDeletionCommand({
      KeyId: kmsKeyId,
      PendingWindowInDays: 7, // AWS minimum
    }))
    console.log(`[KMS] Scheduled key ${kmsKeyId} for deletion (7 days)`)
  } catch (err) {
    console.error(`[KMS] Failed to schedule key deletion for ${kmsKeyId}:`, err)
  }
}
