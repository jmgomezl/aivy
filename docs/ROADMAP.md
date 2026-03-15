# Roadmap

## Phase 0: Framing (Complete)

Goal: Validate the story and tighten scope.

Deliverables:

- Name and narrative (Aivy — AI Agents on Hedera).
- Vault-first product stance with AivyVault Solidity contract.
- 4 agent templates (Treasury, Yield, Compliance, Governance).
- Demo script with real Hedera testnet deployment.
- Pixel office UI with animated sprites.

## Phase 1: Hackathon MVP (Complete)

Goal: Show a working end-to-end path on Hedera testnet.

Deliverables:

1. Pixel office frontend with themed rooms, animated sprites, and live activity feed.
2. Template registry with 4 agent types and capability-based tool access.
3. Real agent deployment with dedicated Hedera accounts and encrypted keys.
4. AivyVault contract deployment on Hedera EVM with spending cap enforcement.
5. AI chat with 50+ Hedera Agent Kit tools via GPT-4o function calling.
6. Quick-fund flow with HashPack wallet integration and preset amounts.
7. Autonomous execution via cron schedules and Mirror Node event triggers.
8. Balance monitoring with batch pre-fetching and 30s auto-refresh.
9. Landing page with vault architecture showcase.
10. 140+ unit tests with 96% coverage.
11. Production deployment at https://aivylabs.xyz.

Success criteria:

- A user deploys agents from the UI on Hedera testnet.
- Agents appear in the pixel office with live status and speech bubbles.
- Real HBAR funding via HashPack with on-chain transaction confirmation.
- AivyVault contracts deployed and enforcing spending caps on-chain.
- AI chat routes to correct Hedera tools and returns real transaction results.
- Mirror Node events trigger autonomous agent execution.

## Phase 1.5: Agentic Commerce — ERC-8183 (Complete)

Goal: Enable trustless agent-to-agent settlements on top of AivyVault spending caps.

Deliverables:

1. AivyJobManager.sol contract implementing ERC-8183 job lifecycle with escrow.
2. IACPHook interface for extensible pre/post action hooks.
3. Vault cap bridge — spending caps enforced before job funding.
4. 7 new API endpoints for job CRUD and lifecycle transitions.
5. Jobs database table with full lifecycle tracking.
6. 19 new tests covering contract compilation, job lifecycle, and vault integration.
7. ERC-8183 documentation with Mermaid architecture diagrams.

Success criteria:

- AivyJobManager compiles successfully alongside AivyVault.
- Full job lifecycle: Open → Funded → Submitted → Completed/Rejected/Expired.
- Vault spending cap blocks job funding when cap would be exceeded.
- Provider receives payment only after evaluator approval.
- Client can reclaim escrowed HBAR after rejection or expiry.

## Phase 2: Post-hackathon productization

Goal: Move from demo to reusable builder product.

Deliverables:

1. Team workspaces with multi-user collaboration.
2. Saved projects and persistent environments.
3. Template versioning and custom template creation.
4. Vault policy editor with presets and custom rules.
5. Live logs, traces, and execution history.
6. Agent-to-agent coordination protocols.
7. WebSocket-based real-time updates (replace polling).
8. Mainnet support alongside testnet.

## Phase 3: Managed cloud

Goal: Offer a fully managed agent deployment platform.

Deliverables:

1. Managed deployment tier with one-click provisioning.
2. Billing, quotas, and usage metering.
3. Template marketplace for community-contributed agents.
4. Multi-tenant vault and policy management.
5. Production observability, alerting, and incident controls.
6. SDK/API for programmatic agent management.
