// Runs the whole sponsored_register_demo.mjs flow (dry-run, send, send-with-version) against an in-process fake
// devnet and fake Kora. The fake chain applies the PlotArmor register_work_claim and add_version rules that matter
// here (account creation with rent, the claim's latest_link, the lineage-head check). It proves the script's
// sequencing and checks; it does not prove behavior of the real Kora, devnet or program.
// Keys are the published RFC 8032 test vectors (public test data). No private key of Kora or the rent wallet is used.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { mkdtempSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { main, cidToExternalRefHash } from './sponsored_register_demo.mjs';
import { PROGRAM, DEVNET_GENESIS_HASH } from './verify_plotarmor_sign_transaction.mjs';

const require = createRequire(new URL('../../plotarmor-program/package.json', import.meta.url));
const { Keypair, PublicKey, Transaction, TransactionInstruction, SystemInstruction } = require('@solana/web3.js');
const bs58 = require('bs58');
const b58 = bs58.default ?? bs58;
const seed = hex => Keypair.fromSeed(Uint8Array.from(Buffer.from(hex, 'hex')));
const payerKp = seed('9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60');
const rentKp = seed('4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb');
const payer = payerKp.publicKey.toBase58();
const rentWallet = rentKp.publicKey.toBase58();
const LIGHTHOUSE = 'L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95';
const SYSTEM = '11111111111111111111111111111111';
const API_KEY = 'TEST-API-KEY-NOT-A-SECRET';
const HMAC_SECRET = 'TEST-HMAC-NOT-A-SECRET';
const CID = 'QmT2DLbRoj4JLPJb4PxGw95che5KYvaFkoaX3emGbtWjPX';
const RENT_BY_SIZE = { 50: 904240, 210: 1717040, 110: 1209040, 75: 1031240, 112: 1219200, 82: 1066800 };
const KORA_URL = 'https://plotarmor-kora-devnet.onrender.com';
const DEVNET_URL = 'https://api.devnet.solana.com';

function lighthouseIx() {
  const data = Buffer.alloc(12);
  data.set([5, 0, 0]); data.writeBigUInt64LE(4_000_000_000n, 3); data[11] = 4;
  return new TransactionInstruction({ programId: new PublicKey(LIGHTHOUSE), data, keys: [{ pubkey: payerKp.publicKey, isSigner: false, isWritable: false }] });
}

// opts.koraTamper(tx) edits Kora's returned transaction before it signs; opts.corruptHeadAfterRegister rewrites the chain head.
function world(opts = {}) {
  const accounts = new Map(); // address -> { lamports, owner, data }
  const balances = new Map([[payer, 5_000_000_000], [rentWallet, 10_000_000_000]]);
  const landed = new Map(); // signature -> { tx, slot, pre, post, fee }
  const polls = new Map();
  const calls = { send: 0, sign: 0, blockhash: 0, methods: [] };
  let slot = 500_000_000, bhCounter = 0;
  const bal = k => balances.get(k) ?? 0;

  function apply(tx) {
    const keys = tx.compileMessage().accountKeys.map(k => k.toBase58());
    const pre = keys.map(bal);
    const [transfer, plot] = tx.instructions;
    const t = SystemInstruction.decodeTransfer(transfer);
    const writer = t.toPubkey.toBase58();
    assert.equal(plot.programId.toBase58(), PROGRAM);
    const fee = 5000 * tx.signatures.length;
    balances.set(payer, bal(payer) - fee);
    balances.set(t.fromPubkey.toBase58(), bal(t.fromPubkey.toBase58()) - Number(t.lamports));
    balances.set(writer, bal(writer) + Number(t.lamports));
    const disc = plot.data.subarray(0, 8).toString('hex');
    const k = plot.keys.map(x => x.pubkey.toBase58());
    const create = (address, size) => {
      assert.ok(!accounts.has(address), `account in use ${address}`);
      assert.ok(bal(writer) >= RENT_BY_SIZE[size], 'writer cannot fund rent');
      balances.set(writer, bal(writer) - RENT_BY_SIZE[size]);
      accounts.set(address, { lamports: RENT_BY_SIZE[size], owner: PROGRAM, data: Buffer.alloc(size) });
    };
    if (disc === '80e030f0a60e774c') { // register_work_claim
      assert.equal(k[7], writer);
      [[1, 50], [2, 210], [3, 110], [4, 75], [5, 112], [6, 82]].forEach(([i, size]) => create(k[i], size));
      const claim = accounts.get(k[2]).data;
      new PublicKey(k[1]).toBuffer().copy(claim, 8);   // root_artifact
      new PublicKey(k[1]).toBuffer().copy(claim, 40);  // latest_artifact
      new PublicKey(k[5]).toBuffer().copy(claim, 72);  // latest_link
      new PublicKey(writer).toBuffer().copy(claim, 104); // claimant
      if (opts.corruptHeadAfterRegister) new PublicKey(k[3]).toBuffer().copy(claim, 72);
    } else if (disc === 'a72a0018536d3df8') { // add_version
      assert.equal(k[5], writer);
      const claim = accounts.get(k[1]);
      assert.ok(claim, 'claim missing');
      assert.equal(new PublicKey(claim.data.subarray(104, 136)).toBase58(), writer, 'not the claimant');
      assert.equal(new PublicKey(plot.data.subarray(106, 138)).toBase58(), new PublicKey(claim.data.subarray(72, 104)).toBase58(), 'stale lineage head');
      create(k[2], 50); create(k[3], 112); create(k[4], 82);
      new PublicKey(k[2]).toBuffer().copy(claim.data, 40);
      new PublicKey(k[3]).toBuffer().copy(claim.data, 72);
    } else assert.fail(`unknown instruction ${disc}`);
    return { keys, pre, post: keys.map(bal), fee };
  }

  const json = (id, result) => new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), { status: 200 });
  const accountJson = (a, slice) => a && { lamports: a.lamports, owner: a.owner, executable: false, rentEpoch: 0, data: [slice ? '' : a.data.toString('base64'), 'base64'] };

  async function fetchFn(url, init) {
    const body = JSON.parse(init.body);
    calls.methods.push(`${url === KORA_URL ? 'kora' : 'devnet'}:${body.method}`);
    if (url === KORA_URL) {
      const ts = init.headers['x-timestamp'];
      assert.equal(init.headers['x-api-key'], API_KEY);
      assert.equal(init.headers['x-hmac-signature'], createHmac('sha256', HMAC_SECRET).update(ts).update(init.body).digest('hex'), 'bad HMAC');
      assert.ok(Math.abs(Date.now() / 1000 - Number(ts)) < 30);
      switch (body.method) {
        case 'getPayerSigner': return json(body.id, { signer_address: payer, payment_address: payer });
        case 'getBlockhash': calls.blockhash++; return json(body.id, { blockhash: b58.encode(createHash('sha256').update(`bh-${++bhCounter}`).digest()) });
        case 'signTransaction': {
          calls.sign++;
          assert.equal(body.params.sig_verify, false);
          assert.equal(body.params.signer_key, payer);
          const tx = Transaction.from(Buffer.from(body.params.transaction, 'base64'));
          assert.ok(tx.signatures.length <= 3, 'max_signatures');
          assert.ok(tx.instructions.every(i => [SYSTEM, PROGRAM].includes(i.programId.toBase58())), 'program not allowed');
          tx.add(lighthouseIx());
          tx.signatures = []; // recompile signers from the message
          opts.koraTamper?.(tx);
          tx.partialSign(payerKp);
          return json(body.id, { signed_transaction: tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64'), signer_pubkey: payer });
        }
        default: assert.fail(`Kora method ${body.method}`);
      }
    }
    assert.equal(url, DEVNET_URL);
    switch (body.method) {
      case 'getGenesisHash': return json(body.id, DEVNET_GENESIS_HASH);
      case 'getMinimumBalanceForRentExemption': return json(body.id, RENT_BY_SIZE[body.params[0]]);
      case 'getMultipleAccounts': {
        const slice = body.params[1].dataSlice?.length === 0;
        return json(body.id, { context: { slot }, value: body.params[0].map(a => accountJson(accounts.get(a) ?? (bal(a) > 0 ? { lamports: bal(a), owner: SYSTEM, data: Buffer.alloc(0) } : null), slice)) });
      }
      case 'simulateTransaction': {
        const tx = Transaction.from(Buffer.from(body.params[0], 'base64'));
        const err = body.params[1].sigVerify && !tx.verifySignatures() ? 'SignatureFailure' : null;
        return json(body.id, { context: { slot }, value: { err, logs: [] } });
      }
      case 'sendTransaction': {
        calls.send++;
        const tx = Transaction.from(Buffer.from(body.params[0], 'base64'));
        assert.ok(tx.verifySignatures(), 'send requires all signatures');
        const sig = b58.encode(tx.signatures[0].signature);
        const result = apply(tx);
        landed.set(sig, { tx, slot: ++slot, ...result });
        return json(body.id, sig);
      }
      case 'getSignatureStatuses': {
        const sig = body.params[0][0];
        const n = (polls.get(sig) ?? 0) + 1; polls.set(sig, n);
        return json(body.id, { context: { slot }, value: [landed.has(sig) ? { slot, confirmations: null, err: null, confirmationStatus: n === 1 ? 'confirmed' : 'finalized' } : null] });
      }
      case 'getTransaction': {
        const l = landed.get(body.params[0]);
        const m = l.tx.compileMessage();
        return json(body.id, { slot: l.slot, blockTime: 1_790_000_000, meta: { err: null, fee: l.fee, preBalances: l.pre, postBalances: l.post, logMessages: [] },
          transaction: { signatures: l.tx.signatures.map(s => b58.encode(s.signature)), message: { accountKeys: l.keys ?? m.accountKeys.map(k => k.toBase58()), header: m.header } } });
      }
      default: assert.fail(`devnet method ${body.method}`);
    }
  }
  return { fetchFn, accounts, balances, calls, landed };
}

function setup(extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'sponsored-flow-'));
  const keyFile = join(dir, 'rent.json');
  writeFileSync(keyFile, JSON.stringify(Array.from(rentKp.secretKey)), { mode: 0o600 }); // public test vector, not a real wallet
  const out = join(dir, 'evidence');
  const env = { PROBE_OUTPUT: out, PROBE_KEYPAIR_PATH: keyFile, KORA_API_KEY: API_KEY, KORA_HMAC_SECRET: HMAC_SECRET };
  const w = world(extra);
  const run = (...argv) => main({ argv, env, fetchFn: w.fetchFn, rentWalletAddress: rentWallet, log: () => {}, logError: () => {} });
  const files = () => readdirSync(out);
  const read = name => JSON.parse(readFileSync(join(out, name), 'utf8'));
  return { run, w, out, files, read };
}

// Captures the writer key the script generates so the test can prove it is never written anywhere.
function captureWriter() {
  const original = Keypair.generate;
  const made = [];
  Keypair.generate = (...a) => { const k = original.apply(Keypair, a); made.push(k); return k; };
  return { made, restore: () => { Keypair.generate = original; } };
}
const claimHead = (w, address) => { const d = w.accounts.get(address).data; return { latestArtifact: new PublicKey(d.subarray(40, 72)).toBase58(), latestLink: new PublicKey(d.subarray(72, 104)).toBase58() }; };

test('dry-run with a CID: signs and simulates, broadcasts nothing, records the digest', async () => {
  const s = setup();
  const status = await s.run('dry-run', CID);
  assert.equal(status.result, 'DRY-RUN PASS');
  assert.equal(s.w.calls.send, 0);
  assert.equal(s.w.calls.sign, 1);
  assert.ok(!s.files().some(f => f.endsWith('signature.json') || f.endsWith('signature-before-send.json')));
  assert.equal(s.read('run.json').external_ref_hash_hex, Buffer.from(cidToExternalRefHash(CID)).toString('hex'));
  const unsigned = Transaction.from(Buffer.from(readFileSync(join(s.out, 'unsigned.transaction.base64'), 'utf8'), 'base64'));
  assert.equal(unsigned.instructions[1].data.subarray(8 + 32 + 7 + 64).toString('hex'), Buffer.from(cidToExternalRefHash(CID)).toString('hex'));
  assert.equal(s.w.accounts.size, 0, 'nothing created on the fake chain');
});

test('send without a CID keeps the original file names and a zero external ref hash', async () => {
  const s = setup();
  const status = await s.run('send');
  assert.equal(status.result, 'PASS');
  assert.equal(status.writer_post_lamports, 0);
  assert.equal(status.rent_wallet_delta, -7_147_560);
  assert.equal(s.w.calls.send, 1);
  for (const f of ['signed.transaction.base64', 'unsigned.transaction.base64', 'accounts.json', 'kora-verification.json', 'signature.json', 'summary.json']) assert.ok(s.files().includes(f), f);
  assert.equal(s.read('run.json').external_ref_hash_hex, null);
  assert.equal(s.w.accounts.size, 6);
});

test('send-with-version with a CID: registers, waits for finalized, reads the head, adds a version, reads both back', async () => {
  const cap = captureWriter();
  try {
    const s = setup();
    const status = await s.run('send-with-version', CID);
    assert.equal(status.result, 'PASS', status.error);
    assert.equal(s.w.calls.send, 2);
    assert.equal(s.w.calls.sign, 2);
    assert.equal(s.w.calls.blockhash, 2);
    assert.notEqual(status.register.signature, status.add_version.signature);
    // Order of operations on the wire: register send, then a finalized read of the claim, then the version's Kora call.
    const m = s.w.calls.methods;
    const firstSend = m.indexOf('devnet:sendTransaction');
    const claimRead = m.findIndex((x, i) => i > firstSend && x === 'devnet:getMultipleAccounts' && m[i - 1] === 'devnet:getSignatureStatuses');
    const secondSign = m.lastIndexOf('kora:signTransaction');
    assert.ok(firstSend < claimRead && claimRead < secondSign, 'claim head is read between the two transactions');
    // Ledger: head before equals the registration link; after equals the version link and content.
    assert.equal(status.claim_head_before.latestLink, status.register.records.claim_artifact_link);
    assert.equal(status.claim_head_after.latestLink, status.add_version.records.claim_artifact_link);
    assert.equal(status.claim_head_after.latestArtifact, status.add_version.records.content_artifact);
    assert.deepEqual(claimHead(s.w, status.register.records.work_claim), { latestArtifact: status.add_version.records.content_artifact, latestLink: status.add_version.records.claim_artifact_link });
    // Both readbacks: three signers, writer ends at 0, rent wallet paid the quote, Kora only the fee.
    assert.equal(status.register.rent_lamports, 7_147_560);
    assert.equal(status.add_version.rent_lamports, 904_240 + 1_219_200 + 1_066_800);
    for (const r of [status.register, status.add_version]) {
      assert.equal(r.writer_post_lamports, 0);
      assert.equal(r.rent_wallet_delta, -r.rent_lamports);
      assert.equal(r.kora_delta, -15000);
      assert.deepEqual([...r.signers].sort(), [payer, rentWallet, cap.made[0].publicKey.toBase58()].sort());
    }
    assert.equal(s.w.accounts.size, 6 + 3);
    // Evidence files exist for both transactions and the two head reads.
    for (const f of ['register-signed.transaction.base64', 'register-signature.json', 'version-signed.transaction.base64', 'version-signature.json', 'version-accounts.json', 'claim-head-before-version.json', 'claim-head-after-version.json', 'summary.json']) assert.ok(s.files().includes(f), f);
    // The version transaction carries the same digest and the chain head as expected_previous_link.
    const v = Transaction.from(Buffer.from(readFileSync(join(s.out, 'version-unsigned.transaction.base64'), 'utf8'), 'base64')).instructions[1].data;
    assert.equal(new PublicKey(v.subarray(106, 138)).toBase58(), status.claim_head_before.latestLink);
    assert.equal(v.subarray(138).toString('hex'), Buffer.from(cidToExternalRefHash(CID)).toString('hex'));

    // The writer key was generated once, in memory, and appears nowhere on disk.
    assert.equal(cap.made.length, 1);
    const secret = Buffer.from(cap.made[0].secretKey);
    const needles = [secret.toString('hex'), secret.toString('base64'), b58.encode(secret), JSON.stringify(Array.from(secret)), secret.subarray(0, 32).toString('hex'), b58.encode(secret.subarray(0, 32))];
    for (const f of s.files()) {
      const text = readFileSync(join(s.out, f), 'utf8');
      for (const n of needles) assert.ok(!text.includes(n), `writer secret found in ${f}`);
    }
  } finally { cap.restore(); }
});

test('send-with-version stops before the version if the chain head is not the registration link', async () => {
  const s = setup({ corruptHeadAfterRegister: true });
  const status = await s.run('send-with-version', CID);
  assert.equal(status.result, 'FAIL');
  assert.match(status.error, /latest_link differs/);
  assert.equal(s.w.calls.send, 1, 'no second broadcast');
  assert.equal(s.w.calls.sign, 1);
});

test('a Kora reply that changes the transfer is rejected before anything is signed or sent', async () => {
  const s = setup({ koraTamper: tx => { tx.instructions[0].data.writeBigUInt64LE(9_000_000n, 4); } });
  const status = await s.run('send', CID);
  assert.equal(status.result, 'FAIL');
  assert.match(status.error, /Transfer instruction changed/);
  assert.equal(s.w.calls.send, 0);
});

test('guards: wrong rent wallet address, missing secrets, bad CID, bad mode, reused output directory', async () => {
  const s = setup();
  const env = { PROBE_OUTPUT: join(s.out, '..', 'second-evidence'), PROBE_KEYPAIR_PATH: join(s.out, '..', 'rent.json'), KORA_API_KEY: API_KEY, KORA_HMAC_SECRET: HMAC_SECRET };
  const wrong = await main({ argv: ['dry-run'], env, fetchFn: s.w.fetchFn, rentWalletAddress: 'HZJTTwQMa6uyfA9AMXMmJKb9UrzxzGTKPAXQ2LKxgFLn', log: () => {}, logError: () => {} });
  assert.equal(wrong.result, 'FAIL');
  assert.match(wrong.error, /Unexpected rent wallet/);
  await assert.rejects(() => main({ argv: ['dry-run', 'not-a-cid'], env: {}, fetchFn: s.w.fetchFn }), /Not a valid CIDv0/);
  await assert.rejects(() => main({ argv: ['launch'], env: {}, fetchFn: s.w.fetchFn }), /Usage/);
  await assert.rejects(() => main({ argv: ['dry-run'], env: { PROBE_OUTPUT: 'x' }, fetchFn: s.w.fetchFn }), /PROBE_KEYPAIR_PATH/);
  const again = setup();
  await again.run('dry-run');
  await assert.rejects(() => again.run('dry-run'), /EEXIST|exists/);
  assert.ok(existsSync(again.out));
});
