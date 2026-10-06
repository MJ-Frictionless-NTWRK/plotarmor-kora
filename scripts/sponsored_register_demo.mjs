#!/usr/bin/env node
// Devnet only. Design B from evidence/2026-09-30-rent-spike/REPORT.md, sections 3 and 5.
// One legacy transaction: rent wallet -> fresh zero-SOL writer (exact live rent), then
// register_work_claim with the writer as signer, claimant and payer, then Kora's appended
// Lighthouse assertion. Kora is fee payer and pays the network fee only.
// Requires the deployed policy to allow max_signatures = 3.
// Modes: "dry-run" stops after the fully signed sigVerify simulation; "send" broadcasts once.
// Never reads Kora's fee-payer key. Loads only the rent wallet file used by the earlier probes.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { hmac, inspectSignedTransaction } from './verify_live_sign_transaction.mjs';
import { buildRegistrationProbe } from './verify_register_work_claim.mjs';
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
// Gateway cap on rent-wallet spending per registration (Kora's caps protect only Kora's key).
export const MAX_RENT_LAMPORTS = 8_000_000;
const sha = value => createHash('sha256').update(value).digest('hex');
const encode58 = bytes => (bs58.default ?? bs58).encode(bytes);

export function sumRent(perRecord) {
  assert.deepEqual(Object.keys(perRecord), Object.keys(RECORD_SIZES), 'Rent quote must cover exactly the six records');
  let total = 0;
  for (const value of Object.values(perRecord)) {
    assert.ok(Number.isSafeInteger(value) && value > 0, `Invalid rent value ${value}`);
    total += value;
  }
  assert.ok(Number.isSafeInteger(total) && total <= MAX_RENT_LAMPORTS, `Rent ${total} exceeds the gateway cap ${MAX_RENT_LAMPORTS}`);
  return total;
}

export function buildSponsoredTransaction(payer, writer, blockhash, lamports, intent) {
  assert.ok(Number.isSafeInteger(lamports) && lamports > 0 && lamports <= MAX_RENT_LAMPORTS, 'Transfer amount outside the gateway cap');
  assert.ok(new Set([payer, writer, RENT_WALLET]).size === 3, 'Kora, rent wallet and writer must be distinct');
  const probe = buildRegistrationProbe(payer, writer, blockhash, intent);
  const registration = Transaction.from(probe.wire).instructions[0];
  // Restore the IDL account flags: decoding marks every transaction signer as signer here.
  registration.keys = registration.keys.map(k => ({ ...k, isSigner: k.pubkey.toBase58() === writer }));
  assert.equal(registration.programId.toBase58(), PROGRAM);
  assert.ok(registration.data.equals(probe.data));
  const tx = new Transaction({ feePayer: new PublicKey(payer), recentBlockhash: blockhash })
    .add(SystemProgram.transfer({ fromPubkey: new PublicKey(RENT_WALLET), toPubkey: new PublicKey(writer), lamports }))
    .add(registration);
  const wire = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
  return { wire, records: probe.addresses };
}

const describe = ix => JSON.stringify({ p: ix.programId.toBase58(), d: ix.data.toString('hex'),
  k: ix.keys.map(k => [k.pubkey.toBase58(), k.isWritable, k.isSigner]) });

// Structural checks first, then Kora's Ed25519 signature, so failures name the exact cause.
export function verifyKoraReturn(result, payer, wire, writer) {
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
  assert.deepEqual([...signers].sort(), [payer, RENT_WALLET, writer].sort(), 'Unexpected signer set');
  assert.equal(signers[0], payer);
  assert.ok(after.signatures.slice(1).every(s => s.signature === null), 'Unexpected non-Kora signature before co-signing');
  const checked = inspectSignedTransaction(result, payer, wire);
  assert.ok(checked.lighthouseValid, 'Lighthouse assertion is not the expected fee-payer balance check');
  assert.ok(checked.signatureValid, 'Invalid Kora signature');
  return { transaction: after, lighthouse_minimum_lamports: after.instructions[2].data.readBigUInt64LE(3).toString() };
}

export async function main() {
  const mode = process.argv[2];
  assert.ok(['dry-run', 'send'].includes(mode), 'Usage: sponsored_register_demo.mjs dry-run|send');
  const dir = process.env.PROBE_OUTPUT;
  assert.ok(dir, 'Set PROBE_OUTPUT to a new evidence directory');
  const rentWalletFile = process.env.PROBE_KEYPAIR_PATH;
  assert.ok(rentWalletFile, 'Set PROBE_KEYPAIR_PATH to the rent wallet keypair file');
  assert.ok(process.env.KORA_API_KEY && process.env.KORA_HMAC_SECRET, 'Set KORA_API_KEY and KORA_HMAC_SECRET in this terminal');
  mkdirSync(dirname(dir), { recursive: true });
  mkdirSync(dir, { recursive: false }); // Never overwrite an earlier run.
  const save = (name, value) => writeFileSync(`${dir}/${name}`, typeof value === 'string' ? value : JSON.stringify(value, null, 2), { flag: 'wx', mode: 0o600 });
  let seq = 0, sends = 0;
  const step = (n, text) => console.log(`\n[${n}/9] ${text}`);
  const KORA_METHODS = ['getPayerSigner', 'getBlockhash', 'signTransaction'];
  const DEVNET_METHODS = ['getGenesisHash', 'getMultipleAccounts', 'getBalance', 'getMinimumBalanceForRentExemption',
    'simulateTransaction', 'getSignatureStatuses', 'getTransaction', ...(mode === 'send' ? ['sendTransaction'] : [])];

  async function rpc(method, params, kora = false) {
    assert.ok((kora ? KORA_METHODS : DEVNET_METHODS).includes(method), `Forbidden RPC method: ${method}`);
    if (method === 'sendTransaction') assert.equal(++sends, 1, 'Refusing a second broadcast');
    const id = ++seq;
    const body = JSON.stringify({ jsonrpc: '2.0', id, method, params });
    const prefix = `${String(id).padStart(3, '0')}-${kora ? 'kora' : 'devnet'}-${method}`;
    save(`${prefix}.request.json`, body);
    const headers = { 'content-type': 'application/json' };
    if (kora) {
      headers['x-api-key'] = process.env.KORA_API_KEY;
      headers['x-timestamp'] = String(Math.floor(Date.now() / 1000));
      headers['x-hmac-signature'] = hmac(process.env.KORA_HMAC_SECRET, headers['x-timestamp'], body);
    }
    let response;
    try { response = await fetch(kora ? KORA_URL : DEVNET_URL, { method: 'POST', headers, body, redirect: 'error', signal: AbortSignal.timeout(90000) }); }
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

  save('run.json', { started_at: new Date().toISOString(), mode, program: PROGRAM, kora: KORA_URL, devnet: DEVNET_URL,
    policy_sha256: sha(readFileSync(new URL('../kora.toml', import.meta.url))) });
  const status = { mode, result: 'FAIL' };
  try {
    step(1, 'Devnet and Kora reachable (first Kora call can take about a minute if Render was asleep)');
    assert.equal(await rpc('getGenesisHash', []), DEVNET_GENESIS_HASH, 'Not devnet');
    const payer = (await rpc('getPayerSigner', {}, true)).signer_address;
    console.log(`Kora fee payer: ${payer}`);

    step(2, 'Load rent wallet and create a fresh zero-SOL writer');
    // Only this explicitly authorized ordinary wallet is loaded. Never open Kora's key.
    const rentWallet = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(rentWalletFile, 'utf8'))));
    assert.equal(rentWallet.publicKey.toBase58(), RENT_WALLET, 'Unexpected rent wallet');
    const writer = Keypair.generate(); // Throwaway devnet identity, held only in memory, never saved.
    const user = writer.publicKey.toBase58();
    console.log(`Rent wallet: ${RENT_WALLET}\nWriter (new): ${user}`);

    step(3, 'Price the six records from live rent and check the writer and records are unused');
    const intent = `sponsored-demo-${randomUUID()}`;
    const perRecord = {};
    for (const [name, size] of Object.entries(RECORD_SIZES)) {
      perRecord[name] = await rpc('getMinimumBalanceForRentExemption', [size, { commitment: 'confirmed' }]);
    }
    const rent = sumRent(perRecord);
    console.log(`Storage deposit for six records: ${rent} lamports`);
    const blockhash = (await rpc('getBlockhash', {}, true)).blockhash;
    const built = buildSponsoredTransaction(payer, user, blockhash, rent, intent);
    const names = Object.keys(RECORD_SIZES);
    const existing = await rpc('getMultipleAccounts', [[...names.map(n => built.records[n]), user],
      { encoding: 'base64', commitment: 'confirmed', dataSlice: { offset: 0, length: 0 } }]);
    assert.equal(existing.value.length, 7, 'Invalid account existence response');
    const occupied = names.filter((_, i) => existing.value[i] !== null);
    assert.equal(occupied.length, 0, `Records already exist: ${occupied.join(', ')}`);
    assert.equal(existing.value[6], null, 'Writer must start at 0 lamports');
    save('accounts.json', { intent, writer: user, rent_wallet: RENT_WALLET, kora_fee_payer: payer, rent_lamports: rent,
      rent_per_record: perRecord, records: built.records });

    step(4, 'One transaction: rent transfer, then the registration; unsigned preflight');
    save('unsigned.transaction.base64', built.wire.toString('base64'));
    const pre = await rpc('simulateTransaction', [built.wire.toString('base64'), { encoding: 'base64', sigVerify: false, commitment: 'confirmed' }]);
    assert.equal(pre.value.err, null, `Unsigned simulation failed: ${JSON.stringify(pre.value.err)}`);

    step(5, 'Kora checks policy, appends Lighthouse and signs as fee payer (sign only)');
    const signed = await rpc('signTransaction', { transaction: built.wire.toString('base64'), signer_key: payer, sig_verify: false, user_id: user }, true);
    const verified = verifyKoraReturn(signed, payer, built.wire, user);
    const after = verified.transaction;
    save('kora-verification.json', { signature_valid: true, blockhash_and_fee_payer_unchanged: true,
      instructions_0_1_identical: true, only_lighthouse_appended: true, signer_set: after.signatures.map(s => s.publicKey.toBase58()),
      lighthouse_minimum_lamports: verified.lighthouse_minimum_lamports });

    step(6, 'Writer and rent wallet sign the returned message');
    const message = after.serializeMessage();
    after.partialSign(writer, rentWallet);
    assert.ok(message.equals(after.serializeMessage()), 'Message changed while signing');
    assert.ok(after.verifySignatures(), 'Signature check failed');
    const final = after.serialize();
    const signature = encode58(after.signature);
    save('signed.transaction.base64', final.toString('base64'));
    save('message.sha256', sha(message));
    console.log(`Transaction size: ${final.length} bytes; signature: ${signature}`);

    step(7, 'Simulate the exact signed bytes with sigVerify');
    const sim = await rpc('simulateTransaction', [final.toString('base64'), { encoding: 'base64', sigVerify: true, commitment: 'confirmed' }]);
    assert.equal(sim.value.err, null, `Signed simulation failed: ${JSON.stringify(sim.value.err)}`);
    if (mode === 'dry-run') {
      Object.assign(status, { result: 'DRY-RUN PASS', note: 'Kora accepted three signatures; nothing broadcast', rent_lamports: rent });
      console.log('\nDRY-RUN PASS: Kora signed a three-signer transaction and the signed bytes simulate. Nothing was broadcast.');
      return;
    }

    step(8, 'Send to devnet once (maxRetries 0)');
    save('signature-before-send.json', { signature });
    console.log(`If anything below times out, check https://explorer.solana.com/tx/${signature}?cluster=devnet before doing anything else.`);
    let sent;
    try { sent = await rpc('sendTransaction', [final.toString('base64'), { encoding: 'base64', skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 0 }]); }
    catch (error) { throw new Error(`sendTransaction outcome unknown (${error.message}). Do not resend; check ${signature} first`); }
    assert.equal(sent, signature, 'Returned signature does not match');
    save('signature.json', { signature });
    let confirmed = false;
    for (let i = 0; i < 60 && !confirmed; i++) {
      const s = (await rpc('getSignatureStatuses', [[signature], { searchTransactionHistory: true }])).value[0];
      if (s?.err) throw new Error(`Transaction failed on chain: ${JSON.stringify(s.err)}`);
      confirmed = ['confirmed', 'finalized'].includes(s?.confirmationStatus);
      if (!confirmed) await new Promise(r => setTimeout(r, 1500));
    }
    assert.ok(confirmed, `Not confirmed after polling. Do not resend; check ${signature} on the explorer first`);

    step(9, 'Read the result back from the ledger');
    const landed = await rpc('getTransaction', [signature, { encoding: 'json', commitment: 'confirmed', maxSupportedTransactionVersion: 0 }]);
    assert.equal(landed.meta.err, null, 'Landed transaction has an error');
    const keys = landed.transaction.message.accountKeys;
    const signers = keys.slice(0, landed.transaction.message.header.numRequiredSignatures);
    assert.deepEqual([...signers].sort(), [payer, RENT_WALLET, user].sort(), 'Landed signer set differs');
    assert.equal(signers[0], payer, 'Landed fee payer is not Kora');
    const delta = k => landed.meta.postBalances[keys.indexOf(k)] - landed.meta.preBalances[keys.indexOf(k)];
    const writerAfter = landed.meta.postBalances[keys.indexOf(user)];
    assert.equal(writerAfter, 0, 'Writer did not end at 0 lamports');
    assert.equal(delta(RENT_WALLET), -rent, 'Rent wallet delta differs from the quote');
    assert.equal(delta(payer), -landed.meta.fee, 'Kora paid more than the network fee');
    const created = await rpc('getMultipleAccounts', [names.map(n => built.records[n]), { encoding: 'base64', commitment: 'confirmed', dataSlice: { offset: 0, length: 0 } }]);
    const wrong = names.filter((n, i) => created.value[i]?.owner !== PROGRAM || created.value[i]?.lamports !== perRecord[n]);
    assert.equal(wrong.length, 0, `Records missing, not program-owned or not exactly rent-funded: ${wrong.join(', ')}`);
    Object.assign(status, { result: 'PASS', signature, signers, fee_lamports: landed.meta.fee, slot: landed.slot,
      rent_lamports: rent, rent_wallet_delta: delta(RENT_WALLET), kora_delta: delta(payer), writer_post_lamports: writerAfter,
      records: built.records, explorer: `https://explorer.solana.com/tx/${signature}?cluster=devnet` });
    console.log(`\nPASS. Signers: ${signers.join(', ')}`);
    console.log(`Network fee paid by Kora: ${landed.meta.fee} lamports; rent wallet: ${delta(RENT_WALLET)}; writer after: ${writerAfter}`);
    console.log(`Explorer: ${status.explorer}`);
  } catch (error) {
    status.error = String(error?.message ?? error);
    console.error(`\nFAIL: ${status.error}`);
    process.exitCode = 1;
  } finally {
    save('summary.json', { ...status, finished_at: new Date().toISOString() });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
