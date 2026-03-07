# Product Brief

## Working name

Nook

## One-line pitch

A virtual pixel office for deploying Hedera agents from low-code templates, monitoring them in real time, and defaulting every sensitive action through a NookVault guardrail contract.

## Core idea

The product is not just an agent dashboard. It is a collaborative control room where teams can:

- choose a template,
- deploy an agent onto Hedera,
- observe agent behavior visually,
- inspect what the agent is doing,
- approve or pause execution,
- keep assets behind a vault contract instead of transferring funds to the agent.

## Product stance

For the hackathon, the product should behave like option 1 with proof of execution:

- Primary mode: template-first deployment system.
- Demo proof: at least one real agent running on your infrastructure through Hedera testnet.
- Security posture: vault-first by default.

That keeps the MVP clear while still proving there is a real backend path.

## Main user promise

Developers and operators can launch an agent without manually wiring wallets, runtime infrastructure, and safety logic from scratch.

## Key differentiators

- Visual environment instead of a standard dashboard.
- Hedera-native positioning, not generic agent tooling.
- OculusVault default path that avoids giving token custody to autonomous agents.
- Low-code deployment flow that can become a managed platform later.

## MVP scope

1. Pixel office frontend with shared presence and agent visualization.
2. Template catalog for 3-5 agent types.
3. Deployment control plane for agent instances.
4. Real-time event stream back into the office.
5. Vault contract suggestion and default provisioning flow.
6. One end-to-end testnet demo agent.

## Demo narrative

1. Open the office and show the rooms.
2. Deploy a template agent.
3. Show the system suggesting or forcing OculusVault.
4. Provision the vault-linked execution contract.
5. Start the agent and display live events in the office.
6. Pause, inspect, and resume the agent from the control room.
7. Show a Hedera transaction or mirror-node-backed event.
