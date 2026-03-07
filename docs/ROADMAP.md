# Hackathon Launch

## Phase 0: framing

Goal: validate the story and tighten scope.

Deliverables:

- name and narrative,
- vault-first product stance,
- 3-5 agent templates,
- demo script,
- UI prototype.

## Phase 1: hackathon MVP

Goal: show a working end-to-end path.

Deliverables:

1. Pixel office frontend with deploy flow.
2. Template registry in code.
3. Control plane endpoint that accepts a deployment request.
4. One agent runner integrated with Hedera Agent Kit.
5. One OculusVault-backed execution contract or mocked equivalent if contract delivery is too risky.
6. Mirror node or transaction feed shown inside the office.

Success criteria:

- a user deploys from the UI,
- the agent appears in the office,
- the agent emits live activity,
- one Hedera-backed action is visible,
- the vault narrative is clear and concrete.

## Phase 2: post-hackathon productization

Goal: move from demo to reusable builder product.

Deliverables:

1. Authentication and team workspaces.
2. Saved projects and environments.
3. Template versioning.
4. Managed runtime orchestration.
5. Live logs, traces, and run history.
6. Vault policy editor with presets.

## Recommended next engineering tasks

1. Move the current Vite app into `apps/web`.
2. Stand up a small Node control plane with deployment and event endpoints.
3. Implement one real demo template first, preferably treasury or compliance, because the vault story is strongest there.
4. Define the vault contract interface and the minimum policy schema.
5. Decide how the runner requests execution from the vault.
6. Wire mirror node events back into the office UI.
