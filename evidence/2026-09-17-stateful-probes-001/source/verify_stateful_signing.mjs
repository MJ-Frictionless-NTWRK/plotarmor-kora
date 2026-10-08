#!/usr/bin/env node
// Devnet only. Setup broadcasts an ordinary-wallet registration. Probes never broadcast.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { dirname } from 'node:path';
import { hmac, inspectSignedTransaction } from './verify_live_sign_transaction.mjs';
import { buildRegistrationProbe } from './verify_register_work_claim.mjs';
import { PROGRAM, DEVNET_GENESIS_HASH } from './verify_plotarmor_sign_transaction.mjs';

const require = createRequire(new URL('../../plotarmor-program/package.json', import.meta.url));
const { PublicKey, Transaction, TransactionInstruction, Keypair } = require('@solana/web3.js');
const { BorshInstructionCoder, BorshAccountsCoder } = require('@coral-xyz/anchor');
const idlBytes = readFileSync(new URL('../../plotarmor-program/target/idl/plotarmor.json', import.meta.url));
const idl = JSON.parse(idlBytes);
const coder = new BorshInstructionCoder(idl);
const accountsCoder = new BorshAccountsCoder(idl);
const system = '11111111111111111111111111111111';
const lighthouse = 'L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95';
const koraUrl = 'https://plotarmor-kora-devnet.onrender.com';
const devnetUrl = 'https://api.devnet.solana.com';
const sha = value => createHash('sha256').update(value).digest();
const pk = value => new PublicKey(value);
const pda = (...seeds) => PublicKey.findProgramAddressSync(seeds.map(s => typeof s === 'string' ? Buffer.from(s) : s), pk(PROGRAM))[0].toBase58();
const layouts = {
  add_version: [['registry_config',0,0],['work_claim',1,0],['content_artifact',1,0],['claim_artifact_link',1,0],['anchor_record',1,0],['claimant',1,1],['system_program',0,0]],
  add_owner: [['registry_config',0,0],['work_claim',0,0],['ownership',1,0],['new_owner_record',1,0],['admin',1,1],['new_owner',0,0],['system_program',0,0]],
  anchor_authorized_contract: [['registry_config',0,0],['work_claim',0,0],['ownership',0,0],['contract_artifact',1,0],['authorized_contract_anchor',1,0],['anchor_record',1,0],['admin',1,1],['system_program',0,0]],
};

export function buildStatefulProbe(name, payer, authority, blockhash, fixture, intent, newOwner) {
  assert.equal(idl.address, PROGRAM);
  assert.notEqual(payer, authority, 'Rent payer must differ from Kora');
  assert.ok(intent && layouts[name]);
  const layout = layouts[name];
  const definition = idl.instructions.find(i => i.name === name);
  assert.deepEqual(definition.accounts.map(a => [a.name, +!!a.writable, +!!a.signer]), layout);
  const raw = sha(`${intent}:${name}:content`), link = sha(`${intent}:${name}:link`), nonce = sha(`${intent}:${name}:anchor`);
  const a = { registry_config: pda('config'), work_claim: fixture.work_claim,
    ownership: fixture.ownership, claimant: authority, admin: authority, system_program: system };
  let args;
  if (name === 'add_version') {
    a.content_artifact = pda('content', raw);
    a.claim_artifact_link = pda('claim_artifact', pk(a.work_claim).toBuffer(), link);
    a.anchor_record = pda('anchor', pk(a.content_artifact).toBuffer(), nonce);
    args = { raw_hash: [...raw], content_kind: 0, link_nonce: [...link], anchor_nonce: [...nonce],
      anchor_mode_arg: 1, expected_previous_link: pk(fixture.latest_link), external_ref_hash: Array(32).fill(0) };
  } else if (name === 'add_owner') {
    assert.notEqual(newOwner, authority);
    assert.notEqual(newOwner, payer, 'Do not attribute synthetic ownership to Kora');
    a.new_owner = newOwner;
    a.new_owner_record = pda('owner', pk(a.ownership).toBuffer(), pk(newOwner).toBuffer());
    args = { new_share: 1, new_role: 0, new_threshold_shares: 1 };
  } else {
    a.contract_artifact = pda('contract_artifact', raw);
    a.authorized_contract_anchor = pda('authorized_contract', pk(a.work_claim).toBuffer(), pk(a.contract_artifact).toBuffer());
    a.anchor_record = pda('anchor', pk(a.authorized_contract_anchor).toBuffer(), nonce);
    args = { raw_contract_hash: [...raw], contract_kind: 0, anchor_nonce: [...nonce], anchor_mode_arg: 1, external_ref_hash: Array(32).fill(0) };
  }
  const instruction = new TransactionInstruction({ programId: pk(PROGRAM), data: coder.encode(name, args),
    keys: layout.map(([key,w,s]) => ({ pubkey: pk(a[key]), isWritable: !!w, isSigner: !!s })) });
  const transaction = new Transaction({ feePayer: pk(payer), recentBlockhash: blockhash }).add(instruction);
  return { transaction, accounts: Object.fromEntries(layout.map(([key]) => [key,a[key]])), args };
}

export function verifyReturned(result, payer, originalWire, authority) {
  const checked = inspectSignedTransaction(result, payer, originalWire);
  assert.ok(checked.signatureValid && checked.lighthouseValid, 'Invalid Kora signature or Lighthouse assertion');
  const before = Transaction.from(originalWire), after = Transaction.from(Buffer.from(result.signed_transaction, 'base64'));
  assert.equal(after.recentBlockhash, before.recentBlockhash, 'Blockhash changed');
  assert.equal(after.feePayer.toBase58(), payer);
  assert.deepEqual(after.signatures.map(s => s.publicKey.toBase58()), [payer, authority]);
  assert.ok(after.signatures[1].signature === null, 'Unexpected authority signature');
  assert.equal(after.instructions.length, 2);
  const describe = ix => ({ program: ix.programId.toBase58(), data: ix.data.toString('hex'),
    keys: ix.keys.map(k => [k.pubkey.toBase58(), k.isWritable, k.isSigner]) });
  assert.deepEqual(describe(after.instructions[0]), describe(before.instructions[0]), 'PlotArmor instruction changed');
  assert.equal(after.instructions[1].programId.toBase58(), lighthouse);
  // Reconstruct the exact permitted message: original instruction plus returned assertion.
  before.add(after.instructions[1]);
  assert.ok(before.serializeMessage().equals(after.serializeMessage()), 'Unexpected message mutation');
  return { transaction: after, evidence: { signature_valid: true, original_instruction_identical: true,
    only_lighthouse_appended: true, message_sha256: sha(after.serializeMessage()).toString('hex'),
    lighthouse_target: payer, lighthouse_minimum_lamports: after.instructions[1].data.readBigUInt64LE(3).toString() } };
}

export async function main() {
  const mode = process.argv[2];
  assert.ok(['setup', 'probe'].includes(mode), 'Usage: verify_stateful_signing.mjs setup|probe');
  const dir = process.env.PROBE_OUTPUT;
  assert.ok(dir, 'Set PROBE_OUTPUT to a new evidence directory');
  mkdirSync(dirname(dir), { recursive: true });
  mkdirSync(dir, { recursive: false }); // Never overwrite a previous run or its failure.
  const save = (name, value) => writeFileSync(`${dir}/${name}`, typeof value === 'string' ? value : JSON.stringify(value, null, 2), { flag: 'wx', mode: 0o600 });
  let sequence = 0;
  const statuses = {};
  save('idl.json', idlBytes.toString());
  save('run.json', { started_at: new Date().toISOString(), mode, program: PROGRAM, koraUrl, devnetUrl,
    policy_sha256: sha(readFileSync(new URL('../kora.toml', import.meta.url))).toString('hex') });
  async function rpc(method, params, kora = false) {
    const permitted = kora ? ['getPayerSigner', 'getBlockhash', 'signTransaction']
      : ['getGenesisHash', 'simulateTransaction', 'getLatestBlockhash', 'getMultipleAccounts', 'getSignatureStatuses', 'getTransaction', ...(mode === 'setup' ? ['sendTransaction'] : [])];
    assert.ok(permitted.includes(method), `Forbidden RPC method: ${method}`);
    const id = ++sequence;
    const body = JSON.stringify({ jsonrpc: '2.0', id, method, params });
    const prefix = `${String(id).padStart(3,'0')}-${kora ? 'kora' : 'devnet'}-${method}`;
    save(`${prefix}.request.json`, body);
    const headers = { 'content-type': 'application/json' };
    if (kora) {
      assert.ok(process.env.KORA_API_KEY && process.env.KORA_HMAC_SECRET, 'Kora API/HMAC credentials unavailable');
      headers['x-api-key'] = process.env.KORA_API_KEY;
      headers['x-timestamp'] = String(Math.floor(Date.now()/1000));
      headers['x-hmac-signature'] = hmac(process.env.KORA_HMAC_SECRET, headers['x-timestamp'], body);
    }
    let response;
    try { response = await fetch(kora ? koraUrl : devnetUrl, { method: 'POST', headers, body, redirect: 'error', signal: AbortSignal.timeout(45000) }); }
    catch (error) { save(`${prefix}.transport-error.txt`, String(error)); throw error; }
    const raw = await response.text();
    save(`${prefix}.response.txt`, raw);
    save(`${prefix}.http.json`, { status: response.status, received_at: new Date().toISOString() });
    const parsed = JSON.parse(raw);
    assert.ok(response.ok && !parsed.error, `RPC rejected; exact response: ${prefix}.response.txt`);
    assert.equal(parsed.id, id);
    return parsed.result;
  }
  async function simulation(tx, label, authority, signed) {
    const wire = tx.serialize({ requireAllSignatures: signed, verifySignatures: signed });
    save(`${label}.transaction.base64`, wire.toString('base64'));
    const result = await rpc('simulateTransaction', [wire.toString('base64'), {
      encoding: 'base64', sigVerify: signed, commitment: 'confirmed',
      accounts: { encoding: 'base64', addresses: [authority] },
    }]);
    assert.equal(result.value.err, null, `${label} failed; raw simulation preserved`);
    const keys = tx.compileMessage().accountKeys.map(k => k.toBase58());
    const index = keys.indexOf(authority);
    const pre = result.value.preBalances?.[index], post = result.value.postBalances?.[index];
    const balance = { authority, account_index: index, pre_lamports: pre, post_lamports: post,
      delta_lamports: Number.isSafeInteger(pre) && Number.isSafeInteger(post) ? post-pre : null };
    // Some RPC versions expose post account data but omit pre/postBalances.
    // Never turn a separate getBalance read into an exact same-slot delta.
    save(`${label}.balance.json`, balance);
    console.log(`${label}: simulation accepted; authority delta ${balance.delta_lamports}`);
    if (signed) assert.notEqual(balance.delta_lamports, null, 'RPC omitted balance arrays; exact delta unverified');
    return result;
  }
  try {
    assert.ok(process.env.KORA_API_KEY && process.env.KORA_HMAC_SECRET, 'Kora API/HMAC credentials unavailable in this session');
    assert.equal(await rpc('getGenesisHash', []), DEVNET_GENESIS_HASH);
    // Only this explicitly authorized ordinary user key is loaded. Never open Kora's key.
    const wallet = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync('/home/sucka/secrets/probe-user.json', 'utf8'))));
    const authority = wallet.publicKey.toBase58();
    assert.equal(authority, 'HZJTTwQMa6uyfA9AMXMmJKb9UrzxzGTKPAXQ2LKxgFLn', 'Unexpected ordinary probe wallet');
    const payer = (await rpc('getPayerSigner', {}, true)).signer_address;
    assert.notEqual(payer, authority);
    save('identities.json', { authority, kora_fee_payer: payer });
    async function probe(name, tx) {
      const wire = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
      await simulation(tx, `${name}-preflight`, authority, false);
      const result = await rpc('signTransaction', { transaction: wire.toString('base64'), signer_key: payer, sig_verify: false, user_id: authority }, true);
      const checked = verifyReturned(result, payer, wire, authority);
      save(`${name}.verification.json`, checked.evidence);
      const message = checked.transaction.serializeMessage();
      checked.transaction.partialSign(wallet);
      assert.ok(message.equals(checked.transaction.serializeMessage()));
      assert.ok(checked.transaction.verifySignatures());
      await simulation(checked.transaction, `${name}-fully-signed`, authority, true);
      statuses[name] = { status: 'PASS', verification: `${name}.verification.json`, fully_signed_simulation: `${name}-fully-signed.balance.json` };
    }
    if (mode === 'setup') {
      const intent = `stateful-setup-${randomUUID()}`;
      const hash = (await rpc('getBlockhash', {}, true)).blockhash;
      const registration = buildRegistrationProbe(payer, authority, hash, intent);
      save('setup-accounts.json', registration.addresses);
      // Refresh registration's Kora pass before the ordinary setup broadcast.
      try { await probe('register_work_claim', Transaction.from(registration.wire)); }
      catch (error) {
        statuses.register_work_claim = { status: 'FAIL', error: String(error) };
        throw error;
      }
      const ordinary = Transaction.from(registration.wire);
      ordinary.feePayer = wallet.publicKey;
      ordinary.signatures = [];
      ordinary.recentBlockhash = (await rpc('getLatestBlockhash', [{ commitment: 'confirmed' }])).value.blockhash;
      ordinary.sign(wallet);
      assert.deepEqual(ordinary.signatures.map(s => s.publicKey.toBase58()), [authority]);
      assert.ok(ordinary.instructions.every(i => i.programId.toBase58() === PROGRAM));
      await simulation(ordinary, 'ordinary-setup', authority, true);
      const wire = ordinary.serialize();
      const { base58decode } = await import('./verify_live_sign_transaction.mjs');
      // Signature recorded in base64 before transmission, even if response is lost.
      save('setup-signature-before-send.json', { signature_base64: ordinary.signature.toString('base64') });
      const signature = await rpc('sendTransaction', [wire.toString('base64'), { encoding: 'base64', skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 0 }]);
      assert.ok(base58decode(signature).equals(ordinary.signature));
      save('setup-signature.json', { signature });
      console.log(`Ordinary setup signature: ${signature}`);
      let confirmed = false;
      for (let i=0; i<20; i++) {
        const state = (await rpc('getSignatureStatuses', [[signature], { searchTransactionHistory: true }])).value[0];
        if (state?.err) throw new Error(`Setup failed: ${JSON.stringify(state.err)}`);
        if (['confirmed','finalized'].includes(state?.confirmationStatus)) { confirmed = true; break; }
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
      assert.ok(confirmed, 'Setup confirmation unavailable; do not repeat broadcast');
      save('fixture.json', { ...registration.addresses, latest_link: registration.addresses.claim_artifact_link, authority, setup_signature: signature });
      await rpc('getTransaction', [signature, { encoding: 'json', commitment: 'confirmed', maxSupportedTransactionVersion: 0 }]);
    } else {
      assert.ok(process.env.PROBE_FIXTURE, 'Set PROBE_FIXTURE to confirmed setup fixture.json');
      const fixture = JSON.parse(readFileSync(process.env.PROBE_FIXTURE));
      save('fixture.json', fixture);
      assert.equal(fixture.authority, authority);
      const state = await rpc('getMultipleAccounts', [[fixture.work_claim, fixture.ownership], { encoding: 'base64', commitment: 'confirmed' }]);
      const decode = (i, name) => {
        assert.equal(state.value[i]?.owner, PROGRAM);
        return accountsCoder.decode(name, Buffer.from(state.value[i].data[0], 'base64'));
      };
      const claim = decode(0, 'WorkClaim'), ownership = decode(1, 'Ownership');
      assert.equal(claim.claimant.toBase58(), authority);
      assert.equal(ownership.admin.toBase58(), authority);
      assert.equal(ownership.work_claim.toBase58(), fixture.work_claim);
      assert.equal(claim.ownership.toBase58(), fixture.ownership);
      assert.equal(pda('claim', claim.root_artifact.toBuffer(), wallet.publicKey.toBuffer()), fixture.work_claim);
      assert.equal(pda('ownership', pk(fixture.work_claim).toBuffer()), fixture.ownership);
      fixture.latest_link = claim.latest_link.toBase58();
      // Public synthetic owner, no generated key and no signature needed. Never broadcast.
      const newOwner = pk(Buffer.from('58' + '66'.repeat(31), 'hex')).toBase58();
      for (const name of Object.keys(layouts)) {
        try {
          const blockhash = (await rpc('getBlockhash', {}, true)).blockhash;
          const built = buildStatefulProbe(name, payer, authority, blockhash, fixture, randomUUID(), newOwner);
          save(`${name}.accounts.json`, { accounts: built.accounts, args: built.args });
          await probe(name, built.transaction);
        } catch (error) {
          statuses[name] = { status: 'FAIL', error: String(error) };
          save(`${name}.failure.txt`, error.stack ?? String(error));
          console.error(`${name}: FAIL; preserved raw artifacts; no retry`);
        }
      }
    }
  } catch (error) {
    for (const name of Object.keys(layouts)) {
      statuses[name] ??= { status: 'BLOCKED', reason: String(error) };
    }
    save('blocked.txt', error.stack ?? String(error));
    console.error(String(error));
    process.exitCode = 1;
  } finally {
    save('summary.json', { statuses, finished_at: new Date().toISOString(), qualifying_live_passes: Object.values(statuses).filter(s => s.status === 'PASS').length });
    if (Object.values(statuses).some(s => s.status !== 'PASS')) process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
