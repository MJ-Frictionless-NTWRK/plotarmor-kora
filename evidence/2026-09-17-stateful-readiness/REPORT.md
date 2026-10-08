# Stateful signing coverage attempt, 2026-09-17

| Instruction | Status | Evidence |
| --- | --- | --- |
| add_version | BLOCKED | summary.json, blocked.txt |
| add_owner | BLOCKED | summary.json, blocked.txt |
| anchor_authorized_contract | BLOCKED | summary.json, blocked.txt |

No live request was sent. The readiness check stopped because KORA_API_KEY and
KORA_HMAC_SECRET were unavailable in the session. This is a local prerequisite
error, not a Kora rejection. The user was asked for the existing credential
location, without requesting secret values in chat. Funding is not a blocker.

Qualifying live verification passes: **0**. Setup broadcasts: **0**. No setup
signature exists. No Kora-signed transaction was broadcast. kora.toml was not
modified and no deployment was performed.

The first local harness invocation failed before creating its evidence directory;
its stderr is preserved in initial-startup.stderr.txt. Parent directory creation
was fixed, then the readiness invocation produced blocked.txt and summary.json.
Neither invocation reached a live probe. There were no failed live probes hidden
by retries.

The account structs confirm RegistryConfig is already first in all three shapes.
The M2 commit 7c267e9 changes sign_contract only among program instructions.
Rent payer is claimant for add_version and admin for add_owner and
anchor_authorized_contract. These probes do not depend on the M2 redeploy.

One combined offline test run passed across the existing three test files and
verify_stateful_signing.test.mjs. A subsequent focused stateful test run passed
after adding RPC method restrictions and failure status recording. These are
two offline runs, not live signing passes. The final parent-directory fix was
exercised by the readiness invocation.

## Prepared execution

The new harness uses only the existing ordinary probe-user wallet for user
signatures and setup. It never accesses kora-devnet.json. Export the existing
KORA_API_KEY and KORA_HMAC_SECRET through their approved credential source.
Do not put those values in artifacts or command arguments.

Run setup once using a fresh evidence directory:

```bash
NO_DNA=1 PROBE_OUTPUT=/home/sucka/plotarmor-kora/evidence/stateful-setup-001 \
  node scripts/verify_stateful_signing.mjs setup
```

Setup first attempts a fully verified Kora register_work_claim refresh without
broadcasting that transaction. It then constructs a separate ordinary-wallet-paid
registration, simulates it, broadcasts it once with maxRetries=0, records its
signature, waits for confirmation, and writes fixture.json. Only this ordinary
registration is broadcast. If send/confirmation is ambiguous, inspect the saved
signed request and signature status; do not rerun setup blindly.

After confirmed setup:

```bash
NO_DNA=1 PROBE_OUTPUT=/home/sucka/plotarmor-kora/evidence/stateful-probes-001 \
  PROBE_FIXTURE=/home/sucka/plotarmor-kora/evidence/stateful-setup-001/fixture.json \
  node scripts/verify_stateful_signing.mjs probe
```

The probe stage validates the on-chain WorkClaim and Ownership, then independently
attempts each of the three instructions once. It records each failure and proceeds
to the next instruction without retrying the failed one. The synthetic new-owner
address is a public Edwards basepoint; it never signs and no ownership change is
broadcast. All test content hashes and nonces are synthetic.

Artifacts preserve exact JSON RPC request bodies and response bodies, HTTP status,
transaction wire bytes, account addresses, argument values, and raw simulations.
Authentication headers are intentionally omitted to avoid persisting credentials.
The IDL snapshot and policy digest identify builder inputs. Each successful probe
verifies Kora's signature over the returned Lighthouse-bearing message, preserves
the original instruction's bytes and account privileges, and reconstructs the
allowed message change. It then signs with the ordinary wallet and simulates with
sigVerify=true, without blockhash replacement, recording exact pre/post balance
arrays and the authority delta. Missing balance arrays prevent a qualifying pass.

Full six-instruction coverage still needs these three live passes plus
sign_contract coverage, with its current five-account shape requiring M2
deployment alignment. Existing registration/evidence signing passes remain
historical; registration has not been refreshed by this blocked run.
