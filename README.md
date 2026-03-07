# Nook

Vault-first virtual office for deploying and observing Hedera agents.

## Concept

This project turns the hackathon idea into a concrete product direction:

- A Gather-style pixel office where users see agents as live actors in shared space.
- A template-driven deployment flow for Hedera Agent Kit based agents.
- OculusVault as the default execution model, so agents operate through guarded contracts instead of holding funds directly.

## Current State

The app in this repo is now a hackathon-capable draft with a live backend path:

- Pixel office UI with guided deployment and wallet-connect entry.
- Node API server for Hedera testnet deployment and activity polling.
- Hedera Agent Kit adapter for balance queries and HCS topic actions.
- NookVault contract compilation and deployment on Hedera testnet.
- Mirror-node-backed live activity feed in the office UI.

## Run

```bash
npm install
npm run dev
```

## Live Hedera Setup

Copy `.env.example` to `.env` and set:

- `HEDERA_ACCOUNT_ID`
- `HEDERA_PRIVATE_KEY`
- `VITE_WALLETCONNECT_PROJECT_ID` for wallet connect in the frontend

Without those values, the app still runs in local preview mode.

## Build

```bash
npm run build
npm run lint
```

## Docs

- [Product brief](/Users/juan/JuanMa/Personal/Personal/APEX/docs/PRODUCT_BRIEF.md)
- [Architecture](/Users/juan/JuanMa/Personal/Personal/APEX/docs/ARCHITECTURE.md)
- [Hackathon launch notes](/Users/juan/JuanMa/Personal/Personal/APEX/docs/ROADMAP.md)
