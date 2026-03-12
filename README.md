<p align="center">
  <img src="public/logo-full.png" alt="Aivy" width="120" />
</p>

<h1 align="center">Aivy — AI Agents on Hedera</h1>

<p align="center">
  The missing infrastructure layer for autonomous AI agents on Hedera.<br/>
  Deploy, fund, schedule, and monitor agents that interact with the Hedera network — in 60 seconds.
</p>

<p align="center">
  <a href="https://aivylabs.xyz">Live Demo</a> &bull;
  <a href="docs/ARCHITECTURE.md">Architecture</a> &bull;
  <a href="docs/PRODUCT_BRIEF.md">Product Brief</a>
</p>

---

![Aivy Landing](docs/screenshots/landing.png)

## Why Aivy?

Hedera has world-class infrastructure — fast finality, low fees, native tokens, consensus messaging — but **building agentic applications on top of it is still hard**. Developers need to wire up wallet management, tool calling, transaction guardrails, and execution loops from scratch.

Aivy solves this by providing a **ready-to-use platform where AI agents are first-class citizens on Hedera**:

- **Any LLM can operate on Hedera** — Agents use 50+ tools from the Hedera Agent Kit via natural language. No SDK knowledge required.
- **Agents run autonomously, not just on user prompts** — Cron schedules and on-chain event triggers let agents act on their own (e.g., "rebalance treasury weekly", "respond to incoming HBAR transfers").
- **On-chain guardrails, not just promises** — Every agent deploys with an AivyVault Solidity contract that enforces spending caps at the EVM level. The AI literally cannot overspend.
- **Real wallet isolation** — Each agent gets its own Hedera account with an encrypted private key. No shared operator key risk.
- **Hedera-native event system** — Agents react to HBAR transfers, HCS topic messages, and token movements by polling the Mirror Node in real-time.

> **The goal**: make it as easy to deploy an autonomous Hedera agent as it is to deploy a serverless function.

---

## Hedera Integration Deep Dive

### Hedera Agent Kit — 50+ On-Chain Tools

Aivy wraps the full [Hedera Agent Kit](https://github.com/hashgraph/hedera-agent-kit) and exposes every tool to AI agents via OpenAI function calling:

| Capability Group | Hedera Operations | Example Agent Use |
|-----------------|-------------------|-------------------|
| **Accounts** | `create_account`, `transfer_hbar`, `get_account_balance` | Treasury Sentinel checks balances and moves HBAR |
| **Tokens (HTS)** | `create_token`, `mint_token`, `transfer_token`, `associate_token` | Yield Router mints reward tokens |
| **Consensus (HCS)** | `create_topic`, `submit_message`, `get_topic_messages` | Compliance Clerk logs audit records immutably |
| **Smart Contracts** | `deploy_contract`, `call_contract`, `get_contract_info` | Deploy AivyVault guardrail contracts |
| **Queries** | `get_transaction_record`, `get_account_info`, `get_exchange_rate` | Any agent inspects on-chain state |

Agents are granted **capability groups**, not individual tools — so a read-only Compliance Clerk can never accidentally mint tokens.

### AivyVault — On-Chain Spending Guardrails

Every vault-protected agent deploys a Solidity smart contract on Hedera:

```solidity
// Simplified — enforces per-agent spending caps at the EVM level
function logExecution(string action, uint256 amountTinybar, ...) external {
    require(!paused, "vault paused");
    require(amountTinybar <= spendingCapTinybar, "cap exceeded");
    emit ExecutionLogged(action, amountTinybar, targetAccountId, note);
}
```

This means spending limits are enforced **on-chain**, not just in application code. Even if the AI hallucinates a large transfer, the vault contract blocks it.

### Mirror Node Event Polling

Aivy polls the Hedera Mirror Node REST API every 30 seconds to detect:

- **HBAR inflows** — Transfers landing in an agent's account (with configurable minimum amount)
- **HCS messages** — New messages on any topic the agent monitors
- **Token transfers** — Fungible/NFT tokens arriving at the agent's account

When an event matches a trigger, Aivy fills a prompt template with event data (`{{amount}}`, `{{sender}}`, `{{txId}}`) and runs the agent autonomously.

### HashPack Wallet Integration

Users connect their HashPack wallet via WalletConnect/HashConnect v3 to:

- **Fund agent accounts** — Direct HBAR transfer from user wallet to agent's dedicated Hedera account
- **Authenticate** — Challenge-response flow: server issues a challenge, user signs with their Hedera key, server verifies via Mirror Node
- **Track spending** — See exactly how much HBAR each agent has spent, funded, and its remaining runway

---

## Screenshots

| Office View |
|:-----------:|
| ![Office](docs/screenshots/office.png) |

---

## Key Features

| Feature | Description |
|---------|-------------|
| **Autonomous Schedules** | Cron-based execution — "check balance every hour", "rebalance weekly" |
| **Event Triggers** | React to HBAR inflows, HCS messages, token transfers via Mirror Node |
| **Real Funding Flow** | Transfer HBAR from HashPack directly to agent accounts |
| **Spending Analytics** | Per-agent HBAR tracking, burn rate, estimated runway |
| **Vault Guardrails** | Solidity contracts enforce spending caps on-chain |
| **50+ Hedera Tools** | Full Agent Kit: accounts, tokens, consensus, contracts, queries |
| **AI Chat** | Natural language interface — GPT-4o routes to the right Hedera tools |
| **Multi-Agent Routing** | Ask a question, Aivy picks the best agent to answer |
| **Agent Coordination** | Agents trigger actions on other agents (e.g., low balance alerts) |
| **Live Activity Feed** | Mirror Node-backed ticker with HashScan transaction links |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, TypeScript, Vite |
| Backend | Express 5, Node.js, SQLite (better-sqlite3) |
| AI | OpenAI GPT-4o with tool calling |
| Blockchain | Hedera SDK, Hedera Agent Kit, Solidity (AivyVault) |
| Security | AES-256-GCM key encryption, JWT auth, rate limiting |
| Automation | node-cron, Mirror Node REST polling |
| Wallet | HashConnect v3, WalletConnect |

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env with your Hedera testnet credentials

# 3. Start development (frontend + backend)
npm run dev
```

The app opens at `http://localhost:5173`. Without Hedera credentials, it runs in **demo mode** with simulated data.

### Environment Variables

```env
HEDERA_ACCOUNT_ID=0.0.XXXXXX           # Hedera testnet operator account
HEDERA_PRIVATE_KEY=302e...              # Operator private key (ECDSA or ED25519)
OPENAI_API_KEY=sk-...                   # Enables AI chat with agents
VITE_WALLETCONNECT_PROJECT_ID=...       # Optional: HashPack wallet connect
```

Security keys (`MASTER_ENCRYPTION_KEY`, `JWT_SECRET`) are auto-generated on first run if not set.

### Build

```bash
npm run build    # TypeScript + Vite production bundle
npm run lint     # ESLint check
```

---

## Architecture

### Agent Templates

| Agent | Hedera Role | Capability Groups |
|-------|------------|-------------------|
| Treasury Sentinel | HBAR management | Accounts, Account Queries, Consensus, Transaction Queries |
| Yield Router | Token & DeFi ops | Accounts, Tokens, Token Queries, Contracts, Contract Queries |
| Compliance Clerk | Audit & read-only | All Query groups (no mutations) |
| Governance Relay | DAO proposals | Consensus, Consensus Queries, Network Queries |

### What Each Agent Gets

1. **Dedicated Hedera Account** — Own key pair, encrypted at rest (AES-256-GCM)
2. **AivyVault Contract** — On-chain spending cap enforcement via Solidity
3. **HCS Audit Topic** — Every action logged immutably on Hedera Consensus Service
4. **GPT-4o Session** — Natural language with access to 50+ Hedera tools
5. **Autonomous Execution** — Cron schedules + event-triggered actions via Mirror Node

---

## Project Structure

```
server/
  index.ts          # Express API — agents, chat, tools, schedules, triggers
  db.ts             # SQLite — deployments, spending, schedules, triggers
  auth.ts           # JWT challenge-response with Hedera account verification
  crypto.ts         # AES-256-GCM encryption for agent private keys
  scheduler.ts      # node-cron wrapper for autonomous agent execution
  eventPoller.ts    # Mirror Node polling for HBAR, HCS, token events
  rateLimiter.ts    # Per-route rate limiting
  middleware.ts     # Auth middleware

src/
  components/
    AgentPanel.tsx      # Agent detail — chat, info, spending, automation tabs
    ChatPanel.tsx       # AI chat with Hedera tool calling
    ScheduleManager.tsx # Cron schedule CRUD UI
    TriggerManager.tsx  # Event trigger CRUD UI
    Dashboard.tsx       # Network-wide analytics
    ToolLibrary.tsx     # Direct Hedera tool invocation
  lib/
    hederaWallet.ts     # HashConnect v3 integration
```

---

## Contributing

1. Create a branch from `main`
2. Make your changes
3. Open a Pull Request (1 approval required)

Branch protection is enabled — all changes go through PRs.

---

## Team

Built by **AivyLabs** for the Hedera APEX Hackathon 2026.

## License

MIT
