/**
 * Migrate Aivy agents from one-KMS-key-per-agent → one shared KMS key.
 *
 * WHAT THIS DOES
 * ─────────────
 * Current state: Each KMS agent has its OWN dedicated KMS symmetric key (~$1/month each).
 *   However, the private keys were stored AES-encrypted (not KMS-encrypted) at rest,
 *   so those per-agent KMS keys are effectively orphaned and doing nothing useful.
 *
 * Target state: ONE shared KMS key (alias/aivy-agent-keystore) encrypts ALL agent
 *   private keys. The KMS ciphertext is stored directly in the DB (no AES layer on top).
 *
 * STEPS
 * ─────
 * 1. Backup DB file
 * 2. Find or create alias/aivy-agent-keystore
 * 3. For each deployment with kms_key_id:
 *    a. AES-decrypt agent_private_key_encrypted → plaintext Ed25519 hex key
 *    b. Re-encrypt 32-byte raw key with shared KMS key using EncryptionContext {agentId}
 *    c. Update DB: store new KMS ciphertext, update kms_key_id to shared key
 * 4. Verify every migrated agent: decrypt → derive public key → compare with original
 * 5. Backup migrated DB
 * 6. Print cleanup plan for old orphaned KMS keys
 *
 * SAFETY RULES
 * ────────────
 * - Never log plaintext private keys
 * - If ANY agent fails verification: stop, do not schedule deletions
 * - Old keys are NOT deleted here — a separate cleanup plan is printed for manual review
 * - Non-Aivy keys (Kickoff, Juanma bot, etc.) are explicitly excluded from cleanup
 *
 * USAGE
 * ─────
 * npx tsx scripts/migrate-to-shared-kms.ts [--dry-run]
 */

import * as dotenv from 'dotenv'
dotenv.config()

import * as fs from 'node:fs'
import * as path from 'node:path'
import * as crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import {
  KMSClient,
  CreateKeyCommand,
  DescribeKeyCommand,
  CreateAliasCommand,
  EnableKeyRotationCommand,
  EncryptCommand,
  DecryptCommand,
  ListKeysCommand,
  DescribeKeyCommandOutput,
  TagResourceCommand,
} from '@aws-sdk/client-kms'
import { PrivateKey } from '@hashgraph/sdk'

// ─── Config ────────────────────────────────────────────────────────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.resolve(__dirname, '..', 'data')
const DB_FILE = path.join(DATA_DIR, 'aivy.db')
const SHARED_KEY_ALIAS = 'alias/aivy-agent-keystore'
const DRY_RUN = process.argv.includes('--dry-run')

const MASTER_KEY_ENV = process.env.MASTER_ENCRYPTION_KEY
if (!MASTER_KEY_ENV) {
  console.error('ERROR: MASTER_ENCRYPTION_KEY env var is required')
  process.exit(1)
}
if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
  console.error('ERROR: AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY are required')
  process.exit(1)
}

const ALGORITHM = 'aes-256-gcm'
const masterKey = Buffer.from(MASTER_KEY_ENV, 'hex')

// ─── AES helpers (mirrors server/crypto.ts) ───────────────────────────────
function aesDecrypt(encoded: string): string {
  const parts = encoded.split(':')
  if (parts.length !== 3) throw new Error(`Invalid AES format: ${encoded.slice(0, 40)}`)
  const [ivB64, tagB64, dataB64] = parts
  const iv = Buffer.from(ivB64, 'base64')
  const authTag = Buffer.from(tagB64, 'base64')
  const encrypted = Buffer.from(dataB64, 'base64')
  const decipher = crypto.createDecipheriv(ALGORITHM, masterKey, iv)
  decipher.setAuthTag(authTag)
  return decipher.update(encrypted).toString('utf8') + decipher.final('utf8')
}

function isAesEncrypted(value: string): boolean {
  const parts = value.split(':')
  return parts.length === 3 && parts.every(p => /^[A-Za-z0-9+/]+=*$/.test(p))
}

// ─── KMS client ────────────────────────────────────────────────────────────
const kms = new KMSClient({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
})

async function getOrCreateSharedKey(): Promise<string> {
  try {
    const result: DescribeKeyCommandOutput = await kms.send(new DescribeKeyCommand({ KeyId: SHARED_KEY_ALIAS }))
    const keyId = result.KeyMetadata!.KeyId!
    console.log(`✓ Found existing shared key: ${keyId} (${SHARED_KEY_ALIAS})`)
    return keyId
  } catch {
    // Alias doesn't exist — create it
  }

  if (DRY_RUN) {
    console.log(`[DRY RUN] Would create shared key ${SHARED_KEY_ALIAS}`)
    return 'dry-run-key-id'
  }

  console.log(`Creating new shared key ${SHARED_KEY_ALIAS}...`)
  const createResult = await kms.send(new CreateKeyCommand({
    Description: 'Aivy shared agent keystore — encrypts all agent Ed25519 private keys',
    KeyUsage: 'ENCRYPT_DECRYPT',
    KeySpec: 'SYMMETRIC_DEFAULT',
    Tags: [
      { TagKey: 'Platform', TagValue: 'Aivy' },
      { TagKey: 'Purpose', TagValue: 'SharedAgentKeystore' },
    ],
  }))

  const keyId = createResult.KeyMetadata?.KeyId
  if (!keyId) throw new Error('Failed to create shared KMS key')

  await kms.send(new CreateAliasCommand({ AliasName: SHARED_KEY_ALIAS, TargetKeyId: keyId }))
  try { await kms.send(new EnableKeyRotationCommand({ KeyId: keyId })) } catch { /* non-critical */ }

  console.log(`✓ Created shared key: ${keyId}`)
  return keyId
}

// ─── DB types ──────────────────────────────────────────────────────────────
type AgentRow = {
  id: string
  name: string
  agent_private_key_encrypted: string | null
  kms_key_id: string | null
}

// ─── Main ──────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${'='.repeat(60)}`)
  console.log(`Aivy KMS Migration — Shared Key Architecture`)
  console.log(DRY_RUN ? '*** DRY RUN — no changes will be written ***' : '*** LIVE RUN ***')
  console.log('='.repeat(60))

  if (!fs.existsSync(DB_FILE)) {
    console.error(`ERROR: DB not found at ${DB_FILE}`)
    process.exit(1)
  }

  // 1. Backup original DB
  const backupOrig = `${DB_FILE}.pre-migration-${Date.now()}.bak`
  if (!DRY_RUN) {
    fs.copyFileSync(DB_FILE, backupOrig)
    console.log(`\n✓ Original DB backed up → ${backupOrig}`)
  }

  const db = new Database(DB_FILE, DRY_RUN ? { readonly: true } : {})

  // 2. Load all agents with a kms_key_id
  const rows = db.prepare(`
    SELECT id, name, agent_private_key_encrypted, kms_key_id
    FROM deployments
    WHERE kms_key_id IS NOT NULL AND agent_private_key_encrypted IS NOT NULL
  `).all() as AgentRow[]

  console.log(`\nFound ${rows.length} KMS agent(s) to migrate`)
  if (rows.length === 0) {
    console.log('Nothing to do.')
    db.close()
    return
  }

  // 3. Resolve shared key
  const sharedKeyId = await getOrCreateSharedKey()

  // 4. Migrate each agent
  const oldKeyIds = new Set<string>()
  const migrated: Array<{ id: string; name: string; oldKeyId: string; newBlob: string; originalPublicKey: string }> = []
  const failed: Array<{ id: string; name: string; error: string }> = []

  for (const row of rows) {
    process.stdout.write(`  Migrating "${row.name}" (${row.id})... `)

    try {
      const stored = row.agent_private_key_encrypted!

      // AES-decrypt the stored value to get the plaintext Ed25519 hex key
      const plaintextHex = isAesEncrypted(stored) ? aesDecrypt(stored) : stored

      // Validate it looks like a 32-byte Ed25519 raw key (64 hex chars)
      if (!/^[0-9a-fA-F]{64}$/.test(plaintextHex)) {
        throw new Error(`Unexpected key format (length ${plaintextHex.length}, expected 64 hex chars)`)
      }

      // Derive original public key for later verification
      const originalPrivateKey = PrivateKey.fromStringED25519(plaintextHex)
      const originalPublicKey = originalPrivateKey.publicKey.toStringDer()

      if (DRY_RUN) {
        console.log(`[DRY RUN] would re-encrypt`)
        oldKeyIds.add(row.kms_key_id!)
        continue
      }

      // Re-encrypt raw 32-byte key under the shared KMS key
      const rawBytes = Buffer.from(plaintextHex, 'hex')
      const encryptResult = await kms.send(new EncryptCommand({
        KeyId: sharedKeyId,
        Plaintext: rawBytes,
        EncryptionContext: {
          platform: 'aivy',
          keyType: 'hedera-ed25519',
          agentId: row.id,
        },
      }))
      rawBytes.fill(0)

      if (!encryptResult.CiphertextBlob) throw new Error('KMS encrypt returned no ciphertext')
      const newBlob = Buffer.from(encryptResult.CiphertextBlob).toString('base64')

      migrated.push({ id: row.id, name: row.name, oldKeyId: row.kms_key_id!, newBlob, originalPublicKey })
      oldKeyIds.add(row.kms_key_id!)
      console.log('✓')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      failed.push({ id: row.id, name: row.name, error: msg })
      console.log(`✗ FAILED: ${msg}`)
    }
  }

  if (DRY_RUN) {
    console.log('\n[DRY RUN] No changes written.')
    db.close()
    return
  }

  if (failed.length > 0) {
    console.error(`\n✗ ${failed.length} agent(s) failed encryption. Aborting — no DB changes written.`)
    db.close()
    process.exit(1)
  }

  // 5. Verify each migrated agent before writing to DB
  console.log('\nVerifying migrated keys...')
  const verifyFailed: string[] = []

  for (const agent of migrated) {
    process.stdout.write(`  Verifying "${agent.name}"... `)
    try {
      const ciphertext = Buffer.from(agent.newBlob, 'base64')
      const decryptResult = await kms.send(new DecryptCommand({
        KeyId: sharedKeyId,
        CiphertextBlob: ciphertext,
        EncryptionContext: {
          platform: 'aivy',
          keyType: 'hedera-ed25519',
          agentId: agent.id,
        },
      }))

      if (!decryptResult.Plaintext) throw new Error('KMS decrypt returned nothing')

      const verifyHex = Buffer.from(decryptResult.Plaintext).toString('hex')
      ;(decryptResult.Plaintext as Buffer).fill(0)

      const verifyKey = PrivateKey.fromStringED25519(verifyHex)
      const verifyPublicKey = verifyKey.publicKey.toStringDer()

      if (verifyPublicKey !== agent.originalPublicKey) {
        throw new Error('Public key mismatch after re-encryption')
      }
      console.log('✓')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      verifyFailed.push(`${agent.name} (${agent.id}): ${msg}`)
      console.log(`✗ FAILED: ${msg}`)
    }
  }

  if (verifyFailed.length > 0) {
    console.error('\n✗ Verification failed for:')
    verifyFailed.forEach(f => console.error(`  - ${f}`))
    console.error('Aborting — no DB changes written. Old keys are safe.')
    db.close()
    process.exit(1)
  }

  // 6. Write to DB (all or nothing)
  console.log('\nWriting to DB...')
  const updateStmt = db.prepare(`
    UPDATE deployments
    SET agent_private_key_encrypted = ?, kms_key_id = ?
    WHERE id = ?
  `)

  const tx = db.transaction(() => {
    for (const agent of migrated) {
      updateStmt.run(agent.newBlob, sharedKeyId, agent.id)
    }
  })
  tx()
  console.log(`✓ Updated ${migrated.length} agent(s) in DB`)

  // 7. Backup migrated DB
  const backupMigrated = `${DB_FILE}.post-migration-${Date.now()}.bak`
  fs.copyFileSync(DB_FILE, backupMigrated)
  console.log(`✓ Migrated DB backed up → ${backupMigrated}`)

  db.close()

  // 8. Cleanup plan — list old per-agent KMS keys
  console.log(`\n${'='.repeat(60)}`)
  console.log('OLD KMS KEY CLEANUP PLAN')
  console.log('='.repeat(60))
  console.log('The following old per-agent KMS keys are no longer referenced.')
  console.log('They were never used for at-rest encryption (plaintext was stored AES-only).')
  console.log('Review the list and schedule them for deletion manually or run the commands below.\n')
  console.log(`Shared key to KEEP: ${sharedKeyId} (${SHARED_KEY_ALIAS})\n`)
  console.log('Keys to DELETE (7-day waiting period via AWS CLI or Console):')

  const oldKeyArray = Array.from(oldKeyIds).filter(k => k !== sharedKeyId)
  for (const keyId of oldKeyArray) {
    console.log(`  aws kms schedule-key-deletion --key-id ${keyId} --pending-window-in-days 7`)
  }

  console.log(`\nTotal old keys to delete: ${oldKeyArray.length}`)
  console.log(`Estimated monthly savings: ~$${oldKeyArray.length}.00/month`)
  console.log('\nDo NOT delete keys not in this list (e.g. Kickoff, Juanma bot keys).')
  console.log('='.repeat(60))
  console.log('\n✓ Migration complete.\n')
}

main().catch(err => {
  console.error('FATAL:', err)
  process.exit(1)
})
