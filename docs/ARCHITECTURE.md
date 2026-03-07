# Architecture

## Product shape

Build this as a template-first platform with a managed runtime path:

- Frontend: collaborative pixel office and deployment console.
- Control plane: template registry, deploy API, agent registry, event streaming.
- Runtime: one or more agent workers that execute Hedera Agent Kit logic.
- Vault layer: OculusVault contracts that hold assets and expose bounded execution rights.
- Data layer: mirror node ingestion, transaction history, audit records, team/project metadata.

## Core principle

Agents should not receive unrestricted token balances by default.

Instead:

1. A vault contract is created or selected.
2. Policy rules are attached to that vault.
3. The agent receives execution permissions scoped by those rules.
4. The control plane logs every action and projects it back into the office UI.

## Logical components

### 1. Pixel Office frontend

Responsibilities:

- workspace UI,
- agent placement and status,
- template deployment flow,
- operator controls,
- activity feed,
- vault inspection panel.

Suggested stack:

- React frontend,
- WebSocket or SSE for live events,
- wallet connection for operator actions.

### 2. Control plane API

Responsibilities:

- create project/workspace,
- list templates,
- deploy agent instance,
- provision vault policy,
- persist agent metadata,
- stream events.

Suggested responsibilities by service:

- `template-service`: manages templates and versioning,
- `deployment-service`: provisions runtimes and vault config,
- `registry-service`: source of truth for live agents,
- `event-service`: consumes runtime events and pushes UI updates.

### 3. Agent runtime

Responsibilities:

- run agent logic,
- call Hedera Agent Kit tools,
- request vault execution,
- emit traces and audit events,
- expose health state back to the control plane.

MVP runtime options:

- one containerized worker per live demo agent,
- one shared worker that simulates multiple template agents,
- background jobs plus a single event bus for the hackathon version.

### 4. OculusVault layer

Responsibilities:

- hold HBAR and tokens,
- enforce policy guardrails,
- expose a narrow execution interface to the agent,
- record approvals and limits,
- support pause and emergency stop.

Minimum guardrails for the demo:

- spending cap,
- protocol allowlist,
- time window or timelock,
- operator pause,
- mirrored audit record.

### 5. Hedera integration layer

Responsibilities:

- translate template actions into Hedera Agent Kit calls,
- deploy and interact with contracts,
- inspect balances and transactions,
- index results from Hedera mirror nodes.

MVP integration target:

- deploy one real agent on Hedera testnet,
- show at least one real contract-backed action or monitored transaction,
- route the action through the vault path if possible.

## Proposed repository growth

Current repo:

- single frontend app for concept validation.

Recommended next structure:

```text
apps/
  web/                  # Pixel Office frontend
  control-plane/        # API + orchestration
services/
  agent-runner/         # Hedera Agent Kit worker
  event-gateway/        # realtime events
packages/
  agent-templates/      # template definitions
  vault-sdk/            # OculusVault client and policy helpers
  hedera-adapters/      # network + mirror integrations
infrastructure/
  docker/
  terraform/
```

## Phase-based implementation

### Phase 1: hackathon-ready

- Frontend office.
- Mock deployment flow.
- One live backend agent.
- One vault-backed path.
- One real Hedera demo.

### Phase 2: platform beta

- Team accounts and saved workspaces.
- More templates.
- Runtime fleet management.
- Persistent projects and logs.
- Shared event streaming.

### Phase 3: managed cloud

- Fully managed deployment tier.
- Billing and quotas.
- Template marketplace.
- Multi-tenant vault and policy management.
- Production observability and incident controls.
