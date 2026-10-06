#!/usr/bin/env node
// Devnet only. Design B from evidence/2026-09-30-rent-spike/REPORT.md, sections 3 and 5.
// One legacy transaction: rent wallet -> fresh zero-SOL writer (exact live rent), then
// register_work_claim (app parameters: claim_kind 1, shares 100/100) with the writer as signer, claimant and payer, then Kora's appended
// Lighthouse assertion. Kora is fee payer and pays the network fee only.
// Requires the deployed policy to allow max_signatures = 3.
// Usage: sponsored_register_demo.mjs dry-run|send|send-with-version [CIDv0]
//   dry-run            stops after the fully signed sigVerify simulation, broadcasts nothing.
//   send               broadcasts the registration once.
//   send-with-version  in one process: registers, waits for finalized, reads the claim's latest_link from the
//                      chain, then sends rent transfer + add_version signed by the same in-memory writer key.
//                      The writer key is generated in memory and is never written anywhere.
// The optional CIDv0 sets external_ref_hash to its sha2-256 digest, the way the app does (see cidToExternalRefHash).
// Never reads Kora's fee-payer key. Loads only the rent wallet file used by the earlier probes.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { hmac, inspectSignedTransaction } from './verify_live_sign_transaction.mjs';
import { buildRegistrationProbe, buildAddVersionProbe } from './verify_register_work_claim.mjs';
import { PROGRAM, DEVNET_GENESIS_HASH } from './verify_plotarmor_sign_transaction.mjs';

const require = createRequire(new URL('../../plotarmor-program/package.json', import.meta.url));
const { PublicKey, Transaction, SystemProgram, Keypair } = require('@solana/web3.js');
const bs58 = require('bs58');

const KORA_URL = 'https://plotarmor-kora-devnet.onrender.com';
const DEVNET_URL = 'https://api.devnet.solana.com';
const SYSTEM = '11111111111111111111111111111111';
const LIGHTHOUSE = 'L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95';
export const RENT_WALLET = 'HZJTTwQMa6uyfA9AMXMmJKb9UrzxzGTKPAXQ2LKxgFLn';
// The six accounts register_work_claim creates; sizes include the 8-byte discriminator.
export const RECORD_SIZES = { content_artifact: 50, work_claim: 210, ownership: 110, owner_record: 75, claim_artifact_link: 112, anchor_record: 82 };
// The three accounts add_version creates (content_artifact is new because the version has new content).
export const VERSION_RECORDS = ['content_artifact', 'claim_artifact_link', 'anchor_record'];
// Gateway cap on rent-wallet spending per transaction (Kora's caps protect only Kora's key).
export const MAX_RENT_LAMPORTS = 8_000_000;
// Arguments the web app sends today (UploadFlow.tsx: Original claim, 100/100 shares, screenplay).
// anchor_mode_arg stays 1 (AttestedDevnet). external_ref_hash is zero unless a CID is given.
export const APP_PARAMS = Object.freeze({ content_kind: 1, claim_kind: 1, total_shares: 100, threshold_shares: 100 });
const sha = value => createHash('sha256').update(value).digest('hex');
const encode58 = bytes => (bs58.default ?? bs58).encode(bytes);

// Same rule as plotarmor-demo src/vault/ipfs.ts lines 46-62 (cidToExternalRefHash), with base58Decode at lines 18-40:
// a CIDv0 is 46 characters starting with "Qm" and decodes to 34 bytes, 0x12 0x20 then the 32-byte sha2-256 digest.
// The app passes that digest as number[] (cidToExternalRefHashArray, lines 64-66; used at UploadFlow.tsx:494).
export function cidToExternalRefHash(cid) {
  assert.ok(cid && cid.startsWith('Qm') && cid.length === 46, `Not a valid CIDv0: ${cid}`);
  const decoded = (bs58.default ?? bs58).decode(cid);
  assert.equal(decoded.length, 34, `Unexpected decoded length: ${decoded.length} (expected 34)`);
  assert.ok(decoded[0] === 0x12 && decoded[1] === 0x20, 'Unexpected multihash prefix');
  return Array.from(decoded.slice(2));
}

// The rent quote must cover exactly the accounts the instruction creates.
export function sumRent(perRecord, names = Object.keys(RECORD_SIZES)) {
  assert.deepEqual(Object.keys(perRecord), names, `Rent quote must cover exactly: ${names.join(', ')}`);
  let total = 0;
  for (const value of Object.values(perRecord)) {
    assert.ok(Number.isSafeInteger(value) && value > 0, `Invalid rent value ${value}`);
    total += value;
  }
  assert.ok(Number.isSafeInteger(total) && total <= MAX_RENT_LAMPORTS, `Rent ${total} exceeds the gateway cap ${MAX_RENT_LAMPORTS}`);
  return total;
}

function assemble(payer, writer, blockhash, lamports, probe, expectedProgramData, rentWalletAddress = RENT_WALLET) {
  assert.ok(Number.isSafeInteger(lamports) && lamports > 0 && lamports <= MAX_RENT_LAMPORTS, 'Transfer amount outside the gateway cap');
  assert.ok(new Set([payer, writer, rentWalletAddress]).size === 3, 'Kora, rent wallet and writer must be distinct');
  const instruction = Transaction.from(probe.wire).instructions[0];
  // Restore the IDL account flags: decoding marks every transaction signer as signer here.
  instruction.keys = instruction.keys.map(k => ({ ...k, isSigner: k.pubkey.toBase58() === writer }));
  assert.equal(instruction.programId.toBase58(), PROGRAM);
  assert.ok(instruction.data.equals(expectedProgramData));
  const tx = new Transaction({ feePayer: new PublicKey(payer), recentBlockhash: blockhash })
    .add(SystemProgram.transfer({ fromPubkey: new PublicKey(rentWalletAddress), toPubkey: new PublicKey(writer), lamports }))
    .add(instruction);
  const wire = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
  return { wire, records: probe.addresses };
}

// `externalRefHash` is an optional array of 32 numbers (see cidToExternalRefHash); zeros when omitted.
export function buildSponsoredTransaction(payer, writer, blockhash, lamports, intent, externalRefHash, rentWalletAddress = RENT_WALLET) {
  const overrides = externalRefHash ? { ...APP_PARAMS, external_ref_hash: externalRefHash } : APP_PARAMS;
  const probe = buildRegistrationProbe(payer, writer, blockhash, intent, overrides);
  return assemble(payer, writer, blockhash, lamports, probe, probe.data, rentWalletAddress);
}

// add_version for a claim the same writer registered. `workClaim` and `expectedPreviousLink` come from the chain.
export function buildSponsoredVersionTransaction(payer, writer, blockhash, lamports, intent, { workClaim, expectedPreviousLink, externalRefHash }, rentWalletAddress = RENT_WALLET) {
  const probe = buildAddVersionProbe(payer, writer, blockhash, intent,
    { workClaim, expectedPreviousLink, contentKind: APP_PARAMS.content_kind, externalRefHash });
  return assemble(payer, writer, blockhash, lamports, probe, probe.data, rentWalletAddress);
}

// WorkClaim layout after the 8-byte discriminator: root_artifact, latest_artifact, latest_link, claimant, ownership
// (32 bytes each), then created_at, claim_kind, discoverability, superseded_by (programs/plotarmor/src/state.rs).
export function parseWorkClaim(data) {
  assert.ok(data.length >= 210, `WorkClaim data too short: ${data.length}`);
  const at = offset => new PublicKey(data.subarray(offset, offset + 32)).toBase58();
  return { rootArtifact: at(8), latestArtifact: at(40), latestLink: at(72), claimant: at(104) };
}

const describe = ix => JSON.stringify({ p: ix.programId.toBase58(), d: ix.data.toString('hex'),
  k: ix.keys.map(k => [k.pubkey.toBase58(), k.isWritable, k.isSigner]) });

// Structural checks first, then Kora's Ed25519 signature, so failures name the exact cause.
export function verifyKoraReturn(result, payer, wire, writer, rentWalletAddress = RENT_WALLET) {
  const original = Transaction.from(wire); // Compare decoded against decoded.
  const after = Transaction.from(Buffer.from(result.signed_transaction, 'base64'));
  assert.equal(after.recentBlockhash, original.recentBlockhash, 'Kora changed the blockhash');
  assert.equal(after.feePayer.toBase58(), payer, 'Kora changed the fee payer');
  assert.equal(after.instructions.length, 3, 'Expected transfer, registration and exactly one Lighthouse assertion');
  assert.equal(describe(after.instructions[0]), describe(original.instructions[0]), 'Transfer instruction changed');
  assert.equal(describe(after.instructions[1]), describe(original.instructions[1]), 'Registration instruction changed');
  assert.equal(after.instructions[0].programId.toBase58(), SYSTEM);
  assert.equal(after.instructions[1].programId.toBase58(), PROGRAM);
  assert.equal(after.instructions[2].programId.toBase58(), LIGHTHOUSE, 'Third instruction is not Lighthouse');
  const expected = Transaction.from(wire).add(after.instructions[2]);
  assert.ok(expected.serializeMessage().equals(after.serializeMessage()), 'Kora changed the message beyond the Lighthouse append');
  const signers = after.signatures.map(s => s.publicKey.toBase58());
  assert.deepEqual([...signers].sort(), [payer, rentWalletAddress, writer].sort(), 'Unexpected signer set');
  assert.equal(signers[0], payer);
  assert.ok(after.signatures.slice(1).every(s => s.signature === null), 'Unexpected non-Kora signature before co-signing');
  const checked = inspectSignedTransaction(result, payer, wire);
  assert.ok(checked.lighthouseValid, 'Lighthouse assertion is not the expected fee-payer balance check');
  assert.ok(checked.signatureValid, 'Invalid Kora signature');
  return { transaction: after, lighthouse_minimum_lamports: after.instructions[2].data.readBigUInt64LE(3).toString() };
}

// `opts` exists so the whole flow can be tested against fake endpoints. The command line passes none, so
// production runs use process.argv, process.env, the global fetch and the real rent wallet address.
export async function main(opts = {}) {
  const argv = opts.argv ?? process.argv.slice(2);
  const env = opts.env ?? process.env;
  const fetchFn = opts.fetchFn ?? fetch;
  const RENT = opts.rentWalletAddress ?? RENT_WALLET;
  const log = opts.log ?? console.log;
  const logError = opts.logError ?? console.error;
  const [mode, cid] = argv.slice(0, 2);
  assert.ok(['dry-run', 'send', 'send-with-version'].includes(mode), 'Usage: sponsored_register_demo.mjs dry-run|send|send-with-version [CIDv0]');
  const externalRefHash = cid ? cidToExternalRefHash(cid) : undefined;
  const dir = env.PROBE_OUTPUT;
  assert.ok(dir, 'Set PROBE_OUTPUT to a new evidence directory');
  const rentWalletFile = env.PROBE_KEYPAIR_PATH;
  assert.ok(rentWalletFile, 'Set PROBE_KEYPAIR_PATH to the rent wallet keypair file');
  assert.ok(env.KORA_API_KEY && env.KORA_HMAC_SECRET, 'Set KORA_API_KEY and KORA_HMAC_SECRET in this terminal');
  mkdirSync(dirname(dir), { recursive: true });
  mkdirSync(dir, { recursive: false }); // Never overwrite an earlier run.
  const writes = mode === 'send-with-version' ? 2 : mode === 'send' ? 1 : 0;
  // Plain modes keep the original file names; send-with-version prefixes per-transaction files.
  const save = (name, value) => writeFileSync(`${dir}/${name}`, typeof value === 'string' ? value : JSON.stringify(value, null, 2), { flag: 'wx', mode: 0o600 });
  let seq = 0, sends = 0;
  const KORA_METHODS = ['getPayerSigner', 'getBlockhash', 'signTransaction'];
  const DEVNET_METHODS = ['getGenesisHash', 'getMultipleAccounts', 'getBalance', 'getMinimumBalanceForRentExemption',
    'simulateTransaction', 'getSignatureStatuses', 'getTransaction', ...(writes ? ['sendTransaction'] : [])];

  async function rpc(method, params, kora = false) {
    assert.ok((kora ? KORA_METHODS : DEVNET_METHODS).includes(method), `Forbidden RPC method: ${method}`);
    if (method === 'sendTransaction') assert.ok(++sends <= writes, 'Refusing an extra broadcast');
    const id = ++seq;
    const body = JSON.stringify({ jsonrpc: '2.0', id, method, params });
    const prefix = `${String(id).padStart(3, '0')}-${kora ? 'kora' : 'devnet'}-${method}`;
    save(`${prefix}.request.json`, body);
    const headers = { 'content-type': 'application/json' };
    if (kora) {
      headers['x-api-key'] = env.KORA_API_KEY;
      headers['x-timestamp'] = String(Math.floor(Date.now() / 1000));
      headers['x-hmac-signature'] = hmac(env.KORA_HMAC_SECRET, headers['x-timestamp'], body);
    }
    let response;
    try { response = await fetchFn(kora ? KORA_URL : DEVNET_URL, { method: 'POST', headers, body, redirect: 'error', signal: AbortSignal.timeout(90000) }); }
    catch (error) { save(`${prefix}.transport-error.txt`, String(error)); throw error; }
    const raw = await response.text();
    save(`${prefix}.response.txt`, raw);
    save(`${prefix}.http.json`, { status: response.status, received_at: new Date().toISOString() });
    let parsed;
    try { parsed = JSON.parse(raw); } catch { throw new Error(`${method}: HTTP ${response.status}, non-JSON body; see ${prefix}.response.txt`); }
    if (!response.ok || parsed.error) throw new Error(`${method} rejected: ${JSON.stringify(parsed.error ?? response.status)}; see ${prefix}.response.txt`);
    assert.equal(parsed.id, id);
    return parsed.result;
  }

  save('run.json', { started_at: new Date().toISOString(), mode, cid: cid ?? null, external_ref_hash_hex: externalRefHash ? Buffer.from(externalRefHash).toString('hex') : null,
    program: PROGRAM, kora: KORA_URL, devnet: DEVNET_URL, policy_sha256: sha(readFileSync(new URL('../kora.toml', import.meta.url))) });
  const status = { mode, result: 'FAIL' };

  // One sponsored transaction from pricing to the ledger readback. `spec.build` returns { wire, records }.
  // `file` prefixes the per-transaction evidence files ('' for the plain modes).
  async function runOne({ label, file, intent, names, build, send, payer, writer, rentWallet }) {
    const step = text => log(`[${label}] ${text}`);
    step('Price the new records from live rent and check they and the writer are unused');
    const perRecord = {};
    for (const name of names) perRecord[name] = await rpc('getMinimumBalanceForRentExemption', [RECORD_SIZES[name], { commitment: 'confirmed' }]);
    const rent = sumRent(perRecord, names);
    log(`Storage deposit for ${names.length} records: ${rent} lamports`);
    const blockhash = (await rpc('getBlockhash', {}, true)).blockhash;
    const built = build(blockhash, rent);
    const writerAddress = writer.publicKey.toBase58();
    const existing = await rpc('getMultipleAccounts', [[...names.map(n => built.records[n]), writerAddress],
      { encoding: 'base64', commitment: 'confirmed', dataSlice: { offset: 0, length: 0 } }]);
    assert.equal(existing.value.length, names.length + 1, 'Invalid account existence response');
    const occupied = names.filter((_, i) => existing.value[i] !== null);
    assert.equal(occupied.length, 0, `Records already exist: ${occupied.join(', ')}`);
    assert.equal(existing.value[names.length], null, 'Writer must start at 0 lamports');
    save(`${file}accounts.json`, { intent, writer: writerAddress, rent_wallet: RENT, kora_fee_payer: payer, rent_lamports: rent,
      rent_per_record: perRecord, records: built.records });

    step('Unsigned preflight');
    save(`${file}unsigned.transaction.base64`, built.wire.toString('base64'));
    const pre = await rpc('simulateTransaction', [built.wire.toString('base64'), { encoding: 'base64', sigVerify: false, commitment: 'confirmed' }]);
    assert.equal(pre.value.err, null, `Unsigned simulation failed: ${JSON.stringify(pre.value.err)}`);

    step('Kora checks policy, appends Lighthouse and signs as fee payer (sign only)');
    const signed = await rpc('signTransaction', { transaction: built.wire.toString('base64'), signer_key: payer, sig_verify: false, user_id: writerAddress }, true);
    const verified = verifyKoraReturn(signed, payer, built.wire, writerAddress, RENT);
    const after = verified.transaction;
    save(`${file}kora-verification.json`, { signature_valid: true, blockhash_and_fee_payer_unchanged: true,
      instructions_0_1_identical: true, only_lighthouse_appended: true, signer_set: after.signatures.map(s => s.publicKey.toBase58()),
      lighthouse_minimum_lamports: verified.lighthouse_minimum_lamports });

    step('Writer and rent wallet sign the returned message');
    const message = after.serializeMessage();
    after.partialSign(writer, rentWallet);
    assert.ok(message.equals(after.serializeMessage()), 'Message changed while signing');
    assert.ok(after.verifySignatures(), 'Signature check failed');
    const final = after.serialize();
    const signature = encode58(after.signature);
    save(`${file}signed.transaction.base64`, final.toString('base64'));
    save(`${file}message.sha256`, sha(message));
    log(`Transaction size: ${final.length} bytes; signature: ${signature}`);

    step('Simulate the exact signed bytes with sigVerify');
    const sim = await rpc('simulateTransaction', [final.toString('base64'), { encoding: 'base64', sigVerify: true, commitment: 'confirmed' }]);
    assert.equal(sim.value.err, null, `Signed simulation failed: ${JSON.stringify(sim.value.err)}`);
    if (!send) return { rent, records: built.records, perRecord };

    step('Send to devnet once (maxRetries 0)');
    save(`${file}signature-before-send.json`, { signature });
    log(`If anything below times out, check https://explorer.solana.com/tx/${signature}?cluster=devnet before doing anything else.`);
    let sent;
    try { sent = await rpc('sendTransaction', [final.toString('base64'), { encoding: 'base64', skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 0 }]); }
    catch (error) { throw new Error(`sendTransaction outcome unknown (${error.message}). Do not resend; check ${signature} first`); }
    assert.equal(sent, signature, 'Returned signature does not match');
    save(`${file}signature.json`, { signature });
    await waitForStatus(signature, ['confirmed', 'finalized'], 60, `Not confirmed after polling. Do not resend; check ${signature} on the explorer first`);

    step('Read the result back from the ledger');
    const landed = await rpc('getTransaction', [signature, { encoding: 'json', commitment: 'confirmed', maxSupportedTransactionVersion: 0 }]);
    assert.equal(landed.meta.err, null, 'Landed transaction has an error');
    const keys = landed.transaction.message.accountKeys;
    const signers = keys.slice(0, landed.transaction.message.header.numRequiredSignatures);
    assert.deepEqual([...signers].sort(), [payer, RENT, writerAddress].sort(), 'Landed signer set differs');
    assert.equal(signers[0], payer, 'Landed fee payer is not Kora');
    const delta = k => landed.meta.postBalances[keys.indexOf(k)] - landed.meta.preBalances[keys.indexOf(k)];
    const writerAfter = landed.meta.postBalances[keys.indexOf(writerAddress)];
    assert.equal(writerAfter, 0, 'Writer did not end at 0 lamports');
    assert.equal(delta(RENT), -rent, 'Rent wallet delta differs from the quote');
    assert.equal(delta(payer), -landed.meta.fee, 'Kora paid more than the network fee');
    const created = await rpc('getMultipleAccounts', [names.map(n => built.records[n]), { encoding: 'base64', commitment: 'confirmed', dataSlice: { offset: 0, length: 0 } }]);
    const wrong = names.filter((n, i) => created.value[i]?.owner !== PROGRAM || created.value[i]?.lamports !== perRecord[n]);
    assert.equal(wrong.length, 0, `Records missing, not program-owned or not exactly rent-funded: ${wrong.join(', ')}`);
    const result = { result: 'PASS', signature, signers, fee_lamports: landed.meta.fee, slot: landed.slot,
      rent_lamports: rent, rent_wallet_delta: delta(RENT), kora_delta: delta(payer), writer_post_lamports: writerAfter,
      records: built.records, explorer: `https://explorer.solana.com/tx/${signature}?cluster=devnet` };
    log(`PASS (${label}). Signers: ${signers.join(', ')}`);
    log(`Network fee paid by Kora: ${landed.meta.fee} lamports; rent wallet: ${delta(RENT)}; writer after: ${writerAfter}`);
    log(`Explorer: ${result.explorer}`);
    return result;
  }

  async function waitForStatus(signature, accepted, polls, failure) {
    for (let i = 0; i < polls; i++) {
      const s = (await rpc('getSignatureStatuses', [[signature], { searchTransactionHistory: true }])).value[0];
      if (s?.err) throw new Error(`Transaction failed on chain: ${JSON.stringify(s.err)}`);
      if (accepted.includes(s?.confirmationStatus)) return;
      await new Promise(r => setTimeout(r, 1500));
    }
    throw new Error(failure);
  }

  try {
    log('\n[setup] Devnet and Kora reachable (first Kora call can take about a minute if Render was asleep)');
    assert.equal(await rpc('getGenesisHash', []), DEVNET_GENESIS_HASH, 'Not devnet');
    const payer = (await rpc('getPayerSigner', {}, true)).signer_address;
    log(`Kora fee payer: ${payer}`);

    // Only this explicitly authorized ordinary wallet is loaded. Never open Kora's key.
    const rentWallet = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(rentWalletFile, 'utf8'))));
    assert.equal(rentWallet.publicKey.toBase58(), RENT, 'Unexpected rent wallet');
    const writer = Keypair.generate(); // Throwaway devnet identity, held only in memory, never saved or printed.
    log(`Rent wallet: ${RENT}\nWriter (new): ${writer.publicKey.toBase58()}`);
    if (cid) log(`external_ref_hash from CID ${cid}: ${Buffer.from(externalRefHash).toString('hex')}`);
    const writerAddress = writer.publicKey.toBase58();
    const plain = mode !== 'send-with-version';

    const intent = `sponsored-demo-${randomUUID()}`;
    const first = await runOne({ label: 'register', file: plain ? '' : 'register-', intent, names: Object.keys(RECORD_SIZES), send: mode !== 'dry-run',
      payer, writer, rentWallet, build: (blockhash, rent) => buildSponsoredTransaction(payer, writerAddress, blockhash, rent, intent, externalRefHash, RENT) });
    if (mode === 'dry-run') {
      Object.assign(status, { result: 'DRY-RUN PASS', note: 'Kora accepted three signatures; nothing broadcast', rent_lamports: first.rent });
      log('\nDRY-RUN PASS: Kora signed a three-signer transaction and the signed bytes simulate. Nothing was broadcast.');
      return status;
    }
    if (mode === 'send') { Object.assign(status, first); return status; }

    // send-with-version: finalized, then read the lineage head from the chain, then add_version.
    log('\n[register] Wait for finalized before reading the claim');
    await waitForStatus(first.signature, ['finalized'], 80, `Registration ${first.signature} not finalized in time. Do not resend; check the explorer`);
    const claimAddress = first.records.work_claim;
    const claimInfo = await rpc('getMultipleAccounts', [[claimAddress], { encoding: 'base64', commitment: 'finalized' }]);
    const account = claimInfo.value[0];
    assert.ok(account && account.owner === PROGRAM, 'Work claim account missing or not program-owned');
    const head = parseWorkClaim(Buffer.from(account.data[0], 'base64'));
    assert.equal(head.claimant, writerAddress, 'Claim claimant is not the writer');
    assert.equal(head.latestLink, first.records.claim_artifact_link, 'Chain latest_link differs from the registration link');
    save('claim-head-before-version.json', { work_claim: claimAddress, ...head });
    log(`Chain latest_link before the version: ${head.latestLink}`);

    const versionIntent = `sponsored-version-${randomUUID()}`;
    const second = await runOne({ label: 'add_version', file: 'version-', intent: versionIntent, names: VERSION_RECORDS, send: true,
      payer, writer, rentWallet, build: (blockhash, rent) => buildSponsoredVersionTransaction(payer, writerAddress, blockhash, rent, versionIntent,
        { workClaim: claimAddress, expectedPreviousLink: head.latestLink, externalRefHash }, RENT) });

    const after = await rpc('getMultipleAccounts', [[claimAddress], { encoding: 'base64', commitment: 'confirmed' }]);
    const headAfter = parseWorkClaim(Buffer.from(after.value[0].data[0], 'base64'));
    assert.equal(headAfter.latestLink, second.records.claim_artifact_link, 'Claim latest_link did not advance to the version link');
    assert.equal(headAfter.latestArtifact, second.records.content_artifact, 'Claim latest_artifact did not advance to the version content');
    save('claim-head-after-version.json', { work_claim: claimAddress, ...headAfter });
    Object.assign(status, { result: 'PASS', register: first, add_version: second, claim_head_before: head, claim_head_after: headAfter });
    log(`\nPASS. Registration signature: ${first.signature}\nVersion signature:      ${second.signature}`);
  } catch (error) {
    status.error = String(error?.message ?? error);
    logError(`\nFAIL: ${status.error}`);
  } finally {
    save('summary.json', { ...status, finished_at: new Date().toISOString() });
  }
  return status;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const status = await main();
  if (status.result === 'FAIL') process.exitCode = 1;
}
