# Aivy × Quorum

**[Try the monthly cover canvas](https://aivylabs.xyz/quorum).**
The homepage and agent-office navigation link to this focused workflow. It lets
a visitor approve up to three monthly testnet policy purchases for Medellín,
Mexico City or Tokyo, with a budget cap and minimum payout.

## User flow

1. Choose a place, monthly premium limit and minimum payout.
2. Review a fresh quote. Approve the three-purchase spending limit explicitly.
3. Activate. A funded demo account pays the first premium on Hedera testnet.
4. Inspect the actual policy/NFT and transaction receipts, the next attempt date,
   or pause future purchases. “Check renewal now” rechecks eligibility; it does
   not bypass dates or create another policy in a completed period.

The worker runs while the browser is closed. The saved rules are immutable;
renewals use fresh prices. No purchase is allowed below the minimum payout or
above the monthly budget. The mandate ends after three monthly periods.

## Trust boundary

This is a dedicated Aivy frontend connected to Quorum's deterministic backend.
It does not deploy an arbitrary LLM agent or use the existing office's KMS,
AivyVault, wallet connector or general-purpose tools. The page explains that
boundary in its expandable details. Quorum holds the demo signing keys; a
browser capability controls the demo account. Keep that capability private.
Pause before clearing browser storage: losing access does not cancel the plan.

Each completed purchase creates a separate service-managed policy beneficiary,
using the existing Quorum issuer and its limits, issuance lock and recovery
journals. The scheduled *purchase date* is offchain state; the resulting
*conditional payout* is a Hedera Scheduled Transaction. Earthquake checks are
still requested separately. Test tokens have no cash value.

[Backend source, visual architecture and safety tests](https://github.com/jmgomezl/aivy-parametric-pool/blob/main/docs/COVER-AGENT.md).

## Deployment

- Build the frontend with `npm run build:web`. This typechecks the web app and
  creates `dist` without rebuilding the older Aivy API.
- Deploy new hashed assets before `index.html`; retain previous hashed assets
  for browsers with an older page open.
- Inside the existing `aivylabs.xyz` TLS server, proxy `/api/quorum/` to
  `http://127.0.0.1:8814/api/cover-agents/`, with an 8 KB request-body limit,
  a 180-second read timeout, `Cache-Control: no-store` and forwarded client IP.
  The existing `/api/` route remains on port 3001. Validate with `nginx -t`.
- Deploy the corresponding Quorum backend first. Preserve its private journals
  and run one worker. The Aivy office backend does not require a restart.

The route loads independently of the large legacy office/wallet bundle.
Shared Vite helpers and Buffer polyfills have their own chunk.

## Validation and historical scope

`node scripts/check-quorum-canvas.mjs` uses isolated API fixtures against Vite
preview on `https://127.0.0.1:5185/`. It checks widths 1440, 1024, 768, 390 and
320, consent, activation, receipts, pause/resume, reload, no overflow and no
legacy wallet chunk. Fixtures are never used as live transaction evidence.

The existing full repository test run and full backend build have baseline
failures, reproduced on untouched commit `6ddc263`: two outdated expectations
(template count and demo authorization behavior), a local better-sqlite3 Node
ABI mismatch, and older backend TypeScript errors. They are not introduced by
this integration. The frontend build and dedicated canvas checks pass.

This integration was added September 9, 2026, after the APEX submission. It is
new Quorum integration work, not a retroactive claim about that earlier build.
