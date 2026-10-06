# Spec: walletless draft registration through Kora (Supabase Edge Function)

Status: DRAFT SPEC. Spec only. No app code, no Edge Function, no deployment, no secrets set.
Date: 2026-10-06. Network: devnet only. Lane 1 repo (plotarmor-kora) writes the spec; the
implementation belongs in `~/plotarmor-demo` (see section 14, the Codex prompt).

Decisions recorded 2026-10-06 (Milan): writer key generated in the browser and stored vault-encrypted
in Supabase like the existing ECDH key (devnet only, legal review before mainnet); one writer key per
user; limits 5 per hour and 20 per day per user, 200 per day global, 1 SOL reserve; `add_version`
is included with the same pattern, `add_owner` is deferred; recommended defaults for everything else.
Section 13 shows each answer. The build brief with tested reference code is
`docs/BRIEF_demo_walletless.md`; it supersedes section 14.

Wording rules for this document: "read" means confirmed by reading a file with the cited path
and line. "ran" means a command was run in this session. "inferred" means not confirmed by
either. Nothing here is a claim of correctness or security.

## 0. Verification status (hard rule from CLAUDE.md)

Passes completed for this design: **0 of 4**. Reading source is not a pass.

What exists as evidence for the underlying mechanism (not for this design):

- One live devnet registration with three signers, sent from the command-line script:
  `59ntRv2vP4a5guNf9z1hGZZXkFmGk1YGRufFZjNxAGBdhfioMryeCzVoJAfgTTeJsyeyQFn11cW9YZBqn98C5LPk`
  (`evidence/2026-10-05-sponsored-send-001/summary.json`, readback in
  `evidence/2026-10-05_sponsored_register_devnet.md`). One live pass of the script path.
- One later dry run, `evidence/2026-10-06-sponsored-dryrun-002/`, with a Kora cold start in it.
- One live devnet registration with the app's arguments (`content_kind 1`, `claim_kind 1`, shares 100/100,
  `anchor_mode_arg 1`, zero external ref hash), three signers, finalized:
  `3PnhZSwa1SX4ecbhDNXEK3wSSG7NNQ1oTkctM4AWmzRhmLz4ikMBqjUaQqj9sZYjLeEc7iQbVmb1WVKJB4pDVMgW`.
  Evidence: `evidence/2026-10-06-sponsored-send-002-app-params/` (the script's own ledger readback),
  `evidence/2026-10-06-sponsored-dryrun-003-app-params/` (the dry run before it) and
  `evidence/2026-10-06_sponsored_register_app_params_devnet.md` (a separate finalized readout). Two readouts
  made with the same tooling; not an independent audit.

What has NOT been exercised and is therefore unverified:

- A non-zero external ref hash (the app sends the sha256 digest of the CIDv0; the landed run above used
  32 zero bytes) and `add_version` through Kora with the sponsored transfer. The app's `claim_kind`, shares
  and `content_kind` are no longer in this list; they landed in the run above.
- A Supabase user id as Kora `user_id` (the script sends the writer address).
- Anything running inside a Supabase Edge Function (Deno), including HMAC via Web Crypto.
- The browser signing and sending half of the flow.

Ran in this session: `git log`, `git status`, `grep` over the three repos, a node decode of the
public unsigned and signed transactions in `evidence/2026-10-05-sponsored-send-001/` (confirmed
the registration instruction data is 143 bytes: 8 discriminator plus 135 argument bytes, and the
signed transaction has three instructions). Nothing else was executed. No private key, `.env`
file or keypair file was opened or printed.

Section 12 lists the four passes needed before any "verified" wording is allowed.

## 1. Findings (read-only investigation)

### 1.1 The working script, `plotarmor-kora/scripts/sponsored_register_demo.mjs`

Transaction construction (`buildSponsoredTransaction`, lines 46 to 60):

1. Legacy `Transaction`, `feePayer` = Kora fee payer, `recentBlockhash` from Kora `getBlockhash`
   (line 157).
2. Instruction 0: `SystemProgram.transfer` from the rent wallet to the fresh writer, exact
   `lamports` (line 56).
3. Instruction 1: `register_work_claim` (line 57, built by `buildRegistrationProbe` in
   `scripts/verify_register_work_claim.mjs:21-64`).
4. Kora then appends instruction 2, a Lighthouse assertion (verified at lines 71-78).

Distinct accounts: Kora fee payer, rent wallet `HZJTTwQMa6uyfA9AMXMmJKb9UrzxzGTKPAXQ2LKxgFLn`,
writer. The three must differ (line 48).

`register_work_claim` account list, in order (`verify_register_work_claim.mjs:41-47`; flags are
[writable, signer]):

| # | Name | Seeds (program `3h9CzV9M...EJBKv2`) | Flags |
|---|------|--------------------------------------|-------|
| 0 | registry_config | `"config"` | ro |
| 1 | content_artifact | `"content", raw_hash` | w |
| 2 | work_claim | `"claim", content_artifact, writer` | w |
| 3 | ownership | `"ownership", work_claim` | w |
| 4 | owner_record | `"owner", ownership, writer` | w |
| 5 | claim_artifact_link | `"claim_artifact", work_claim, link_nonce` | w |
| 6 | anchor_record | `"anchor", work_claim, anchor_nonce` | w |
| 7 | signer (writer) | none | w, signer |
| 8 | system_program | none | ro |

Instruction data, 143 bytes (ran: decoded from the evidence file): discriminator
`80e030f0a60e774c` (IDL bytes 128,224,48,240,166,14,119,76), then `raw_hash[32]`,
`content_kind u8`, `claim_kind u8`, `total_shares u16 LE`, `threshold_shares u16 LE`,
`link_nonce[32]`, `anchor_nonce[32]`, `anchor_mode_arg u8`, `external_ref_hash[32]`
(order read from the IDL, `plotarmor-program/target/idl/plotarmor.json`).

Rent calculation (lines 29-44 and 152-156): six live `getMinimumBalanceForRentExemption` calls
with the account sizes `content_artifact 50, work_claim 210, ownership 110, owner_record 75,
claim_artifact_link 112, anchor_record 82` (line 29; they match the `LEN` constants in
`plotarmor-program/programs/plotarmor/src/state.rs`). The sum is the transfer amount, capped at
`MAX_RENT_LAMPORTS = 8_000_000` (line 31). Observed on devnet: 7,147,560 lamports total (per
record 904,240 / 1,031,240 / 1,066,800 / 1,717,040 / 1,209,040 / 1,219,200; ran: summed from
the evidence readback).

Signing order (lines 175-190), and the reason it matters: Kora appends an instruction, so the
message changes. Order is: (a) build and unsigned-simulate; (b) Kora `signTransaction` with
`sig_verify: false`; (c) verify the returned transaction; (d) only now `partialSign(writer,
rentWallet)` on the returned message and re-check the message bytes did not change (line 185);
(e) simulate with sigVerify; (f) send once. Signing anything before step (b) returns would be
signing a message that no longer exists.

Kora RPC methods called (line 102): `getPayerSigner`, `getBlockhash`, `signTransaction`. The
`signTransaction` params are `{ transaction: <base64>, signer_key: <kora address>, sig_verify:
false, user_id: <writer address> }` (line 175). Result fields used: `signed_transaction`,
`signer_pubkey` (`scripts/verify_live_sign_transaction.mjs:158-180`).

Auth headers and HMAC (`scripts/sponsored_register_demo.mjs:113-118`,
`scripts/verify_live_sign_transaction.mjs:90-92`): header `x-api-key`; header `x-timestamp` =
Unix seconds as a string; header `x-hmac-signature` = hex of HMAC-SHA256 keyed with the HMAC
secret over `timestamp` immediately followed by the exact JSON request body string. JSON-RPC
2.0 body `{jsonrpc, id, method, params}`. Timestamp window 300 seconds (`kora.toml:6`). `redirect:
'error'` and a timeout on every call.

Kora response validator (`verifyKoraReturn`, lines 66-87): same blockhash; same fee payer;
exactly 3 instructions; instructions 0 and 1 identical to what was built (program, data, account
list with flags); instruction 2 is Lighthouse; the message equals the original with only that
instruction appended (line 77 to 78); signer set is exactly {Kora, rent wallet, writer}; Kora is
slot 0; the other two slots are empty; Kora's Ed25519 signature verifies; the Lighthouse
instruction passes the byte checks in `inspectSignedTransaction` (one account equal to the
Kora fee payer, 12 data bytes, prefix `05 00 00`, last byte `04`; the asserted minimum
lamports are read from bytes 3 to 10). That this is "a fee-payer balance assertion" is
inferred from those byte checks; it was not decoded against Lighthouse source in this session.

Kora policy relevant to this design (`kora.toml`): `rate_limit = 20` (line 3, semantics
inferred); auth with 300 s window (5-7); `usage_limit` rule of 10 transactions per 3600 s
(15-24, keyed by `user_id` per `README.md:105-107`, inferred); Lighthouse on (26-28);
`sign_transaction` only (30-43); `max_signatures = 3` (53); allowed programs PlotArmor, System,
Lighthouse and `require_one_of_programs` PlotArmor (59-65); system `allow_create_account =
false` (78). This spec needs no change to `kora.toml`. Kora's Free Key Value store loses data on
restart (`evidence/2026-09-30-rent-spike/REPORT.md:121`), so Kora's own usage counters are a
backstop and not the budget ledger.

### 1.2 The app, `~/plotarmor-demo` (branch `feat/saas-ui`, read only)

- Registration is built and sent in `src/vault/UploadFlow.tsx`, inside `handleProtect`. The
  whole on-chain step is wrapped in `if (anchorWallet)` (line 477), with
  `anchorWallet = useAnchorWallet()` (line 234). Without a connected wallet it is skipped and
  `anchor_state` stays `none`. The card at lines 1274 to 1279 asks the user to connect a wallet.
- `register_work_claim` is called through the Anchor client at lines 524 to 546:
  `.registerWorkClaim(rawHash, contentKind, 1 /*claim_kind Original*/, 100, 100, linkNonce,
  anchorNonce, 1 /*AttestedDevnet*/, externalRefHash)`, accounts via `accountsStrict`, with
  `signer: anchorWallet.publicKey` (line 543) and `.rpc({ commitment: "confirmed" })`
  (line 546). `getProgram(wallet)` returns `null` without a wallet (`src/solana.ts:23-27`).
- Who signs: the connected browser wallet (Phantom through `@solana/wallet-adapter`, see
  `src/WalletContext.tsx`). That wallet is the on-chain claimant, ownership admin and sole owner.
  It also pays all rent and the network fee today.
- Inputs already persisted before any on-chain attempt: `link_nonce` and `anchor_nonce` are
  generated once and saved in the `works` row (lines 397-435), reused on retry. `content_hash`
  is the SHA-256 hex (`src/crypto.ts:27`). `external_ref_hash` is the sha2-256 digest inside the
  CIDv0 (`src/vault/ipfs.ts:48-66`, used at `UploadFlow.tsx:494`). `content_kind` is 2 for
  `treatment`, else 1 (`UploadFlow.tsx:58-60`).
- After success the row is patched with `anchor_state "confirmed"`, `tx_id`, `anchor_mode 1`,
  `work_claim_pda`, `content_artifact_pda`, `anchor_record_pda` (lines 590-603). On failure
  `anchor_state "failed"` plus a reason (lines 604-612). `RegistrationResult.tsx:43` shows
  "Registration did not complete. Your draft is saved, nothing is lost."
- Does the app already have a non-wallet keypair? Not a Solana one. The only per-user keypair is
  an ECDH P-256 key for sharing project keys: `setupECDHKeypair` (`src/auth.tsx:148`), stored
  as `profiles.encrypted_private_key` wrapped by the vault master key (`auth.tsx:25-29`,
  `src/crypto.ts:257`). A grep for `Keypair` and `secretKey` across `src` and `supabase` found
  only those ECDH functions. No Solana secret key is stored anywhere today.
- The vault: password goes through PBKDF2 (`deriveKey`, `src/crypto.ts:69`, 100000 iterations)
  to a wrapping key, which unwraps the AES-256 master key stored server side as
  `profiles.encrypted_master_key`. The unlocked key lives in React state as `vaultKeyHex`
  (`auth.tsx:58`) and is used at `UploadFlow.tsx:356-359`. There is also a recovery code
  (`crypto.ts:159-194`). The server holds ciphertext only.
- Edge Function conventions to follow: `supabase/functions/upload-to-ipfs/index.ts` (JWT check
  with `auth.getUser()` at lines 82-89, service-role client, CORS allowlist at 11-15, erasure
  check at 54-63 and 146, per-user rate limit RPC at 178) and the rate-limit migration pattern in
  `supabase/ipfs-rate-limit.sql` (advisory lock per user, SECURITY DEFINER RPC). Project is
  `khygvzpnyimrxndlvlje` (demo `CLAUDE.md:75-76`). The stale project `ntiaabywflimmbfhwqec`
  must never be used. Schema changes go through `supabase migration new` and `supabase db push`
  (demo `CLAUDE.md:96-97`).
- Test stack: vitest (`npm test`), typecheck, eslint, vite build.

### 1.3 The program, `~/plotarmor-program` (read only): can a claim be closed?

Question: does any instruction close a WorkClaim, or return lamports to the writer or owner,
which would allow a register-then-close drain loop of the rent wallet?

Answer from source: **no**. `programs/plotarmor/src/lib.rs:62-170` exposes seven instructions:
`init_registry_config`, `add_owner`, `anchor_authorized_contract`, `anchor_evidence_contract`,
`add_version`, `register_work_claim`, `sign_contract`. A case-insensitive search of
`programs/plotarmor/src` for `close`, `withdraw`, `refund`, `reclaim`, `realloc`, `lamports`,
`transfer`, `revoke` and `delete` returned no matches (ran). Every account is created by Anchor
`init` / `init_if_needed` with `payer = signer` or `admin` or `claimant`, and nothing moves
lamports out.

Consequences for abuse controls:

- There is no loop. Rent paid for a registration is locked in the six program-owned accounts.
  The rent wallet cannot be refunded and the user cannot cash the rent out.
- The cost to the sponsor is a one-way spend of about 7.15M lamports (0.00715 SOL) per
  registration at current devnet rent (observed), plus Kora's 5000 per signature network fee
  (15000 observed). On devnet this is play money. On mainnet it is real, so the limits in
  section 8 matter.
- An attacker needs a fresh `raw_hash` per registration (content PDA seeds). That is cheap, so
  uniqueness of the hash is not an abuse control. Rate and quota are.
- `content_artifact` uses `init_if_needed` (`register_work_claim.rs:30`, guard at line 130). If
  another claimant already registered the same hash, that account exists and the registration
  creates only five accounts. A transfer sized for six would leave about 904,240 lamports in
  the writer. The server must compute rent only for accounts that do not exist yet (section 5).
- Caveat: this reads the repo checkout. It does not prove the deployed binary matches. Comparing
  the deployed program hash to a build of this source is not done and remains unverified.
- `add_version` requires `claimant` to equal the claim's claimant (`add_version.rs:26`).
  `add_owner` requires `admin` (`add_owner.rs:25`). Both are signed by the writer key, which
  matters for section 2.

## 2. Key ownership

The writer keypair is an ordinary Ed25519 Solana keypair generated in the browser with
`Keypair.generate()` from `@solana/web3.js`. The secret is never sent to the server. The server
sees only the public address.

Storage: encrypted with the user's existing vault master key and stored as ciphertext in a new
table (section 8.1), the same pattern as `profiles.encrypted_private_key`. The server holds
ciphertext it cannot open, because the master key exists only in the browser after the user
unlocks the vault. If the product decision is that even stored ciphertext is too close to
custody, Open Question 1 gives the fallback (local only plus a user-held recovery file).
The function must never select the ciphertext column; it reads `writer_pubkey` only.

One writer key per user, created lazily on the first walletless registration (recommended; see
Open Question 2). Order of operations in the browser is strict: generate, encrypt, save the
ciphertext, read it back and decrypt it to prove the round trip, and only then request
sponsorship. This guarantees rent is never spent on a registration whose key could be lost.

On-chain, after registration (read from `register_work_claim.rs:131-177`):

- WorkClaim `claimant` = writer. Ownership `admin` = writer. OwnerRecord `owner` = writer with
  all shares (100 of 100 in the app). The sponsor wallet and Kora own nothing and have no
  authority. Account owner is the program. Rent is not refundable (section 1.3).

What this means for the user later:

- Only the writer key can add versions (`claimant`) or owners (`admin`). The app can do this
  later only with the user's vault unlocked, and each such transaction also needs rent, so
  version and owner sponsorship is a follow-up (Open Question 7).
- There is no transfer instruction. A claim cannot be moved to a wallet the user connects
  later. The available path is `add_owner` signed by the writer, naming the new wallet.
- If the user loses the vault password and recovery code, the writer key is lost with it. The
  public record remains; nobody can extend it.
- The chain shows only the writer address. The link from person to address is the app's own
  database. No statement about legal effect is made here. That is for the legal review.
- The server never holds or signs with a key that represents the user. The two keys the server
  does use, Kora's fee payer and the rent wallet, are service keys that represent the service.
  They hold no authority over the claim.

## 3. Architecture

```
Browser (vault unlocked)            sponsor-register (Edge Fn)          Kora (Render)      Devnet RPC
 1 ensure writer key saved
 2 insertWork (nonces persisted)
 3 {action:"warm"} ----------------> GET /liveness (wake) -----------> wakes
 4 {action:"register",work_id,
    writer_pubkey} ----------------> validate, reserve quota
                                     RPC: rent quote, accounts, balance ------------------> reads
                                     build tx (transfer, register)
                                     signTransaction (HMAC) ----------> Kora signs, adds
                                     validate Kora's return <---------- Lighthouse
                                     rent wallet partialSign
 5 <---- base64 tx, signature ------ record 'issued'
 6 validate tx against own inputs
 7 writer partialSign
 8 sendRawTransaction --------------------------------------------------------------------> lands
 9 poll confirm, updateWork(...)
```

Principles that the implementation must keep:

- The function never accepts a transaction from the browser. It builds every byte itself.
- Nothing is signed before Kora returns the transaction. The rent wallet signs only a message
  that passed the validator.
- The browser validates the returned message against its own inputs before the writer signs,
  because the writer's signature authorizes exactly those instructions.
- Secrets live only in Edge Function secrets. Nothing sensitive uses a `VITE_` variable.

## 4. Endpoint

One Supabase Edge Function, `sponsor-register`, deployed with JWT verification on. It also
calls `auth.getUser()` like `upload-to-ipfs`. CORS allowlist copied from that function. Methods
POST and OPTIONS. Request body limit 4 KB.

### 4.1 Request

```json
{ "action": "warm" }
```

```json
{
  "action": "register",
  "work_id": "<uuid of the caller's works row>",
  "writer_pubkey": "<base58 Ed25519 address, 32 bytes, the user's writer key>"
}
```

`"action": "add_version"` takes the same two fields, where `work_id` is the new version's `works` row
(it must have a `parent_work_id`). The server finds the root work's `work_claim_pda`, reads the claim
on chain, requires the claim's `claimant` to equal `writer_pubkey`, takes the lineage head from the
chain as `expected_previous_link`, and prices only the accounts that do not exist yet
(`claim_artifact_link`, `anchor_record`, and `content_artifact` if missing). Its instruction data is 170 bytes
(discriminator from IDL bytes 167,42,0,24,83,109,61,248) and its accounts
are, in order: registry_config (ro), work_claim (w), content_artifact (w), claim_artifact_link (w),
anchor_record (w, derived from the content artifact), claimant = writer (w, signer), system_program (ro).

Nothing else is accepted. Hashes, nonces, content kind, shares and CID come from the `works`
row, not from the request, so a caller cannot ask for a registration it did not store.

### 4.2 Responses

Success, HTTP 200:

```json
{
  "status": "ready_to_sign",
  "registration_id": "<uuid>",
  "transaction": "<base64 legacy transaction; Kora and rent wallet signed, writer slot empty>",
  "signature": "<base58, equals the transaction signature once the writer signs; Kora's slot 0>",
  "blockhash": "<base58>",
  "issued_at": "<ISO timestamp>",
  "rent_lamports": 7147560,
  "fee_payer": "<Kora address>",
  "rent_wallet": "<rent wallet address>",
  "records": {
    "registry_config": "...", "content_artifact": "...", "work_claim": "...",
    "ownership": "...", "owner_record": "...", "claim_artifact_link": "...", "anchor_record": "..."
  }
}
```

Already registered, HTTP 200 (idempotent recovery when an earlier attempt landed but its
response was lost):

```json
{ "status": "already_registered", "records": { "...": "..." }, "signature": "<base58 or null>" }
```

Warm, HTTP 200: `{ "status": "ready" | "waking" }`.

Error, HTTP 4xx or 5xx:

```json
{ "error": { "code": "<enum below>", "message": "<developer text, never secrets>",
             "retryable": true, "retry_after_seconds": 30 } }
```

Codes: `unauthenticated` 401, `invalid_request` 400, `work_not_found` 404 (also used when the work
belongs to someone else), `work_not_eligible` 409, `writer_key_not_saved` 409,
`writer_balance_unexpected` 409, `erasure_in_progress` 409, `registration_in_progress` 409,
`rate_limited` 429, `quota_exceeded` 429, `global_quota_exceeded` 429, `sponsorship_paused`
503 (kill switch or low rent wallet), `kora_unavailable` 503, `kora_rejected` 502,
`kora_response_invalid` 502, `solana_rpc_unavailable` 503, `internal` 500.

## 5. Server steps, exact

Hard deadline for the whole request: 110 seconds (Supabase Edge Function wall-clock limits
depend on plan; the 150 second figure is inferred, see Open Question 13). Every outbound call
has `redirect: 'error'` and an `AbortSignal.timeout`.

`action: "warm"`: require JWT; best-effort per-user limit of 6 per minute held in memory; fetch
`GET {KORA_URL}/liveness` with an 8 second timeout; return `ready` if 200, else `waking`. No
quota is consumed. No Kora authentication is sent (liveness is unauthenticated, README.md:193).

`action: "register"`:

1. **Kill switch and auth.** If `SPONSOR_ENABLED` is not `"true"`, return `sponsorship_paused`.
   Verify the JWT. Require `email_confirmed_at` on the user. Run the erasure check used by
   `upload-to-ipfs` (`is_user_erasure_blocking`).
2. **Validate input.** `work_id` is a UUID. `writer_pubkey` decodes to 32 bytes, is on the
   curve, and differs from the pinned Kora address and the rent wallet address.
3. **Load the work** with the service client, filtered by `id = work_id AND user_id =
   caller.id`, selecting only: `id, user_id, content_hash, link_nonce, anchor_nonce, ipfs_cid,
   work_type, parent_work_id, anchor_state, work_claim_pda`. Require: root work
   (`parent_work_id` null); `anchor_state` in (`none`, `submitted`, `failed`);
   `work_claim_pda` null; `content_hash`, `link_nonce`, `anchor_nonce` each 64 hex characters;
   `ipfs_cid` a valid CIDv0. Derive `external_ref_hash` from the CID, `content_kind` from
   `work_type`, and use the app constants `claim_kind 1`, `total_shares 100`,
   `threshold_shares 100`, `anchor_mode_arg 1` (values from `UploadFlow.tsx:527-532`).
   Otherwise `work_not_found` or `work_not_eligible`.
4. **Require the saved writer key.** Select `writer_pubkey` from `user_writer_keys` for the
   caller. It must exist and equal the request's `writer_pubkey`, else `writer_key_not_saved`.
5. **Sweep stale rows.** For the caller's `issued` rows older than 90 seconds, call
   `getSignatureStatuses` (search history on). Landed without error: mark `landed`. Not found
   and `isBlockhashValid(blockhash)` is false: mark `expired`. This keeps the ledger honest
   without a scheduled job (`isBlockhashValid` support on the chosen RPC is inferred; verify).
6. **Reserve quota atomically** with `reserve_sponsored_registration` (section 8.1). Map its
   reasons to `registration_in_progress`, `rate_limited`, `quota_exceeded`,
   `global_quota_exceeded`. From here on, any failure before step 14 must mark the row `failed`
   with an `error_code` so it does not count against the user.
7. **Wake Kora and fetch the fee payer.** `GET /liveness` with the policy in section 9, then
   authenticated `getPayerSigner`. The returned `signer_address` must equal the pinned
   `KORA_FEE_PAYER_ADDRESS`. If not, fail `kora_response_invalid` and stop. (The pin is a public
   address, not a secret. It stops a hijacked or misconfigured Kora URL from receiving rent
   wallet signatures.)
8. **Read devnet state** (server-held RPC URL, section 10): `getGenesisHash` equals
   `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG` (`scripts/verify_plotarmor_sign_transaction.mjs:17`);
   `getMultipleAccounts` for the six record PDAs plus the writer (zero-length data slice);
   `getMinimumBalanceForRentExemption` for the size of each record that does not exist yet
   (sizes in section 1.1); `getBalance` of the rent wallet.
   - `content_artifact` may exist (`init_if_needed`). Rent is the sum over missing accounts only.
   - If `work_claim` already exists and its owner record names this writer, return
     `already_registered` and mark the row `landed`. If any other record exists in a
     combination that is not that case, fail `work_not_eligible`.
   - `transfer = rent_needed - writer_balance` when `0 <= writer_balance < rent_needed`;
     `writer_balance >= rent_needed` returns `writer_balance_unexpected`. The writer's address
     is public after its first registration, so a stranger can send it dust; this keeps dust
     from blocking registration. The writer ends at 0 lamports in the live evidence
     (`summary.json`, `writer_post_lamports: 0`).
   - Enforce `transfer <= MAX_RENT_LAMPORTS` (8,000,000, matching the script) and `> 0`.
   - Refuse with `sponsorship_paused` when `rent_wallet_balance - transfer -
     outstanding_unlanded_rent < RENT_WALLET_MIN_RESERVE_LAMPORTS`, where outstanding rent is
     the sum of `rent_lamports` over this table's `reserved` and `issued` rows from the last 2
     minutes.
9. **Build the transaction** exactly as in section 1.1: blockhash from Kora `getBlockhash`
   (fetched after Kora is awake, so it is fresh); instruction 0 System transfer rent wallet to
   writer; instruction 1 `register_work_claim`. Build the instruction data by hand
   (8 byte discriminator plus the borsh arguments in section 1.1, 143 bytes) so the function
   does not need the Anchor library in Deno. A golden test (section 11) compares the bytes with
   Anchor's encoder. Build keys directly with the IDL flags (writer is the only signer on the
   registration instruction); do not decode and re-encode, which marks every transaction signer
   as a signer (script comment, `sponsored_register_demo.mjs:51`).
10. **Unsigned preflight.** `simulateTransaction` with `sigVerify: false`; require `err: null`.
11. **Kora `signTransaction`**, params as in section 1.1. `user_id` is the Supabase user id (a
    UUID string) so Kora's per-user usage rule counts real accounts, not fresh writer keys. The
    script never tested a non-address `user_id`; if Kora rejects it, fall back to the writer
    address and rely on the gateway ledger for per-user limits (Open Question 5). On a network
    error or 5xx, retry once; never retry a policy rejection.
12. **Validate Kora's return** with the shared validator (section 5.1). Any failure returns
    `kora_response_invalid`, marks the row `failed`, logs the failing check name, and does not
    sign.
13. **Rent wallet signs.** `partialSign` with the rent wallet keypair, then assert: message bytes
    unchanged, Kora's signature still valid, rent wallet signature valid, writer slot empty.
    The rent wallet key is loaded from the secret and its public key must equal the pinned
    `RENT_WALLET_ADDRESS` or the function refuses to start work.
14. **Record and return.** Update the row to `issued` with `signature` (slot 0, base58),
    `message_sha256`, `blockhash`, `rent_lamports`, `issued_at`. Return the section 4.2
    response. Do not log or store the transaction body.

### 5.1 Shared validator, `validateKoraReturn` (pure function, no network)

Inputs: the original wire bytes, Kora's returned base64, and the expected values (Kora address,
rent wallet, writer). Reject unless all hold:

1. Decodes as a legacy transaction; header requires exactly 3 signatures.
2. Same recent blockhash as the original.
3. Fee payer equals the pinned Kora address; signature slot 0 belongs to it.
4. Exactly 3 instructions.
5. Instruction 0 equals the built transfer (program, data, account list with flags). Decoded
   with `SystemInstruction.decodeTransfer`: source is the rent wallet, destination is the
   writer, lamports equal the quote.
6. Instruction 1 equals the built registration (program PlotArmor, data bytes, nine accounts
   with flags).
7. Instruction 2 program is Lighthouse `L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95`, has one
   account equal to the Kora address, 12 data bytes, prefix `05 00 00`, last byte `04`.
8. The returned message bytes equal the original message with only that Lighthouse instruction
   appended (compare serialized messages, as in `sponsored_register_demo.mjs:77-78`).
9. Signer set is exactly {Kora, rent wallet, writer}; the rent wallet appears only as the
   source of instruction 0; the writer appears only as the destination of instruction 0 and the
   signer of instruction 1.
10. Kora's Ed25519 signature over the message verifies (Deno Web Crypto Ed25519 or `tweetnacl`;
    the implementer states which and tests it). The other two slots are empty.
11. Nothing else: no extra instructions, no address lookup tables (legacy only), total size
    at most 1232 bytes.

The same module, with a flipped perspective, is used in the browser (section 6, step 4).

## 6. Browser steps, exact

Direct send (chosen). After the writer signs, the browser sends the transaction straight to the
Solana RPC it already uses (`getConnection()`, `src/solana.ts:16-19`, which already reads the
public `VITE_HELIUS_API_KEY`).

Why direct send and not a `sponsor-submit` function:

- The transaction is a fixed, fully signed message. Only these exact bytes can land. A relay
  adds no safety.
- It keeps the function short-lived (it ends after signing), which matters for the cold-start
  budget and the wall-clock limit.
- No second function, no server holding the writer-signed bytes, one less thing to secure.
- Rebroadcasting identical bytes is safe because one signature can land once (inferred from
  how Solana de-duplicates; the live test should confirm no double charge).
- The cost: the server does not see the outcome directly. The ledger is reconciled by the sweep
  in section 5, step 5, and the browser records the result in `works` as it does today. If
  Milan wants server-authoritative state, `sponsor-submit` can be added later without changing
  this contract (Open Question 9).

Steps, after `handleProtect` has done everything up to and including `insertWork`:

1. If the user has a wallet connected, keep today's wallet path unchanged. The walletless path
   runs only when no wallet is connected (Open Question 15).
2. Show the progress text "Registering, this can take up to 30 seconds the first time". Start
   `{action:"warm"}` earlier, when the user reaches the final step of the upload flow, so a
   sleeping Kora is usually awake by the time they press the button.
3. Ensure the writer key (section 2): load or create, with the round-trip check. Keep the secret
   in memory only; drop references immediately after signing.
4. Set `anchor_state: "submitted"` as today, then POST `{action:"register", work_id,
   writer_pubkey}` with the session access token as Bearer. Client timeout 120 seconds. Single
   attempt per click; retries come from the user pressing Try again.
5. **Validate before signing.** Decode the returned transaction and check, using only locally
   known values: three instructions; fee payer equals the public pinned Kora address; the
   transfer is from the pinned rent wallet to its own writer address, with `lamports` at most
   8,000,000 and equal to `rent_lamports`; instruction 1 data equals the bytes the browser
   itself computes from its own `content_hash`, nonces, content kind, CID and constants; its
   accounts equal the PDAs it derives itself, with only its writer address as signer; the
   third instruction is the Lighthouse shape in section 5.1, item 7; Kora's and the rent
   wallet's signatures verify; the writer slot is empty. Reject and show the failure state on
   any mismatch. Without this check the server could have the writer authorize a different
   registration.
6. `tx.partialSign(writerKeypair)`; assert the message bytes are unchanged and
   `tx.verifySignatures()` is true.
7. `connection.sendRawTransaction(bytes, { skipPreflight: false, preflightCommitment:
   "confirmed", maxRetries: 0 })`. Rebroadcast the identical bytes every 5 seconds while the
   blockhash is valid. Poll `getSignatureStatuses` every 1.5 seconds. Stop at `confirmed` or
   `finalized`, or on `err`. If it has not confirmed after 75 seconds, call `isBlockhashValid`;
   if it is false and the status is still unknown, the attempt is dead and safe to retry. If
   valid, keep polling to 120 seconds, then fail without retrying blind.
8. On confirmation: read back `work_claim` with `getAccountInfo`, require owner equals the
   PlotArmor program, then patch `works` with the same fields as `UploadFlow.tsx:590-603`
   (`anchor_state: "confirmed"`, `tx_id` = signature, `work_claim_pda`, `content_artifact_pda`,
   `anchor_record_pda`, `anchor_mode: 1`). The signature is the transaction's slot 0 signature,
   which the server also returned, so the app can record it even if the page is closed between
   send and confirm.
9. On failure at any step: patch `anchor_state: "failed"` and store a short reason code
   (section 7), not the raw error text, then show the failure state.
10. On retry, reuse the persisted nonces and the saved writer key. If the earlier attempt
    actually landed, step 4 returns `already_registered` and the flow goes straight to step 8.

## 7. Error mapping to the designed UI states

Designed copy already in the app: "Registration did not complete. Your draft is saved, nothing
is lost." (`RegistrationResult.tsx:43`) with a "Try again" button (`UploadFlow.tsx:1282`).
Slow start copy: "Registering, this can take up to 30 seconds the first time".

All failures map to the designed failure state. The user never sees a code, a lamport figure, a
transaction, or a mention of Kora or rent.

| Cause | Code | Stored `anchor_failure_reason` | UI | Try again? |
|---|---|---|---|---|
| Not signed in or expired session | `unauthenticated` | `session` | Designed failure state | after sign-in |
| Kora asleep too long, network, 5xx | `kora_unavailable` | `service_busy` | Designed failure state | yes |
| Devnet RPC trouble | `solana_rpc_unavailable` | `network` | Designed failure state | yes |
| Blockhash expired, send timeout | client side | `expired` | Designed failure state | yes |
| Tampered or malformed return | `kora_response_invalid` | `invalid_response` | Designed failure state | yes (support alert logged) |
| Kora policy rejection | `kora_rejected` | `rejected` | Designed failure state | yes |
| Per-user or daily quota | `rate_limited`, `quota_exceeded` | `limit` | Designed failure state; PROPOSED extra line "Try again later." | later |
| Global quota, kill switch, low rent wallet | `global_quota_exceeded`, `sponsorship_paused` | `paused` | Designed failure state; PROPOSED extra line "Try again later." | later |
| Work not eligible, key not saved | `work_not_eligible`, `writer_key_not_saved` | `not_ready` | Designed failure state | no, needs support |
| Already registered | `already_registered` | none | Success path | n/a |

The two "Try again later." lines are new copy and need approval (Open Question 11).
`anchor_retry_count` increments per attempt as today. After 30 seconds without a response the
UI may change the progress line to "Still registering. This is taking longer than usual." (also
PROPOSED).

## 8. Abuse controls

Context: the rent wallet funds every registration, rent is not recoverable, and anyone with an
account can call the function. Defenses are layered. None is claimed to be sufficient.

Decided defaults (Open Question 3), all constants in one file and adjustable:

| Control | Default |
|---|---|
| Per user, rolling 1 hour | 5 registrations or versions |
| Per user, rolling 24 hours | 20 registrations or versions |
| Global, rolling 24 hours | 200 (about 1.4 SOL a day at observed rent if all are registrations) |
| Maximum rent per request | 8,000,000 lamports (script cap; observed 7,147,560) |
| Rent wallet reserve | refuse when balance after the request would be under 1,000,000,000 lamports |
| Account requirement | confirmed email, and a saved writer key |
| Kill switch | secret `SPONSOR_ENABLED` not equal to `true` returns `sponsorship_paused` |
| Kora's own backstop | 10 transactions per hour per `user_id` (`kora.toml:21-24`), counters not durable on the free plan |

Failures that were not the user's doing (anything that ends `failed` before a signed
transaction is issued) do not count toward the limits. `expired` rows do count.

Account farming (many free signups) defeats per-user limits; the global cap and the reserve
bound the loss. Signup captcha is outside this spec (Open Question 10).

### 8.1 Migration SQL (to be placed in `supabase/migrations/` via `supabase migration new`)

Not executed. No Postgres server is available in this environment. The statements and the plpgsql
body were parsed with the real Postgres parser (libpg-query), which checks syntax only; behavior
and RLS are unverified. The implementer must run it on a local Supabase stack and report the
result. A human applies it with `supabase db push` against `khygvzpnyimrxndlvlje`.

```sql
-- Walletless registration: writer key ciphertext and sponsorship ledger. Devnet only.
-- The ledger is the authoritative budget record; Kora's own usage counters are only a backstop.

create table public.user_writer_keys (
  user_id uuid primary key references auth.users(id) on delete cascade,
  writer_pubkey text not null unique
    check (writer_pubkey ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  -- AES-GCM ciphertext (base64 of 12 byte IV, 64 byte secret, 16 byte tag) made in the browser with the
  -- vault master key. The server cannot decrypt it and the Edge Function never selects this column.
  encrypted_secret text not null check (length(encrypted_secret) between 100 and 400),
  created_at timestamptz not null default now()
);

alter table public.user_writer_keys enable row level security;

create policy user_writer_keys_select_own on public.user_writer_keys
  for select to authenticated using (user_id = (select auth.uid()));
create policy user_writer_keys_insert_own on public.user_writer_keys
  for insert to authenticated with check (user_id = (select auth.uid()));
-- No update or delete policy: the writer key is write-once from the client.

revoke all on public.user_writer_keys from public, anon, authenticated;
grant select, insert on public.user_writer_keys to authenticated;
grant all on public.user_writer_keys to service_role;

create table public.sponsored_registrations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  work_id uuid not null,
  kind text not null default 'register' check (kind in ('register', 'add_version')),
  writer_pubkey text not null,
  status text not null default 'reserved'
    check (status in ('reserved', 'issued', 'landed', 'expired', 'failed')),
  rent_lamports bigint check (rent_lamports is null or rent_lamports between 1 and 8000000),
  signature text,
  message_sha256 text,
  blockhash text,
  error_code text,
  created_at timestamptz not null default now(),
  issued_at timestamptz,
  resolved_at timestamptz
);

-- One open registration per work. A failed or expired row does not block a retry.
create unique index sponsored_registrations_one_open_per_work
  on public.sponsored_registrations (work_id)
  where status in ('reserved', 'issued', 'landed');
create index sponsored_registrations_user_time
  on public.sponsored_registrations (user_id, created_at);
create index sponsored_registrations_time
  on public.sponsored_registrations (created_at);

alter table public.sponsored_registrations enable row level security;

-- Users may read their own rows (to show status). Only the service role writes.
create policy sponsored_registrations_select_own on public.sponsored_registrations
  for select to authenticated using (user_id = (select auth.uid()));

revoke all on public.sponsored_registrations from public, anon, authenticated;
grant select on public.sponsored_registrations to authenticated;
grant all on public.sponsored_registrations to service_role;

-- Atomic limit check and reservation, same pattern as check_ipfs_upload_rate_limit.
-- Defaults: 5 per user per hour, 20 per user per day, 200 per day across all users.
create or replace function public.reserve_sponsored_registration(
  p_user_id uuid,
  p_work_id uuid,
  p_writer text,
  p_kind text default 'register',
  p_user_hour_limit int default 5,
  p_user_day_limit int default 20,
  p_global_day_limit int default 200
)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_hour int;
  v_day int;
  v_global int;
  v_id uuid;
begin
  if p_user_id is null or p_work_id is null or p_writer is null then
    raise exception 'p_user_id, p_work_id and p_writer are required';
  end if;
  if p_kind not in ('register', 'add_version') then
    raise exception 'invalid kind';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  -- A function instance that died after reserving must not block the work forever.
  update public.sponsored_registrations
     set status = 'failed', error_code = 'reservation_timeout', resolved_at = now()
   where user_id = p_user_id and status = 'reserved'
     and created_at < now() - interval '3 minutes';

  if exists (select 1 from public.sponsored_registrations
              where work_id = p_work_id and status in ('reserved', 'issued', 'landed')) then
    return json_build_object('allowed', false, 'reason', 'registration_in_progress');
  end if;

  select count(*) into v_hour from public.sponsored_registrations
   where user_id = p_user_id and status in ('reserved', 'issued', 'landed', 'expired')
     and created_at >= now() - interval '1 hour';
  select count(*) into v_day from public.sponsored_registrations
   where user_id = p_user_id and status in ('reserved', 'issued', 'landed', 'expired')
     and created_at >= now() - interval '24 hours';
  select count(*) into v_global from public.sponsored_registrations
   where status in ('reserved', 'issued', 'landed', 'expired')
     and created_at >= now() - interval '24 hours';

  if v_hour >= p_user_hour_limit then
    return json_build_object('allowed', false, 'reason', 'rate_limited');
  end if;
  if v_day >= p_user_day_limit then
    return json_build_object('allowed', false, 'reason', 'quota_exceeded');
  end if;
  if v_global >= p_global_day_limit then
    return json_build_object('allowed', false, 'reason', 'global_quota_exceeded');
  end if;

  insert into public.sponsored_registrations (user_id, work_id, kind, writer_pubkey)
  values (p_user_id, p_work_id, p_kind, p_writer)
  returning id into v_id;

  -- Housekeeping: keep 90 days of audit history.
  delete from public.sponsored_registrations where created_at < now() - interval '90 days';

  return json_build_object('allowed', true, 'id', v_id,
    'hour_count', v_hour + 1, 'day_count', v_day + 1, 'global_day_count', v_global + 1);
end;
$$;

revoke all on function public.reserve_sponsored_registration(uuid, uuid, text, text, int, int, int)
  from public, anon, authenticated;
grant execute on function public.reserve_sponsored_registration(uuid, uuid, text, text, int, int, int)
  to service_role;
```

Notes for the implementer: the erase-user workflow (`supabase/functions/erase-user`, migration
`20260902000000_add_user_erasure_workflow.sql`) must be checked for how it inventories
per-user tables, and both new tables added if needed. `user_writer_keys` cascades on user
deletion. `sponsored_registrations` has no foreign key on purpose, matching
`ipfs_upload_attempts`, so a rolled back work row does not erase accounting. Whether to purge
or pseudonymize those rows on erasure is Open Question 14.

### 8.2 Logging

One JSON line per request via `console.log`, visible in Supabase function logs:
`request_id`, `event` (`warm`, `register`), `user_id` (UUID only, no email), `work_id`,
`writer_pubkey`, `outcome` or `error_code`, `rent_lamports`, `signature`, `message_sha256`,
`liveness_ms`, `kora_ms`, `total_ms`, `retries`, `kora_cold` (true if liveness needed more than
one attempt), the limit counters returned by the reserve RPC, and the rent wallet balance
observed. The `sponsored_registrations` table is the durable audit trail.

Never log: the API key, HMAC secret, any header, the rent wallet secret, request or response
bodies from Kora, the transaction base64, or the writer ciphertext. Failed validator checks log
the check name and the offending index only.

Suggested alerts (a human sets them up): rent wallet balance under the reserve, any
`kora_response_invalid`, and a spike in `rate_limited`.

## 9. Kora cold start

Kora is on the Render free plan, which sleeps after idle and wakes on a request. Render's
documentation says restart usually takes about one minute
(`evidence/2026-09-30-rent-spike/REPORT.md:121`, upstream documentation, not measured). Observed
here once: the first Kora call in `evidence/2026-10-06-sponsored-dryrun-002/` took about 13.7
seconds after a warm devnet call (13:46:51.561 to 13:47:05.293 UTC, from the `*.http.json`
timestamps), and the following Kora calls took under 0.3 seconds each. One observation is not
a distribution.

Policy:

- Wake with `GET {KORA_URL}/liveness`. Per attempt timeout 10 seconds. Retry on timeout,
  connection error and 502, 503, 504, with waits of 2, 3, 5, 5, 5 seconds and so on, up to a
  total liveness budget of 75 seconds. A 200 ends the loop.
- After liveness succeeds, authenticated Kora calls use a 20 second timeout. `getPayerSigner`
  and `getBlockhash` retry once. `signTransaction` retries once on network error or 5xx only.
- If the budget is spent: `kora_unavailable`, retryable, `retry_after_seconds` 30. The row is
  marked `failed` and does not count against the user.
- Fetch `getBlockhash` only after Kora is awake so the blockhash is as fresh as possible. A
  blockhash lasts on the order of a minute or so; the browser budget in section 6 assumes this
  and checks validity instead of assuming.
- Warm early (section 6, step 2). The user message is "Registering, this can take up to 30
  seconds the first time". Observed and documented numbers suggest 30 seconds may be short in
  some cases (Open Question 11).
- Do not add a keep-alive pinger as part of this change. That is an infrastructure decision for
  the Kora repo (a paid plan removes the sleep).

## 10. Secrets and configuration (names only, Milan sets the values)

Edge Function secrets, set by a human (for example `supabase secrets set --project-ref
khygvzpnyimrxndlvlje NAME=<value from your private terminal>`). The implementer must not set,
read or print any value.

| Name | Kind | Purpose |
|---|---|---|
| `KORA_URL` | config | Kora base URL (the script already uses the public Render URL) |
| `KORA_API_KEY` | secret | `x-api-key` header |
| `KORA_HMAC_SECRET` | secret | HMAC-SHA256 key |
| `KORA_FEE_PAYER_ADDRESS` | public config | Pinned Kora fee payer address, checked against `getPayerSigner` |
| `RENT_WALLET_SECRET_KEY` | secret | Rent wallet keypair, JSON array of 64 integers, the same text a Solana keypair file holds |
| `RENT_WALLET_ADDRESS` | public config | Pinned rent wallet address; the function refuses to sign if the secret's public key differs |
| `SOLANA_RPC_URL` | secret | Server-side devnet RPC URL; use a server-only key, not the browser's `VITE_HELIUS_API_KEY` |
| `SPONSOR_ENABLED` | config | Kill switch, must equal `true` to sponsor |
| `RENT_WALLET_MIN_RESERVE_LAMPORTS` | config | Reserve threshold in section 8 |

Already provided by Supabase to every function: `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`.

Browser-side public constants (not secrets, safe to ship): the program id, the rent wallet
address, the Kora fee payer address, the Edge Function URL derived from `VITE_SUPABASE_URL`.
Nothing named `VITE_...` may hold the API key, HMAC secret, rent wallet key, or any Kora or
rent secret.

The Kora fee payer key stays under the permanent canon in `CLAUDE.md`: no agent touches it, and
nothing in this design needs it. The rent wallet key is a separate ordinary wallet; the
implementer still must not open or print it, and the live test uses the deployed function so
no agent needs it either.

## 11. Test plan

Unit and component (run by the implementer, in `plotarmor-demo`, vitest):

1. **Kora-response validator, accept case.** A fixture built from the public evidence layout
   (three instructions, Lighthouse last) passes. Requires a valid Kora signature; tests use the published RFC 8032
   test vector keys for the synthetic payer, rent wallet and writer. Do not generate Kora or
   rent wallet keys, even throwaway ones.
2. **Validator, tampered transactions**, each rejected with the named check. At minimum:
   changed blockhash; different fee payer; extra instruction inserted; extra instruction
   appended after Lighthouse; second Lighthouse instruction; transfer amount raised by one
   lamport; transfer destination changed; transfer source changed; registration data byte
   flipped (for example `raw_hash`); registration account swapped (for example `owner_record`
   pointed at an attacker); registration account signer flag changed; writer flagged writable
   in an extra instruction; Lighthouse account pointed at the writer; Lighthouse data length
   wrong; wrong Lighthouse program id; Kora signature with a flipped bit; Kora signature in the
   wrong slot; a pre-filled writer or rent wallet signature; address lookup table (v0) message;
   missing signature slots. The existing script tests at
   `scripts/sponsored_register_demo.test.mjs:53-70` are the reference for the first set.
3. **Browser-side validator** (section 6 step 5): accept; reject when the registration data
   hash differs from the locally computed one; reject when the transfer destination is not the
   user's own writer; reject over-cap lamports.
4. **Instruction encoder golden test.** The hand-built 143 byte data equals Anchor's
   `BorshInstructionCoder` output for fixed inputs using `src/anchor/plotarmor.json`, and equals
   the layout in section 1.1. Include `claim_kind 1`, shares 100 and 100.
5. **Rent math.** Six missing accounts sum to 7,147,560 at the observed per-record values;
   five (content exists) sum to 6,243,320; transfer reduction for a dusty writer; the cap;
   `writer_balance >= rent_needed` rejection.
6. **PDA derivation** matches `UploadFlow.tsx:486-522` for a fixed writer, hash and nonces.
7. **HMAC.** Fixed timestamp, body and secret produce the same hex as
   `scripts/verify_live_sign_transaction.mjs:90-92` (Web Crypto against Node `createHmac`).
8. **Handler tests with injected dependencies** (mock Kora, RPC and Supabase): 401 without
   JWT; rejected work owned by another user; each error code in section 4; kill switch; quota
   refusal; low rent wallet refusal; cold start (liveness fails three times, then succeeds);
   Kora timeout; fee payer pin mismatch; `already_registered` recovery; no secret appears in
   any log line or response (assert on captured console output).
9. **Writer key store.** Generate, wrap with a test master key, unwrap, public key matches;
   AAD mismatch (different user id) fails to unwrap; the function code path never references
   the ciphertext column (a grep-style test of the function source).
10. **SQL.** On a local Supabase stack (needs Docker; unavailable here), apply the migration and
    check: RLS blocks cross-user reads, `authenticated` cannot insert into
    `sponsored_registrations` or call the RPC, the limits trip at the configured counts,
    concurrent reserves for one user cannot exceed the limit, the unique index blocks a second
    open registration for one work. If Docker is not available to the implementer, report this
    check as not run.
11. `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` all pass, and the
    bundle contains none of the names in section 10 (grep of `dist/`).

Live devnet (run by Milan after deploying; the agent does not deploy):

A. One registration through the deployed function by a real test user, in a browser or with a
   small human-run script that uses that user's session. Record: Kora cold or warm, request
   timings, the Edge Function log line, the ledger row, the final signature. Record in
   `plotarmor-kora/evidence/<date>_walletless_register_devnet.*` the signature plus a
   re-fetch readback like `evidence/2026-10-05_sponsored_register_devnet.fetch.mjs`: signers
   are {Kora, writer, rent wallet}, the writer ends at 0 lamports, the rent wallet delta equals
   the quote, Kora paid only the network fee, and the six (or five) accounts are owned by the
   program with exactly rent-funded balances.
B. Negative live checks: no token returns 401; a fourth registration in an hour returns 429;
   `SPONSOR_ENABLED=false` returns `sponsorship_paused`.

## 12. Verification passes required before any "verified" wording

Per `CLAUDE.md`, four independent passes, reported with counts and evidence. Planned:

1. Automated tests in section 11 (one pass, even though it contains many tests).
2. First live registration through the deployed function (section 11 A).
3. A second, separate live run: a different user and file, after Kora has idled long enough
   to sleep, plus the negative checks in section 11 B. Observe the real cold start.
4. Independent re-audit of the validator, the function and the migration by a different
   session or agent, with the live ledger and Edge Function logs available.

Until then, use "provisional" wording. Not covered by these passes: mainnet behavior,
Lighthouse semantics beyond the byte shape, long-run abuse, and the deployed program binary.

## 13. Open questions for Milan, with the answers recorded 2026-10-06

1. **Writer key ciphertext in Supabase.** The recommended design stores only a vault-encrypted
   blob the server cannot open, like `encrypted_private_key`. Is that acceptable under the
   custody question pending with Sali Law Group (the demo `CLAUDE.md:290` says that sign-off was
   assumed, not confirmed)? Fallback: store the key only in the browser (IndexedDB, vault
   encrypted) and require the user to download a recovery file; a lost browser then means a
   lost key.
   DECIDED: store the vault-encrypted blob in Supabase like the ECDH key. Devnet only; legal review before mainnet.
2. **One writer key per user or one per work?** One per user is simpler and lets later versions
   share the claimant. One per work avoids linking a user's works on-chain but needs one stored
   key per work. The spec assumes one per user.
   DECIDED: one writer key per user.
3. **Limits.** Are 3 per hour, 10 per day per user, 100 per day global, 8,000,000 lamports per
   request and a 1 SOL reserve right for devnet? What should they be on mainnet?
   DECIDED: 5 per hour and 20 per day per user, 200 per day global, 1 SOL reserve, 8,000,000 lamports per request. Mainnet limits are for Phase 7.
4. **Rent wallet funding.** Who refills it, what balance triggers an alert, and where does the
   alert go? Rent wallet balance was about 9.99 SOL after the last live run (readback).
   DEFAULT: alert when the rent wallet balance falls under the reserve; Milan refills by hand on devnet.
5. **`user_id` sent to Kora.** The spec sends the Supabase user id. The script only ever sent
   an address, and the README describes the address as the identity. If Kora rejects a UUID,
   fall back to the writer address and lose Kora's per-user backstop. Acceptable?
   DEFAULT: send the Supabase user id; if Kora rejects it, fall back to the writer address and record that in the evidence.
6. **Same file registered before.** If another user already registered the same hash, the
   content account exists and rent is for five accounts. Allow it (spec) or refuse with
   `work_not_eligible`? This touches duplicate-detection product policy.
   DEFAULT: allow it, rent for five accounts.
7. **New versions and owners.** `add_version` and `add_owner` need the writer's signature and
   rent too. Treat their sponsorship as a follow-up with the same pattern, leaving later drafts
   of walletless works as private drafts for now?
   DECIDED: include `add_version` with the same pattern; defer `add_owner`.
8. **Mainnet.** Rent is real money there and the rent wallet is a hot key in a function secret.
   Out of scope until Phase 7, but is the plan to keep sponsoring, charge, or require a
   wallet? Kora v2.2.0-beta.8 acceptance is devnet only.
   DEFAULT: devnet only until Phase 7.
9. **Server-authoritative outcome.** Accept direct browser send with a reconciled ledger, or do
   you want a `sponsor-submit` function so the server records the result itself?
   DEFAULT: direct browser send with the reconciled ledger.
10. **Signup abuse.** Add captcha on signup or require more than a confirmed email before
    sponsorship?
   DEFAULT: confirmed email only for now; revisit captcha before any public launch.
11. **Copy.** Approve "Try again later." for quota and paused states, the "Still registering"
    line after 30 seconds, and whether "up to 30 seconds" should become "up to a minute"
    given Render's documented restart time.
   DEFAULT: approve both proposed copy lines; keep "up to 30 seconds" and measure the real cold start in live pass 3.
12. **Where evidence lives.** The live run script needs a test user's session, so it fits the
    demo repo, while the signature readback belongs in `plotarmor-kora/evidence/`. Confirm that
    split, and who runs it.
   DEFAULT: live script in the demo repo, signature readback in `plotarmor-kora/evidence/`.
13. **Edge Function limits.** Confirm the wall-clock and memory limits on the Supabase plan in
    use, because the 110 second deadline assumes about 150 seconds.
   DEFAULT: implementer confirms the plan limits from the Supabase dashboard docs; 110 s deadline stays.
14. **Erasure.** On account deletion, purge `sponsored_registrations` rows for that user, keep
    them pseudonymized, or keep as is?
   DEFAULT: purge the user's ledger rows in the erasure workflow.
15. **Wallet path.** Keep the existing connected-wallet path (user pays own rent and fee)
    alongside the walletless one? The card at `UploadFlow.tsx:1274-1279` and the docs page
    `docs/connecting-a-wallet.md` will need new wording either way.
   DEFAULT: keep the wallet path when a wallet is connected; walletless runs when none is.
16. **Later wallet linking.** If a user later connects Phantom, claims stay owned by the writer
    key. Is the intended story "add the wallet as an owner" (needs sponsored `add_owner`), or
    nothing?
   DEFAULT: nothing for now; sponsored `add_owner` is deferred.

## 14. Codex prompt

Superseded. The build prompt, together with tested reference code, SQL and a test plan, is in
`docs/BRIEF_demo_walletless.md` (last section). Use that one.
