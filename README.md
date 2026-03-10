# Aivy — AI Agents on Hedera

> Deploy AI agents on Hedera in 60 seconds with vault-first security.

**Live demo:** [https://aivylabs.xyz](https://aivylabs.xyz)

![Aivy Landing](docs/screenshots/landing.png)

## What is Aivy?

Aivy is a vault-first virtual office for deploying and managing AI agents on the Hedera network. Agents operate through guarded smart contracts with on-chain spending caps — not by holding funds directly.

- **Pixel office UI** — Watch agents work in a Gather-style workspace with real-time animations
- **Vault-first security** — Every agent deploys with an AivyVault contract enforcing spending limits
- **50+ Hedera tools** — Token creation, transfers, consensus messaging, smart contracts, and more
- **AI-powered chat** — Talk to agents using natural language; GPT-4 routes to the right Hedera tools
- **Live activity feed** — Mirror-node-backed ticker showing real transactions with hashscan links
- **Guided demo** — 8-step interactive tour works without any Hedera credentials
- **HashPack wallet** — Connect via WalletConnect to sign transactions with your own account

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, TypeScript, Vite |
| Backend | Express 5, Node.js |
| AI | OpenAI GPT-4 with tool calling |
| Blockchain | Hedera SDK, Hedera Agent Kit, Solidity (AivyVault) |
| Wallet | HashConnect v3, WalletConnect |
| Deployment | DigitalOcean (nginx + rsync) |

## Quick Start

```bash
npm install
npm run dev
```

This starts both the Vite frontend and Express backend concurrently.

## Environment Setup

Copy `.env.example` to `.env` and configure:

```env
HEDERA_ACCOUNT_ID=0.0.XXXXXX
HEDERA_PRIVATE_KEY=302e...
OPENAI_API_KEY=sk-...
VITE_WALLETCONNECT_PROJECT_ID=...   # optional, for HashPack wallet
```

Without Hedera credentials, the app runs in **demo mode** with simulated data.

## Build

```bash
npm run build    # compiles TypeScript + Vite production bundle
npm run lint     # ESLint check
```

## Architecture

Four agent templates, each with a specialized role:

| Agent | Role |
|-------|------|
| Treasury Sentinel | Vault management, balance queries, HBAR transfers |
| Yield Router | Token creation, minting, fungible token operations |
| Compliance Clerk | Audit logging via HCS topics, compliance records |
| Governance Relay | Proposal topics, consensus messaging, governance |

Each deployed agent gets:
1. A dedicated **AivyVault** smart contract with configurable spending cap
2. An **HCS audit topic** for on-chain activity logging
3. A **GPT-4 chat session** with Hedera tool access

See [Architecture](docs/ARCHITECTURE.md) and [Product Brief](docs/PRODUCT_BRIEF.md) for details.

## Team

Built by **AivyLabs** for the Hedera APEX Hackathon 2025.

## License

MIT
