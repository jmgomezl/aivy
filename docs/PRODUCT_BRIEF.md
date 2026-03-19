# Product Brief

## Name

Aivy

## One-line pitch

A visual pixel office for deploying AI agents on Hedera from templates, monitoring them in real time, and enforcing every sensitive action through an AivyVault guardrail contract.

## Core idea

The product is not just an agent dashboard. It is a collaborative control room where teams can:

- choose a template,
- deploy an agent onto Hedera,
- observe agent behavior visually in a pixel office,
- inspect what the agent is doing via AI chat,
- approve or pause execution,
- keep assets behind an AivyVault contract instead of giving unrestricted access.

## Product stance

For the hackathon, the product behaves as a template-first platform with proof of execution:

- Primary mode: template-first deployment system.
- Demo proof: real agents running on Hedera testnet with dedicated accounts.
- Security posture: vault-first + KMS-first by default — every agent gets an AivyVault contract and a dedicated AWS KMS key.
- Key management: AWS KMS envelope encryption — private keys never stored in plaintext, with full CloudTrail audit trail.

## Main user promise

Developers and operators can launch an agent without manually wiring wallets, runtime infrastructure, and safety logic from scratch.

## Key differentiators

- **AWS KMS key management** — every agent's signing key protected by a dedicated KMS key. Zero plaintext keys at rest. Full CloudTrail audit.
- Visual pixel office with animated agent sprites — not a generic dashboard.
- Hedera-native positioning, not generic agent tooling.
- AivyVault + KMS — defense-in-depth with on-chain spending caps AND cryptographic key protection.
- Quick-fund flow — fund agents in 2-3 clicks with preset amounts.
- Low-code deployment flow that can become a managed platform later.

## MVP scope

1. Pixel office frontend with agent sprites, themed rooms, and activity feed.
2. Template catalog for 4 agent types (Treasury, Yield, Compliance, Governance).
3. Deployment flow with real Hedera account creation and vault contract deployment.
4. Real-time balance monitoring via Mirror Node with 30s auto-refresh.
5. AivyVault contract deployment and on-chain spending cap enforcement.
6. Quick-fund modal with HashPack wallet integration.
7. AI chat with 50+ Hedera Agent Kit tools.
8. Autonomous execution via cron schedules and event triggers.
9. **AWS KMS integration** — per-agent envelope encryption, key rotation, scheduled deletion, CloudTrail audit.

## Demo narrative

1. Open the landing page — see the pixel office preview and vault architecture.
2. Click "Try Demo" — demo agents deploy on Hedera testnet with real accounts.
3. Enter the office — see agents in themed rooms with live speech bubbles.
4. Click an agent — view its Hedera account, vault contract, and spending data.
5. Chat with an agent — ask it to check balances or create tokens.
6. Fund an agent — click "Fund" chip, select preset amount, sign in HashPack.
7. View the activity feed — real Mirror Node transactions with HashScan links.
8. Check the dashboard — network-wide analytics and agent coordination stats.
