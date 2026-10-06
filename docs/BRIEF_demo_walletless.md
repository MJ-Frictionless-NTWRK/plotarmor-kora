# Build brief: walletless draft registration in plotarmor-demo

Audience: Codex (or any engineer) working in `~/plotarmor-demo`. Self-contained. Written 2026-10-06 in
`plotarmor-kora`; the design reasoning is in `docs/SPEC_walletless_register_edge_function.md` in this
repo, but you should not need it to build this.

Status: DRAFT BRIEF. 0 of 4 verification passes for the deployed system. Reference code below was
developed and tested in a scratch project (section 3); that is development testing, not a verification
pass of the deployed system. Use the word "provisional". Never write "verified" or "secure" about the result.

## 1. Goal

Today a user without a wallet cannot publicly register a draft: `UploadFlow.tsx` skips the on-chain
step unless a browser wallet is connected. Make the web app register a draft (and add a later version of
it) through Kora with no wallet and no SOL.

How it works, in one paragraph. The browser keeps a per-user "writer" Solana keypair, stored encrypted
with the vault master key (like the existing ECDH key). A Supabase Edge Function, `sponsor-register`,
builds one legacy transaction: a System transfer from a service "rent wallet" to the writer for exactly
the rent the new accounts need, then the PlotArmor instruction (`register_work_claim` or
`add_version`) with the writer as signer. Kora appends a Lighthouse assertion and signs as fee payer.
The function checks Kora's reply byte for byte, adds the rent wallet signature, and returns the
transaction. The browser rebuilds the same transaction from its own inputs, compares, adds the writer
signature, sends it to Solana, confirms it, and saves the result on the `works` row. Nothing is signed
before Kora returns the transaction, because Kora's appended instruction changes the message.

Decisions already made by Milan (do not reopen):

- Writer key generated in the browser, stored vault-encrypted in Supabase. Devnet only. Legal review
  before mainnet.
- One writer key per user.
- Limits: 5 per hour and 20 per day per user, 200 per day across all users, rent wallet reserve 1 SOL,
  at most 8,000,000 lamports of rent per request.
- Include `add_version` with the same pattern. Do NOT build `add_owner` sponsorship.
- Recommended defaults for everything else (section 13 lists them).

## 2. Rules (non-negotiable)

Safety and secrets
- Never open, print, log, or create private keys, `.env`/`.env.local` files, keypair files, or secret
  values. Do not read `.env.local`. Never generate a Kora fee payer or rent wallet key, not even a
  throwaway. Tests use the published RFC 8032 test vector keys already in the test files.
- Supabase project is `khygvzpnyimrxndlvlje`. Never use `ntiaabywflimmbfhwqec`.
- Nothing sensitive goes into a `VITE_` variable. The Kora API key, HMAC secret and rent wallet key exist
  only as Edge Function secrets. The only new public variable is the rollout flag `VITE_WALLETLESS_REGISTER`.
- The server never holds plaintext of, or signs with, a key that represents the user. The function never
  accepts a transaction from the browser; it builds every byte itself. The function never selects the
  `encrypted_secret` column.
- Do not edit `kora.toml` or anything in `plotarmor-kora` or `plotarmor-program`. Do not change the
  Anchor program or its IDL.
- Follow `plotarmor-demo/CLAUDE.md` where it is stricter than this brief.

Process
- Work on a NEW BRANCH from `feat/saas-ui`, in an isolated worktree (section 4). Do not touch other
  people's uncommitted edits.
- Do NOT deploy, push functions, set secrets, run `supabase db push`, or call any live service. Humans do
  those (section 11). You may run local tests, typecheck, lint, and build.
- Do not commit or push without Milan's approval. If he approves, stage only explicitly named files; never
  `git add -A` or `git add .`. Inspect the staged list and diff before committing.
- Label anything you did not confirm by running a command as "inferred".
- No em dashes or en dashes in code, comments, docs or strings. Plain language.
- Do not use the word spelled by ASCII codes 110, 111, 105, 115, 101.

## 3. What was tested, and what was not

Reference code in section 7 was written and run in a scratch project that mirrors the demo's layout and
uses the demo's own `node_modules` (vitest 2.1.9 with the demo's `jsdom` config and `setup.js`,
`@solana/web3.js` 1.98.4, `@noble/curves` 1.9.7, `@coral-xyz/anchor` 0.32.1, the demo's `tsc`).

Ran and passed there (provisional):
- 129 tests in 4 files: `sponsorTx` 74, `sponsorHandler` 37, `walletless` 14, `registerWork` 4.
- `tsc --noEmit` with strict mode and `allowImportingTsExtensions`, no errors. The scratch project used
  tiny stubs for `src/solana.ts`, `src/supabase.ts`, `src/crypto.ts`, `src/vault/queries.ts` and
  `src/env.d.ts`. Do not copy those stubs; the demo has the real modules.
- The SQL migration parsed with the real Postgres parser (libpg-query): syntax only.
- Golden checks inside the tests: the hand-built instruction data equals Anchor's `BorshInstructionCoder`
  output for `register_work_claim` (143 bytes) and `add_version` (170 bytes) using `src/anchor/plotarmor.json`;
  PDA derivation reproduces the six accounts of the live devnet registration
  `59ntRv2vP4a5guNf9z1hGZZXkFmGk1YGRufFZjNxAGBdhfioMryeCzVoJAfgTTeJsyeyQFn11cW9YZBqn98C5LPk`;
  HMAC output equals Node's `createHmac`; a long tamper list is rejected by name.

NOT tested, you must do or report as not run:
- `supabase/functions/sponsor-register/index.ts` and `deno.json` (Deno, `esm.sh` import, the import map
  resolving `@solana/web3.js`, `@noble/curves/ed25519` and `buffer` inside the Supabase bundler). No Deno
  was available. Run `supabase functions serve` locally if you can, otherwise report "not run".
- The SQL on a real Postgres: RLS behavior, limits, concurrency, the unique index (section 9, test S).
- Everything live: Kora, Supabase, devnet. Whether Kora accepts a UUID `user_id` is unproven; the script
  has only ever sent a wallet address.
- Your edits to `UploadFlow.tsx`, `VaultApp.tsx`, `RegistrationResult.tsx`, `tsconfig.json`,
  `package.json`, vite build output, eslint and prettier on the new files.
- Whether `isBlockhashValid` works on the chosen server-side RPC (inferred supported).

Integrity check: copy each file from section 7 and 8 exactly, then run `sha256sum` and compare to this
table before you change anything.

| File | SHA-256 of the exact content |
|---|---|
| `supabase/functions/_shared/sponsorTx.ts` | `fe8ef3186a84bb8d7e534839c695eb3a55006775b90afea9dd3c3f5f4eb88f2a` |
| `supabase/functions/_shared/kora.ts` | `e91be8cf92cd9fe5fe9ae190bcaf7e70aa31bc0c849c9dbd270a9359bab5780a` |
| `supabase/functions/sponsor-register/handle.ts` | `cde9545171399603047054974faaa3a7d8d64e73bca204a2dff050409d71f81c` |
| `supabase/functions/sponsor-register/index.ts` | `7336d169321e236d00950fc79d625183e6a65f642a55ff0d7b1a50cb93bfdad1` |
| `supabase/functions/sponsor-register/deno.json` | `866ae3fe77f6b77a85cb4495d628e5cc349c95a91fdd712be3e98c895600b644` |
| `supabase/migrations/20261006000000_walletless_registration.sql` | `95716e89af28ac7952bbbf383b7b893f868dbd7220b70ee2c23ed6ad0052879f` |
| `src/walletless/writerKey.ts` | `e17ccfaa4fa9a8201c658e8c6716328b8836d61243af54b9bfd0bbb04763f936` |
| `src/walletless/sponsoredRegister.ts` | `154ab8f14c06196330949e6acb8003701bdcc5f5d86715da9369eceb77e590c5` |
| `src/walletless/registerWork.ts` | `1b54dfd98f387b8f3fca7c71f5d41c2ff8617b9c58d17173ccf2d4c0ebf72bee` |
| `src/tests/sponsorTx.test.ts` | `9301b6e6d2ad7b6908726b73243cf815b72cc8b91df10b58f933bf0fa9480d57` |
| `src/tests/sponsorHandler.test.ts` | `a42763e8bc91b68b21d1bbbaecc0cf4106921dd441e7056b797301b22662f49b` |
| `src/tests/walletless.test.ts` | `14805e90cc4bb2f1f524707a6c482071f5299da4cec90704dca412238364fe54` |
| `src/tests/registerWork.test.ts` | `926c85ebe2861a1cb9b64c2d34ee932f84275f690f954743917aa75a6b438744` |

Hashes are of each file with exactly one trailing newline.

## 4. Setup

```bash
cd ~/plotarmor-demo
git status                       # someone else may have uncommitted edits; leave them alone
git worktree add ../plotarmor-demo-walletless -b feat/walletless-register feat/saas-ui
cd ../plotarmor-demo-walletless
npm ci
npm install @noble/curves@^1.9.7   # already installed transitively; make it an explicit dependency
```

Edit `tsconfig.json`: add `"allowImportingTsExtensions": true` to `compilerOptions` (Deno requires `.ts`
extensions in relative imports, and the demo's `noEmit: true` makes this legal). Edit `src/env.d.ts`: add
`readonly VITE_WALLETLESS_REGISTER?: string;` to the existing `ImportMetaEnv`.

## 5. Facts and constants

| Item | Value |
|---|---|
| PlotArmor program | `3h9CzV9MJDeD5yjhVhdE6cupuXVRnLW1Cu6P14EJBKv2` |
| Lighthouse program | `L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95` |
| Rent wallet (public) | `HZJTTwQMa6uyfA9AMXMmJKb9UrzxzGTKPAXQ2LKxgFLn` |
| Kora fee payer (public) | `HWfGUebvq9ez4EWZKXoDBiNfH8uQ2q3mpMqpVCHfMdSW` |
| Devnet genesis hash | `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG` |
| Supabase project | `khygvzpnyimrxndlvlje` |
| Kora (Render, free plan, sleeps) | `https://plotarmor-kora-devnet.onrender.com` (config name `KORA_URL`) |
| App arguments | `claim_kind 1`, shares `100/100`, `anchor_mode_arg 1`, `content_kind` 2 for treatment else 1 |
| `register_work_claim` data | 143 bytes: disc `80e030f0a60e774c`, raw_hash 32, content_kind 1, claim_kind 1, total_shares u16 LE, threshold u16 LE, link_nonce 32, anchor_nonce 32, anchor_mode 1, external_ref_hash 32 |
| `add_version` data | 170 bytes: disc `a72a0018536d3df8`, raw_hash 32, content_kind 1, link_nonce 32, anchor_nonce 32, anchor_mode 1, expected_previous_link 32, external_ref_hash 32 |
| `register_work_claim` accounts | registry_config(ro), content_artifact(w), work_claim(w), ownership(w), owner_record(w), claim_artifact_link(w), anchor_record(w), signer = writer(w, signer), system_program(ro) |
| `add_version` accounts | registry_config(ro), work_claim(w), content_artifact(w), claim_artifact_link(w), anchor_record(w), claimant = writer(w, signer), system_program(ro) |
| Account sizes | content 50, work_claim 210, ownership 110, owner_record 75, claim_artifact_link 112, anchor_record 82 |
| Observed rent (devnet) | 904,240 / 1,717,040 / 1,209,040 / 1,031,240 / 1,219,200 / 1,066,800; six together 7,147,560 |
| `add_version` seeds | link `["claim_artifact", work_claim, link_nonce]`, anchor `["anchor", content_artifact, anchor_nonce]` (note: content artifact, not claim) |
| Program facts (read from source) | no instruction closes accounts or returns lamports, so rent is one-way spend; `content_artifact` is `init_if_needed`, so if the file hash was registered before, only five accounts are created |
| Kora policy (`kora.toml`, do not change) | `max_signatures 3`, allowed programs PlotArmor, System, Lighthouse, `require_one_of_programs` PlotArmor, `sign_transaction` only, Lighthouse on |

Existing code you will touch or mirror (line numbers from `feat/saas-ui` on 2026-10-06; re-check):
- `src/vault/UploadFlow.tsx`: `anchorWallet` at 234; vault master key at 356-359; `link_nonce` and
  `anchor_nonce` generated once and saved at 397-435; wallet branch `if (anchorWallet)` at 477 through the
  catch at 604-612; "Connect wallet to sign" card at 1274-1279; `RegistrationResult` shown after.
- `src/vault/RegistrationResult.tsx:43`: "Registration did not complete. Your draft is saved, nothing is lost."
  It has no retry button today.
- `src/VaultApp.tsx:481`: renders `RegistrationResult`.
- `src/vault/queries.ts`: `updateWork` (47), `getAccessToken` (335).
- `src/solana.ts`: `getConnection()` (16-19, uses the public `VITE_HELIUS_API_KEY`).
- `supabase/functions/upload-to-ipfs/index.ts`: JWT, CORS and rate-limit conventions followed here.

## 6. How the pieces fit

```
Browser (vault unlocked)            sponsor-register (Edge Fn)          Kora (Render)      Devnet RPC
 1 ensureWriterKey: generate, encrypt, save, read back, decrypt
 2 insertWork (nonces persisted already by existing code)
 3 {action:"warm"} --------------> GET /liveness (wake) ------------> wakes
 4 {action:"register"|"add_version", work_id, writer_pubkey}
                                    JWT, kill switch, email, erasure
                                    load work row (hash, nonces, cid come from the row)
                                    saved writer key must match
                                    reserve quota (RPC, atomic)
                                    wake Kora, pin fee payer ---------> getPayerSigner
                                    read accounts, rent, balances ------------------------> reads
                                    build tx, unsigned simulate --------------------------> simulates
                                    signTransaction (HMAC) ----------> Kora signs, adds Lighthouse
                                    validate Kora's return
                                    rent wallet signs
 5 <---- base64 tx, signature ----- row marked 'issued'
 6 rebuild the same tx locally, compare (rent wallet signature must verify, writer slot empty)
 7 writer signs
 8 sendRawTransaction, rebroadcast same bytes, poll -------------------------------------------> lands
 9 read back the claim account; updateWork(confirmed patch)
```

### 6.1 Kora response check (what `validateKoraReturn` enforces)

Used by the server on Kora's reply and by the browser on the server's reply. First failure throws
`SponsorCheckError` with the check name. Everything below must hold:

| Check name | Rule |
|---|---|
| `bad_size`, `decode`, `versioned_message` | non-empty, at most 1232 bytes, decodes as a legacy transaction (a version flag in the message is rejected) |
| `blockhash_changed` | same recent blockhash as the transaction that was built |
| `fee_payer_changed` | fee payer equals the pinned Kora address |
| `instruction_count` | exactly 3 instructions |
| `transfer_changed`, `registration_changed` | instructions 0 and 1 identical to what was built (program, data bytes, every account with writable and signer flags) |
| `third_instruction_not_lighthouse`, `lighthouse_shape` | instruction 2 is Lighthouse with one account (the fee payer), 12 data bytes, prefix `05 00 00`, last byte `04` |
| `transfer_source`, `transfer_destination`, `transfer_out_of_range` | decoded System transfer: from the pinned rent wallet, to the writer, 1 to 8,000,000 lamports |
| `message_changed` | the returned message equals the built message with only that Lighthouse instruction appended |
| `rent_wallet_misused`, `writer_misused`, `writer_not_signer` | the rent wallet appears only as the transfer source; the writer is never in the Lighthouse instruction and signs the PlotArmor instruction |
| `signer_set`, `kora_not_first` | signer set is exactly {Kora, rent wallet, writer}; Kora is slot 0 |
| `kora_signature_missing`, `kora_signature_invalid` | Kora's Ed25519 signature over the message verifies |
| `unexpected_signature`, `rent_wallet_signature_missing`, `rent_wallet_signature_invalid` | server side: no other signature is present; browser side (`rentWalletSigned: true`): the rent wallet signature is present and verifies; the writer slot is empty in both |

The semantic meaning of the Lighthouse bytes ("fee payer balance assertion") is inferred from the byte
shape that the live-tested script checks; it was not decoded against Lighthouse source.

### 6.2 HMAC and auth headers (Kora)

JSON-RPC 2.0 `POST` to `KORA_URL` with body `{"jsonrpc":"2.0","id":N,"method":M,"params":P}` serialized once;
the same string is signed and sent. Headers: `x-api-key: <KORA_API_KEY>`, `x-timestamp: <unix seconds as a
string>`, `x-hmac-signature: <lowercase hex of HMAC-SHA256 keyed with KORA_HMAC_SECRET over timestamp
immediately followed by body>`. Kora allows a 300 second timestamp window. `redirect: "error"` and a
timeout on every call. Methods used: `getPayerSigner` (params `{}`, result `signer_address`),
`getBlockhash` (params `{}`, result `blockhash`), `signTransaction` (params `{transaction, signer_key,
sig_verify: false, user_id}`, result `signed_transaction` and `signer_pubkey`). `GET /liveness` is
unauthenticated and wakes a sleeping Kora (Render free plan; observed once at about 13.7 seconds, Render
documents about a minute). This is implemented in `_shared/kora.ts`, which is the reference.

## 7. Reference code

Create these files exactly. They are the tested reference.

#### `supabase/functions/_shared/sponsorTx.ts`

````ts
// Shared by the Edge Function (Deno) and the browser (Vite). Pure: no network, no secrets.
// Builds the sponsored transaction and checks what Kora returns. Devnet only.
import { Buffer } from "buffer";
import { PublicKey, SystemInstruction, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import { ed25519 } from "@noble/curves/ed25519";

export const PROGRAM_ID = "3h9CzV9MJDeD5yjhVhdE6cupuXVRnLW1Cu6P14EJBKv2";
export const SYSTEM_PROGRAM_ID = "11111111111111111111111111111111";
export const LIGHTHOUSE_PROGRAM_ID = "L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95";
// Public addresses. The browser pins these; the Edge Function pins the same values from config.
export const RENT_WALLET_ADDRESS = "HZJTTwQMa6uyfA9AMXMmJKb9UrzxzGTKPAXQ2LKxgFLn";
export const KORA_FEE_PAYER_ADDRESS = "HWfGUebvq9ez4EWZKXoDBiNfH8uQ2q3mpMqpVCHfMdSW";
export const DEVNET_GENESIS_HASH = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
export const MAX_RENT_LAMPORTS = 8_000_000;
export const MAX_TRANSACTION_BYTES = 1232;

// Arguments the app sends today (UploadFlow.tsx): Original claim, 100/100 shares, AttestedDevnet.
export const APP_ARGS = { claimKind: 1, totalShares: 100, thresholdShares: 100, anchorMode: 1 } as const;

// Account sizes including the 8 byte discriminator (program state.rs LEN constants).
export const ACCOUNT_SIZES = {
  content_artifact: 50,
  work_claim: 210,
  ownership: 110,
  owner_record: 75,
  claim_artifact_link: 112,
  anchor_record: 82,
} as const;
export type RecordName = keyof typeof ACCOUNT_SIZES;

const REGISTER_DISCRIMINATOR = [128, 224, 48, 240, 166, 14, 119, 76];
const ADD_VERSION_DISCRIMINATOR = [167, 42, 0, 24, 83, 109, 61, 248];

export class SponsorCheckError extends Error {
  check: string;
  constructor(check: string, detail = "") {
    super(detail ? `${check}: ${detail}` : check);
    this.name = "SponsorCheckError";
    this.check = check;
  }
}
const fail = (check: string, detail = ""): never => {
  throw new SponsorCheckError(check, detail);
};

// ---------- encoding helpers ----------

export function hexToBytes(hex: string, length: number): Uint8Array {
  if (typeof hex !== "string" || !new RegExp(`^[0-9a-fA-F]{${length * 2}}$`).test(hex)) {
    fail("bad_hex", `expected ${length} bytes as hex`);
  }
  return Uint8Array.from(Buffer.from(hex, "hex"));
}

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function base58Decode(text: string): Uint8Array {
  let n = 0n;
  for (const c of text) {
    const i = B58.indexOf(c);
    if (i < 0) fail("bad_base58", "invalid character");
    n = n * 58n + BigInt(i);
  }
  const out: number[] = [];
  while (n > 0n) {
    out.push(Number(n & 0xffn));
    n >>= 8n;
  }
  for (const c of text) {
    if (c !== "1") break;
    out.push(0);
  }
  return Uint8Array.from(out.reverse());
}

export function base58Encode(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = "";
  while (n > 0n) {
    out = B58[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = "1" + out;
  }
  return out;
}

// The 32 byte sha2-256 digest inside a CIDv0 (same rule as src/vault/ipfs.ts).
export function cidToExternalRefHash(cid: string): Uint8Array {
  if (typeof cid !== "string" || cid.length !== 46 || !cid.startsWith("Qm")) fail("bad_cid", "not a CIDv0");
  const bytes = base58Decode(cid);
  if (bytes.length !== 34 || bytes[0] !== 0x12 || bytes[1] !== 0x20) fail("bad_cid", "unexpected multihash");
  return bytes.slice(2);
}

// Same mapping as UploadFlow.tsx contentKindForWorkType: treatment is 2, everything else 1.
export const contentKindForWorkType = (workType: string): number => (workType === "treatment" ? 2 : 1);

const concat = (...parts: Uint8Array[]): Uint8Array => Uint8Array.from(parts.flatMap((p) => Array.from(p)));
const u16le = (n: number): Uint8Array => Uint8Array.from([n & 0xff, (n >> 8) & 0xff]);
const text = (s: string): Uint8Array => new TextEncoder().encode(s);

// ---------- operations ----------

export type Op = {
  op: "register" | "add_version";
  rawHash: Uint8Array;
  contentKind: number;
  linkNonce: Uint8Array;
  anchorNonce: Uint8Array;
  externalRefHash: Uint8Array;
  // add_version only: the work claim account and the lineage head the client read on chain.
  workClaim?: string;
  expectedPreviousLink?: string;
};

const program = () => new PublicKey(PROGRAM_ID);
const pda = (...seeds: Uint8Array[]) => PublicKey.findProgramAddressSync(seeds, program())[0];

export function deriveAccounts(op: Op, writer: string): Record<string, string> {
  const w = new PublicKey(writer);
  const registry = pda(text("config"));
  const content = pda(text("content"), op.rawHash);
  if (op.op === "register") {
    const claim = pda(text("claim"), content.toBytes(), w.toBytes());
    const ownership = pda(text("ownership"), claim.toBytes());
    const owner = pda(text("owner"), ownership.toBytes(), w.toBytes());
    const link = pda(text("claim_artifact"), claim.toBytes(), op.linkNonce);
    const anchor = pda(text("anchor"), claim.toBytes(), op.anchorNonce);
    return {
      registry_config: registry.toBase58(), content_artifact: content.toBase58(), work_claim: claim.toBase58(),
      ownership: ownership.toBase58(), owner_record: owner.toBase58(),
      claim_artifact_link: link.toBase58(), anchor_record: anchor.toBase58(),
    };
  }
  if (!op.workClaim) fail("missing_work_claim");
  const claim = new PublicKey(op.workClaim as string);
  const link = pda(text("claim_artifact"), claim.toBytes(), op.linkNonce);
  // add_version derives the anchor from the content artifact, not the claim.
  const anchor = pda(text("anchor"), content.toBytes(), op.anchorNonce);
  return {
    registry_config: registry.toBase58(), content_artifact: content.toBase58(), work_claim: claim.toBase58(),
    claim_artifact_link: link.toBase58(), anchor_record: anchor.toBase58(),
  };
}

export function encodeData(op: Op): Uint8Array {
  const a = APP_ARGS;
  if (op.op === "register") {
    return concat(
      Uint8Array.from(REGISTER_DISCRIMINATOR), op.rawHash, Uint8Array.from([op.contentKind, a.claimKind]),
      u16le(a.totalShares), u16le(a.thresholdShares), op.linkNonce, op.anchorNonce,
      Uint8Array.from([a.anchorMode]), op.externalRefHash,
    );
  }
  if (!op.expectedPreviousLink) fail("missing_expected_previous_link");
  return concat(
    Uint8Array.from(ADD_VERSION_DISCRIMINATOR), op.rawHash, Uint8Array.from([op.contentKind]),
    op.linkNonce, op.anchorNonce, Uint8Array.from([a.anchorMode]),
    new PublicKey(op.expectedPreviousLink as string).toBytes(), op.externalRefHash,
  );
}

export function buildProgramInstruction(op: Op, writer: string): TransactionInstruction {
  const acc = deriveAccounts(op, writer);
  const k = (name: string, isWritable: boolean) => ({ pubkey: new PublicKey(acc[name]), isWritable, isSigner: false });
  const signer = { pubkey: new PublicKey(writer), isWritable: true, isSigner: true };
  const system = { pubkey: new PublicKey(SYSTEM_PROGRAM_ID), isWritable: false, isSigner: false };
  const keys =
    op.op === "register"
      ? [k("registry_config", false), k("content_artifact", true), k("work_claim", true), k("ownership", true),
         k("owner_record", true), k("claim_artifact_link", true), k("anchor_record", true), signer, system]
      : [k("registry_config", false), k("work_claim", true), k("content_artifact", true),
         k("claim_artifact_link", true), k("anchor_record", true), signer, system];
  return new TransactionInstruction({ programId: program(), keys, data: Buffer.from(encodeData(op)) });
}

// Accounts the operation creates. Only content_artifact may already exist (init_if_needed).
export function createdRecordNames(op: Op): RecordName[] {
  return op.op === "register"
    ? ["content_artifact", "work_claim", "ownership", "owner_record", "claim_artifact_link", "anchor_record"]
    : ["content_artifact", "claim_artifact_link", "anchor_record"];
}

export function missingRecordNames(op: Op, exists: Record<string, boolean>): RecordName[] {
  const missing: RecordName[] = [];
  for (const name of createdRecordNames(op)) {
    if (exists[name]) {
      if (name !== "content_artifact") fail("record_exists", name);
    } else {
      missing.push(name);
    }
  }
  return missing;
}

// Rent for exactly the accounts that will be created. `rentByName` must cover exactly those names.
export function sumRent(missing: RecordName[], rentByName: Record<string, number>): number {
  assertSameKeys(Object.keys(rentByName), missing);
  let total = 0;
  for (const name of missing) {
    const v = rentByName[name];
    if (!Number.isSafeInteger(v) || v <= 0) fail("bad_rent", `${name}=${v}`);
    total += v;
  }
  if (total > MAX_RENT_LAMPORTS) fail("rent_over_cap", `${total}`);
  return total;
}
function assertSameKeys(a: string[], b: string[]) {
  if (JSON.stringify([...a].sort()) !== JSON.stringify([...b].sort())) fail("rent_quote_mismatch");
}

// ---------- building ----------

export function buildSponsoredTransaction(p: {
  payer: string; rentWallet: string; writer: string; blockhash: string; lamports: number; op: Op;
}): { wire: Buffer; records: Record<string, string> } {
  if (!Number.isSafeInteger(p.lamports) || p.lamports <= 0 || p.lamports > MAX_RENT_LAMPORTS) fail("transfer_out_of_range");
  if (new Set([p.payer, p.rentWallet, p.writer]).size !== 3) fail("keys_not_distinct");
  if (!p.blockhash) fail("missing_blockhash");
  const tx = new Transaction({ feePayer: new PublicKey(p.payer), recentBlockhash: p.blockhash })
    .add(SystemProgram.transfer({ fromPubkey: new PublicKey(p.rentWallet), toPubkey: new PublicKey(p.writer), lamports: p.lamports }))
    .add(buildProgramInstruction(p.op, p.writer));
  const wire = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
  return { wire, records: deriveAccounts(p.op, p.writer) };
}

// ---------- checking what Kora returned ----------

const describe = (ix: TransactionInstruction) =>
  JSON.stringify({ p: ix.programId.toBase58(), d: Buffer.from(ix.data).toString("hex"),
    k: ix.keys.map((x) => [x.pubkey.toBase58(), x.isWritable, x.isSigner]) });

// Reads the compact-u16 signature count, then reports whether the message is versioned (0x80 flag).
function isVersionedMessage(bytes: Uint8Array): boolean {
  let count = 0, shift = 0, i = 0;
  for (;;) {
    if (i >= bytes.length) return false;
    const b = bytes[i++];
    count |= (b & 0x7f) << shift;
    if ((b & 0x80) === 0) break;
    shift += 7;
  }
  const first = bytes[i + count * 64];
  return first !== undefined && (first & 0x80) !== 0;
}

export function verifySlot(tx: Transaction, address: string): boolean {
  const slot = tx.signatures.find((s) => s.publicKey.toBase58() === address);
  if (!slot || !slot.signature) return false;
  return ed25519.verify(Uint8Array.from(slot.signature), Uint8Array.from(tx.serializeMessage()), new PublicKey(address).toBytes());
}

// `original` is the transaction as built by buildSponsoredTransaction. The server passes the bytes it
// sent to Kora. The browser rebuilds the same bytes from its own inputs, the returned blockhash and the
// returned lamports. Throws SponsorCheckError naming the first failed check.
// `rentWalletSigned` is false on the server (Kora's return carries only Kora's signature) and true in the
// browser (the server has added the rent wallet signature, which must then verify). The writer slot must
// be empty in both cases.
export function validateKoraReturn(p: {
  original: Uint8Array; returnedBase64: string; payer: string; rentWallet: string; writer: string; rentWalletSigned?: boolean;
}): { transaction: Transaction; lighthouseMinimumLamports: bigint } {
  if (typeof p.returnedBase64 !== "string") fail("missing_transaction");
  const returned = Buffer.from(p.returnedBase64, "base64");
  if (returned.length === 0 || returned.length > MAX_TRANSACTION_BYTES) fail("bad_size", `${returned.length} bytes`);
  if (isVersionedMessage(returned)) fail("versioned_message");
  let after: Transaction, before: Transaction;
  try {
    before = Transaction.from(Buffer.from(p.original));
    after = Transaction.from(returned);
  } catch {
    return fail("decode");
  }
  if (after.recentBlockhash !== before.recentBlockhash) fail("blockhash_changed");
  if (after.feePayer?.toBase58() !== p.payer) fail("fee_payer_changed");
  if (after.instructions.length !== 3) fail("instruction_count", `${after.instructions.length}`);
  const [transfer, registration, lighthouse] = after.instructions;
  if (describe(transfer) !== describe(before.instructions[0])) fail("transfer_changed");
  if (describe(registration) !== describe(before.instructions[1])) fail("registration_changed");
  if (transfer.programId.toBase58() !== SYSTEM_PROGRAM_ID) fail("transfer_program");
  if (registration.programId.toBase58() !== PROGRAM_ID) fail("registration_program");
  if (lighthouse.programId.toBase58() !== LIGHTHOUSE_PROGRAM_ID) fail("third_instruction_not_lighthouse");

  let decoded;
  try { decoded = SystemInstruction.decodeTransfer(transfer); } catch { return fail("transfer_decode"); }
  if (decoded.fromPubkey.toBase58() !== p.rentWallet) fail("transfer_source");
  if (decoded.toPubkey.toBase58() !== p.writer) fail("transfer_destination");
  if (decoded.lamports <= 0n || decoded.lamports > BigInt(MAX_RENT_LAMPORTS)) fail("transfer_out_of_range");

  // Lighthouse shape: one account (the fee payer), 12 data bytes, prefix 05 00 00, last byte 04.
  const d = Buffer.from(lighthouse.data);
  const shapeOk = lighthouse.keys.length === 1 && lighthouse.keys[0].pubkey.toBase58() === p.payer
    && d.length === 12 && d[0] === 5 && d[1] === 0 && d[2] === 0 && d[11] === 4;
  if (!shapeOk) fail("lighthouse_shape");

  // The only change allowed is that one appended instruction.
  const expected = Transaction.from(Buffer.from(p.original)).add(lighthouse);
  if (!expected.serializeMessage().equals(after.serializeMessage())) fail("message_changed");

  // Who appears where.
  const mention = (ix: TransactionInstruction, addr: string) => ix.keys.some((k) => k.pubkey.toBase58() === addr);
  if (mention(registration, p.rentWallet) || mention(lighthouse, p.rentWallet)) fail("rent_wallet_misused");
  if (mention(lighthouse, p.writer)) fail("writer_misused");
  if (!registration.keys.some((k) => k.isSigner && k.pubkey.toBase58() === p.writer)) fail("writer_not_signer");

  const signers = after.signatures.map((s) => s.publicKey.toBase58());
  if (JSON.stringify([...signers].sort()) !== JSON.stringify([p.payer, p.rentWallet, p.writer].sort())) fail("signer_set");
  if (signers[0] !== p.payer) fail("kora_not_first");
  if (!after.signatures[0].signature) fail("kora_signature_missing");
  for (const s of after.signatures.slice(1)) {
    const address = s.publicKey.toBase58();
    const mayBeSigned = p.rentWalletSigned === true && address === p.rentWallet;
    if (s.signature !== null && !mayBeSigned) fail("unexpected_signature");
    if (s.signature === null && address === p.rentWallet && p.rentWalletSigned === true) fail("rent_wallet_signature_missing");
  }
  if (!verifySlot(after, p.payer)) fail("kora_signature_invalid");
  if (p.rentWalletSigned === true && !verifySlot(after, p.rentWallet)) fail("rent_wallet_signature_invalid");
  return { transaction: after, lighthouseMinimumLamports: d.readBigUInt64LE(3) };
}

// Adds signatures to a validated transaction and confirms the message did not move.
export function cosign(tx: Transaction, signers: { publicKey: PublicKey; secretKey: Uint8Array }[]): Transaction {
  const before = tx.serializeMessage();
  tx.partialSign(...signers);
  if (!before.equals(tx.serializeMessage())) fail("message_changed_while_signing");
  for (const s of signers) if (!verifySlot(tx, s.publicKey.toBase58())) fail("own_signature_invalid");
  return tx;
}

export const wireOf = (tx: Transaction): Buffer => tx.serialize({ requireAllSignatures: false, verifySignatures: false });
export const signatureOf = (tx: Transaction): string => {
  const s = tx.signatures[0]?.signature;
  if (!s) return fail("kora_signature_missing");
  return base58Encode(Uint8Array.from(s as Uint8Array));
};

// WorkClaim layout after the 8 byte discriminator: root_artifact, latest_artifact, latest_link,
// claimant, ownership (32 bytes each), created_at i64, claim_kind u8, discoverability u8, superseded_by.
export function parseWorkClaim(data: Uint8Array): { latestLink: string; claimant: string; supersededBy: string } {
  if (data.length < ACCOUNT_SIZES.work_claim) fail("work_claim_short", `${data.length}`);
  const at = (o: number) => new PublicKey(data.slice(o, o + 32)).toBase58();
  return { latestLink: at(72), claimant: at(104), supersededBy: at(178) };
}
````

#### `supabase/functions/_shared/kora.ts`

````ts
// Kora JSON-RPC client for the Edge Function. Holds the API key and HMAC secret only in memory.
// Never log headers, bodies or secrets.

export async function hmacHex(secret: string, timestamp: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(timestamp + body));
  return Array.from(new Uint8Array(mac), (b) => b.toString(16).padStart(2, "0")).join("");
}

export class KoraError extends Error {
  kind: "unavailable" | "rejected" | "invalid";
  constructor(kind: "unavailable" | "rejected" | "invalid", message: string) {
    super(message);
    this.name = "KoraError";
    this.kind = kind;
  }
}

export interface KoraConfig {
  url: string;
  apiKey: string;
  hmacSecret: string;
  fetchFn?: typeof fetch;
  nowMs?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

// Wake policy (spec section 9): 10 s per attempt, waits of 2, 3, 5, 5, ... seconds, 75 s in total.
export const WAKE_ATTEMPT_TIMEOUT_MS = 10_000;
export const WAKE_BUDGET_MS = 75_000;
export const WAKE_WAITS_MS = [2_000, 3_000, 5_000];
export const RPC_TIMEOUT_MS = 20_000;

export function createKora(cfg: KoraConfig) {
  const fetchFn = cfg.fetchFn ?? fetch;
  const nowMs = cfg.nowMs ?? (() => Date.now());
  const sleep = cfg.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const base = cfg.url.replace(/\/+$/, "");
  let id = 0;

  // GET /liveness is unauthenticated. Retries on timeouts, connection errors and 502/503/504.
  async function wake(): Promise<{ attempts: number; ms: number }> {
    const start = nowMs();
    let attempts = 0;
    for (;;) {
      attempts++;
      try {
        const res = await fetchFn(`${base}/liveness`, { method: "GET", redirect: "error", signal: AbortSignal.timeout(WAKE_ATTEMPT_TIMEOUT_MS) });
        if (res.ok) return { attempts, ms: nowMs() - start };
        if (![502, 503, 504].includes(res.status)) throw new KoraError("unavailable", `liveness HTTP ${res.status}`);
      } catch (e) {
        if (e instanceof KoraError) throw e;
      }
      const wait = WAKE_WAITS_MS[Math.min(attempts - 1, WAKE_WAITS_MS.length - 1)];
      if (nowMs() - start + wait >= WAKE_BUDGET_MS) throw new KoraError("unavailable", "Kora did not wake within the budget");
      await sleep(wait);
    }
  }

  async function once(method: string, params: unknown): Promise<unknown> {
    const body = JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params });
    const timestamp = String(Math.floor(nowMs() / 1000));
    const headers = {
      "content-type": "application/json",
      "x-api-key": cfg.apiKey,
      "x-timestamp": timestamp,
      "x-hmac-signature": await hmacHex(cfg.hmacSecret, timestamp, body),
    };
    let res: Response;
    try {
      res = await fetchFn(base, { method: "POST", headers, body, redirect: "error", signal: AbortSignal.timeout(RPC_TIMEOUT_MS) });
    } catch {
      throw new KoraError("unavailable", `${method}: network error or timeout`);
    }
    const raw = await res.text();
    if (res.status >= 500) throw new KoraError("unavailable", `${method}: HTTP ${res.status}`);
    let parsed: { id?: number; result?: unknown; error?: unknown };
    try { parsed = JSON.parse(raw); } catch { throw new KoraError("invalid", `${method}: HTTP ${res.status}, non-JSON body`); }
    if (!res.ok || parsed.error) throw new KoraError("rejected", `${method}: HTTP ${res.status}`);
    if (parsed.id !== id || parsed.result === undefined) throw new KoraError("invalid", `${method}: bad JSON-RPC envelope`);
    return parsed.result;
  }

  // One retry, only for network errors and 5xx. Policy rejections are never retried.
  async function rpc(method: string, params: unknown, retry = true): Promise<unknown> {
    try {
      return await once(method, params);
    } catch (e) {
      if (retry && e instanceof KoraError && e.kind === "unavailable") return await once(method, params);
      throw e;
    }
  }

  return {
    wake,
    async getPayerSigner(): Promise<string> {
      const r = (await rpc("getPayerSigner", {})) as { signer_address?: string };
      if (typeof r?.signer_address !== "string") throw new KoraError("invalid", "getPayerSigner: missing signer_address");
      return r.signer_address;
    },
    async getBlockhash(): Promise<string> {
      const r = (await rpc("getBlockhash", {})) as { blockhash?: string };
      if (typeof r?.blockhash !== "string") throw new KoraError("invalid", "getBlockhash: missing blockhash");
      return r.blockhash;
    },
    async signTransaction(transactionBase64: string, signerKey: string, userId: string): Promise<{ signed_transaction: string; signer_pubkey: string }> {
      const r = (await rpc("signTransaction", { transaction: transactionBase64, signer_key: signerKey, sig_verify: false, user_id: userId })) as
        { signed_transaction?: string; signer_pubkey?: string };
      if (typeof r?.signed_transaction !== "string" || typeof r?.signer_pubkey !== "string") throw new KoraError("invalid", "signTransaction: missing fields");
      return { signed_transaction: r.signed_transaction, signer_pubkey: r.signer_pubkey };
    },
  };
}
export type Kora = ReturnType<typeof createKora>;
````

#### `supabase/functions/sponsor-register/handle.ts`

````ts
// Request handler for sponsor-register. No Deno globals and no direct network access: everything
// external arrives through `deps`, so vitest can drive it with fakes. index.ts wires the real clients.
import { Buffer } from "buffer";
import { PublicKey, type Keypair, type Transaction } from "@solana/web3.js";
import {
  ACCOUNT_SIZES, DEVNET_GENESIS_HASH, MAX_RENT_LAMPORTS, PROGRAM_ID, SponsorCheckError,
  buildSponsoredTransaction, cidToExternalRefHash, contentKindForWorkType, cosign, deriveAccounts,
  hexToBytes, missingRecordNames, parseWorkClaim, signatureOf, sumRent, validateKoraReturn, wireOf,
  type Op, type RecordName,
} from "../_shared/sponsorTx.ts";
import { KoraError, type Kora } from "../_shared/kora.ts";

export const ALLOWED_ORIGINS = ["https://plotarmor-demo.vercel.app", "https://plotarmor.io", "http://localhost:5173"];
export const MAX_BODY_BYTES = 4096;
export const DEFAULT_LIMITS = { userHour: 5, userDay: 20, globalDay: 200 };
export const DEADLINE_MS = 110_000;
export const ISSUED_STALE_MS = 90_000;

const ERRORS = {
  unauthenticated: [401, false, 0], invalid_request: [400, false, 0], work_not_found: [404, false, 0],
  work_not_eligible: [409, false, 0], writer_key_not_saved: [409, false, 0], writer_balance_unexpected: [409, false, 0],
  erasure_in_progress: [409, false, 0], registration_in_progress: [409, true, 15], rate_limited: [429, true, 600],
  quota_exceeded: [429, true, 3600], global_quota_exceeded: [429, true, 3600], sponsorship_paused: [503, true, 3600],
  kora_unavailable: [503, true, 30], kora_rejected: [502, true, 0], kora_response_invalid: [502, true, 0],
  solana_rpc_unavailable: [503, true, 15], internal: [500, true, 0],
} as const;
export type ErrorCode = keyof typeof ERRORS;

export class ApiError extends Error {
  code: ErrorCode;
  constructor(code: ErrorCode, message: string = code) {
    super(message);
    this.name = "ApiError";
    this.code = code;
  }
}

export interface WorkRow {
  id: string; user_id: string; content_hash: string | null; link_nonce: string | null; anchor_nonce: string | null;
  ipfs_cid: string | null; work_type: string | null; parent_work_id: string | null;
  anchor_state: string | null; work_claim_pda: string | null;
}
export interface Deps {
  nowMs(): number;
  env: { enabled: boolean; koraFeePayer: string; rentWallet: string; minReserveLamports: number; limits?: typeof DEFAULT_LIMITS };
  rentSigner: Keypair; // loaded from the secret in index.ts; its public key is checked against env.rentWallet
  kora: Kora;
  authenticate(req: Request): Promise<{ id: string; emailConfirmed: boolean } | null>;
  db: {
    isErasureBlocking(userId: string): Promise<boolean>;
    getWork(userId: string, workId: string): Promise<{ work: WorkRow; root: WorkRow | null } | null>;
    getWriterPubkey(userId: string): Promise<string | null>;
    sweepIssued(userId: string): Promise<void>;
    reserve(p: { userId: string; workId: string; writer: string; kind: string }): Promise<{ allowed: boolean; reason?: string; id?: string }>;
    outstandingRentLamports(): Promise<number>;
    markIssued(id: string, f: { signature: string; messageSha256: string; blockhash: string; rentLamports: number }): Promise<void>;
    markLanded(id: string): Promise<void>;
    markFailed(id: string, errorCode: string): Promise<void>;
    lastSignatureForWork(workId: string): Promise<string | null>;
  };
  chain: {
    genesisHash(): Promise<string>;
    accounts(addresses: string[]): Promise<({ owner: string; data: Uint8Array } | null)[]>;
    balance(address: string): Promise<number>;
    minimumRent(size: number): Promise<number>;
    simulate(wireBase64: string): Promise<{ err: unknown }>;
  };
  sha256Hex(bytes: Uint8Array): Promise<string>;
  log(line: Record<string, unknown>): void;
}

function cors(req: Request) {
  const origin = req.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    Vary: "Origin",
  };
}
const json = (req: Request, status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors(req), "Content-Type": "application/json" } });
const errorResponse = (req: Request, code: ErrorCode, message: string) => {
  const [status, retryable, after] = ERRORS[code];
  return json(req, status, { error: { code, message, retryable, ...(after ? { retry_after_seconds: after } : {}) } });
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OK_STATES = new Set(["none", "submitted", "failed"]);

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return json(req, 405, { error: { code: "invalid_request", message: "Method not allowed", retryable: false } });
  const requestId = crypto.randomUUID();
  const started = deps.nowMs();
  const log = (line: Record<string, unknown>) => deps.log({ request_id: requestId, total_ms: deps.nowMs() - started, ...line });
  let reservationId: string | null = null;
  let userId: string | null = null;
  try {
    const user = await deps.authenticate(req);
    if (!user) throw new ApiError("unauthenticated");
    userId = user.id;
    const raw = await req.text();
    if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) throw new ApiError("invalid_request", "body too large");
    let body: { action?: unknown; work_id?: unknown; writer_pubkey?: unknown };
    try { body = JSON.parse(raw); } catch { throw new ApiError("invalid_request", "invalid JSON"); }

    if (body.action === "warm") {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const ready = await Promise.race([
        deps.kora.wake().then(() => true, () => false),
        new Promise<boolean>((r) => { timer = setTimeout(() => r(false), 8000); }),
      ]);
      clearTimeout(timer);
      log({ event: "warm", user_id: user.id, outcome: ready ? "ready" : "waking" });
      return json(req, 200, { status: ready ? "ready" : "waking" });
    }
    if (body.action !== "register" && body.action !== "add_version") throw new ApiError("invalid_request", "unknown action");
    const action = body.action as "register" | "add_version";

    // 1. Kill switch, confirmed email, erasure.
    if (!deps.env.enabled) throw new ApiError("sponsorship_paused", "disabled");
    if (!user.emailConfirmed) throw new ApiError("unauthenticated", "email not confirmed");
    if (await deps.db.isErasureBlocking(user.id)) throw new ApiError("erasure_in_progress");

    // 2. Input. Only work_id and writer_pubkey come from the caller.
    if (typeof body.work_id !== "string" || !UUID.test(body.work_id)) throw new ApiError("invalid_request", "work_id");
    const writer = typeof body.writer_pubkey === "string" ? body.writer_pubkey : "";
    try {
      if (!PublicKey.isOnCurve(new PublicKey(writer).toBytes())) throw new Error("off curve");
    } catch { throw new ApiError("invalid_request", "writer_pubkey"); }
    if (writer === deps.env.koraFeePayer || writer === deps.env.rentWallet) throw new ApiError("invalid_request", "writer_pubkey");
    if (deps.rentSigner.publicKey.toBase58() !== deps.env.rentWallet) {
      log({ event: action, user_id: user.id, outcome: "rent_wallet_mismatch" });
      throw new ApiError("internal", "rent wallet configuration");
    }
    const workId = body.work_id;

    // 3. The work row. Hash, nonces, CID and kind come from here, never from the request.
    const found = await deps.db.getWork(user.id, workId);
    if (!found || found.work.user_id !== user.id) throw new ApiError("work_not_found");
    const { work, root } = found;
    if (!OK_STATES.has(work.anchor_state ?? "none") || work.work_claim_pda) throw new ApiError("work_not_eligible", "anchor_state");
    let op: Op;
    try {
      op = {
        op: action,
        rawHash: hexToBytes(work.content_hash ?? "", 32),
        contentKind: contentKindForWorkType(work.work_type ?? ""),
        linkNonce: hexToBytes(work.link_nonce ?? "", 32),
        anchorNonce: hexToBytes(work.anchor_nonce ?? "", 32),
        externalRefHash: cidToExternalRefHash(work.ipfs_cid ?? ""),
      };
    } catch { throw new ApiError("work_not_eligible", "stored work fields"); }
    if (action === "register") {
      if (work.parent_work_id) throw new ApiError("work_not_eligible", "not a root work");
    } else {
      if (!work.parent_work_id || !root || root.user_id !== user.id || !root.work_claim_pda) throw new ApiError("work_not_eligible", "root work not registered");
      op.workClaim = root.work_claim_pda;
    }

    // 4. The saved writer key.
    if ((await deps.db.getWriterPubkey(user.id)) !== writer) throw new ApiError("writer_key_not_saved");

    // 5. Reconcile this user's stale issued rows, then 6. reserve quota atomically.
    await deps.db.sweepIssued(user.id);
    const reserved = await deps.db.reserve({ userId: user.id, workId, writer, kind: action });
    if (!reserved.allowed) {
      const reason = reserved.reason as ErrorCode;
      if (reason === "registration_in_progress" || reason === "rate_limited" || reason === "quota_exceeded" || reason === "global_quota_exceeded") throw new ApiError(reason);
      throw new ApiError("internal", "reserve");
    }
    reservationId = reserved.id ?? null;
    if (!reservationId) throw new ApiError("internal", "reserve id");

    // 7. Wake Kora and pin the fee payer.
    const woke = await deps.kora.wake().catch(mapKora);
    const payer = await deps.kora.getPayerSigner().catch(mapKora);
    if (payer !== deps.env.koraFeePayer) throw new ApiError("kora_response_invalid", "fee payer pin");

    // 8. Devnet state.
    const chain = await guardChain(async () => {
      if ((await deps.chain.genesisHash()) !== DEVNET_GENESIS_HASH) throw new ApiError("internal", "not devnet");
      const acc = deriveAccounts(op, writer);
      const names = Object.keys(acc).filter((n) => n !== "registry_config");
      const states = await deps.chain.accounts([...names.map((n) => acc[n]), writer]);
      const exists: Record<string, boolean> = {};
      names.forEach((n, i) => { exists[n] = states[i] !== null; });
      return { acc, exists, claimState: states[names.indexOf("work_claim")], writerBalance: await deps.chain.balance(writer) };
    });
    const { acc, exists } = chain;

    if (action === "register") {
      if (exists.work_claim && exists.owner_record) {
        await deps.db.markLanded(reservationId);
        log({ event: action, user_id: user.id, work_id: workId, outcome: "already_registered" });
        return json(req, 200, { status: "already_registered", records: acc, signature: await deps.db.lastSignatureForWork(workId) });
      }
    } else {
      if (exists.claim_artifact_link) {
        await deps.db.markLanded(reservationId);
        log({ event: action, user_id: user.id, work_id: workId, outcome: "already_registered" });
        return json(req, 200, { status: "already_registered", records: acc, signature: await deps.db.lastSignatureForWork(workId) });
      }
      const state = chain.claimState;
      if (!state || state.owner !== PROGRAM_ID) throw new ApiError("work_not_eligible", "claim account");
      const claim = parseWorkClaim(state.data);
      if (claim.claimant !== writer || claim.supersededBy !== "11111111111111111111111111111111") throw new ApiError("work_not_eligible", "claim authority");
      op.expectedPreviousLink = claim.latestLink;
    }
    let missing: RecordName[];
    try { missing = missingRecordNames(op, exists); } catch { throw new ApiError("work_not_eligible", "partial records exist"); }
    const rentByName: Record<string, number> = {};
    await guardChain(async () => { for (const n of missing) rentByName[n] = await deps.chain.minimumRent(ACCOUNT_SIZES[n]); });
    let rentNeeded: number;
    try { rentNeeded = sumRent(missing, rentByName); } catch { throw new ApiError("work_not_eligible", "rent quote"); }
    if (chain.writerBalance >= rentNeeded) throw new ApiError("writer_balance_unexpected");
    const lamports = rentNeeded - chain.writerBalance;
    if (lamports > MAX_RENT_LAMPORTS) throw new ApiError("work_not_eligible", "rent over cap");
    const [rentBalance, outstanding] = await Promise.all([guardChain(() => deps.chain.balance(deps.env.rentWallet)), deps.db.outstandingRentLamports()]);
    if (rentBalance - lamports - outstanding < deps.env.minReserveLamports) {
      log({ event: action, user_id: user.id, outcome: "reserve_low", rent_wallet_balance: rentBalance });
      throw new ApiError("sponsorship_paused", "reserve");
    }

    // 9, 10. Build and preflight (unsigned).
    const blockhash = await deps.kora.getBlockhash().catch(mapKora);
    const built = buildSponsoredTransaction({ payer, rentWallet: deps.env.rentWallet, writer, blockhash, lamports, op });
    const sim = await guardChain(() => deps.chain.simulate(Buffer.from(built.wire).toString("base64")));
    if (sim.err !== null) {
      log({ event: action, user_id: user.id, work_id: workId, outcome: "preflight_failed", error: JSON.stringify(sim.err) });
      throw new ApiError("work_not_eligible", "preflight");
    }

    // 11. Kora signs. user_id is the Supabase user id.
    const t0 = deps.nowMs();
    const koraReply = await deps.kora.signTransaction(Buffer.from(built.wire).toString("base64"), payer, user.id).catch(mapKora);
    const koraMs = deps.nowMs() - t0;

    // 12. Validate everything Kora returned before anything else is signed.
    let validated: Transaction;
    try {
      if (koraReply.signer_pubkey !== payer) throw new SponsorCheckError("signer_pubkey");
      validated = validateKoraReturn({ original: built.wire, returnedBase64: koraReply.signed_transaction, payer, rentWallet: deps.env.rentWallet, writer }).transaction;
    } catch (e) {
      log({ event: action, user_id: user.id, work_id: workId, outcome: "kora_response_invalid", check: e instanceof SponsorCheckError ? e.check : "unknown" });
      throw new ApiError("kora_response_invalid", e instanceof SponsorCheckError ? e.check : "unknown");
    }

    // 13. The rent wallet signs the validated message.
    cosign(validated, [deps.rentSigner]);
    const wire = wireOf(validated);
    const signature = signatureOf(validated);
    const messageSha256 = await deps.sha256Hex(Uint8Array.from(validated.serializeMessage()));

    // 14. Record and return. The transaction body is never logged.
    await deps.db.markIssued(reservationId, { signature, messageSha256, blockhash, rentLamports: lamports });
    log({ event: action, user_id: user.id, work_id: workId, writer_pubkey: writer, outcome: "issued", rent_lamports: lamports,
      signature, message_sha256: messageSha256, liveness_ms: woke.ms, kora_cold: woke.attempts > 1, kora_ms: koraMs, rent_wallet_balance: rentBalance });
    return json(req, 200, {
      status: "ready_to_sign", registration_id: reservationId, transaction: wire.toString("base64"), signature, blockhash,
      issued_at: new Date(deps.nowMs()).toISOString(), rent_lamports: lamports, fee_payer: payer, rent_wallet: deps.env.rentWallet, records: acc,
    });
  } catch (e) {
    const api = e instanceof ApiError ? e : new ApiError("internal", "unexpected");
    if (!(e instanceof ApiError)) log({ event: "error", user_id: userId, outcome: "unexpected", error: e instanceof Error ? e.name : "unknown" });
    if (reservationId) await deps.db.markFailed(reservationId, api.code).catch(() => undefined);
    log({ event: "error", user_id: userId, outcome: api.code });
    return errorResponse(req, api.code, api.message);
  }
}

function mapKora(e: unknown): never {
  if (e instanceof KoraError) {
    throw new ApiError(e.kind === "unavailable" ? "kora_unavailable" : e.kind === "rejected" ? "kora_rejected" : "kora_response_invalid", e.kind);
  }
  throw e;
}
async function guardChain<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError("solana_rpc_unavailable");
  }
}
````

#### `supabase/functions/sponsor-register/index.ts`

````ts
// Supabase Edge Function: sponsor-register
// Builds the sponsored registration or version transaction, has Kora sign it, checks Kora's reply, and adds
// the rent wallet signature. The browser's writer key signs last. See docs/BRIEF in plotarmor-kora.
// Deploy (human): supabase functions deploy sponsor-register --project-ref khygvzpnyimrxndlvlje
// JWT verification stays ON.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Keypair } from "@solana/web3.js";
import { createKora } from "../_shared/kora.ts";
import { DEFAULT_LIMITS, ISSUED_STALE_MS, handle, type Deps, type WorkRow } from "./handle.ts";

const need = (name: string): string => {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Missing required secret ${name}`); // names only, never values
  return v;
};

let cached: { rentSigner: Keypair; deps: Omit<Deps, "authenticate"> & { authenticateWith: (req: Request) => Promise<{ id: string; emailConfirmed: boolean } | null> } } | null = null;

function build() {
  if (cached) return cached;
  const supabaseUrl = need("SUPABASE_URL");
  const anonKey = need("SUPABASE_ANON_KEY");
  const rpcUrl = need("SOLANA_RPC_URL");
  const db = createClient(supabaseUrl, need("SUPABASE_SERVICE_ROLE_KEY"), { auth: { autoRefreshToken: false, persistSession: false } });
  const rentSigner = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(need("RENT_WALLET_SECRET_KEY"))));
  const kora = createKora({ url: need("KORA_URL"), apiKey: need("KORA_API_KEY"), hmacSecret: need("KORA_HMAC_SECRET") });

  async function solana(method: string, params: unknown[], tries = 3): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
    let last: unknown;
    for (let i = 0; i < tries; i++) {
      try {
        const res = await fetch(rpcUrl, { method: "POST", redirect: "error", signal: AbortSignal.timeout(10_000),
          headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
        const json = await res.json();
        if (!res.ok || json.error) throw new Error(`rpc ${method} failed`);
        return json.result;
      } catch (e) { last = e; }
    }
    throw last;
  }

  const rows = <T,>(r: { data: T | null; error: { message: string } | null }): T | null => {
    if (r.error) throw new Error(r.error.message);
    return r.data;
  };
  const cols = "id, user_id, content_hash, link_nonce, anchor_nonce, ipfs_cid, work_type, parent_work_id, anchor_state, work_claim_pda";

  const deps: Omit<Deps, "authenticate"> = {
    nowMs: () => Date.now(),
    env: {
      enabled: Deno.env.get("SPONSOR_ENABLED") === "true",
      koraFeePayer: need("KORA_FEE_PAYER_ADDRESS"),
      rentWallet: need("RENT_WALLET_ADDRESS"),
      minReserveLamports: Number(need("RENT_WALLET_MIN_RESERVE_LAMPORTS")),
      limits: DEFAULT_LIMITS,
    },
    rentSigner,
    kora,
    db: {
      async isErasureBlocking(userId) {
        const { data, error } = await db.rpc("is_user_erasure_blocking", { p_user_id: userId });
        if (error) throw new Error(error.message);
        return data === true;
      },
      async getWork(userId, workId) {
        const work = rows<WorkRow>(await db.from("works").select(cols).eq("id", workId).eq("user_id", userId).maybeSingle());
        if (!work) return null;
        const root = work.parent_work_id
          ? rows<WorkRow>(await db.from("works").select(cols).eq("id", work.parent_work_id).eq("user_id", userId).maybeSingle())
          : null;
        return { work, root };
      },
      async getWriterPubkey(userId) {
        // Select the address only. The ciphertext column is never read by this function.
        const r = rows<{ writer_pubkey: string }>(await db.from("user_writer_keys").select("writer_pubkey").eq("user_id", userId).maybeSingle());
        return r?.writer_pubkey ?? null;
      },
      async sweepIssued(userId) {
        const cutoff = new Date(Date.now() - ISSUED_STALE_MS).toISOString();
        const { data, error } = await db.from("sponsored_registrations").select("id, signature, blockhash")
          .eq("user_id", userId).eq("status", "issued").lt("issued_at", cutoff).limit(10);
        if (error) throw new Error(error.message);
        for (const row of data ?? []) {
          const st = (await solana("getSignatureStatuses", [[row.signature], { searchTransactionHistory: true }])).value[0];
          let next: { status: string; error_code?: string } | null = null;
          if (st?.err) next = { status: "failed", error_code: "onchain_error" };
          else if (st && ["confirmed", "finalized"].includes(st.confirmationStatus)) next = { status: "landed" };
          else if (!st) {
            const valid = (await solana("isBlockhashValid", [row.blockhash, { commitment: "confirmed" }])).value;
            if (!valid) next = { status: "expired" };
          }
          if (next) await db.from("sponsored_registrations").update({ ...next, resolved_at: new Date().toISOString() }).eq("id", row.id);
        }
      },
      async reserve({ userId, workId, writer, kind }) {
        const { data, error } = await db.rpc("reserve_sponsored_registration", {
          p_user_id: userId, p_work_id: workId, p_writer: writer, p_kind: kind,
          p_user_hour_limit: DEFAULT_LIMITS.userHour, p_user_day_limit: DEFAULT_LIMITS.userDay, p_global_day_limit: DEFAULT_LIMITS.globalDay,
        });
        if (error) throw new Error(error.message);
        return data as { allowed: boolean; reason?: string; id?: string };
      },
      async outstandingRentLamports() {
        const since = new Date(Date.now() - 120_000).toISOString();
        const { data, error } = await db.from("sponsored_registrations").select("rent_lamports").in("status", ["reserved", "issued"]).gte("created_at", since);
        if (error) throw new Error(error.message);
        return (data ?? []).reduce((n: number, r: { rent_lamports: number | null }) => n + (r.rent_lamports ?? 0), 0);
      },
      async markIssued(id, f) {
        const { error } = await db.from("sponsored_registrations").update({ status: "issued", signature: f.signature, message_sha256: f.messageSha256,
          blockhash: f.blockhash, rent_lamports: f.rentLamports, issued_at: new Date().toISOString() }).eq("id", id);
        if (error) throw new Error(error.message);
      },
      async markLanded(id) { await db.from("sponsored_registrations").update({ status: "landed", resolved_at: new Date().toISOString() }).eq("id", id); },
      async markFailed(id, errorCode) { await db.from("sponsored_registrations").update({ status: "failed", error_code: errorCode, resolved_at: new Date().toISOString() }).eq("id", id); },
      async lastSignatureForWork(workId) {
        const r = rows<{ signature: string }>(await db.from("sponsored_registrations").select("signature").eq("work_id", workId).not("signature", "is", null)
          .order("created_at", { ascending: false }).limit(1).maybeSingle());
        return r?.signature ?? null;
      },
    },
    chain: {
      async genesisHash() { return await solana("getGenesisHash", []); },
      async accounts(addresses) {
        const r = await solana("getMultipleAccounts", [addresses, { encoding: "base64", commitment: "confirmed" }]);
        return r.value.map((a: { owner: string; data: [string, string] } | null) =>
          a ? { owner: a.owner, data: Uint8Array.from(atob(a.data[0]), (c) => c.charCodeAt(0)) } : null);
      },
      async balance(address) { return (await solana("getBalance", [address, { commitment: "confirmed" }])).value; },
      async minimumRent(size) { return await solana("getMinimumBalanceForRentExemption", [size, { commitment: "confirmed" }]); },
      async simulate(wireBase64) {
        const r = await solana("simulateTransaction", [wireBase64, { encoding: "base64", sigVerify: false, commitment: "confirmed" }]);
        return { err: r.value.err };
      },
    },
    sha256Hex: async (bytes) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes))), (b) => b.toString(16).padStart(2, "0")).join(""),
    log: (line) => console.log(JSON.stringify(line)),
  };

  const anon = (req: Request) => createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: req.headers.get("authorization") || "" } },
  });
  cached = {
    rentSigner,
    deps: { ...deps, authenticateWith: async (req) => {
      const { data: { user }, error } = await anon(req).auth.getUser();
      return error || !user ? null : { id: user.id, emailConfirmed: Boolean(user.email_confirmed_at) };
    } },
  };
  return cached;
}

Deno.serve(async (req: Request) => {
  try {
    const { deps } = build();
    const { authenticateWith, ...rest } = deps;
    return await handle(req, { ...rest, authenticate: authenticateWith });
  } catch (e) {
    // Configuration problem. Log the message (secret names only) and return a generic error.
    console.error(JSON.stringify({ event: "config_error", error: e instanceof Error ? e.message : "unknown" }));
    return new Response(JSON.stringify({ error: { code: "internal", message: "Service not configured", retryable: true } }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
});
````

#### `supabase/functions/sponsor-register/deno.json`

````json
{
  "imports": {
    "@solana/web3.js": "npm:@solana/web3.js@1.98.4",
    "@noble/curves/ed25519": "npm:@noble/curves@1.9.7/ed25519",
    "buffer": "node:buffer"
  }
}
````

#### `supabase/migrations/20261006000000_walletless_registration.sql`

````sql
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
````

#### `src/walletless/writerKey.ts`

````ts
// The user's writer keypair for walletless registration. Generated in the browser, wrapped with the
// vault master key (AES-GCM, bound to the user id) and stored as ciphertext. The server never sees the
// secret and never selects the ciphertext column.
import { Keypair } from "@solana/web3.js";

export interface WriterKeyRow {
  writer_pubkey: string;
  encrypted_secret: string;
}
export interface WriterKeyStore {
  get(userId: string): Promise<WriterKeyRow | null>;
  insert(userId: string, row: WriterKeyRow): Promise<void>;
}

const LABEL = "plotarmor-writer-key-v1:";
const aad = (userId: string): Uint8Array<ArrayBuffer> => new Uint8Array(new TextEncoder().encode(LABEL + userId));
const toB64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

// Output layout matches the vault's other wrapped values: base64 of [12 byte IV | ciphertext + tag].
export async function wrapSecret(secret: Uint8Array, masterKey: CryptoKey, userId: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad(userId) }, masterKey, new Uint8Array(secret)));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return toB64(out);
}

export async function unwrapSecret(wrapped: string, masterKey: CryptoKey, userId: string): Promise<Uint8Array> {
  const bytes = fromB64(wrapped);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(0, 12), additionalData: aad(userId) }, masterKey, bytes.slice(12));
  return new Uint8Array(plain);
}

async function open(row: WriterKeyRow, masterKey: CryptoKey, userId: string): Promise<Keypair> {
  const secret = await unwrapSecret(row.encrypted_secret, masterKey, userId);
  const kp = Keypair.fromSecretKey(secret);
  if (kp.publicKey.toBase58() !== row.writer_pubkey) throw new Error("Saved writer key does not match its address.");
  return kp;
}

// Load the user's writer key, or create and save one. A new key is used only after it has been stored,
// read back and decrypted again, so rent is never spent for a key that could be lost.
export async function ensureWriterKey(p: { userId: string; masterKey: CryptoKey; store: WriterKeyStore }): Promise<Keypair> {
  const existing = await p.store.get(p.userId);
  if (existing) return open(existing, p.masterKey, p.userId);

  const fresh = Keypair.generate();
  const row = { writer_pubkey: fresh.publicKey.toBase58(), encrypted_secret: await wrapSecret(fresh.secretKey, p.masterKey, p.userId) };
  try {
    await p.store.insert(p.userId, row);
  } catch {
    // Another tab may have created it first. Use that one if it exists.
    const winner = await p.store.get(p.userId);
    if (!winner) throw new Error("Could not save your writer key.");
    return open(winner, p.masterKey, p.userId);
  }
  const saved = await p.store.get(p.userId);
  if (!saved) throw new Error("Your writer key was not saved.");
  const kp = await open(saved, p.masterKey, p.userId);
  if (!kp.publicKey.equals(fresh.publicKey)) throw new Error("Saved writer key differs from the new key.");
  return kp;
}

// Supabase-backed store. RLS lets a user read and insert only their own row; there is no update or delete.
export function supabaseWriterKeyStore(client: {
  from: (t: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
}): WriterKeyStore {
  return {
    async get(userId) {
      const { data, error } = await client.from("user_writer_keys").select("writer_pubkey, encrypted_secret").eq("user_id", userId).maybeSingle();
      if (error) throw new Error(error.message);
      return data ?? null;
    },
    async insert(userId, row) {
      const { error } = await client.from("user_writer_keys").insert({ user_id: userId, ...row });
      if (error) throw new Error(error.message);
    },
  };
}
````

#### `src/walletless/sponsoredRegister.ts`

````ts
// Browser side of walletless registration and version adding. Calls the sponsor-register Edge Function,
// checks what it returns against the browser's own inputs, signs with the user's writer key, sends the
// transaction to the Solana RPC, and confirms it. No secret other than the writer key is ever handled here.
import { Buffer } from "buffer";
import { PublicKey, Transaction, type Connection, type Keypair } from "@solana/web3.js";
import {
  KORA_FEE_PAYER_ADDRESS, PROGRAM_ID, RENT_WALLET_ADDRESS, SponsorCheckError, base58Encode, buildSponsoredTransaction,
  cidToExternalRefHash, contentKindForWorkType, cosign, hexToBytes, parseWorkClaim, validateKoraReturn, wireOf,
  type Op,
} from "../../supabase/functions/_shared/sponsorTx.ts";

// Short codes stored in works.anchor_failure_reason. The user only ever sees the designed failure state.
export type FailureReason =
  | "session" | "service_busy" | "network" | "expired" | "invalid_response" | "rejected" | "limit" | "paused"
  | "not_ready" | "onchain_error";

export class SponsorFailure extends Error {
  reason: FailureReason;
  retryable: boolean;
  constructor(reason: FailureReason, retryable = true, message: string = reason) {
    super(message);
    this.name = "SponsorFailure";
    this.reason = reason;
    this.retryable = retryable;
  }
}

const CODE_TO_REASON: Record<string, FailureReason> = {
  unauthenticated: "session", kora_unavailable: "service_busy", solana_rpc_unavailable: "network",
  kora_response_invalid: "invalid_response", kora_rejected: "rejected", rate_limited: "limit", quota_exceeded: "limit",
  global_quota_exceeded: "paused", sponsorship_paused: "paused", work_not_eligible: "not_ready",
  writer_key_not_saved: "not_ready", work_not_found: "not_ready", invalid_request: "not_ready",
  writer_balance_unexpected: "not_ready", erasure_in_progress: "not_ready", registration_in_progress: "service_busy",
  internal: "service_busy",
};
export const reasonForCode = (code: string): FailureReason => CODE_TO_REASON[code] ?? "service_busy";

type ChainClient = Pick<Connection, "sendRawTransaction" | "getSignatureStatuses" | "getAccountInfo" | "isBlockhashValid">;

export interface BrowserDeps {
  functionUrl: string; // `${VITE_SUPABASE_URL}/functions/v1/sponsor-register`
  getAccessToken(): Promise<string | null>;
  connection: ChainClient;
  fetchFn?: typeof fetch;
  nowMs?: () => number;
  sleep?: (ms: number) => Promise<void>;
  pinned?: { payer: string; rentWallet: string }; // defaults to the public constants
}

export interface WorkInput {
  id: string;
  contentHashHex: string;
  linkNonceHex: string;
  anchorNonceHex: string;
  cid: string;
  workType: string;
  // add_version only: the root work's work_claim_pda.
  rootWorkClaim?: string;
}

async function post(deps: BrowserDeps, body: unknown, timeoutMs: number): Promise<Record<string, unknown>> {
  const token = await deps.getAccessToken();
  if (!token) throw new SponsorFailure("session", true);
  let res: Response;
  try {
    res = await (deps.fetchFn ?? fetch)(deps.functionUrl, {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new SponsorFailure("service_busy", true, "request failed or timed out");
  }
  let json: Record<string, unknown>;
  try { json = await res.json(); } catch { throw new SponsorFailure("service_busy", true, "bad response"); }
  if (!res.ok) {
    const err = (json.error ?? {}) as { code?: string; retryable?: boolean };
    throw new SponsorFailure(reasonForCode(err.code ?? "internal"), err.retryable !== false, err.code ?? "internal");
  }
  return json;
}

// Fire and forget. Call when the user reaches the final step so a sleeping Kora is awake by the time they press the button.
export function warmSponsor(deps: BrowserDeps): void {
  void post(deps, { action: "warm" }, 15_000).catch(() => undefined);
}

export async function registerWithoutWallet(p: {
  deps: BrowserDeps; action: "register" | "add_version"; work: WorkInput; writer: Keypair;
}): Promise<{ signature: string | null; records: Record<string, string>; alreadyRegistered: boolean }> {
  const { deps, action, work, writer } = p;
  const nowMs = deps.nowMs ?? (() => Date.now());
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const pinned = deps.pinned ?? { payer: KORA_FEE_PAYER_ADDRESS, rentWallet: RENT_WALLET_ADDRESS };
  const writerAddress = writer.publicKey.toBase58();

  const reply = await post(deps, { action, work_id: work.id, writer_pubkey: writerAddress }, 120_000);
  const records = (reply.records ?? {}) as Record<string, string>;
  if (reply.status === "already_registered") {
    await requireLanded(deps, records.work_claim);
    return { signature: (reply.signature as string | null) ?? null, records, alreadyRegistered: true };
  }
  if (reply.status !== "ready_to_sign" || typeof reply.transaction !== "string" || typeof reply.blockhash !== "string"
    || !Number.isSafeInteger(reply.rent_lamports)) {
    throw new SponsorFailure("invalid_response", true, "unexpected reply");
  }

  // Rebuild the same transaction from the browser's own inputs and compare. The writer's signature
  // authorizes exactly these instructions, so they must be the ones this page intended.
  const op = await localOp(deps, action, work, writerAddress);
  let tx: Transaction;
  try {
    const local = buildSponsoredTransaction({ payer: pinned.payer, rentWallet: pinned.rentWallet, writer: writerAddress,
      blockhash: reply.blockhash, lamports: reply.rent_lamports as number, op });
    const checked = validateKoraReturn({ original: local.wire, returnedBase64: reply.transaction, payer: pinned.payer,
      rentWallet: pinned.rentWallet, writer: writerAddress, rentWalletSigned: true });
    tx = checked.transaction;
    if (reply.signature !== base58Encode(Uint8Array.from(tx.signatures[0].signature as Buffer))) throw new SponsorCheckError("signature_mismatch");
  } catch (e) {
    if (e instanceof SponsorCheckError) throw new SponsorFailure("invalid_response", true, e.check);
    throw e;
  }

  cosign(tx, [writer]);
  if (!tx.verifySignatures()) throw new SponsorFailure("invalid_response", true, "final signature check");
  const signature = base58Encode(Uint8Array.from(tx.signatures[0].signature as Buffer));
  await sendAndConfirm(deps.connection, wireOf(tx), signature, reply.blockhash, nowMs, sleep);
  await requireLanded(deps, records.work_claim);
  return { signature, records, alreadyRegistered: false };
}

async function localOp(deps: BrowserDeps, action: "register" | "add_version", work: WorkInput, writer: string): Promise<Op> {
  const op: Op = {
    op: action,
    rawHash: hexToBytes(work.contentHashHex, 32),
    contentKind: contentKindForWorkType(work.workType),
    linkNonce: hexToBytes(work.linkNonceHex, 32),
    anchorNonce: hexToBytes(work.anchorNonceHex, 32),
    externalRefHash: cidToExternalRefHash(work.cid),
  };
  if (action === "register") return op;
  if (!work.rootWorkClaim) throw new SponsorFailure("not_ready", false, "root work is not registered");
  // Read the lineage head fresh from the chain, as the wallet path does.
  const info = await deps.connection.getAccountInfo(new PublicKey(work.rootWorkClaim));
  if (!info || info.owner.toBase58() !== PROGRAM_ID) throw new SponsorFailure("not_ready", false, "claim account");
  const claim = parseWorkClaim(Uint8Array.from(info.data));
  if (claim.claimant !== writer) throw new SponsorFailure("not_ready", false, "claim belongs to another key");
  return { ...op, workClaim: work.rootWorkClaim, expectedPreviousLink: claim.latestLink };
}

async function requireLanded(deps: BrowserDeps, workClaim: string | undefined): Promise<void> {
  if (!workClaim) throw new SponsorFailure("invalid_response", true, "missing records");
  const info = await deps.connection.getAccountInfo(new PublicKey(workClaim), "confirmed");
  if (!info || info.owner.toBase58() !== PROGRAM_ID) throw new SponsorFailure("expired", true, "claim account not found after send");
}

// Send once, rebroadcast the identical bytes every 5 seconds, poll every 1.5 seconds. After 75 seconds
// the blockhash is checked: if it is no longer valid and the signature is unknown, the attempt is dead and
// safe to retry. Polling stops at 120 seconds. A retry that finds the transaction already landed is
// handled by the server's already_registered reply.
export async function sendAndConfirm(
  connection: ChainClient, bytes: Buffer, signature: string, blockhash: string,
  nowMs: () => number, sleep: (ms: number) => Promise<void>,
): Promise<void> {
  const start = nowMs();
  let lastSend = -Infinity;
  for (;;) {
    const elapsed = nowMs() - start;
    if (elapsed - lastSend >= 5_000) {
      try {
        await connection.sendRawTransaction(bytes, { skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 0 });
      } catch (e) {
        const text = e instanceof Error ? e.message : "";
        if (lastSend === -Infinity && !/already been processed/i.test(text)) throw new SponsorFailure("network", true, "send failed");
      }
      lastSend = elapsed;
    }
    const status = (await connection.getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0];
    if (status?.err) throw new SponsorFailure("onchain_error", false, "transaction failed on chain");
    if (status && (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized")) return;
    if (elapsed >= 75_000 && !status) {
      const valid = (await connection.isBlockhashValid(blockhash, { commitment: "confirmed" })).value;
      if (!valid) throw new SponsorFailure("expired", true, "blockhash expired");
    }
    if (elapsed >= 120_000) throw new SponsorFailure("expired", true, "not confirmed in time");
    await sleep(1_500);
  }
}
````

#### `src/walletless/registerWork.ts`

````ts
// Glue between the app and the walletless modules. Used by UploadFlow (first attempt) and by the
// "Try again" button on the registration result (retry). Both read everything from the saved works row,
// so a retry reuses the persisted nonces and the saved writer key.
import { getConnection } from "../solana";
import { supabase } from "../supabase";
import { importKeyHex } from "../crypto";
import { getAccessToken, updateWork } from "../vault/queries";
import { SponsorFailure, registerWithoutWallet, type BrowserDeps } from "./sponsoredRegister";
import { ensureWriterKey, supabaseWriterKeyStore } from "./writerKey";

// Public rollout flag. Not a secret; nothing sensitive may ever use a VITE_ variable.
export const WALLETLESS_ENABLED = import.meta.env.VITE_WALLETLESS_REGISTER === "true";

export function sponsorDeps(): BrowserDeps {
  return {
    functionUrl: `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sponsor-register`,
    getAccessToken,
    connection: getConnection(),
  };
}

export interface AnchorableWork {
  id: string;
  content_hash: string;
  link_nonce: string;
  anchor_nonce: string;
  ipfs_cid: string;
  work_type: string;
  parent_work_id?: string | null;
  anchor_retry_count?: number | null;
}

// Runs the whole walletless anchor step and records the outcome on the works row. Returns the patch so the
// caller can merge it into its in-memory copy. Never throws for registration problems: those become a
// "failed" patch with a short reason code, and the draft stays saved.
export async function anchorWithoutWallet(p: {
  work: AnchorableWork;
  userId: string;
  vaultKeyHex: string;
  rootWorkClaim?: string | null; // add_version only: the root work's work_claim_pda
  deps?: BrowserDeps;
}): Promise<Record<string, unknown>> {
  const submitted = { anchor_state: "submitted", anchor_submitted_at: new Date().toISOString() };
  await updateWork(p.work.id, submitted);
  try {
    const masterKey = await importKeyHex(p.vaultKeyHex, true);
    const writer = await ensureWriterKey({ userId: p.userId, masterKey, store: supabaseWriterKeyStore(supabase) });
    const isVersion = Boolean(p.work.parent_work_id);
    const out = await registerWithoutWallet({
      deps: p.deps ?? sponsorDeps(), action: isVersion ? "add_version" : "register", writer,
      work: {
        id: p.work.id, contentHashHex: p.work.content_hash, linkNonceHex: p.work.link_nonce, anchorNonceHex: p.work.anchor_nonce,
        cid: p.work.ipfs_cid, workType: p.work.work_type, rootWorkClaim: p.rootWorkClaim ?? undefined,
      },
    });
    const confirmed = {
      anchor_state: "confirmed", anchor_confirmed_at: new Date().toISOString(), tx_id: out.signature, anchor_mode: 1,
      work_claim_pda: out.records.work_claim, content_artifact_pda: out.records.content_artifact, anchor_record_pda: out.records.anchor_record,
    };
    await updateWork(p.work.id, confirmed);
    return { ...submitted, ...confirmed };
  } catch (e) {
    const failed = {
      anchor_state: "failed",
      anchor_failure_reason: e instanceof SponsorFailure ? e.reason : "service_busy",
      anchor_retry_count: (p.work.anchor_retry_count ?? 0) + 1,
    };
    await updateWork(p.work.id, failed);
    return { ...submitted, ...failed };
  }
}
````


## 8. Edits to existing files (not covered by tests; you write and test them)

### 8.1 `src/vault/UploadFlow.tsx`

1. Imports: `import { useEffect } from "react"` (add to the existing react import), `import {
   WALLETLESS_ENABLED, anchorWithoutWallet, sponsorDeps } from "../walletless/registerWork";`, `import {
   warmSponsor } from "../walletless/sponsoredRegister";`.
2. Warm Kora early. Next to the other hooks in `UploadFlow`, add (use the step number of the screen that
   shows the "Register this draft" button, 3 at the time of writing):

```tsx
useEffect(() => {
  if (step === 3 && WALLETLESS_ENABLED && !anchorWallet && user) warmSponsor(sponsorDeps());
}, [step, anchorWallet, user]);
```

3. After the existing `if (anchorWallet) { ... }` block (the one that ends just before `let historyWarning`),
   add an `else if` that leaves the wallet path untouched:

```tsx
} else if (WALLETLESS_ENABLED) {
  dispatch({ type: "PROTECT_PROGRESS", text: "Registering, this can take up to 30 seconds the first time" });
  const patch = await anchorWithoutWallet({
    work: data,                       // the row returned by insertWork
    userId: user.id,
    vaultKeyHex,
    rootWorkClaim: parentWork?.work_claim_pda ?? null,
  });
  anchorPatch = { ...anchorPatch, ...patch };
}
```

   `anchorWithoutWallet` never throws for registration problems; it saves a `failed` patch with a short
   reason code and the existing code continues to `onComplete`, which shows the failure state.
4. The card at lines 1274-1279 ("Connect to sign the public registration record...") must render only
   when `!anchorWallet && !WALLETLESS_ENABLED`. Do not invent new copy for it.
5. Behavior to preserve: the wallet path, the nonce persistence, rollbacks on earlier failures, the
   "Registering your draft" screen (step 4) and its progress text.
6. Mixed ownership: a root work registered with a Phantom wallet has that wallet as claimant. A walletless
   version of it cannot work; `registerWithoutWallet` reports `not_ready`. When a wallet is connected, the
   wallet path runs as before, so keep the `if (anchorWallet)` branch first.

### 8.2 `src/vault/RegistrationResult.tsx` and `src/VaultApp.tsx` (the "Try again" button)

`RegistrationResult` has no retry today. The designed failure state needs one. Add an optional prop
`onRetry?: () => Promise<void>`. When `failed && onRetry`, show a `Button` labelled "Try again" next to
"Open work". While running, disable it and show the text "Registering, this can take up to 30 seconds the
first time". If the retry ends failed again, the same failure state shows. Also approved by Milan:
when the stored reason is `limit` or `paused`, add the line "Try again later." under the failure message.

In `VaultApp.tsx` where `RegistrationResult` is rendered (around line 481), pass `onRetry` only when
`WALLETLESS_ENABLED` and no wallet is connected:

```tsx
onRetry={async () => {
  const root = works.find((w) => w.id === registrationResult.parent_work_id);   // adapt to the real variable names
  const patch = await anchorWithoutWallet({
    work: registrationResult, userId: user.id, vaultKeyHex,
    rootWorkClaim: root?.work_claim_pda ?? null,
  });
  setRegistrationResult({ ...registrationResult, ...patch });
}}
```

Retry reuses the saved nonces and the saved writer key because everything is read from the `works` row. If
the earlier attempt actually landed, the server replies `already_registered` and the flow completes.

### 8.3 Other

- `package.json`: `@noble/curves` as a dependency (section 4).
- Add the rollout flag name `VITE_WALLETLESS_REGISTER` to any env example or setup docs that list `VITE_`
  variables (do not add a value). Mention that it is a public flag.
- Do not edit user-facing docs pages. Copy changes beyond what this brief states need Milan's approval.

## 9. Tests

Create the four test files below (they are the tested reference), then add the three tests that are yours
to write. All use vitest through `npm test`. Files import from `../../supabase/functions/...` and carry
`// @vitest-environment node` because the demo default is jsdom, which breaks `Uint8Array` identity checks
in the crypto libraries.

#### `src/tests/sponsorTx.test.ts`

````ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { Buffer } from "buffer";
import { BorshInstructionCoder, type Idl } from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import idl from "../anchor/plotarmor.json";
import {
  ACCOUNT_SIZES, APP_ARGS, LIGHTHOUSE_PROGRAM_ID, MAX_RENT_LAMPORTS, PROGRAM_ID, SYSTEM_PROGRAM_ID,
  SponsorCheckError, base58Decode, base58Encode, buildSponsoredTransaction, cidToExternalRefHash, cosign,
  createdRecordNames, deriveAccounts, encodeData, hexToBytes, missingRecordNames, parseWorkClaim, signatureOf,
  sumRent, validateKoraReturn, verifySlot, type Op,
} from "../../supabase/functions/_shared/sponsorTx.ts";

// Keys below are the PUBLISHED RFC 8032 section 7.1 test vectors. They are public test data standing in
// for Kora, the rent wallet and the writer. Never generate or use real Kora or rent wallet keys in tests.
const seed = (hex: string) => Keypair.fromSeed(Uint8Array.from(Buffer.from(hex, "hex")));
const payerKp = seed("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60");
const rentKp = seed("4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb");
const writerKp = seed("c5aa8df43f9f837bedb7442f31dcb7b166d38535076f094b85ce3a2e0b4458f7");
const otherKp = seed("f5e5767cf153319517630f226876b86c8160cc583bc013744c6bf255f5cc0ee5");
const payer = payerKp.publicKey.toBase58();
const rentWallet = rentKp.publicKey.toBase58();
const writer = writerKp.publicKey.toBase58();
const other = otherKp.publicKey.toBase58();
const blockhash = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG"; // any 32 byte base58 value works

const sha = (s: string) => Uint8Array.from(createHash("sha256").update(s).digest());
const register: Op = {
  op: "register", rawHash: sha("raw"), contentKind: 1, linkNonce: sha("link"), anchorNonce: sha("anchor"),
  externalRefHash: sha("ext"),
};
const claim = deriveAccounts(register, writer).work_claim;
const addVersion: Op = {
  op: "add_version", rawHash: sha("raw2"), contentKind: 2, linkNonce: sha("link2"), anchorNonce: sha("anchor2"),
  externalRefHash: sha("ext2"), workClaim: claim, expectedPreviousLink: other,
};
const LAMPORTS = 7_147_560;

function lighthouseIx(overrides: Partial<{ keys: string[]; len: number; program: string; first: number; last: number }> = {}) {
  const data = Buffer.alloc(overrides.len ?? 12);
  data[0] = overrides.first ?? 5;
  data.writeBigUInt64LE(5000n, 3);
  data[data.length - 1] = overrides.last ?? 4;
  return new TransactionInstruction({
    programId: new PublicKey(overrides.program ?? LIGHTHOUSE_PROGRAM_ID),
    keys: (overrides.keys ?? [payer]).map((k) => ({ pubkey: new PublicKey(k), isSigner: false, isWritable: false })),
    data,
  });
}

// Plays Kora: appends Lighthouse (unless told otherwise), then signs slot 0 with the payer test key.
function koraReturn(wire: Uint8Array, opts: { mutate?: (tx: Transaction) => void; lighthouse?: TransactionInstruction | null; signWith?: Keypair } = {}) {
  const tx = Transaction.from(Buffer.from(wire));
  // web3.js treats every key already in tx.signatures as a required signer, so clear them before editing.
  tx.signatures = [];
  opts.mutate?.(tx);
  if (opts.lighthouse !== null) tx.add(opts.lighthouse ?? lighthouseIx());
  tx.partialSign(opts.signWith ?? payerKp);
  return tx.serialize({ requireAllSignatures: false, verifySignatures: false });
}
const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64");

function setup(op: Op) {
  const { wire } = buildSponsoredTransaction({ payer, rentWallet, writer, blockhash, lamports: LAMPORTS, op });
  const check = (returned: Uint8Array | string) =>
    validateKoraReturn({ original: wire, returnedBase64: typeof returned === "string" ? returned : b64(returned), payer, rentWallet, writer });
  return { wire, check };
}
const expectCheck = (fn: () => unknown, check: RegExp | string) => {
  try { fn(); } catch (e) {
    expect(e).toBeInstanceOf(SponsorCheckError);
    expect((e as SponsorCheckError).check).toMatch(check);
    return;
  }
  throw new Error(`expected rejection ${check}`);
};

describe("encoders", () => {
  const coder = new BorshInstructionCoder(idl as Idl);
  it("register_work_claim data equals Anchor's encoder with the app arguments", () => {
    const anchorBytes = coder.encode("register_work_claim", {
      raw_hash: [...register.rawHash], content_kind: register.contentKind, claim_kind: APP_ARGS.claimKind,
      total_shares: APP_ARGS.totalShares, threshold_shares: APP_ARGS.thresholdShares,
      link_nonce: [...register.linkNonce], anchor_nonce: [...register.anchorNonce],
      anchor_mode_arg: APP_ARGS.anchorMode, external_ref_hash: [...register.externalRefHash],
    });
    expect(Buffer.from(encodeData(register)).equals(anchorBytes)).toBe(true);
    expect(encodeData(register).length).toBe(143);
  });
  it("add_version data equals Anchor's encoder", () => {
    const anchorBytes = coder.encode("add_version", {
      raw_hash: [...addVersion.rawHash], content_kind: addVersion.contentKind,
      link_nonce: [...addVersion.linkNonce], anchor_nonce: [...addVersion.anchorNonce],
      anchor_mode_arg: APP_ARGS.anchorMode, expected_previous_link: new PublicKey(other),
      external_ref_hash: [...addVersion.externalRefHash],
    });
    expect(Buffer.from(encodeData(addVersion)).equals(anchorBytes)).toBe(true);
    expect(encodeData(addVersion).length).toBe(170);
  });
  it("base58 round trips and a CIDv0 yields its sha256 digest", () => {
    const bytes = Uint8Array.from([0, 0, 1, 2, 255, 128]);
    expect(Array.from(base58Decode(base58Encode(bytes)))).toEqual(Array.from(bytes));
    const cid = "QmT2DLbRoj4JLPJb4PxGw95che5KYvaFkoaX3emGbtWjPX";
    expect(Buffer.from(cidToExternalRefHash(cid)).toString("hex")).toBe(
      "45914b08915ab9dda49fc41c7da8655123afedef07ba0963f4f840edb74d01ba");
    expect(() => cidToExternalRefHash("Qm123")).toThrow(SponsorCheckError);
    expect(() => hexToBytes("zz", 1)).toThrow(SponsorCheckError);
  });
});

describe("PDA derivation against the live devnet registration", () => {
  // evidence/2026-10-05-sponsored-send-001/accounts.json (public). Only addresses are compared, because
  // that run used the older probe arguments.
  const intent = "sponsored-demo-9e458468-071a-469f-92e8-40be72f981be";
  const w = "4p5u6WvMN6BEc8jNmvBMiao1bG1gdJ4UJD5CA9AUZirh";
  const op: Op = {
    op: "register", contentKind: 0, externalRefHash: new Uint8Array(32),
    rawHash: sha(`PlotArmor registration probe content\n${w}\n${intent}\n`),
    linkNonce: sha(`PlotArmor registration link nonce\n${w}\n${intent}\n`),
    anchorNonce: sha(`PlotArmor registration anchor nonce\n${w}\n${intent}\n`),
  };
  it("matches the six landed accounts and the registry", () => {
    expect(deriveAccounts(op, w)).toEqual({
      registry_config: "BpsMTsw9uxmmgmy1iVjgwaLfoyKMGuoisyBQ8sTrxvmG",
      content_artifact: "8A9vYTp7odtEZPsRtLj55iAgLm1Wy7FZ5jTW6VZ7RRkM",
      work_claim: "fcT9HJWSCgU6co6K2ic2qxVThxXhc8EPAngP99mwq16",
      ownership: "H8Eve625aJ9wt6mCneVJNGeKEyK4HwuraEZ5d44kt8db",
      owner_record: "ABD89jjbZgWAkc7tMGDYh3m5c2d9oy9HYaUPe9swHum7",
      claim_artifact_link: "khZKQWP9h7aRS2Ra8rYqu96K4rJvGji3KJFNaFf5MpR",
      anchor_record: "EjQmRJ9YKffHw8dkpopjn1W1bCr3FdHRoJigk5Sf1eRU",
    });
  });
});

describe("rent math", () => {
  const six = { content_artifact: 904240, work_claim: 1717040, ownership: 1209040, owner_record: 1031240, claim_artifact_link: 1219200, anchor_record: 1066800 };
  it("sums six accounts to the observed devnet total", () => {
    expect(sumRent(missingRecordNames(register, {}), six)).toBe(7_147_560);
  });
  it("prices only the five missing accounts when the content account exists", () => {
    const missing = missingRecordNames(register, { content_artifact: true });
    const { content_artifact: _omit, ...five } = six;
    expect(sumRent(missing, five)).toBe(6_243_320);
    expect(() => sumRent(missing, six)).toThrow(/rent_quote_mismatch/);
  });
  it("add_version creates content (maybe), link and anchor", () => {
    expect(createdRecordNames(addVersion)).toEqual(["content_artifact", "claim_artifact_link", "anchor_record"]);
    expect(sumRent(["claim_artifact_link", "anchor_record"], { claim_artifact_link: 1219200, anchor_record: 1066800 })).toBe(2_286_000);
  });
  it("rejects any other existing record, bad values and the cap", () => {
    expect(() => missingRecordNames(register, { work_claim: true })).toThrow(/record_exists/);
    expect(() => sumRent(["anchor_record"], { anchor_record: 0 })).toThrow(/bad_rent/);
    expect(() => sumRent(["anchor_record"], { anchor_record: MAX_RENT_LAMPORTS + 1 })).toThrow(/rent_over_cap/);
  });
  it("account sizes match the program state LEN values", () => {
    expect(ACCOUNT_SIZES).toEqual({ content_artifact: 50, work_claim: 210, ownership: 110, owner_record: 75, claim_artifact_link: 112, anchor_record: 82 });
  });
});

describe("buildSponsoredTransaction", () => {
  it("builds transfer then registration with three signer slots and room for Lighthouse", () => {
    const { wire } = buildSponsoredTransaction({ payer, rentWallet, writer, blockhash, lamports: LAMPORTS, op: register });
    const tx = Transaction.from(Buffer.from(wire));
    expect(tx.instructions.map((i) => i.programId.toBase58())).toEqual([SYSTEM_PROGRAM_ID, PROGRAM_ID]);
    expect(tx.signatures.map((s) => s.publicKey.toBase58()).sort()).toEqual([payer, rentWallet, writer].sort());
    expect(tx.signatures[0].publicKey.toBase58()).toBe(payer);
    expect(wire.length).toBeLessThan(1232 - 20);
  });
  it("refuses out of range lamports and non distinct keys", () => {
    const base = { payer, rentWallet, writer, blockhash, op: register };
    expect(() => buildSponsoredTransaction({ ...base, lamports: 0 })).toThrow(/transfer_out_of_range/);
    expect(() => buildSponsoredTransaction({ ...base, lamports: MAX_RENT_LAMPORTS + 1 })).toThrow(/transfer_out_of_range/);
    expect(() => buildSponsoredTransaction({ ...base, writer: rentWallet, lamports: 1 })).toThrow(/keys_not_distinct/);
  });
});

describe.each([["register", register], ["add_version", addVersion]] as const)("validateKoraReturn (%s)", (_name, op) => {
  const { wire, check } = setup(op);

  it("accepts Kora's honest return and exposes the asserted minimum", () => {
    const out = check(koraReturn(wire));
    expect(out.lighthouseMinimumLamports).toBe(5000n);
    expect(verifySlot(out.transaction, payer)).toBe(true);
  });
  it("lets the rent wallet and writer co-sign without moving the message", () => {
    const tx = check(koraReturn(wire)).transaction;
    cosign(tx, [rentKp]);
    cosign(tx, [writerKp]);
    expect(tx.verifySignatures()).toBe(true);
    expect(signatureOf(tx)).toBe(base58Encode(Uint8Array.from(tx.signatures[0].signature as Buffer)));
  });

  const tamper: [string, RegExp, () => Uint8Array | string][] = [
    ["blockhash changed", /blockhash_changed/, () => koraReturn(wire, { mutate: (t) => { t.recentBlockhash = "11111111111111111111111111111111"; } })],
    ["fee payer changed", /fee_payer_changed|signer_set/, () => koraReturn(wire, { mutate: (t) => { t.feePayer = otherKp.publicKey; }, signWith: otherKp })],
    ["no Lighthouse appended", /instruction_count/, () => koraReturn(wire, { lighthouse: null })],
    ["extra instruction inserted before the registration", /instruction_count|transfer_changed|registration_changed/,
      () => koraReturn(wire, { mutate: (t) => { t.instructions.splice(1, 0, SystemProgram.transfer({ fromPubkey: payerKp.publicKey, toPubkey: otherKp.publicKey, lamports: 1 })); } })],
    ["extra instruction appended after Lighthouse", /instruction_count/,
      () => koraReturn(wire, { mutate: (t) => { t.add(lighthouseIx()); } })],
    ["transfer amount raised by one lamport", /transfer_changed/,
      () => koraReturn(wire, { mutate: (t) => { t.instructions[0] = SystemProgram.transfer({ fromPubkey: rentKp.publicKey, toPubkey: writerKp.publicKey, lamports: LAMPORTS + 1 }); } })],
    ["transfer destination changed", /transfer_changed/,
      () => koraReturn(wire, { mutate: (t) => { t.instructions[0] = SystemProgram.transfer({ fromPubkey: rentKp.publicKey, toPubkey: otherKp.publicKey, lamports: LAMPORTS }); } })],
    ["transfer source changed", /transfer_changed/,
      () => koraReturn(wire, { mutate: (t) => { t.instructions[0] = SystemProgram.transfer({ fromPubkey: otherKp.publicKey, toPubkey: writerKp.publicKey, lamports: LAMPORTS }); } })],
    ["registration data byte flipped", /registration_changed/,
      () => koraReturn(wire, { mutate: (t) => { const d = Buffer.from(t.instructions[1].data); d[9] ^= 1; t.instructions[1] = new TransactionInstruction({ programId: t.instructions[1].programId, keys: t.instructions[1].keys, data: d }); } })],
    ["registration account swapped", /registration_changed/,
      () => koraReturn(wire, { mutate: (t) => { const keys = t.instructions[1].keys.map((k, i) => (i === 3 ? { ...k, pubkey: otherKp.publicKey } : k)); t.instructions[1] = new TransactionInstruction({ programId: t.instructions[1].programId, keys, data: t.instructions[1].data }); } })],
    ["writer signer flag cleared everywhere", /transfer_changed|registration_changed|signer_set|writer_not_signer/,
      () => koraReturn(wire, { mutate: (t) => { t.instructions = t.instructions.map((ix) => new TransactionInstruction({ programId: ix.programId, data: ix.data, keys: ix.keys.map((k) => (k.pubkey.equals(writerKp.publicKey) ? { ...k, isSigner: false } : k)) })); } })],
    ["Lighthouse account is the writer", /lighthouse_shape/, () => koraReturn(wire, { lighthouse: lighthouseIx({ keys: [writer] }) })],
    ["Lighthouse has two accounts", /lighthouse_shape/, () => koraReturn(wire, { lighthouse: lighthouseIx({ keys: [payer, writer] }) })],
    ["Lighthouse data length wrong", /lighthouse_shape/, () => koraReturn(wire, { lighthouse: lighthouseIx({ len: 13 }) })],
    ["Lighthouse prefix wrong", /lighthouse_shape/, () => koraReturn(wire, { lighthouse: lighthouseIx({ first: 6 }) })],
    ["third instruction is another program", /third_instruction_not_lighthouse/, () => koraReturn(wire, { lighthouse: lighthouseIx({ program: SYSTEM_PROGRAM_ID }) })],
    ["Kora signature has a flipped bit", /kora_signature_invalid/, () => { const t = Transaction.from(Buffer.from(koraReturn(wire))); (t.signatures[0].signature as Buffer)[0] ^= 1; return t.serialize({ requireAllSignatures: false, verifySignatures: false }); }],
    ["signed by the wrong key in slot 0", /kora_signature_invalid|kora_signature_missing/, () => { const t = Transaction.from(Buffer.from(koraReturn(wire))); t.signatures[0].signature = Buffer.alloc(64, 7); return t.serialize({ requireAllSignatures: false, verifySignatures: false }); }],
    ["Kora signature missing", /kora_signature_missing/, () => { const t = Transaction.from(Buffer.from(koraReturn(wire))); t.signatures[0].signature = null; return t.serialize({ requireAllSignatures: false, verifySignatures: false }); }],
    ["writer slot pre-filled", /unexpected_signature/, () => { const t = Transaction.from(Buffer.from(koraReturn(wire))); t.partialSign(writerKp); return t.serialize({ requireAllSignatures: false, verifySignatures: false }); }],
    ["rent wallet slot pre-filled", /unexpected_signature/, () => { const t = Transaction.from(Buffer.from(koraReturn(wire))); t.partialSign(rentKp); return t.serialize({ requireAllSignatures: false, verifySignatures: false }); }],
    ["versioned message", /versioned_message/, () => { const bytes = Buffer.from(koraReturn(wire)); bytes[1 + 3 * 64] |= 0x80; return bytes; }],
    ["oversize", /bad_size/, () => Buffer.alloc(1233, 1)],
    ["garbage", /decode/, () => Buffer.from([3, 1, 2, 3, 4])],
    ["not base64 text", /decode|bad_size/, () => "!!!!"],
    ["empty", /bad_size/, () => ""],
  ];
  it.each(tamper)("rejects: %s", (_label, pattern, make) => {
    expectCheck(() => check(make()), pattern);
  });

  it("rejects when the browser's expected writer differs from the one Kora signed for", () => {
    const returned = b64(koraReturn(wire));
    expectCheck(() => validateKoraReturn({ original: wire, returnedBase64: returned, payer, rentWallet, writer: other }), /transfer_destination|signer_set/);
  });
  it("rejects when the pinned rent wallet or fee payer differs", () => {
    const returned = b64(koraReturn(wire));
    expectCheck(() => validateKoraReturn({ original: wire, returnedBase64: returned, payer: other, rentWallet, writer }), /fee_payer_changed/);
    expectCheck(() => validateKoraReturn({ original: wire, returnedBase64: returned, payer, rentWallet: other, writer }), /transfer_source/);
  });
});

describe("validateKoraReturn with the rent wallet already signed (browser view)", () => {
  const { wire } = setup(register);
  const signed = () => { const tx = Transaction.from(Buffer.from(koraReturn(wire))); tx.partialSign(rentKp); return tx; };
  const run = (tx: Transaction, rentWalletSigned = true) => validateKoraReturn({ original: wire, returnedBase64: b64(tx.serialize({ requireAllSignatures: false, verifySignatures: false })), payer, rentWallet, writer, rentWalletSigned });
  it("accepts a valid rent wallet signature and an empty writer slot", () => {
    expect(run(signed()).transaction.signatures.filter((s) => s.signature).length).toBe(2);
  });
  it("rejects a missing, corrupt, or unexpected signature", () => {
    expectCheck(() => run(Transaction.from(Buffer.from(koraReturn(wire)))), /rent_wallet_signature_missing/);
    const bad = signed(); (bad.signatures.find((s) => s.publicKey.toBase58() === rentWallet)!.signature as Buffer)[0] ^= 1;
    expectCheck(() => run(bad), /rent_wallet_signature_invalid/);
    const withWriter = signed(); withWriter.partialSign(writerKp);
    expectCheck(() => run(withWriter), /unexpected_signature/);
    expectCheck(() => run(signed(), false), /unexpected_signature/);
  });
});

describe("parseWorkClaim", () => {
  it("reads head, claimant and supersession at the program's offsets", () => {
    const data = new Uint8Array(210);
    const put = (o: number, k: PublicKey) => data.set(k.toBytes(), o);
    put(72, otherKp.publicKey); put(104, writerKp.publicKey);
    expect(parseWorkClaim(data)).toEqual({ latestLink: other, claimant: writer, supersededBy: "11111111111111111111111111111111" });
    expect(() => parseWorkClaim(new Uint8Array(10))).toThrow(/work_claim_short/);
  });
});
````

#### `src/tests/sponsorHandler.test.ts`

````ts
// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { createHmac } from "node:crypto";
import { Buffer } from "buffer";
import { Keypair, PublicKey, SystemInstruction, Transaction, TransactionInstruction } from "@solana/web3.js";
import {
  DEVNET_GENESIS_HASH, LIGHTHOUSE_PROGRAM_ID, PROGRAM_ID, base58Encode, deriveAccounts,
} from "../../supabase/functions/_shared/sponsorTx.ts";
import { WAKE_BUDGET_MS, KoraError, createKora, hmacHex } from "../../supabase/functions/_shared/kora.ts";
import { handle, type Deps, type WorkRow } from "../../supabase/functions/sponsor-register/handle.ts";

// Published RFC 8032 test vectors stand in for Kora, the rent wallet and the writer. Public test data only.
const seed = (hex: string) => Keypair.fromSeed(Uint8Array.from(Buffer.from(hex, "hex")));
const payerKp = seed("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60");
const rentKp = seed("4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb");
const writerKp = seed("c5aa8df43f9f837bedb7442f31dcb7b166d38535076f094b85ce3a2e0b4458f7");
const payer = payerKp.publicKey.toBase58();
const rentWallet = rentKp.publicKey.toBase58();
const writer = writerKp.publicKey.toBase58();
const USER = "11111111-1111-4111-8111-111111111111";
const WORK = "22222222-2222-4222-8222-222222222222";
const ROOT = "33333333-3333-4333-8333-333333333333";
const CID = "QmT2DLbRoj4JLPJb4PxGw95che5KYvaFkoaX3emGbtWjPX";
const hex = (c: string) => c.repeat(64);
const SENTINEL_SECRETS = ["API-KEY-SENTINEL", "HMAC-SECRET-SENTINEL"];

const baseWork = (over: Partial<WorkRow> = {}): WorkRow => ({
  id: WORK, user_id: USER, content_hash: hex("a"), link_nonce: hex("b"), anchor_nonce: hex("c"), ipfs_cid: CID,
  work_type: "screenplay", parent_work_id: null, anchor_state: "submitted", work_claim_pda: null, ...over,
});

function lighthouse() {
  const data = Buffer.alloc(12);
  data[0] = 5; data.writeBigUInt64LE(5000n, 3); data[11] = 4;
  return new TransactionInstruction({ programId: new PublicKey(LIGHTHOUSE_PROGRAM_ID), keys: [{ pubkey: payerKp.publicKey, isSigner: false, isWritable: false }], data });
}

function makeDeps(over: { deps?: Partial<Deps>; tamper?: (tx: Transaction) => void; accounts?: Record<string, { owner: string; data: Uint8Array } | null>;
  writerBalance?: number; rentBalance?: number; work?: { work: WorkRow; root: WorkRow | null } | null; reserve?: { allowed: boolean; reason?: string; id?: string } } = {}) {
  const logs: Record<string, unknown>[] = [];
  const calls: Record<string, unknown[]> = { markIssued: [], markFailed: [], markLanded: [], signTransaction: [], simulate: [] };
  const kora = {
    wake: vi.fn(async () => ({ attempts: 1, ms: 5 })),
    getPayerSigner: vi.fn(async () => payer),
    getBlockhash: vi.fn(async () => "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG"),
    signTransaction: vi.fn(async (b64: string) => {
      calls.signTransaction.push(b64);
      const tx = Transaction.from(Buffer.from(b64, "base64"));
      tx.signatures = [];
      over.tamper?.(tx);
      tx.add(lighthouse());
      tx.partialSign(payerKp);
      return { signed_transaction: tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"), signer_pubkey: payer };
    }),
  };
  const deps: Deps = {
    nowMs: () => 1_760_000_000_000,
    env: { enabled: true, koraFeePayer: payer, rentWallet, minReserveLamports: 1_000_000_000 },
    rentSigner: rentKp,
    kora,
    authenticate: async (req) => (req.headers.get("authorization") === "Bearer good" ? { id: USER, emailConfirmed: true } : null),
    db: {
      isErasureBlocking: async () => false,
      getWork: async () => (over.work === undefined ? { work: baseWork(), root: null } : over.work),
      getWriterPubkey: async () => writer,
      sweepIssued: async () => undefined,
      reserve: async () => over.reserve ?? { allowed: true, id: "res-1" },
      outstandingRentLamports: async () => 0,
      markIssued: async (...a) => { calls.markIssued.push(a); },
      markLanded: async (...a) => { calls.markLanded.push(a); },
      markFailed: async (...a) => { calls.markFailed.push(a); },
      lastSignatureForWork: async () => "prev-signature",
    },
    chain: {
      genesisHash: async () => DEVNET_GENESIS_HASH,
      accounts: async (addrs) => addrs.map((a) => over.accounts?.[a] ?? null),
      balance: async (a) => (a === writer ? over.writerBalance ?? 0 : over.rentBalance ?? 9_000_000_000),
      minimumRent: async (size) => ({ 50: 904240, 210: 1717040, 110: 1209040, 75: 1031240, 112: 1219200, 82: 1066800 } as Record<number, number>)[size],
      simulate: async (b64) => { calls.simulate.push(b64); return { err: null }; },
    },
    sha256Hex: async (b) => Buffer.from(await crypto.subtle.digest("SHA-256", new Uint8Array(b))).toString("hex"),
    log: (l) => logs.push(l),
    ...over.deps,
  };
  return { deps, logs, calls, kora };
}

const call = (deps: Deps, body: unknown, token = "good") =>
  handle(new Request("https://f.example/sponsor-register", { method: "POST", headers: { authorization: `Bearer ${token}`, origin: "http://localhost:5173" }, body: JSON.stringify(body) }), deps);
const reg = { action: "register", work_id: WORK, writer_pubkey: writer };

describe("sponsor-register: register", () => {
  it("returns a Kora and rent wallet signed transaction that the writer can co-sign", async () => {
    const { deps, calls, logs } = makeDeps();
    const res = await call(deps, reg);
    expect(res.status).toBe(200);
    const out = await res.json();
    expect(out.status).toBe("ready_to_sign");
    expect(out.rent_lamports).toBe(7_147_560);
    const tx = Transaction.from(Buffer.from(out.transaction, "base64"));
    expect(tx.instructions).toHaveLength(3);
    expect(tx.signatures.map((s) => [s.publicKey.toBase58(), s.signature !== null])).toEqual(
      expect.arrayContaining([[payer, true], [rentWallet, true], [writer, false]]));
    const t = SystemInstruction.decodeTransfer(tx.instructions[0]);
    expect(t.lamports).toBe(7_147_560n);
    tx.partialSign(writerKp);
    expect(tx.verifySignatures()).toBe(true);
    expect(out.signature).toBe(base58Encode(Uint8Array.from(tx.signatures[0].signature as Buffer)));
    expect(calls.markIssued).toHaveLength(1);
    expect(calls.markFailed).toHaveLength(0);
    expect(JSON.stringify(logs)).not.toContain(out.transaction);
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
  });

  it("uses the Supabase user id as Kora user_id and pins the fee payer", async () => {
    const { deps, kora } = makeDeps();
    await call(deps, reg);
    expect(kora.signTransaction).toHaveBeenCalledWith(expect.any(String), payer, USER);
    const bad = makeDeps({ deps: { env: { enabled: true, koraFeePayer: rentWallet.replace(/.$/, "1"), rentWallet, minReserveLamports: 0 } } });
    const res = await call(bad.deps, reg);
    expect((await res.json()).error.code).toBe("kora_response_invalid");
    expect(bad.calls.markFailed).toHaveLength(1);
  });

  it("prices five accounts when the content account already exists", async () => {
    const acc = deriveAccounts({ op: "register", rawHash: Uint8Array.from(Buffer.from(hex("a"), "hex")), contentKind: 1, linkNonce: Uint8Array.from(Buffer.from(hex("b"), "hex")), anchorNonce: Uint8Array.from(Buffer.from(hex("c"), "hex")), externalRefHash: new Uint8Array(32) }, writer);
    const { deps } = makeDeps({ accounts: { [acc.content_artifact]: { owner: PROGRAM_ID, data: new Uint8Array(50) } } });
    const out = await (await call(deps, reg)).json();
    expect(out.rent_lamports).toBe(6_243_320);
  });

  it("reduces the transfer for a dusty writer and refuses a writer that already has enough", async () => {
    const dusty = await (await call(makeDeps({ writerBalance: 5000 }).deps, reg)).json();
    expect(dusty.rent_lamports).toBe(7_147_560 - 5000);
    const res = await call(makeDeps({ writerBalance: 7_147_560 }).deps, reg);
    expect((await res.json()).error.code).toBe("writer_balance_unexpected");
  });

  it("returns already_registered when the claim and owner record exist", async () => {
    const acc = deriveAccounts({ op: "register", rawHash: Uint8Array.from(Buffer.from(hex("a"), "hex")), contentKind: 1, linkNonce: Uint8Array.from(Buffer.from(hex("b"), "hex")), anchorNonce: Uint8Array.from(Buffer.from(hex("c"), "hex")), externalRefHash: new Uint8Array(32) }, writer);
    const here = { owner: PROGRAM_ID, data: new Uint8Array(210) };
    const { deps, calls } = makeDeps({ accounts: { [acc.work_claim]: here, [acc.owner_record]: here } });
    const out = await (await call(deps, reg)).json();
    expect(out).toMatchObject({ status: "already_registered", signature: "prev-signature" });
    expect(calls.markLanded).toHaveLength(1);
  });

  it("refuses when the rent wallet reserve would be breached", async () => {
    const res = await call(makeDeps({ rentBalance: 1_005_000_000 }).deps, reg);
    expect((await res.json()).error.code).toBe("sponsorship_paused");
  });
});

describe("sponsor-register: gates", () => {
  it.each([
    ["no token", () => call(makeDeps().deps, reg, "bad"), 401, "unauthenticated"],
    ["unknown action", () => call(makeDeps().deps, { action: "sign" }), 400, "invalid_request"],
    ["bad work id", () => call(makeDeps().deps, { ...reg, work_id: "nope" }), 400, "invalid_request"],
    ["writer is the rent wallet", () => call(makeDeps().deps, { ...reg, writer_pubkey: rentWallet }), 400, "invalid_request"],
    ["writer is not a key", () => call(makeDeps().deps, { ...reg, writer_pubkey: "abc" }), 400, "invalid_request"],
    ["work not found", () => call(makeDeps({ work: null }).deps, reg), 404, "work_not_found"],
    ["work owned by someone else", () => call(makeDeps({ work: { work: baseWork({ user_id: "other" }), root: null } }).deps, reg), 404, "work_not_found"],
    ["already confirmed", () => call(makeDeps({ work: { work: baseWork({ anchor_state: "confirmed" }), root: null } }).deps, reg), 409, "work_not_eligible"],
    ["claim pda already set", () => call(makeDeps({ work: { work: baseWork({ work_claim_pda: "x" }), root: null } }).deps, reg), 409, "work_not_eligible"],
    ["bad stored hash", () => call(makeDeps({ work: { work: baseWork({ content_hash: "zz" }), root: null } }).deps, reg), 409, "work_not_eligible"],
    ["register on a version row", () => call(makeDeps({ work: { work: baseWork({ parent_work_id: ROOT }), root: null } }).deps, reg), 409, "work_not_eligible"],
    ["writer key not saved", () => call(makeDeps({ deps: { db: { ...makeDeps().deps.db, getWriterPubkey: async () => null } } }).deps, reg), 409, "writer_key_not_saved"],
    ["rate limited", () => call(makeDeps({ reserve: { allowed: false, reason: "rate_limited" } }).deps, reg), 429, "rate_limited"],
    ["daily quota", () => call(makeDeps({ reserve: { allowed: false, reason: "quota_exceeded" } }).deps, reg), 429, "quota_exceeded"],
    ["global quota", () => call(makeDeps({ reserve: { allowed: false, reason: "global_quota_exceeded" } }).deps, reg), 429, "global_quota_exceeded"],
    ["already in progress", () => call(makeDeps({ reserve: { allowed: false, reason: "registration_in_progress" } }).deps, reg), 409, "registration_in_progress"],
  ])("%s", async (_n, run, status, code) => {
    const res = await run();
    expect(res.status).toBe(status);
    expect((await res.json()).error.code).toBe(code);
  });

  it("kill switch and unconfirmed email stop before any work", async () => {
    const off = makeDeps({ deps: { env: { enabled: false, koraFeePayer: payer, rentWallet, minReserveLamports: 0 } } });
    expect((await (await call(off.deps, reg)).json()).error.code).toBe("sponsorship_paused");
    const unconfirmed = makeDeps({ deps: { authenticate: async () => ({ id: USER, emailConfirmed: false }) } });
    expect((await call(unconfirmed.deps, reg)).status).toBe(401);
    expect(off.kora.wake).not.toHaveBeenCalled();
  });

  it("refuses to run when the rent signer does not match the pinned address", async () => {
    const wrong = makeDeps({ deps: { rentSigner: writerKp } });
    expect((await (await call(wrong.deps, reg)).json()).error.code).toBe("internal");
  });

  it("warm wakes Kora without consuming quota", async () => {
    const { deps, kora } = makeDeps();
    const res = await call(deps, { action: "warm" });
    expect(await res.json()).toEqual({ status: "ready" });
    expect(kora.wake).toHaveBeenCalled();
  });
});

describe("sponsor-register: Kora misbehaviour", () => {
  it("does not rent-sign a tampered return and marks the reservation failed", async () => {
    const { deps, calls } = makeDeps({
      tamper: (tx) => { const d = Buffer.from(tx.instructions[1].data); d[10] ^= 1; tx.instructions[1] = new TransactionInstruction({ programId: tx.instructions[1].programId, keys: tx.instructions[1].keys, data: d }); },
    });
    const res = await call(deps, reg);
    expect(res.status).toBe(502);
    expect((await res.json()).error.code).toBe("kora_response_invalid");
    expect(calls.markIssued).toHaveLength(0);
    expect(calls.markFailed).toEqual([["res-1", "kora_response_invalid"]]);
  });

  it.each([
    ["unavailable", new KoraError("unavailable", "x"), 503, "kora_unavailable"],
    ["rejected", new KoraError("rejected", "x"), 502, "kora_rejected"],
  ])("maps a Kora %s error", async (_n, err, status, code) => {
    const { deps } = makeDeps();
    (deps.kora.signTransaction as ReturnType<typeof vi.fn>).mockRejectedValueOnce(err);
    const res = await call(deps, reg);
    expect(res.status).toBe(status);
    expect((await res.json()).error.code).toBe(code);
  });

  it("maps an RPC failure and a Kora wake timeout", async () => {
    const rpc = makeDeps();
    rpc.deps.chain.accounts = async () => { throw new Error("boom"); };
    expect((await (await call(rpc.deps, reg)).json()).error.code).toBe("solana_rpc_unavailable");
    const asleep = makeDeps();
    (asleep.deps.kora.wake as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new KoraError("unavailable", "x"));
    expect((await (await call(asleep.deps, reg)).json()).error.code).toBe("kora_unavailable");
  });

  it("never puts secrets or transaction bodies in a response or a log", async () => {
    const { deps, logs } = makeDeps();
    const res = await call(deps, reg);
    const text = JSON.stringify(logs) + JSON.stringify({ ...(await res.json()), transaction: undefined });
    for (const s of SENTINEL_SECRETS) expect(text).not.toContain(s);
    expect(text).not.toContain(Buffer.from(rentKp.secretKey).toString("base64"));
  });
});

describe("sponsor-register: add_version", () => {
  const workClaim = seed("833fe62409237b9d62ec77587520911e9a759cec1d19755b7da901b96dca3d42").publicKey.toBase58();
  const head = seed("f5e5767cf153319517630f226876b86c8160cc583bc013744c6bf255f5cc0ee5").publicKey;
  const claimData = () => {
    const d = new Uint8Array(210);
    d.set(head.toBytes(), 72); d.set(writerKp.publicKey.toBytes(), 104);
    return d;
  };
  const versionWork = baseWork({ parent_work_id: ROOT });
  const root = baseWork({ id: ROOT, work_claim_pda: workClaim, parent_work_id: null, anchor_state: "confirmed" });
  const ver = { action: "add_version", work_id: WORK, writer_pubkey: writer };

  it("builds an add_version transaction with the on-chain lineage head", async () => {
    const { deps } = makeDeps({ work: { work: versionWork, root }, accounts: { [workClaim]: { owner: PROGRAM_ID, data: claimData() } } });
    const out = await (await call(deps, ver)).json();
    expect(out.status).toBe("ready_to_sign");
    expect(out.rent_lamports).toBe(904240 + 1219200 + 1066800);
    const tx = Transaction.from(Buffer.from(out.transaction, "base64"));
    expect(tx.instructions[1].data.length).toBe(170);
    expect(Buffer.from(tx.instructions[1].data).subarray(8 + 32 + 1 + 64 + 1, 8 + 32 + 1 + 64 + 1 + 32).equals(Buffer.from(head.toBytes()))).toBe(true);
  });

  it("refuses when the claim belongs to another writer or is missing", async () => {
    const d = claimData(); d.set(payerKp.publicKey.toBytes(), 104);
    const other = makeDeps({ work: { work: versionWork, root }, accounts: { [workClaim]: { owner: PROGRAM_ID, data: d } } });
    expect((await (await call(other.deps, ver)).json()).error.code).toBe("work_not_eligible");
    const none = makeDeps({ work: { work: versionWork, root } });
    expect((await (await call(none.deps, ver)).json()).error.code).toBe("work_not_eligible");
  });

  it("needs a registered root work of the same user", async () => {
    const unregistered = makeDeps({ work: { work: versionWork, root: { ...root, work_claim_pda: null } } });
    expect((await (await call(unregistered.deps, ver)).json()).error.code).toBe("work_not_eligible");
    const stranger = makeDeps({ work: { work: versionWork, root: { ...root, user_id: "other" } } });
    expect((await (await call(stranger.deps, ver)).json()).error.code).toBe("work_not_eligible");
  });
});

describe("Kora client", () => {
  it("HMAC matches Node's createHmac over timestamp then body", async () => {
    const body = '{"jsonrpc":"2.0","id":1,"method":"getBlockhash","params":{}}';
    expect(await hmacHex("HMAC-SECRET-SENTINEL", "1760000000", body)).toBe(
      createHmac("sha256", "HMAC-SECRET-SENTINEL").update("1760000000").update(body).digest("hex"));
  });

  it("sends the three auth headers and the exact signed body", async () => {
    const seen: { headers: Record<string, string>; body: string }[] = [];
    const fetchFn = (async (_u: string, init: RequestInit) => {
      seen.push({ headers: init.headers as Record<string, string>, body: init.body as string });
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { blockhash: "abc" } }), { status: 200 });
    }) as unknown as typeof fetch;
    const k = createKora({ url: "https://kora.example/", apiKey: "API-KEY-SENTINEL", hmacSecret: "HMAC-SECRET-SENTINEL", fetchFn, nowMs: () => 1_760_000_000_000 });
    expect(await k.getBlockhash()).toBe("abc");
    const h = seen[0].headers;
    expect(h["x-api-key"]).toBe("API-KEY-SENTINEL");
    expect(h["x-timestamp"]).toBe("1760000000");
    expect(h["x-hmac-signature"]).toBe(createHmac("sha256", "HMAC-SECRET-SENTINEL").update("1760000000").update(seen[0].body).digest("hex"));
  });

  it("wakes through three failures and then succeeds, and gives up at the budget", async () => {
    let t = 0, n = 0;
    const sleeps: number[] = [];
    const fetchFn = (async () => (++n < 4 ? new Response("", { status: 503 }) : new Response("ok", { status: 200 }))) as unknown as typeof fetch;
    const k = createKora({ url: "https://k", apiKey: "a", hmacSecret: "b", fetchFn, nowMs: () => t, sleep: async (ms) => { sleeps.push(ms); t += ms; } });
    expect(await k.wake()).toMatchObject({ attempts: 4 });
    expect(sleeps).toEqual([2000, 3000, 5000]);
    let t2 = 0;
    const down = (async () => { throw new Error("down"); }) as unknown as typeof fetch;
    const k2 = createKora({ url: "https://k", apiKey: "a", hmacSecret: "b", fetchFn: down, nowMs: () => t2, sleep: async (ms) => { t2 += ms; } });
    await expect(k2.wake()).rejects.toMatchObject({ kind: "unavailable" });
    expect(t2).toBeLessThan(WAKE_BUDGET_MS);
  });

  it("retries once on 5xx but never on a policy rejection", async () => {
    let n = 0;
    const flaky = (async () => (++n === 1 ? new Response("", { status: 502 }) : new Response(JSON.stringify({ jsonrpc: "2.0", id: 2, result: { signer_address: "x" } }), { status: 200 }))) as unknown as typeof fetch;
    const k = createKora({ url: "https://k", apiKey: "a", hmacSecret: "b", fetchFn: flaky, nowMs: () => 0 });
    expect(await k.getPayerSigner()).toBe("x");
    expect(n).toBe(2);
    let m = 0;
    const reject = (async () => { m++; return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -1 } }), { status: 400 }); }) as unknown as typeof fetch;
    const k2 = createKora({ url: "https://k", apiKey: "a", hmacSecret: "b", fetchFn: reject, nowMs: () => 0 });
    await expect(k2.getBlockhash()).rejects.toMatchObject({ kind: "rejected" });
    expect(m).toBe(1);
  });
});
````

#### `src/tests/walletless.test.ts`

````ts
// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { Buffer } from "buffer";
import { Keypair, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import { DEVNET_GENESIS_HASH, LIGHTHOUSE_PROGRAM_ID, PROGRAM_ID } from "../../supabase/functions/_shared/sponsorTx.ts";
import { handle, type Deps, type WorkRow } from "../../supabase/functions/sponsor-register/handle.ts";
import { SponsorFailure, reasonForCode, registerWithoutWallet, sendAndConfirm, type BrowserDeps } from "../walletless/sponsoredRegister.ts";
import { ensureWriterKey, unwrapSecret, wrapSecret, type WriterKeyRow, type WriterKeyStore } from "../walletless/writerKey.ts";

// Published RFC 8032 test vectors stand in for Kora and the rent wallet. The writer key is generated in memory.
const seed = (hex: string) => Keypair.fromSeed(Uint8Array.from(Buffer.from(hex, "hex")));
const payerKp = seed("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60");
const rentKp = seed("4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb");
const payer = payerKp.publicKey.toBase58();
const rentWallet = rentKp.publicKey.toBase58();
const USER = "11111111-1111-4111-8111-111111111111";
const WORK = "22222222-2222-4222-8222-222222222222";
const CID = "QmT2DLbRoj4JLPJb4PxGw95che5KYvaFkoaX3emGbtWjPX";
const hex = (c: string) => c.repeat(64);
const workInput = { id: WORK, contentHashHex: hex("a"), linkNonceHex: hex("b"), anchorNonceHex: hex("c"), cid: CID, workType: "screenplay" };

async function masterKey() {
  return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
}
function memoryStore(): WriterKeyStore & { rows: Map<string, WriterKeyRow> } {
  const rows = new Map<string, WriterKeyRow>();
  return { rows, get: async (u) => rows.get(u) ?? null, insert: async (u, r) => { if (rows.has(u)) throw new Error("dup"); rows.set(u, r); } };
}

describe("writer key store", () => {
  it("creates, saves, reads back, and reuses the same key", async () => {
    const store = memoryStore(); const mk = await masterKey();
    const a = await ensureWriterKey({ userId: USER, masterKey: mk, store });
    const b = await ensureWriterKey({ userId: USER, masterKey: mk, store });
    expect(a.publicKey.equals(b.publicKey)).toBe(true);
    expect(store.rows.get(USER)?.writer_pubkey).toBe(a.publicKey.toBase58());
    expect(store.rows.get(USER)?.encrypted_secret).not.toContain(Buffer.from(a.secretKey).toString("base64"));
  });
  it("is bound to the user id and the master key", async () => {
    const mk = await masterKey();
    const wrapped = await wrapSecret(new Uint8Array(64).fill(7), mk, USER);
    expect(Array.from(await unwrapSecret(wrapped, mk, USER))).toEqual(new Array(64).fill(7));
    await expect(unwrapSecret(wrapped, mk, "someone-else")).rejects.toBeTruthy();
    await expect(unwrapSecret(wrapped, await masterKey(), USER)).rejects.toBeTruthy();
  });
  it("does not use a key that failed to save, and adopts the winner of a race", async () => {
    const mk = await masterKey();
    const broken: WriterKeyStore = { get: async () => null, insert: async () => { throw new Error("db down"); } };
    await expect(ensureWriterKey({ userId: USER, masterKey: mk, store: broken })).rejects.toThrow();
    const store = memoryStore();
    const first = await ensureWriterKey({ userId: USER, masterKey: mk, store });
    const racing: WriterKeyStore = { get: vi.fn().mockResolvedValueOnce(null).mockImplementation(store.get), insert: store.insert };
    expect((await ensureWriterKey({ userId: USER, masterKey: mk, store: racing })).publicKey.equals(first.publicKey)).toBe(true);
  });
  it("refuses a row whose address does not match its secret", async () => {
    const mk = await masterKey(); const store = memoryStore();
    const kp = Keypair.generate();
    store.rows.set(USER, { writer_pubkey: payer, encrypted_secret: await wrapSecret(kp.secretKey, mk, USER) });
    await expect(ensureWriterKey({ userId: USER, masterKey: mk, store })).rejects.toThrow(/does not match/);
  });
});

// In-process server: the real handler with fake Kora, chain and database.
function server(writer: Keypair, work: Partial<WorkRow> = {}) {
  const row: WorkRow = { id: WORK, user_id: USER, content_hash: hex("a"), link_nonce: hex("b"), anchor_nonce: hex("c"), ipfs_cid: CID,
    work_type: "screenplay", parent_work_id: null, anchor_state: "submitted", work_claim_pda: null, ...work };
  const lh = () => { const d = Buffer.alloc(12); d[0] = 5; d.writeBigUInt64LE(5000n, 3); d[11] = 4;
    return new TransactionInstruction({ programId: new PublicKey(LIGHTHOUSE_PROGRAM_ID), keys: [{ pubkey: payerKp.publicKey, isSigner: false, isWritable: false }], data: d }); };
  const deps: Deps = {
    nowMs: () => 1_760_000_000_000,
    env: { enabled: true, koraFeePayer: payer, rentWallet, minReserveLamports: 1_000_000_000 },
    rentSigner: rentKp,
    kora: {
      wake: async () => ({ attempts: 1, ms: 1 }), getPayerSigner: async () => payer,
      getBlockhash: async () => "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
      signTransaction: async (b64: string) => { const tx = Transaction.from(Buffer.from(b64, "base64")); tx.signatures = []; tx.add(lh()); tx.partialSign(payerKp);
        return { signed_transaction: tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"), signer_pubkey: payer }; },
    },
    authenticate: async () => ({ id: USER, emailConfirmed: true }),
    db: { isErasureBlocking: async () => false, getWork: async () => ({ work: row, root: null }), getWriterPubkey: async () => writer.publicKey.toBase58(),
      sweepIssued: async () => undefined, reserve: async () => ({ allowed: true, id: "r1" }), outstandingRentLamports: async () => 0,
      markIssued: async () => undefined, markLanded: async () => undefined, markFailed: async () => undefined, lastSignatureForWork: async () => null },
    chain: { genesisHash: async () => DEVNET_GENESIS_HASH, accounts: async (a) => a.map(() => null), balance: async (a) => (a === rentWallet ? 9e9 : 0),
      minimumRent: async (s) => ({ 50: 904240, 210: 1717040, 110: 1209040, 75: 1031240, 112: 1219200, 82: 1066800 } as Record<number, number>)[s],
      simulate: async () => ({ err: null }) },
    sha256Hex: async () => "00", log: () => undefined,
  };
  const fetchFn = (async (_u: string, init: RequestInit) => handle(new Request("https://f/sponsor-register", { method: "POST", headers: init.headers, body: init.body as string }), deps)) as unknown as typeof fetch;
  return { fetchFn, deps };
}

function chainClient(opts: { landOn?: number; err?: unknown; valid?: boolean } = {}) {
  const sent: Buffer[] = [];
  return {
    sent,
    sendRawTransaction: vi.fn(async (b: Buffer) => { sent.push(Buffer.from(b)); return "sig"; }),
    getSignatureStatuses: vi.fn(async () => ({ context: { slot: 1 }, value: [sent.length >= (opts.landOn ?? 1) ? { slot: 1, confirmations: 1, err: opts.err ?? null, confirmationStatus: "confirmed" as const } : null] })),
    getAccountInfo: vi.fn(async () => ({ owner: new PublicKey(PROGRAM_ID), data: Buffer.alloc(210), lamports: 1, executable: false })),
    isBlockhashValid: vi.fn(async () => ({ context: { slot: 1 }, value: opts.valid ?? true })),
  };
}
const browser = (fetchFn: typeof fetch, connection: ReturnType<typeof chainClient>, over: Partial<BrowserDeps> = {}): BrowserDeps => ({
  functionUrl: "https://f/sponsor-register", getAccessToken: async () => "good", connection: connection as unknown as BrowserDeps["connection"],
  fetchFn, pinned: { payer, rentWallet }, ...over,
});

describe("registerWithoutWallet end to end (real handler, fake Kora and chain)", () => {
  it("validates, co-signs and sends a fully signed transaction", async () => {
    const writer = Keypair.generate();
    const { fetchFn } = server(writer); const conn = chainClient();
    const out = await registerWithoutWallet({ deps: browser(fetchFn, conn), action: "register", work: workInput, writer });
    expect(out.alreadyRegistered).toBe(false);
    expect(conn.sent).toHaveLength(1);
    const tx = Transaction.from(conn.sent[0]);
    expect(tx.verifySignatures()).toBe(true);
    expect(tx.instructions).toHaveLength(3);
    expect(out.signature).toBeTruthy();
  });

  it("never signs or sends when the server built a different registration than the page intended", async () => {
    const writer = Keypair.generate();
    const { fetchFn } = server(writer, { content_hash: hex("d") }); // server row differs from the page's inputs
    const conn = chainClient();
    await expect(registerWithoutWallet({ deps: browser(fetchFn, conn), action: "register", work: workInput, writer })).rejects.toMatchObject({ reason: "invalid_response" });
    expect(conn.sendRawTransaction).not.toHaveBeenCalled();
  });

  it("never signs when the fee payer or rent wallet is not the pinned one", async () => {
    const writer = Keypair.generate();
    const { fetchFn } = server(writer); const conn = chainClient();
    await expect(registerWithoutWallet({ deps: browser(fetchFn, conn, { pinned: { payer: rentWallet, rentWallet: payer } }), action: "register", work: workInput, writer })).rejects.toBeInstanceOf(SponsorFailure);
    expect(conn.sendRawTransaction).not.toHaveBeenCalled();
  });

  it("maps server errors to stored reasons and respects retryable", async () => {
    const writer = Keypair.generate();
    const { fetchFn, deps } = server(writer);
    deps.db.reserve = async () => ({ allowed: false, reason: "rate_limited" });
    await expect(registerWithoutWallet({ deps: browser(fetchFn, chainClient()), action: "register", work: workInput, writer })).rejects.toMatchObject({ reason: "limit", retryable: true });
    expect(reasonForCode("sponsorship_paused")).toBe("paused");
    expect(reasonForCode("kora_unavailable")).toBe("service_busy");
    expect(reasonForCode("something_new")).toBe("service_busy");
  });

  it("fails with session when there is no access token", async () => {
    const writer = Keypair.generate(); const { fetchFn } = server(writer);
    await expect(registerWithoutWallet({ deps: browser(fetchFn, chainClient(), { getAccessToken: async () => null }), action: "register", work: workInput, writer })).rejects.toMatchObject({ reason: "session" });
  });
});

describe("sendAndConfirm", () => {
  const run = (conn: ReturnType<typeof chainClient>) => {
    let t = 0;
    return sendAndConfirm(conn as unknown as BrowserDeps["connection"], Buffer.from([1]), "sig", "bh", () => t, async (ms) => { t += ms; });
  };
  it("resolves when confirmed and rebroadcasts identical bytes while waiting", async () => {
    const conn = chainClient({ landOn: 3 });
    await run(conn);
    expect(conn.sent.length).toBe(3);
    expect(conn.sent.every((b) => b.equals(conn.sent[0]))).toBe(true);
  });
  it("fails as expired once the blockhash is invalid and the signature is unknown", async () => {
    const conn = chainClient({ landOn: 9999, valid: false });
    await expect(run(conn)).rejects.toMatchObject({ reason: "expired" });
  });
  it("stops at 120 seconds even while the blockhash still looks valid", async () => {
    await expect(run(chainClient({ landOn: 9999, valid: true }))).rejects.toMatchObject({ reason: "expired" });
  });
  it("reports an on chain error without retrying blind", async () => {
    await expect(run(chainClient({ err: { InstructionError: [1, "Custom"] } }))).rejects.toMatchObject({ reason: "onchain_error", retryable: false });
  });
  it("fails fast if the first send is refused", async () => {
    const conn = chainClient(); conn.sendRawTransaction.mockRejectedValueOnce(new Error("Simulation failed"));
    await expect(run(conn)).rejects.toMatchObject({ reason: "network" });
  });
});
````

#### `src/tests/registerWork.test.ts`

````ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Keypair } from "@solana/web3.js";

const updates: [string, Record<string, unknown>][] = [];
vi.mock("../vault/queries", () => ({
  getAccessToken: async () => "good",
  updateWork: async (id: string, patch: Record<string, unknown>) => { updates.push([id, patch]); return {}; },
}));
vi.mock("../solana", () => ({ getConnection: () => ({}) }));
vi.mock("../supabase", () => ({ supabase: { from: () => ({}) } }));
vi.mock("../crypto", () => ({ importKeyHex: async () => ({}) as CryptoKey }));
const register = vi.fn();
vi.mock("../walletless/sponsoredRegister", async (orig) => ({ ...(await orig<typeof import("../walletless/sponsoredRegister")>()), registerWithoutWallet: (...a: unknown[]) => register(...a) }));
vi.mock("../walletless/writerKey", () => ({ ensureWriterKey: async () => Keypair.generate(), supabaseWriterKeyStore: () => ({}) }));

import { anchorWithoutWallet } from "../walletless/registerWork";
import { SponsorFailure } from "../walletless/sponsoredRegister";

const work = { id: "w1", content_hash: "a".repeat(64), link_nonce: "b".repeat(64), anchor_nonce: "c".repeat(64), ipfs_cid: "Qm", work_type: "screenplay", parent_work_id: null, anchor_retry_count: 1 };
const deps = {} as never;
beforeEach(() => { updates.length = 0; register.mockReset(); });

describe("anchorWithoutWallet", () => {
  it("records submitted then confirmed with the on-chain addresses", async () => {
    register.mockResolvedValue({ signature: "sig1", alreadyRegistered: false, records: { work_claim: "wc", content_artifact: "ca", anchor_record: "ar" } });
    const patch = await anchorWithoutWallet({ work, userId: "u", vaultKeyHex: "00", deps });
    expect(updates.map(([, p]) => p.anchor_state)).toEqual(["submitted", "confirmed"]);
    expect(patch).toMatchObject({ anchor_state: "confirmed", tx_id: "sig1", work_claim_pda: "wc", content_artifact_pda: "ca", anchor_record_pda: "ar", anchor_mode: 1 });
    expect(register.mock.calls[0][0].action).toBe("register");
  });
  it("uses add_version for a version row and passes the root claim", async () => {
    register.mockResolvedValue({ signature: null, alreadyRegistered: true, records: { work_claim: "wc", content_artifact: "ca", anchor_record: "ar" } });
    await anchorWithoutWallet({ work: { ...work, parent_work_id: "root" }, userId: "u", vaultKeyHex: "00", rootWorkClaim: "claim", deps });
    expect(register.mock.calls[0][0]).toMatchObject({ action: "add_version", work: { rootWorkClaim: "claim" } });
  });
  it("turns a failure into a failed patch with a short code and keeps the draft", async () => {
    register.mockRejectedValue(new SponsorFailure("limit", true));
    const patch = await anchorWithoutWallet({ work, userId: "u", vaultKeyHex: "00", deps });
    expect(patch).toMatchObject({ anchor_state: "failed", anchor_failure_reason: "limit", anchor_retry_count: 2 });
    expect(updates.at(-1)?.[1].anchor_state).toBe("failed");
  });
  it("maps an unknown error to service_busy and does not leak its text", async () => {
    register.mockRejectedValue(new Error("secret internal detail"));
    const patch = await anchorWithoutWallet({ work, userId: "u", vaultKeyHex: "00", deps });
    expect(patch.anchor_failure_reason).toBe("service_busy");
    expect(JSON.stringify(updates)).not.toContain("secret internal detail");
  });
});
````


Tests you must write (not provided):

- **U: UploadFlow wiring.** Extend the style of `src/tests/tier2-ui-failures.test.tsx`: with
  `VITE_WALLETLESS_REGISTER=true` and no wallet, protecting a draft calls `anchorWithoutWallet` once, a
  `failed` patch yields the designed failure text, the wallet path is untouched when a wallet is connected,
  and the "Connect wallet" card is hidden. Mock `../walletless/registerWork`.
- **R: Retry button.** `RegistrationResult` with `anchor_state: "failed"` and `onRetry` shows "Try again";
  clicking it calls `onRetry` once and disables the button meanwhile; `limit` and `paused` reasons show
  "Try again later."; without `onRetry` no button renders.
- **S: SQL on a real stack** (needs Docker; report "not run" if unavailable). With `supabase start` and the
  migration applied: an authenticated user can read and insert only their own `user_writer_keys` row and
  cannot update or delete it; cannot insert into or update `sponsored_registrations`; cannot call
  `reserve_sponsored_registration`; the service role can. The limits trip at 5 per hour, 20 per day and
  200 global; two concurrent reserves for one user cannot both pass at the limit; a second open row for one
  work is refused; a `failed` row does not count and does not block a retry; a `reserved` row older than
  3 minutes is failed by the next reserve.

Commands to run and paste results for:

```bash
npx vitest run src/tests/sponsorTx.test.ts src/tests/sponsorHandler.test.ts src/tests/walletless.test.ts src/tests/registerWork.test.ts
npm run typecheck && npm run lint && npm test && npm run build
grep -rEl "KORA_API_KEY|KORA_HMAC_SECRET|RENT_WALLET_SECRET_KEY" dist/ || echo "no secret names in dist"
```

Expected from the reference tests alone: 74 + 37 + 14 + 4 = 129 passing. A different number means a copy
error or a version difference; investigate before adding anything.

## 10. Secrets and configuration (names only; Milan sets the values)

Edge Function secrets for `sponsor-register`. Never put values in the repo, a commit message, or output.

| Name | Kind | Purpose |
|---|---|---|
| `KORA_URL` | config | Kora base URL |
| `KORA_API_KEY` | secret | `x-api-key` header |
| `KORA_HMAC_SECRET` | secret | HMAC-SHA256 key |
| `KORA_FEE_PAYER_ADDRESS` | public config | pinned Kora fee payer address (section 5) |
| `RENT_WALLET_SECRET_KEY` | secret | rent wallet keypair as a JSON array of 64 integers, the same text a Solana keypair file holds |
| `RENT_WALLET_ADDRESS` | public config | pinned rent wallet address; the function refuses to sign if the secret's public key differs |
| `SOLANA_RPC_URL` | secret | server-side devnet RPC URL; use a server-only key, not the browser's `VITE_HELIUS_API_KEY` |
| `SPONSOR_ENABLED` | config | kill switch; must equal `true` to sponsor (read when the function instance starts) |
| `RENT_WALLET_MIN_RESERVE_LAMPORTS` | config | `1000000000` |

Provided by Supabase: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
Vercel (public, per environment): `VITE_WALLETLESS_REGISTER` set to `true` to enable the walletless path.

## 11. Human steps after you finish (Milan; you do none of these)

Run in a private terminal. Use `read -rsp` so secrets never appear on screen or in shell history.

```bash
# 1. After review: apply the migration (affects the live project)
supabase db push --project-ref khygvzpnyimrxndlvlje

# 2. Set secrets, one at a time
read -rsp 'KORA_API_KEY: ' V; echo; supabase secrets set --project-ref khygvzpnyimrxndlvlje "KORA_API_KEY=$V"; unset V
read -rsp 'KORA_HMAC_SECRET: ' V; echo; supabase secrets set --project-ref khygvzpnyimrxndlvlje "KORA_HMAC_SECRET=$V"; unset V
read -rsp 'SOLANA_RPC_URL: ' V; echo; supabase secrets set --project-ref khygvzpnyimrxndlvlje "SOLANA_RPC_URL=$V"; unset V
read -rp  'Path to the rent wallet keypair file: ' F
supabase secrets set --project-ref khygvzpnyimrxndlvlje "RENT_WALLET_SECRET_KEY=$(cat "$F")"; unset F
supabase secrets set --project-ref khygvzpnyimrxndlvlje \
  KORA_URL=https://plotarmor-kora-devnet.onrender.com \
  KORA_FEE_PAYER_ADDRESS=HWfGUebvq9ez4EWZKXoDBiNfH8uQ2q3mpMqpVCHfMdSW \
  RENT_WALLET_ADDRESS=HZJTTwQMa6uyfA9AMXMmJKb9UrzxzGTKPAXQ2LKxgFLn \
  RENT_WALLET_MIN_RESERVE_LAMPORTS=1000000000 SPONSOR_ENABLED=true

# 3. Deploy the function (JWT verification stays on)
supabase functions deploy sponsor-register --project-ref khygvzpnyimrxndlvlje

# 4. Vercel: set VITE_WALLETLESS_REGISTER=true on Preview first
```

Before the first run, check the rent wallet balance (about 9.99 SOL at the last readback).

## 12. Live test plan (after deploy; Milan runs, agents may only analyze the evidence he returns)

Passes needed before any "verified" wording (CLAUDE.md in `plotarmor-kora`: four independent passes):
1. Automated tests (section 9): one pass.
2. Live pass A: in the Preview app, as a test user with no wallet, with Kora asleep (idle 15+ minutes),
   register a small test file. Record: how long the first call took, the Edge Function log line
   (`outcome: "issued"`, `kora_cold`, `liveness_ms`), the `sponsored_registrations` row, the final
   signature, and a readback of the landed transaction (signers are Kora, writer, rent wallet; writer ends
   at 0 lamports; rent wallet delta equals `rent_lamports`; Kora paid only the network fee; the six
   accounts are program-owned and exactly rent funded). Save the signature and readback under
   `plotarmor-kora/evidence/<date>_walletless_register_devnet.*` (adapt
   `evidence/2026-10-05_sponsored_register_devnet.fetch.mjs`).
3. Live pass B: a different user and file, plus an `add_version` of the first work, plus negative checks:
   no token returns 401; the sixth registration inside an hour returns 429 `rate_limited`; set
   `SPONSOR_ENABLED=false` and see `sponsorship_paused`; confirm the user-facing text is the designed
   failure state with "Try again" and that the draft stays saved.
4. An independent re-audit by a different session or agent of the validator, the function, the
   migration, and the browser flow, with the ledger rows and function logs available.

Unproven until live: Kora accepting a UUID as `user_id` (if it rejects, the fix is one line in
`handle.ts`: pass the writer address instead, and say so in the evidence); the app arguments (claim_kind 1,
shares 100/100) through Kora; `isBlockhashValid` on the server RPC; the real cold start time against
"up to 30 seconds".

## 13. Defaults taken where Milan said "use your recommended defaults"

Alert when the rent wallet balance falls under the reserve (Milan refills by hand on devnet). Same file
registered before: allow it and price five accounts. Mainnet: out of scope until Phase 7. Direct browser
send with a reconciled ledger, no `sponsor-submit` function. Confirmed email only for now; revisit captcha
before any public launch. Both extra copy lines ("Try again later." for limit and paused, and
"Still registering. This is taking longer than usual." after 30 seconds, optional) are approved. Live
scripts live in the demo repo, signature readback in `plotarmor-kora/evidence/`. On erasure, purge the
user's `sponsored_registrations` rows in the erasure workflow (check `supabase/functions/erase-user` and
migration `20260902000000_add_user_erasure_workflow.sql` for how per-user tables are handled and add both
new tables if needed; report what you find). Keep the wallet path when a wallet is connected. Sponsored
`add_owner` is deferred.

## 14. Known gaps and risks (report these in your handoff, do not hide them)

- `index.ts` returns its configuration error without CORS headers, so the browser sees a network error and
  records `service_busy`. Acceptable; improve if you like.
- `SPONSOR_ENABLED` and the other env values are read when a function instance starts. A secret change takes
  effect when Supabase restarts instances (inferred). If an instant kill switch matters, move it to a
  one-row table read per request.
- Edge Function wall-clock limit: the 110 second deadline assumes about 150 seconds on the current plan
  (inferred; confirm).
- A work with a root registered by a connected wallet cannot get walletless versions (reports `not_ready`).
- `already_registered` can return `signature: null` if the ledger has none; the browser then saves `tx_id`
  as null. Optional improvement: look the signature up with `getSignaturesForAddress` on the work claim.
- Free Render plan: Kora's own usage counters are not durable. The Supabase ledger is the budget record.
- The writer's address is public after its first registration, so strangers can send it dust. The function
  subtracts the existing balance from the transfer and refuses only if the balance already covers the rent.
- The browser pins the Kora fee payer and rent wallet addresses as constants in `sponsorTx.ts`. If either
  address ever changes, update the constants and the two config values together.
- Devnet only. Mainnet needs a separate review: real rent cost, rent wallet custody, limits, legal.

## 15. Prompt to give Codex

````text
Implement walletless draft registration in plotarmor-demo exactly as described in
~/plotarmor-kora/docs/BRIEF_demo_walletless.md. Read the whole brief first. Devnet only.

Do, in order:
1. Section 4: create the worktree and branch feat/walletless-register from feat/saas-ui, npm ci, add
   @noble/curves, tsconfig and env.d.ts edits.
2. Create every file in sections 7 and 9 exactly as shown; run sha256sum and compare with the table in
   section 3. Run the four test files; expect 129 passing.
3. Make the edits in section 8 (UploadFlow, RegistrationResult, VaultApp, package.json, env docs).
4. Write tests U and R (section 9). Run test S only if a local Supabase stack exists; otherwise report
   "not run". Check erase-user and the erasure migration (section 13) and report.
5. Run npm run typecheck, npm run lint, npm test, npm run build and the dist grep. Paste results.

Rules: no commit or push without my approval; if I approve, stage only named files. Do not deploy, do not
run supabase db push, do not set secrets, do not read .env files or print any key, do not call any live
service, do not touch plotarmor-kora or plotarmor-program. Never generate Kora or rent wallet keys, even
for tests; tests use the RFC 8032 vectors already in the test files. Supabase project is
khygvzpnyimrxndlvlje only. No em dashes or en dashes. Label anything not confirmed by running a command as
"inferred". Say "provisional", never "verified" or "secure". If the brief and the repo disagree, stop and
ask.

Final report: files changed, every test and command result, what you did NOT run (Deno, live, SQL on a real
stack), the known gaps from section 14 that still apply, the human steps from section 11, and the pass
count (1 at most: the automated suite). Leave everything uncommitted in the worktree.
````
