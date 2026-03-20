# AWS KMS Key Management — Security Architecture

<p align="center">
  <img src="https://img.shields.io/badge/AWS-KMS-FF9900?style=for-the-badge&logo=amazon-aws&logoColor=white" />
  <img src="https://img.shields.io/badge/Hedera-Testnet-8259EF?style=for-the-badge&logo=hedera&logoColor=white" />
  <img src="https://img.shields.io/badge/Encryption-AES--256--GCM-00C853?style=for-the-badge" />
</p>

> **Bounty**: Secure Key Management for Onchain Applications (Intermediate)
>
> Private keys never exist in plaintext at rest. Every agent's signing key is encrypted by a dedicated AWS KMS symmetric key and only decrypted in-memory for the instant a transaction is signed.

---

## Problem Statement

Autonomous AI agents that interact with blockchains need private keys to sign transactions. Traditional approaches store keys in plaintext files, environment variables, or application databases — creating single points of compromise. If a server is breached, every agent's funds are at risk.

Aivy solves this with **AWS KMS envelope encryption**: each agent gets a dedicated KMS key, and its Hedera signing key is encrypted at rest with that KMS key. The plaintext key only exists in memory for the milliseconds required to sign a transaction, then is wiped.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Aivy Platform                            │
│                                                                 │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────┐   │
│  │  Agent Chat   │    │  Cron Jobs   │    │  Event Triggers  │   │
│  │  (GPT-4o)     │    │  (node-cron) │    │  (Mirror Node)   │   │
│  └──────┬───────┘    └──────┬───────┘    └────────┬─────────┘   │
│         │                   │                      │             │
│         └───────────────────┼──────────────────────┘             │
│                             ▼                                    │
│                  ┌─────────────────────┐                         │
│                  │  Transaction Builder │                         │
│                  │  (Hedera SDK)        │                         │
│                  └──────────┬──────────┘                         │
│                             │                                    │
│                    needs signing key                             │
│                             │                                    │
│                             ▼                                    │
│              ┌──────────────────────────────┐                    │
│              │     KMS Decrypt Request       │                    │
│              │  ┌─────────────────────────┐  │                    │
│              │  │ kmsKeyId + ciphertext    │  │                    │
│              │  │ + encryption context     │  │                    │
│              │  └─────────────────────────┘  │                    │
│              └──────────────┬───────────────┘                    │
│                             │                                    │
└─────────────────────────────┼────────────────────────────────────┘
                              │ HTTPS (TLS 1.3)
                              ▼
               ┌──────────────────────────────┐
               │        AWS KMS Service        │
               │                               │
               │  ┌─────────────────────────┐  │
               │  │  Per-Agent Symmetric Key │  │
               │  │  (AES-256-GCM)           │  │
               │  │  + Auto-Rotation         │  │
               │  │  + Alias tagging         │  │
               │  │  + CloudTrail audit      │  │
               │  └─────────────────────────┘  │
               │                               │
               │  Returns: plaintext key bytes │
               └──────────────┬───────────────┘
                              │
                              ▼
               ┌──────────────────────────────┐
               │   In-Memory Signing (< 50ms)  │
               │                               │
               │  1. PrivateKey.fromStringED25519()  │
               │  2. transaction.sign(key)     │
               │  3. Buffer.fill(0) — wipe key │
               └──────────────────────────────┘
```

---

## Key Lifecycle

### 1. Agent Deployment — Key Creation

When a new agent is deployed, Aivy creates a **dedicated KMS key** for that agent:

```
User clicks "Deploy Agent"
        │
        ▼
┌──────────────────────────────┐
│  AWS KMS: CreateKeyCommand   │
│  - KeySpec: SYMMETRIC_DEFAULT│
│  - Usage: ENCRYPT_DECRYPT    │
│  - Tags: Platform=Aivy,      │
│    AgentName=treasury-sentinel│
│    Purpose=Agent Key Encrypt  │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│  Generate Hedera Ed25519     │
│  keypair (in memory)         │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│  AWS KMS: EncryptCommand     │
│  - Plaintext: private key    │
│  - Context: {platform: aivy, │
│    agent: name, keyType: ed} │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│  Store in SQLite:            │
│  - kms_key_id (KMS reference)│
│  - encrypted private key     │
│  - Hedera account ID         │
│  Wipe plaintext from memory  │
└──────────────────────────────┘
```

**Code path**: `server/kms.ts → createAgentKmsKey()` → `server/index.ts → createAgentAccount()`

### 2. Transaction Signing — Decrypt, Sign, Wipe

Every time an agent needs to sign a Hedera transaction:

```typescript
// 1. Retrieve encrypted key from DB
const deployment = db.getDeployment(agentId)

// 2. KMS decrypts the key (in memory only)
const privateKey = await decryptAgentKey(
  deployment.kmsKeyId,
  deployment.encryptedPrivateKey,
  deployment.name
)

// 3. Sign the transaction
const signed = await transaction.sign(privateKey)

// 4. Wipe key from memory immediately
Buffer.from(privateKey).fill(0)
```

The plaintext private key exists in process memory for **< 50ms** — only for the signing operation.

### 3. Key Rotation

Agent keys can be rotated without downtime:

```
POST /api/agents/:id/kms/rotate
        │
        ▼
┌──────────────────────────────┐
│  Generate new Ed25519 keypair│
│  Encrypt with SAME KMS key  │
│  Update DB with new key      │
│  Wipe old & new plaintext    │
└──────────────────────────────┘
```

KMS also enables **automatic annual rotation** of the symmetric encryption key itself via `EnableKeyRotationCommand`.

### 4. Agent Destruction — Scheduled Key Deletion

When an agent is destroyed:

```
DELETE /api/agents/:id
        │
        ▼
┌──────────────────────────────┐
│  1. Refund remaining HBAR    │
│     to user's wallet         │
│  2. ScheduleKeyDeletion      │
│     (7-day safety window)    │
│  3. Delete agent from DB     │
└──────────────────────────────┘
```

The 7-day safety window ensures accidental deletions can be recovered.

---

## Security Controls

### Encryption Layers

| Layer | Protection | Technology |
|-------|-----------|-----------|
| **At Rest (DB)** | Agent private keys encrypted before storage | AES-256-GCM (application layer) |
| **Envelope Encryption** | Application encryption key protected by KMS | AWS KMS symmetric key per agent |
| **In Transit** | All KMS API calls over TLS | HTTPS / TLS 1.3 |
| **In Memory** | Plaintext key wiped after signing | `Buffer.fill(0)` immediate wipe |

### Access Controls

| Control | Implementation |
|---------|---------------|
| **IAM Policies** | KMS operations scoped to specific key ARNs |
| **Encryption Context** | Every decrypt requires matching `{platform, agent, keyType}` context |
| **Per-Agent Isolation** | Each agent has its own KMS key — compromise of one doesn't affect others |
| **JWT Authentication** | All API endpoints require valid JWT with Hedera account verification |
| **Rate Limiting** | Per-route rate limits prevent brute-force attempts |

### Audit Trail

| Event | Logged To |
|-------|-----------|
| Key creation | AWS CloudTrail + server console |
| Key decryption (signing) | AWS CloudTrail (every `Decrypt` call) |
| Key rotation | AWS CloudTrail + server console |
| Key deletion scheduled | AWS CloudTrail + server console |
| Transaction execution | Hedera Consensus Service (HCS) audit topic |
| Spending cap checks | AivyVault.sol `ExecutionLogged` events on-chain |

---

## API Endpoints

### KMS Status

```
GET /api/kms/status
```

Returns whether AWS KMS is configured and the active region.

```json
{
  "enabled": true,
  "region": "us-east-1",
  "provider": "AWS KMS"
}
```

### Agent KMS Info

```
GET /api/agents/:id/kms/info
```

Returns KMS key metadata for a specific agent.

```json
{
  "enabled": true,
  "keyId": "1c828dde-628e-4d9...",
  "arn": "arn:aws:kms:us-east-1:...:key/1c828dde-...",
  "createdAt": "2026-03-18T...",
  "description": "Aivy Agent Key — Main Treasury",
  "provider": "AWS KMS",
  "region": "us-east-1"
}
```

### Key Rotation

```
POST /api/agents/:id/kms/rotate
```

Generates a new Hedera keypair encrypted with the same KMS key.

```json
{
  "success": true,
  "message": "Key rotated for agent Main Treasury",
  "kmsKeyId": "1c828dde-628e-4d9...",
  "newPublicKey": "302a300506032b6570032100..."
}
```

---

## AWS KMS Console — Live Keys

Each agent deployed on Aivy creates a corresponding KMS key visible in the AWS Console:

| Alias | Key Type | Key Spec | Usage | Auto-Rotation |
|-------|----------|----------|-------|---------------|
| `aivy-agent-main-treasury-*` | Symmetric | AES-256 | Encrypt/Decrypt | ✅ Enabled |
| `aivy-agent-yield-router-*` | Symmetric | AES-256 | Encrypt/Decrypt | ✅ Enabled |
| `aivy-agent-audit-bot-*` | Symmetric | AES-256 | Encrypt/Decrypt | ✅ Enabled |
| `aivy-agent-treasury-sentinel-*` | Symmetric | AES-256 | Encrypt/Decrypt | ✅ Enabled |

> Screenshot from AWS KMS Console showing 10 active agent keys — one per deployed agent.

---

## Three-Layer Security Model

Aivy implements defense-in-depth with three independent security layers:

```
┌────────────────────────────────────────────────────────┐
│                   Layer 3: AWS KMS                      │
│         Cryptographic key protection & audit            │
│   ┌────────────────────────────────────────────────┐   │
│   │              Layer 2: AivyVault.sol              │   │
│   │       On-chain spending caps (Solidity EVM)      │   │
│   │   ┌────────────────────────────────────────┐    │   │
│   │   │       Layer 1: Application Security     │    │   │
│   │   │  JWT auth + rate limiting + encryption  │    │   │
│   │   │                                         │    │   │
│   │   │        Agent Hedera Account             │    │   │
│   │   │        (dedicated per agent)            │    │   │
│   │   └────────────────────────────────────────┘    │   │
│   └────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────┘
```

1. **Application Security**: JWT authentication, AES-256-GCM encryption at rest, rate limiting, user-scoped access
2. **Smart Contract Guardrails**: AivyVault.sol enforces spending caps on-chain — even if the application is compromised, the EVM rejects overspending
3. **AWS KMS Envelope Encryption**: Private keys are never stored in plaintext. Every decrypt operation is logged in CloudTrail. Keys can be rotated and scheduled for deletion.

---

## Configuration

### Required Environment Variables

```env
# AWS KMS Configuration
AWS_ACCESS_KEY_ID=AKIA...          # IAM user with KMS permissions
AWS_SECRET_ACCESS_KEY=...          # IAM secret key
AWS_REGION=us-east-1               # KMS key region

# Hedera Configuration
HEDERA_ACCOUNT_ID=0.0.XXXXXX      # Operator account
HEDERA_PRIVATE_KEY=302e...         # Operator key (for account creation only)
```

### Required IAM Permissions

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "kms:CreateKey",
        "kms:Encrypt",
        "kms:Decrypt",
        "kms:DescribeKey",
        "kms:EnableKeyRotation",
        "kms:ScheduleKeyDeletion",
        "kms:ListKeys",
        "kms:CreateAlias",
        "kms:TagResource"
      ],
      "Resource": "*"
    }
  ]
}
```

### Graceful Fallback

When AWS credentials are not configured, Aivy falls back to local key management with AES-256-GCM encryption. The `isKmsConfigured()` check ensures the system works in both modes:

```typescript
if (isKmsConfigured()) {
  // KMS-protected key creation (Ed25519)
  const kmsBundle = await createAgentKmsKey(agentName)
  // ... key never exists in plaintext at rest
} else {
  // Legacy: local key generation (ECDSA)
  agentKey = PrivateKey.generateECDSA()
  // ... encrypted with AES-256-GCM in DB
}
```

---

## File Reference

| File | Role |
|------|------|
| `server/kms.ts` | AWS KMS client, key creation, encryption, decryption, rotation, deletion |
| `server/index.ts` | Integration — uses KMS for agent account creation and transaction signing |
| `server/crypto.ts` | Application-layer AES-256-GCM encryption (additional layer on top of KMS) |
| `server/db.ts` | Stores `kms_key_id` alongside agent records in SQLite |
| `contracts/AivyVault.sol` | On-chain spending caps — complementary security layer |

---

## Compliance Checklist

| Requirement | Status | Implementation |
|-------------|--------|---------------|
| ✅ Secure key generation using AWS KMS | Done | `createAgentKmsKey()` — KMS symmetric key per agent |
| ✅ Secure key storage | Done | Private keys encrypted by KMS, stored as ciphertext in DB |
| ✅ Key rotation | Done | `rotateAgentKey()` + KMS auto-rotation (annual) |
| ✅ Submit transaction on Hedera | Done | HBAR transfers, token ops, contract calls — all signed via KMS |
| ✅ Access controls | Done | IAM policies, encryption context, JWT auth, rate limiting |
| ✅ Audit logging | Done | CloudTrail for KMS ops, HCS for on-chain actions |
| ✅ No private key exposure | Done | Keys decrypted in memory only, wiped after signing |
| ✅ Working prototype | Done | Live at [aivylabs.xyz](https://aivylabs.xyz) with 10 KMS-protected agents |

---

*Built by AivyLabs for the Hedera APEX Hackathon 2026 — AWS Secure Key Management Bounty*
