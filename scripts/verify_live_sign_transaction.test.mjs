import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { buildTransaction, decodeTransaction, hmac, run } from './verify_live_sign_transaction.mjs';

// Public RFC 8032 Ed25519 test-vector address bytes; no private key material.
const payer = '9hSR6S7WPtxmTojgo6GG3k4yDPecgJY292j7xrsUGWBu';
const blockhash = '11111111111111111111111111111111';

test('minimal unsigned legacy System self-transfer has valid wire framing', () => {
  const wire = buildTransaction(payer, blockhash);
  assert.equal(wire.length, 183);
  const tx = decodeTransaction(wire);
  assert.deepEqual(tx.signatures, [Buffer.alloc(64)]);
  assert.deepEqual(tx.keys, [payer, blockhash]);
  assert.equal(tx.instructions.length, 1);
  const ix = tx.instructions[0];
  assert.equal(ix.program, blockhash);
  assert.deepEqual(ix.accounts, [payer, payer]);
  assert.equal(ix.data.readUInt32LE(), 2);
  assert.equal(ix.data.readBigUInt64LE(4), 0n);
  assert.throws(() => decodeTransaction(wire.subarray(0, -1)), /Truncated/);
});

test('HMAC authenticates timestamp immediately followed by exact UTF-8 body', () => {
  const body = '{"text":"é"}';
  const expected = createHmac('sha256', 'offline-test').update('123' + body).digest('hex');
  assert.equal(hmac('offline-test', '123', body), expected);
  assert.notEqual(hmac('offline-test', '123', body + '\n'), expected);
});

test('401 negative control followed by policy rejection reports incomplete signing', async () => {
  const requests = [];
  const fetcher = async (url, options) => {
    assert.equal(url, 'https://plotarmor-kora-devnet.onrender.com');
    assert.equal(options.redirect, 'error');
    const request = JSON.parse(options.body);
    requests.push(request);
    assert.equal(options.headers['x-api-key'], 'offline-api');
    const expected = hmac('offline-hmac', options.headers['x-timestamp'], options.body);
    const wrong = requests.length === 3;
    assert.equal(options.headers['x-hmac-signature'] === expected, !wrong);
    if (wrong) return new Response('Unauthorized', { status: 401 });
    const result = request.method === 'getPayerSigner'
      ? { signer_address: payer } : { blockhash };
    return Response.json({ jsonrpc: '2.0', id: request.id,
      ...(requests.length === 4
        ? { error: { code: -32602, message: 'Missing required program' } } : { result }),
    });
  };
  assert.equal(await run('offline-api', 'offline-hmac', fetcher), 2);
  assert.deepEqual(requests.map(r => r.method), [
    'getPayerSigner', 'getBlockhash', 'signTransaction', 'signTransaction',
  ]);
  assert.deepEqual(requests[2].params, requests[3].params);
});

test('missing credentials fail before network access', async () => {
  await assert.rejects(run('', '', () => assert.fail('Unexpected network request')), /Set KORA_API_KEY/);
});
