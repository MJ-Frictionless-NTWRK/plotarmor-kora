import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { buildRegistrationProbe, runRegistration, freshRegistrationIntent } from './verify_register_work_claim.mjs';
import { PROGRAM, DEVNET_GENESIS_HASH } from './verify_plotarmor_sign_transaction.mjs';
import { decodeTransaction, hmac } from './verify_live_sign_transaction.mjs';
const requireProgram = createRequire(new URL('../../plotarmor-program/package.json', import.meta.url));
const { PublicKey, Transaction } = requireProgram('@solana/web3.js');
const idl = JSON.parse(readFileSync(new URL('../../plotarmor-program/target/idl/plotarmor.json', import.meta.url)));
const payer = '9hSR6S7WPtxmTojgo6GG3k4yDPecgJY292j7xrsUGWBu';
// Standard public Edwards basepoint; no key generation or private key material.
const user = new PublicKey(Buffer.from('58' + '66'.repeat(31), 'hex')).toBase58();
const hash = '11111111111111111111111111111111';
const intent = 'offline-fixture-v1';

test('devnet genesis constant is the complete known 44-character hash', () => {
  assert.equal(DEVNET_GENESIS_HASH.length, 44);
  assert.equal(DEVNET_GENESIS_HASH, 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG');
});

test('Anchor encoding matches independently assembled discriminator and argument bytes', () => {
  const probe = buildRegistrationProbe(payer, user, hash, intent);
  const discriminator = createHash('sha256').update('global:register_work_claim').digest().subarray(0, 8);
  assert.deepEqual(probe.data, Buffer.concat([
    discriminator, probe.rawHash, Buffer.from([0, 0, 1, 0, 1, 0]),
    probe.linkNonce, probe.anchorNonce, Buffer.from([1]), Buffer.alloc(32),
  ]));
  assert.equal(probe.data.length, 143); // Exercises multi-byte shortvec instruction length.
  const decoded = decodeTransaction(probe.wire);
  assert.equal(decoded.signatures.length, 2);
  assert.ok(decoded.signatures.every(s => s.equals(Buffer.alloc(64))));
  assert.deepEqual(decoded.keys.slice(0, 2), [payer, user]);
  assert.equal(decoded.instructions[0].program, PROGRAM);
  assert.deepEqual(decoded.instructions[0].accounts, Object.values(probe.addresses));
  const sdkDecoded = Transaction.from(probe.wire);
  assert.deepEqual(sdkDecoded.instructions[0].data, probe.data);
  assert.deepEqual(sdkDecoded.instructions[0].keys.map(a => [a.isWritable, a.isSigner]),
    [[false, false], [true, false], [true, false], [true, false], [true, false], [true, false], [true, false], [true, true], [false, false]]);
});

test('all PDA seeds independently resolved from sibling IDL match explicit derivation', () => {
  const probe = buildRegistrationProbe(payer, user, hash, intent);
  const args = { raw_hash: probe.rawHash, link_nonce: probe.linkNonce, anchor_nonce: probe.anchorNonce };
  for (const account of idl.instructions.find(i => i.name === 'register_work_claim').accounts) {
    if (!account.pda) continue;
    const seeds = account.pda.seeds.map(seed => {
      if (seed.kind === 'const') return Buffer.from(seed.value);
      if (seed.kind === 'arg') return args[seed.path];
      return new PublicKey(probe.addresses[seed.path]).toBuffer();
    });
    const expected = PublicKey.findProgramAddressSync(seeds, new PublicKey(PROGRAM))[0];
    assert.equal(probe.addresses[account.name], expected.toBase58());
    assert.equal(PublicKey.isOnCurve(expected.toBytes()), false);
  }
  assert.deepEqual(buildRegistrationProbe(payer, user, hash, intent).wire, probe.wire);
  assert.notEqual(buildRegistrationProbe(payer, user, hash, intent + '-new').addresses.work_claim, probe.addresses.work_claim);
  assert.throws(() => buildRegistrationProbe(user, user, hash, intent), /separate funded claimant/);
  assert.throws(() => buildRegistrationProbe(payer, user, hash, ''), /nonempty probe intent/);
});

test('shared HMAC flow simulates then requests signing, reports rejection, never broadcasts', async () => {
  const calls = [];
  const fetcher = async (url, options) => {
    const request = JSON.parse(options.body);
    calls.push(request.method);
    let result;
    if (url.includes('onrender.com')) {
      assert.equal(options.headers['x-api-key'], 'offline-api');
      assert.equal(options.headers['x-hmac-signature'], hmac('offline-hmac', options.headers['x-timestamp'], options.body));
    } else assert.equal(options.headers['x-api-key'], undefined);
    switch (request.method) {
      case 'getGenesisHash': result = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG'; break;
      case 'getPayerSigner': result = { signer_address: payer }; break;
      case 'getBlockhash': result = { blockhash: hash }; break;
      case 'getMultipleAccounts':
        assert.equal(request.params[0].length, 6);
        result = { value: Array(6).fill(null) }; break;
      case 'simulateTransaction':
        assert.equal(request.params[1].sigVerify, false);
        result = { value: { err: null, logs: [] } }; break;
      case 'signTransaction':
        assert.equal(request.params.user_id, user);
        assert.equal(request.params.sig_verify, false);
        return Response.json({ jsonrpc: '2.0', id: request.id, error: { code: -32602, message: 'test rejection' } });
      default: assert.fail(`Unauthorized RPC method ${request.method}`);
    }
    return Response.json({ jsonrpc: '2.0', id: request.id, result });
  };
  assert.equal(await runRegistration('offline-api', 'offline-hmac', user, fetcher), 2);
  assert.deepEqual(calls, ['getGenesisHash', 'getPayerSigner', 'getBlockhash', 'getMultipleAccounts', 'simulateTransaction', 'signTransaction']);
});


test('fresh intents change all six record PDAs while retaining registry and wallet', () => {
  const a = freshRegistrationIntent();
  const b = freshRegistrationIntent();
  assert.notEqual(a, b);
  const first = buildRegistrationProbe(payer, user, hash, a);
  const second = buildRegistrationProbe(payer, user, hash, b);
  for (const name of Object.keys(first.addresses).slice(1, 7)) {
    assert.notEqual(first.addresses[name], second.addresses[name]);
  }
  assert.equal(first.addresses.registry_config, second.addresses.registry_config);
  assert.equal(first.addresses.signer, user);
  assert.notDeepEqual(first.linkNonce, first.anchorNonce);
});

test('occupied record prevents simulation and signing', async () => {
  const calls = [];
  const fetcher = async (_url, options) => {
    const request = JSON.parse(options.body);
    calls.push(request.method);
    const responses = {
      getGenesisHash: DEVNET_GENESIS_HASH,
      getPayerSigner: { signer_address: payer },
      getBlockhash: { blockhash: hash },
      getMultipleAccounts: { value: [null, { lamports: 1 }, null, null, null, null] },
    };
    assert.ok(request.method in responses, 'Must stop before simulation/signing');
    return Response.json({ jsonrpc: '2.0', id: request.id, result: responses[request.method] });
  };
  await assert.rejects(runRegistration('offline-api', 'offline-hmac', user, fetcher), /PDAs already exist: work_claim/);
  assert.deepEqual(calls, ['getGenesisHash', 'getPayerSigner', 'getBlockhash', 'getMultipleAccounts']);
});
