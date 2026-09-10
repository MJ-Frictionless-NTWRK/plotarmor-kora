# PlotArmor Kora Infrastructure Protocol

## Fee-payer key canon (permanent; must never change)

No agent, in this repo or any other, ever generates, reads, decodes, or transmits
the Kora fee-payer private key or its seed phrase. Key generation is a command the
human runs in their own terminal. Only the resulting public key (address) and the
fact that a secret now exists in Render's store are ever referenced in this repo,
commits, or agent output. If a task ever seems to require touching the actual key
material, stop and ask rather than finding a way to proceed.

This canon is permanent, like the program repo's PDA canon. Do not weaken it for
setup, testing, debugging, deployment, recovery, or convenience. Never inspect
secret files, environment dumps, secret-store values, or logs that could contain
this material. Document human-run commands with placeholders only. Agents may
check the public address and secret-existence status, never the secret value.

## Scope and lane

Lane 1. This repository owns Kora infrastructure and deployment configuration,
not application code or the Anchor program. Correctness beats speed. Devnet only
until explicitly instructed otherwise. Do not redesign cross-repo contracts.
PlotArmor program: `3h9CzV9MJDeD5yjhVhdE6cupuXVRnLW1Cu6P14EJBKv2`.

## Verification standard (hard rule, no exceptions)

No claim of correctness, security, or completeness in code, commit messages,
documentation, or reports may be made before 4 independent verification passes.
A pass is an actual test run, an actual live behavioral check against the deployed
target, or an independent re-audit by a different session/agent. One test-suite
run is one pass, not four. Source inspection alone is not a pass.

Committed configuration describes intent, not live state. Verify the deployed
image/version, effective policy, authentication, rate limits, health behavior,
metrics, and devnet behavior directly before claiming deployment verification.
Never access fee-payer key material to obtain evidence. If a required check would
cross the permanent canon, stop and ask for human-provided nonsecret evidence.

Always report the actual pass count, evidence, and remaining unverified items.
Use provisional language until pass 4. Distinguish upstream documentation and
source findings from locally tested and live-observed behavior. Research alone
does not establish runtime correctness or security.

## Commit and deployment discipline

- Never use `git add -A`, `git add .`, or wildcard staging. Stage only explicitly
  named files for the task. Inspect the staged file list and diff before commit.
- Preserve unrelated user changes. Never commit credentials or secret material.
- Run checks appropriate to the changed infrastructure: configuration parsing,
  pinned-version CLI validation, image build, and relevant behavioral checks.
  Report unavailable checks without implying they passed.
- Commit only when authorized. Treat pushes that trigger deployment as deployments.
- Pin upstream release and immutable source/image identity. Do not deploy `main`
  or `latest` by default. Record audit scope separately from release status.
- Do not silently relax program allowlists, fee-payer protection, authentication,
  spending limits, or rate limits to make a deployment work. Explain conflicts.
- Human-only operations include key generation and placing its secret in Render.
  Automation may reference a secret name or mount path, never its actual value.

## Style

- No em dashes in prose or comments.
- Do not use the forbidden word identified by the sibling repo protocols
  (ASCII character codes 110, 111, 105, 115, 101).
- Use plain, precise language. Explain outcomes, supporting evidence, limitations,
  and human versus automated responsibilities. Never overstate verification.

## Accepted deployment decisions (provisional, devnet only)

- Pin Kora v2.2.0-beta.8 by image digest. The human deliberately accepts the
  unaudited surface beyond commit 8c592591debd08424a65cc471ce0403578fd5d5d for
  devnet with no real funds and no live users. This is NOT permanent acceptance.
  Phase 7 of the roadmap must re-check the version pin, dependencies, audit scope,
  and outstanding findings before mainnet. Never carry this acceptance forward
  automatically. See README.md for the image identity and upstream sources.
- Allow exactly PlotArmor, System Program, and Lighthouse. Require a PlotArmor
  instruction as well; do not describe this as a single-program allowlist.
- Lighthouse is enabled and size overflow rejects the transaction. Enable only
  signTransaction among signing methods. The client signs the returned message
  before broadcasting. No sign-and-send or bundle methods.
- Rent is paid by the user's signer, claimant, anchorer, or admin account in the
  four investigated instructions. Kora pays network fees only. Keep
  fee_payer_policy.system.allow_create_account false. Do not substitute the Kora
  signer for the user's instruction identity or silently add rent sponsorship.
- Use signer_balance_lamports with signer_name and signer_pubkey labels in all
  monitoring. Do not introduce a metric alias or recording-rule workaround.

## Current authorization

Scaffolding and checks requiring no signer are authorized. The human performs
signer-backed startup and balance-metric checks privately and returns nonsecret
results. Agents must not create even a throwaway Kora fee-payer key. Never run an
agent test against an environment containing a fee-payer secret. Use an isolated,
explicitly constructed environment for checks without a signer.

No Render deployment in this pass. Commit only explicitly named files after the
required verification is satisfied; otherwise leave the work uncommitted and
report the actual pass count and outstanding human checks.
