# Devnet rent sponsorship spike, 2026-09-30

Recommendation: **Design B**, with `max_signatures` raised from 2 to 3, retaining `signTransaction` and Lighthouse. The rent wallet transfers **7,147,560 lamports (0.00714756 SOL)** to the zero-SOL user inside the registration transaction. The gateway and user sign Kora's returned message, then the gateway broadcasts it through ordinary devnet RPC. This is a source-supported proposal, not a live-tested three-signer flow.

All work was performed in one session. Raw collection occurred around **2026-09-29 22:05–22:06 UTC**, which is **September 30 00:05–00:06 Europe/Paris**. Only this evidence directory was written. No private key was read, copied or printed; no signing, broadcast, airdrop, application/configuration edit or deployment was performed. The sibling program evidence file was read only.

Evidence links below are relative to this directory. `source-*` files are unmodified upstream source snapshots from **v2.2.0-beta.8**, not implementation changes. [Fetch metadata](fetch-results.json) records URLs, response status and timestamps; [source tree](kora-tree.json) records the Git tree SHA and blob identities. [Supplemental provenance](supplemental-source-provenance.txt) covers the two later source downloads.

1. **Version, signing and broadcast methods**

`/home/sucka/plotarmor-kora/Dockerfile:3` pins `ghcr.io/solana-foundation/kora:v2.2.0-beta.8@sha256:1b929cd9b32e6a3dddb646669fbe0d30651e07377b2bface044cd84289df59bf`. See [Dockerfile snapshot](local-Dockerfile.txt). This establishes intended image identity, **not today's running Render version**. The live [`getVersion` request](kora-version.request.json) received [HTTP 401](kora-version.response.txt.headers.txt) with an empty body. Kora API/HMAC and Render API credentials were absent from this session; secret stores were not opened. Running version, deployed digest and effective configuration remain unknown.

Pinned upstream [`crates/lib/src/rpc_server/server.rs:231–312`](source-rpc_server__server.rs) registers `liveness`, `estimateTransactionFee`, `getSupportedTokens`, `getPayerSigner`, `getBlockhash`, `getConfig`, `getVersion`, `transferTransaction`, `signTransaction`, `signAndSendTransaction`, `estimateBundleFee`, `signBundle`, and `signAndSendBundle`, conditionally on configuration. There is no standalone Kora `sendTransaction` method in that registration list. Ordinary Solana RPC exposes `sendTransaction` independently of Kora.

[`rpc_server/method/sign_transaction.rs:23–27`](source-rpc_server__method__sign_transaction.rs) describes validation/signing, “but not broadcasted to the network.” It returns a base64 signed transaction and signer public key. `signBundle` is its bundle counterpart; bundles are disabled here. `transferTransaction` is a transfer-construction API, also disabled. The server's method-registration quote is `register_method_if_enabled!`.

[`rpc_server/method/sign_and_send_transaction.rs:35–39`](source-rpc_server__method__sign_and_send_transaction.rs) offers `respond_after`: `confirmed` waits for confirmation, `sent` for RPC acceptance, and `signed` broadcasts in the background. The last is **not sign-only**. [`transaction/versioned_transaction.rs:553–644`](source-transaction__versioned_transaction.rs) rejects empty required signature slots, then sends the transaction; background delivery may fail after the response. Quote: “Transaction is missing required signatures”. Nonempty slots alone do not prove valid co-signatures; verify the final message locally and simulate with signature verification.

The exact optional broadcast-enablement diff, **not recommended/applied for this flow**, is:

```diff
--- a/kora.toml
+++ b/kora.toml
@@
-sign_and_send_transaction = false
+sign_and_send_transaction = true
```

A deployment/restart loading that change would be required. It lets authenticated callers ask Kora to submit and optionally await transactions, rather than submitting the fully signed bytes themselves. It does not add authority signatures, waive policy or make account rent Kora's responsibility. Disabling it does **not** prevent a recipient of a Kora signature from completing and broadcasting that transaction externally.

Important difference: [`lighthouse/assertion.rs:31–46`](source-lighthouse__assertion.rs) says “When `will_send` is true, the assertion is skipped”. Thus enabling sign-and-send does not preserve automatic Lighthouse insertion even with `lighthouse.enabled = true`; it preserves existing client signatures by avoiding that message change. Keep the sign-only workflow for the proposed demo.

2. **Design A: prior funding transaction**

A separate System transfer from the rent wallet credits the fresh user with 7,147,560 lamports, then the user registers through Kora. The rent wallet must pay the separate funding transaction's fee (query `getFeeForMessage` for its exact message; ordinarily one signature). A System-only funding transaction cannot qualify for this Kora policy: `kora.toml:64` requires PlotArmor. Do not add a dummy PlotArmor call to bypass that restriction.

The two transactions are not atomic. Funding can land while registration fails because of Kora downtime, Redis failure, quota, user refusal, expired blockhash, program rejection or account races. The recipient controls the credited SOL and can transfer it away. A funding timeout is ambiguous: inspect its signature/status before retrying; never issue a second transfer merely because an HTTP request timed out.

With exact funding and six absent targets, successful registration consumes the entire credit. If ContentArtifact already exists, rent falls by 904,240 lamports at this reading. A stale quote or duplicate transfer leaves liquid surplus. It cannot be forcibly reclaimed by the sponsor; recovering it needs the user's signature and a fee-paying transaction. Program-owned PDA rent is not liquid user surplus and must not be assumed reclaimable without a supported close path.

An unauthenticated/repeatable funding endpoint is a faucet attackers can drain without registering. Per-wallet limits alone are bypassable with fresh wallets. Use authenticated server-derived identity, wallet ownership proof, durable idempotency keyed to user/work/operation, serialized requests, a small demo allowlist, per-user and global lamport budgets, and reconciliation before retries. Current Kora `max = 10`, `window_seconds = 3600` limits signing counts, not external rent transfers. [`usage_limit/rules/transaction.rs:20–30`](source-usage_limit__rules__transaction.rs) keys by `user_id` and counts one unit per transaction; the gateway must not accept arbitrary client-provided quota identities.

3. **Design B: atomic funding plus registration**

Required instruction order: System transfer **rent wallet → user**, then PlotArmor `register_work_claim`, then Kora's appended Lighthouse assertion. The user remains the instruction's `signer`, claimant and initial owner; the rent wallet is only a transfer-source co-signer. Kora remains transaction fee payer.

The transfer-source restriction permits this: [`validator/transaction_validator.rs:304–306`](source-validator__transaction_validator.rs) selects `SystemTransfer { sender, .. } => sender`; [`validator/macros.rs:22–24`](source-validator__macros.rs) rejects only when `*$account == $self.fee_payer_pubkey && !$policy`. Therefore `fee_payer_policy.system.allow_transfer = false` can and should remain false. `allow_create_account = false` also remains: program initialization uses the user as payer. The required System Program is already allowlisted.

However, the **current complete policy rejects B** because there are three required signature slots and `max_signatures = 2`. [`validator/transaction_validator.rs:214–219`](source-validator__transaction_validator.rs) checks `transaction.signatures.len() > self.max_signatures as usize`. Raising it to 3 is necessary. No generic `allow_sol_transfers` flag is needed in this pinned policy.

The transfer amount exceeds `max_allowed_lamports = 1000000`, but that cap is not a global cap on every sender's transfers. [`validator/transaction_validator.rs:932–945`](source-validator__transaction_validator.rs) delegates to fee-payer outflow; [`fee/fee.rs:509–552`](source-fee__fee.rs) counts transfers/account creation from the selected fee payer. Quote: `if *sender == *fee_payer_pubkey`. The cap separately limits transaction fees. Do not raise it merely to fund this rent transfer; impose a separate gateway cap on rent-wallet spending.

If registration or Lighthouse fails during execution, the funding transfer and account creations roll back together. An executed failed transaction can still charge Kora's network fee. [Solana transaction documentation](https://solana.com/docs/core/transactions) states: “Fees are still charged on failure.” This removes A's stranded-funding risk, but valid registrations can still exhaust a sponsor budget, so the same identity, idempotency and global limits remain necessary.

Signing complexity: construct all three signer slots and a fresh blockhash; request Kora signing with ordinary signatures absent and signature verification disabled for that initial simulation. Kora validates/simulates and appends Lighthouse. Validate its response, then have the user and rent wallet sign **that returned message**, preserving Kora's signature. Do not insert instructions, change the blockhash or recompile account order afterward. The gateway should verify all signatures and simulate the exact fully signed bytes with `sigVerify=true`, then use devnet `sendTransaction` and track confirmation. Serialize this demo flow: Lighthouse's minimum is based on fee-payer balance at signing, so another transaction spending that payer before execution can invalidate the assertion. Rebuild and re-sign expired transactions only after reconciling the previous attempt. This flow has not been executed in this report.

4. **Rent-wallet key location and future Edge signing**

Historical [`scripts/verify_stateful_signing.mjs:152–154`](historical-local-excerpts.txt) loads `/home/sucka/secrets/probe-user.json` and asserts public address `HZJTTwQMa6uyfA9AMXMmJKb9UrzxzGTKPAXQ2LKxgFLn`. [Metadata-only observation](local-observations.txt) confirms that file exists, owned by `sucka`, mode `600`, size 231 bytes. Its current contents/address were **not revalidated**. This is the documented local location; other copies and any existing Supabase secret are unknown. Do not confuse it with Kora's separate fee-payer key.

Safest architectural option: a policy-enforcing external Ed25519 signing service that holds the rent key, authenticates the Edge Function, and signs only approved transaction messages. Key import/support and provider selection are unverified, so this is an architectural recommendation, not an already available integration.

For a narrowly funded devnet demo, a simpler option is a **human-installed Supabase Edge Function secret**, for example `RENT_WALLET_SECRET`, accessed only server-side in memory. [Supabase's secrets documentation](https://supabase.com/docs/guides/functions/secrets) supports dashboard installation and `Deno.env.get`; [raw documentation](supabase-secrets.html) is preserved. This leaves the key accessible to function code and privileged project operators, unlike external custody. A human must provision it privately; no agent copy/upload or secret-bearing command is supplied here. Restrict project access and never expose it through Vite/browser variables, repository files, database responses or logs.

The signer must validate exact program IDs, registration discriminator/arguments, expected PDAs, authenticated user authority, rent recipient/amount, fee payer, blockhash, signer set and instruction order, allowing only the expected Lighthouse append. Prefer server-built transactions. Kora's policy protects **Kora's** key, not the rent wallet from arbitrary gateway signing. Verify the loaded public key equals the expected rent address and separate rent-wallet, Kora-auth and database-service credentials.

5. **Recommended diff and lamport calculation**

Exact recommended `kora.toml` diff, **not applied**:

```diff
--- a/kora.toml
+++ b/kora.toml
@@
-max_signatures = 2
+max_signatures = 3
```

Retain sign-and-send disabled, Lighthouse enabled with overflow rejection, all allowlists, free pricing, authentication, Redis enforcement and fee-payer restrictions. A reviewed deployment applying the one-line change is still needed before B can pass current Kora policy. If no deployment is possible this week, A is the fallback with its funding-loss tradeoff.

`/home/sucka/plotarmor-program/programs/plotarmor/src/instructions/register_work_claim.rs:29–80` repeatedly specifies `payer = signer` and `space = ...::LEN`; [snapshot](program-register_work_claim.rs.txt). `state.rs` includes the eight-byte discriminator in every `LEN`; [snapshot](program-state.rs.txt). All six target accounts are assumed absent, as requested; no actual fresh user's addresses were provided or queried. RegistryConfig is an existing prerequisite, not a seventh account to create. Local source revision is recorded in [program-revision.txt](program-revision.txt); this report does not establish deployed bytecode equivalence.

| Account creation inside register_work_claim | Data bytes including discriminator | Live RPC minimum lamports |
| --- | ---: | ---: |
| ContentArtifact | 50 | 904,240 |
| WorkClaim | 210 | 1,717,040 |
| Ownership | 110 | 1,209,040 |
| OwnerRecord | 75 | 1,031,240 |
| ClaimArtifactLink | 112 | 1,219,200 |
| AnchorRecord | 82 | 1,066,800 |
| **Total** | | **7,147,560** |

Each row comes directly from `rent-SIZE.request.json` and `rent-SIZE.response.json`, using `getMinimumBalanceForRentExemption(SIZE, {commitment:"confirmed"})`. [Machine-readable sum](rent-calculation.json). No per-byte formula was used. [RPC documentation](https://solana.com/docs/rpc/http/getminimumbalanceforrentexemption) takes account data length; do not add the discriminator twice or add storage overhead manually.

Per-instruction accounting for B:

- Instruction 0, System transfer: rent wallet **−7,147,560**, user **+7,147,560** lamports.
- Instruction 1, registration: user **−7,147,560**, six PDAs receive the table amounts through creation CPIs.
- Appended Lighthouse assertion: no rent funding; checks Kora's remaining lamports.
- Transaction fee: separately debit Kora using `getFeeForMessage` on the final message. Three signatures ordinarily imply **15,000 lamports** without priority fees, but this is an estimate, not a fee RPC observation in this session. The user needs no fee SOL and ends at zero in the stated case. Do not add a wallet rent reserve to the amount solely because the wallet is transiently funded.

Gateway quote logic must derive and read every target PDA, validate existing owners/data and RegistryConfig, then query live rent for each creation size and sum with integer arithmetic. `init` accounts already present mean reject/reconcile, not silently reduce funding. ContentArtifact alone is `init_if_needed`; when valid and already present, omit its rent, giving **6,243,320** at this reading. Requote on state changes; an existence race can leave surplus even in B. For the demo reject unexpected state and rebuild instead of delivering overfunded messages. If supporting surplus refunds later, an explicitly signed return transfer must be in the original approved message before Kora signs. No such instruction is proposed for the all-absent case.

Use zero initial user balance as an enforced demo precondition. Other balances require a separately specified top-up policy; this report does not authorize sweeping pre-existing user funds. Size-check the final Lighthouse-bearing transaction and simulate it; three-signer acceptance, wallet preservation of partial signatures and final transaction size remain untested.

6. **Current devnet balances**

The RPC [genesis hash](genesis.response.json) is `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`, confirming devnet.

| Wallet | Lamports | SOL | Confirmed slot |
| --- | ---: | ---: | ---: |
| Kora `HWfGUebvq9ez4EWZKXoDBiNfH8uQ2q3mpMqpVCHfMdSW` | 5,000,000,000 | 5 | 505680005 |
| Rent `HZJTTwQMa6uyfA9AMXMmJKb9UrzxzGTKPAXQ2LKxgFLn` | 9,992,847,440 | 9.99284744 | 505680007 |

Raw [fee-payer balance](fee-payer-balance.response.json), [rent-wallet balance](rent-wallet-balance.response.json). These are separate confirmed reads, not a same-slot atomic snapshot. `/metrics` independently showed Kora's balance as 5,000,000,000.

7. **Render plan, upgrade and signing health**

`/home/sucka/plotarmor-kora/render.yaml:9,38` sets both web and Key Value services to `plan: free`; [snapshot](local-render.yaml.txt). Actual billed/runtime plans are **unknown** without control-plane evidence. The live HTTP responses cannot prove them.

Render says Free web services sleep after 15 minutes without inbound traffic and restart on a request, usually in about one minute. Free Key Value has no disk persistence; its data can disappear on restart, so it is not the authoritative sponsor-budget ledger. [Free-service documentation](https://render.com/docs/free), preserved in [raw HTML](render-free.html).

Current names/prices: web **`0.5c-512mb` (legacy Starter), $7/month**; Key Value **`256mb` (legacy Starter), $10/month**, approximately **$17/month combined compute**, excluding other usage, taxes and separate services. [Render pricing](https://render.com/pricing), [saved pricing text](render-pricing.extracted.txt), [plan IDs](https://render.com/docs/compute-plans). Upgrading only the web service removes Free idle sleep for $7/month; the repo's intended real-signing rollout calls for both paid services.

Future human upgrade: select each service's Compute plan in Render and save; synchronize `render.yaml` afterward, and restore `maxShutdownDelaySeconds: 60` as its comment requires. Dashboard plan changes trigger deployment; Key Value changes can cause brief downtime. No upgrade or deployment was attempted. [Compute-plan documentation](https://render.com/docs/compute-plans).

Live health observations: [`/liveness`](kora-liveness.txt) HTTP 200 with `null`; [`/metrics`](kora-metrics.txt) HTTP 200 with `signer_balance_lamports{signer_name="plotarmor-devnet",signer_pubkey="HWfGUebvq9ez4EWZKXoDBiNfH8uQ2q3mpMqpVCHfMdSW"} 5000000000`. [`rpc_server/rpc.rs:58–62`](source-rpc_server__rpc.rs) liveness simply returns `Ok(())`. Metrics adds balance/telemetry visibility, not a fresh cryptographic signing proof. `getPayerSigner` selects a signer and returns public addresses; its [handler](source-rpc_server__method__get_payer_signer.rs) does not sign. `getBlockhash` would test RPC access, not signing or Redis quota success.

No dedicated endpoint in the inspected pinned server proves end-to-end signing readiness. A fresh authenticated `signTransaction` success, independent verification of Kora's signature, then fully signed simulation would provide stronger evidence without broadcasting; it was **not performed** under this report-only scope. September 17's four historical signing passes are documented in [historical excerpts](historical-local-excerpts.txt), not new passes for B. Current three-signer signing/broadcast verification count: **0**. Public health checks and rent/balance reads are observations, not four independent end-to-end verification passes. No claim of deployment correctness or completed demo readiness is made.
