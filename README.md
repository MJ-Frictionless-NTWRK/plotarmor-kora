# PlotArmor Kora devnet infrastructure

This repository configures Kora to sponsor PlotArmor transaction network fees on
Solana devnet. Users still pay account rent. It contains deployment scaffolding;
it is not a claim that a Render service exists or that signing has been verified.

Read [CLAUDE.md](CLAUDE.md) first. Its fee-payer key canon is permanent. No agent
may generate, read, decode, or transmit a Kora fee-payer private key or seed phrase,
including a throwaway test signer. Human key operations happen privately, outside
agent terminals and agent-accessible workspaces. Only the public address and the
fact that the Render secret exists may be reported back.

## Version and audit decision

The human deliberately accepted **v2.2.0-beta.8** with Lighthouse for devnet only,
with no real funds and no live users. The unaudited surface beyond
`8c592591debd08424a65cc471ce0403578fd5d5d` is accepted provisionally for that scope.
This acceptance is not permanent. **Phase 7 of the roadmap must re-check the pin,
dependencies, audit status, outstanding findings, and deployment suitability
before mainnet. Never carry the devnet acceptance forward automatically.**

The Dockerfile uses the official GHCR image, with no Kora source build or patch:

| Identity | Value |
| --- | --- |
| Release | `v2.2.0-beta.8` |
| Source commit | `7aea236d9d24f579e21c578ccf69707246968b23` |
| OCI index digest, amd64 and arm64 | `sha256:1b929cd9b32e6a3dddb646669fbe0d30651e07377b2bface044cd84289df59bf` |
| Linux amd64 manifest | `sha256:060cd9226b466c32d020fd82f69c30d4cd37d3c8ad2ca7c644883bd9f7e98e4a` |
| Digest resolution date | 2026-09-10 |

The tag remains in `FROM` for readability; the digest selects the actual image.
Pin changes require review and renewed verification. Do not replace the digest
with `main`, `latest`, or `beta`.

Upstream references:

- [Release and official image](https://github.com/solana-foundation/kora/releases/tag/v2.2.0-beta.8)
- [Audit baseline and unaudited delta](https://github.com/solana-foundation/kora/blob/main/audits/AUDIT_STATUS.md)
- [Tagged configuration](https://github.com/solana-foundation/kora/blob/v2.2.0-beta.8/kora.toml)
- [Tagged usage-rule schema](https://github.com/solana-foundation/kora/blob/v2.2.0-beta.8/crates/lib/src/usage_limit/config.rs)
- [Tagged signer configuration](https://github.com/solana-foundation/kora/blob/v2.2.0-beta.8/crates/lib/src/signer/config.rs)

## Policy and rent payers

The allowlist contains exactly these three programs, including simulated CPIs:

| Program | Address |
| --- | --- |
| PlotArmor | `3h9CzV9MJDeD5yjhVhdE6cupuXVRnLW1Cu6P14EJBKv2` |
| System Program | `11111111111111111111111111111111` |
| Lighthouse | `L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95` |

`require_one_of_programs` additionally requires PlotArmor. A transaction containing
only infrastructure instructions must not qualify for sponsorship. Token,
Compute Budget, and Address Lookup Table instructions are not allowlisted. Clients
must not append them silently. An integration that needs another program requires
a new policy decision.

The four instruction account structs in `../plotarmor-program` were inspected
before writing `fee_payer_policy.system.allow_create_account`. The program checkout
reports commit `7c267e9689c0d335194f0f73fe4388c670b8509a`; the evidence here is the
working-tree source inspected, not a claim about deployed bytecode:

| Source file | Created accounts | Explicit rent payer |
| --- | --- | --- |
| `register_work_claim.rs` | ContentArtifact, WorkClaim, Ownership, OwnerRecord, ClaimArtifactLink, AnchorRecord | `signer` |
| `add_version.rs` | ContentArtifact, ClaimArtifactLink, AnchorRecord | `claimant` |
| `anchor_evidence_contract.rs` | ContractArtifact, EvidenceAnchor, AnchorRecord | `anchorer` |
| `anchor_authorized_contract.rs` | ContractArtifact, AuthorizedContractAnchor, AnchorRecord | `admin` |

Artifact accounts use `init_if_needed`; other listed accounts use `init`. All
creation paths use the user's instruction identity to fund rent. None implicitly
uses the transaction's fee payer. The structs do not themselves require those
identities to differ, so the client/backend must retain the user in these account
roles and use Kora solely as the transaction fee payer. Substituting Kora would
also change attribution and, for existing records, authorization.

Consequently `allow_create_account = false` for the Kora fee payer. System Program
is still allowlisted so user-funded rent CPIs can run. All other fee-payer
permissions are explicitly false, including minting, authority changes, transfers,
and account closure in both token policy sections. No extra CPI program was found
in these four source files. This is source evidence, not a deployed-program test.

Current operating settings:

- Free pricing: no payment token required. Kora spends SOL on network fees.
- At most 2 transaction signatures and 1,000,000 lamports of allowed exposure per
  transaction. These are initial devnet limits, not measured capacity guarantees.
- Kora's request limit is 20 requests/second; wallet usage is a separate rule of
  10 transactions per 3,600-second window.
- Redis stores quota state. Missing Redis configuration and unavailable Redis
  fail closed. The local port-1 fallback is intentionally unusable; Render must
  supply `KORA_REDIS_URL`. RPC response caching is disabled.
- Only `signTransaction` is enabled among signing methods. All bundle,
  sign-and-send, and transfer methods are disabled.
- Lighthouse assertions are enabled; size overflow rejects the transaction.
- `price_source = "Mock"` avoids a token oracle for the devnet Free policy. Do not
  carry this choice into paid pricing or mainnet without review.

## Backend and client contract

The trusted backend authenticates the user and supplies the canonical wallet
address as `user_id`. Free-mode quota tracking requires this identifier. Kora does
not turn an arbitrary caller-provided identifier into proof of wallet ownership.
The backend must bind it to the authenticated wallet and the intended transaction.

Keep API and HMAC secrets on that backend, never in the browser. Every non-liveness
RPC request requires both `x-api-key` and a valid HMAC. `x-timestamp` is Unix seconds;
`x-hmac-signature` is hex HMAC-SHA256 over the timestamp string followed immediately
by the exact request body. The timestamp window is 300 seconds. This is not a
general replay-prevention or per-person identity system.

The client submits the transaction through the backend to `signTransaction`,
receives Kora's modified transaction with the Lighthouse assertion, signs that
returned message with the user wallet, and broadcasts it. Do not reuse signatures
over the pre-Lighthouse message. No browser wiring is implemented in this repo.

## Human setup, private terminal only

Do not run the commands in this section through an agent. Use a private machine
or terminal outside the agent's environment. Replace `/HUMAN_ONLY_DIRECTORY` with
an existing private directory; do not use this repository or an agent scratch
directory. Never send the generated file or recovery phrase to an agent.

```sh
umask 077
solana-keygen new --outfile /HUMAN_ONLY_DIRECTORY/kora-devnet.json
solana-keygen pubkey /HUMAN_ONLY_DIRECTORY/kora-devnet.json
```

Save any recovery phrase privately. Keep only the public address for the following
commands. These do not require the fee-payer file:

```sh
solana airdrop 1 PUBLIC_FEE_PAYER_ADDRESS --url devnet
solana balance PUBLIC_FEE_PAYER_ADDRESS --url devnet
```

If the devnet faucet is rate-limited, retry later or fund that public address from
a human-controlled devnet wallet. Never substitute a mainnet endpoint. Separately
fund the user wallet for account rent.

In Render's Environment panel, privately populate `KORA_FEE_PAYER_SECRET` with the
JSON array produced by Solana CLI. Do not add surrounding quotes, a variable
assignment, a seed phrase, or a file path. The memory signer in this pinned release
accepts the 64-byte JSON array or Base58 keypair material through an environment
variable; it does not accept a path through that variable. No conversion is needed.
The signer configuration stores only the variable's name.

Privately create separate strong API and HMAC secrets (HMAC at least 32 characters)
and populate `KORA_API_KEY` and `KORA_HMAC_SECRET` in Render and the trusted backend.
These are separate credentials from the fee-payer secret. Do not place any secret
in Git, a Docker build argument, a build layer, an agent terminal, or pasted logs.
The Dockerfile never declares secret `ARG` values or mounts secret files.

Report only the public fee-payer address and that the Render secret now exists.
No agent should query secret values or inspect a signer-backed process environment.

## Render service definition

The human connects this repository and applies `render.yaml` after review. This
creates a Docker web service and a private Redis-compatible Key Value service in
Frankfurt. The listed `0.5c-512mb` web and `256mb` Key Value plans are paid hosting
resources, independent of Free transaction pricing. No service has been created
by this scaffolding pass; review plans in Render before applying the Blueprint.

`sync: false` prompts the human for secrets during Blueprint creation. Never use a
generated-value directive for the fee-payer secret. Creation can trigger the first
deployment; `autoDeployTrigger: "off"` disables subsequent automatic Git deploys,
not that initial creation. All Render deployment actions are human-owned in this
pass. The Key Value service uses `noeviction` and blocks external connections;
clearing its data resets quotas, so do not treat it as disposable application cache.

The public listener and metrics port are both 10000. The entrypoint rejects a
different `PORT` and requires authentication and Redis settings. Kora itself loads
the signer and validates its configuration at startup. It runs as UID 10001,
GID 1000. The image contains only the upstream runtime and named public files.

`RPC_URL` defaults to `https://api.devnet.solana.com`. A private provider URL, if
needed, must also point to devnet and should be set privately in Render. Verify the
cluster before deploying. The URL is operator-controlled; this scaffolding does
not enforce a genesis-hash check at runtime.

Useful references: [Blueprint schema](https://render.com/schema/render.yaml.json),
[Blueprint fields](https://render.com/docs/blueprint-spec),
[secret settings](https://render.com/docs/configure-environment-variables).

## Health and monitoring

`GET /liveness` responds without authentication and performs no signing. It is a
process liveness check, not a balance, Redis, or Solana RPC readiness guarantee.
Render uses it for `healthCheckPath`; later warmup pings may use the same path.

`GET /metrics` is also unauthenticated in this upstream version. On the shared
public listener, telemetry and signer public addresses are publicly visible.
Do not assume the API/HMAC middleware protects this endpoint. Changing exposure
requires a proxy or separate private monitoring listener and a reviewed design.

The actual balance gauge is `signer_balance_lamports`, labelled by `signer_name`
and `signer_pubkey`. The earlier `fee_payer_balance_lamports` name was a
documentation mismatch; the decision is to use the real gauge without an alias.
With this signer config, `signer_name` is `plotarmor-devnet` and `signer_pubkey`
must match the human-provided public address. Tracking runs every 30 seconds.
Upstream can report zero on an account-read error, so investigate RPC failures
alongside low-balance alerts. A no-signer process cannot supply balance samples.

`monitoring/prometheus.yml` is for Prometheus on the same host as a local Kora
process. For Render, change the target to the assigned service hostname without
`https://` or a port, and change `scheme` to `https`. Prometheus performs the scrape;
Kora's `scrape_interval` setting does not provision a monitoring service.

`monitoring/alerts.yml` checks scrape failure, missing signer balance, and balance
below 0.1 devnet SOL. It defines alert rules only, not recording rules. Alert routing
and an Alertmanager destination are not provisioned. To validate and run locally:

```sh
promtool check config monitoring/prometheus.yml
prometheus --config.file=monitoring/prometheus.yml
```

## Verification without a signer

Run only in an environment without fee-payer secrets. Do not run upstream test
suites that generate signing keys. The local smoke script constructs a fresh
environment and an empty scratch `.env`, preventing Kora's dotenv lookup from
loading a parent-directory file. It never reads or copies the inherited environment.

With Docker available, build the actual image:

```sh
docker build --pull -t plotarmor-kora:devnet .
```

For an agent-safe executable check, supply the executable extracted from that
image or from its digest-verified upstream binary layer, and a Redis executable:

```sh
python3 scripts/smoke_no_signer.py \
  --kora /ABSOLUTE_PATH_TO_PINNED_KORA \
  --redis-server /ABSOLUTE_PATH_TO_REDIS_SERVER
```

The optional `--redis-library-path` accepts a nonsecret shared-library directory
when running an unpacked Redis package. The script starts temporary Redis and Kora
processes, runs Kora's validator on the exact policy, tests negative configuration
cases, starts with `--no-load-signer`, checks health, HMAC, disabled sign-and-send,
and HTTP metrics, then stops both processes. It reports balance samples as
unverified. It does not load or validate `signers.toml` against a secret.

## Human signer-backed verification

Run these checks privately, with a human-created test signer if desired. Never
ask an agent to prepare or read even a disposable fee-payer key. On a private
machine, build the image above and prepare a private environment file containing
the JSON-array signer value, API and HMAC secrets, and a reachable Redis URL. The
file must live outside any agent workspace. Keep its contents and logs private.

On Linux, with Redis reachable on the host, a local test may use:

```sh
docker run --rm --network host \
  --env-file /HUMAN_ONLY_DIRECTORY/kora-smoke.env \
  plotarmor-kora:devnet
```

The normal entrypoint must start successfully; do not override it or pass
`--no-load-signer` for this check. In a second private terminal:

```sh
curl --fail http://127.0.0.1:10000/liveness
curl --fail http://127.0.0.1:10000/metrics
```

Wait at least 30 seconds if necessary. Confirm the balance series has
`signer_name="plotarmor-devnet"`, the expected `signer_pubkey`, and a value consistent
with a fresh devnet balance query. Also privately run:

```sh
docker run --rm --network host \
  --env-file /HUMAN_ONLY_DIRECTORY/kora-smoke.env \
  --entrypoint /usr/local/bin/kora \
  plotarmor-kora:devnet --config /app/kora.toml \
  config validate-with-rpc --signers-config /app/signers.toml
```

This checks the configured programs against the actual RPC as well as signer setup.

Human integration evidence must additionally cover a user-funded PlotArmor rent
CPI, Lighthouse presence in the returned transaction, wallet quota rejection,
rejection of infrastructure-only transactions and disallowed programs, and failure
when Redis is unavailable. This scaffolding alone is not proof of those behaviors.

Return only pass/fail results, the public address, image identity, nonsecret metric
labels/value, and any sanitized error category. Never paste the environment file,
key bytes, seed phrase, container environment, or unscreened logs. Deployment to
Render remains a separate human action after review and secret setup.

## Verification record

Current evidence is provisional. Source inspection and digest resolution are not
independent runtime passes. Multiple assertions within one suite remain one pass.

| Check | Status |
| --- | --- |
| Official OCI index, amd64 manifest, and executable-layer digests | Resolved and checked against downloaded bytes |
| Native executable version | `kora-cli 2.2.0-beta.8` |
| Render Blueprint schema, TOML structure, entrypoint failure checks, file style | Passed local checks |
| Prometheus scrape configuration and 3 alert rules | Passed `promtool check config` |
| Exact policy parsed and accepted by Kora validator, signer omitted | Passed |
| Missing Lighthouse allowlist entry, unknown config field, missing Redis URL | Rejected in negative checks |
| Native Kora startup without signer and with Redis | Passed |
| `/liveness`, API-key/HMAC checks, disabled sign-and-send, HTTP `/metrics` | Passed |
| Docker image build and container startup | Not run: Docker unavailable; installation requires interactive sudo |
| Signer-backed startup and balance gauge labels/value | Pending private human check |
| Live RPC validation and PlotArmor transaction policy behavior | Pending |
| Render deployment | Not performed |

**Automated no-signer verification: 1 of 4 required passes.** No claim of complete
verification or security is made. No commit is authorized until the required
verification is satisfied; the current scaffolding remains uncommitted.
