#!/usr/bin/env node
// Human-run probe, Node.js 20+. No dependencies, dotenv, local keys, or broadcast.
import { createHmac, createPublicKey, verify } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const URL = 'https://plotarmor-kora-devnet.onrender.com';
const SYSTEM = '11111111111111111111111111111111';
const LIGHTHOUSE = 'L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95';
const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function base58decode(value) {
  let n = 0n;
  for (const c of value) {
    const digit = ALPHABET.indexOf(c);
    if (digit < 0) throw new Error('Invalid base58');
    n = n * 58n + BigInt(digit);
  }
  const bytes = [];
  while (n) { bytes.unshift(Number(n & 255n)); n >>= 8n; }
  return Buffer.concat([Buffer.alloc(value.match(/^1*/)[0].length), Buffer.from(bytes)]);
}

function base58encode(bytes) {
  let n = BigInt('0x' + (bytes.toString('hex') || '0'));
  let result = '';
  while (n) { result = ALPHABET[Number(n % 58n)] + result; n /= 58n; }
  for (const byte of bytes) { if (byte !== 0) break; result = '1' + result; }
  return result;
}

export function buildTransaction(payer, blockhash) {
  const key = base58decode(payer);
  const hash = base58decode(blockhash);
  if (key.length !== 32 || hash.length !== 32 || payer === SYSTEM) {
    throw new Error('Expected a payer public key and blockhash of 32 bytes');
  }
  // Legacy Solana wire format, shortvec lengths all < 128. One missing Kora
  // signature; header: one writable signer and one readonly unsigned program.
  // SystemInstruction::Transfer = u32 LE 2, followed by u64 LE zero lamports.
  // Both instruction account indices reference the payer, so no value moves.
  const message = Buffer.concat([
    Buffer.from([1, 0, 1, 2]), key, Buffer.alloc(32), hash,
    Buffer.from([1, 1, 2, 0, 0, 12, 2, 0, 0, 0]), Buffer.alloc(8),
  ]);
  return Buffer.concat([Buffer.from([1]), Buffer.alloc(64), message]);
}

export function decodeTransaction(wire) {
  let offset = 0;
  function take(n) {
    if (offset + n > wire.length) throw new Error('Truncated transaction');
    const value = wire.subarray(offset, offset + n); offset += n; return value;
  }
  const byte = () => take(1)[0];
  function length() {
    let value = 0;
    for (let shift = 0; shift <= 14; shift += 7) {
      const b = byte(); value |= (b & 127) << shift;
      if (!(b & 128)) return value;
    }
    throw new Error('Invalid shortvec');
  }
  const signatures = Array.from({ length: length() }, () => take(64));
  const messageStart = offset;
  let required = byte();
  const versioned = Boolean(required & 128);
  if (versioned) {
    if (required !== 128) throw new Error('Unsupported message version');
    required = byte();
  }
  take(2);
  const keys = Array.from({ length: length() }, () => base58encode(take(32)));
  take(32);
  const instructions = Array.from({ length: length() }, () => {
    const programIndex = byte();
    const indices = [...take(length())];
    const data = take(length());
    if (!keys[programIndex] || indices.some(i => !keys[i])) {
      throw new Error('Unresolved instruction account');
    }
    return { program: keys[programIndex], accounts: indices.map(i => keys[i]), data };
  });
  if (versioned && length() !== 0) throw new Error('Unexpected address lookup tables');
  if (offset !== wire.length || required !== signatures.length) {
    throw new Error('Invalid transaction framing');
  }
  return { signatures, keys, instructions, message: wire.subarray(messageStart) };
}

export function hmac(secret, timestamp, body) {
  return createHmac('sha256', secret).update(timestamp).update(body).digest('hex');
}

export function createKoraRpc(apiKey, secret, fetcher = fetch) {
  if (!apiKey || !secret) throw new Error('Set KORA_API_KEY and KORA_HMAC_SECRET in your private terminal');
  let id = 0;
  async function rpc(method, params, wrongHmac = false) {
    const body = JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = hmac(secret, timestamp, body);
    const response = await fetcher(URL, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(60000),
      headers: {
        'content-type': 'application/json', 'x-api-key': apiKey,
        'x-timestamp': timestamp,
        'x-hmac-signature': wrongHmac
          ? (signature[0] === '0' ? '1' : '0') + signature.slice(1) : signature,
      },
      body,
    });
    const raw = await response.text();
    console.log(`\n${method}${wrongHmac ? ' (deliberately wrong HMAC)' : ''}: HTTP ${response.status}`);
    console.log(raw);
    let json;
    try { json = JSON.parse(raw); } catch { /* Raw non-JSON response remains visible. */ }
    const accepted = response.ok && json?.jsonrpc === '2.0' && json.id === id
      && !json.error && json.result !== undefined;
    return { status: response.status, accepted, result: json?.result };
  }

  return rpc;
}

export async function run(apiKey, secret, fetcher = fetch) {
  const rpc = createKoraRpc(apiKey, secret, fetcher);
  console.log(`Target: ${URL} (devnet deployment)`);
  console.log('No broadcast. No fee-payer private key is read or needed.');
  console.log('Checked-in policy requires PlotArmor and forbids fee-payer transfers; expect a policy rejection.');
  const payerReply = await rpc('getPayerSigner', {});
  if (!payerReply.accepted) throw new Error('Authenticated public payer lookup failed');
  const payer = payerReply.result.signer_address;
  const hashReply = await rpc('getBlockhash', {});
  if (!hashReply.accepted) throw new Error('Authenticated blockhash lookup failed');
  const original = buildTransaction(payer, hashReply.result.blockhash);
  console.log(`Instruction: System transfer, 0 lamports, ${payer} -> ${payer}; fee payer: ${payer}`);
  const params = {
    transaction: original.toString('base64'), signer_key: payer,
    sig_verify: false,
    // Stable public probe identity for Free-mode quota accounting, not a wallet login.
    user_id: payer,
  };

  // Same valid transaction and API key; only the HMAC is corrupted.
  const bad = await rpc('signTransaction', params, true);
  const authPassed = bad.status === 401;
  console.log(`Wrong-HMAC rejection: ${authPassed ? 'PASS (401)' : 'FAIL (expected 401)'}`);
  const good = await rpc('signTransaction', params);
  console.log(`Signing accepted: ${good.accepted ? 'YES' : 'NO'}`);
  if (!good.accepted) {
    console.log('Lighthouse: UNVERIFIED, no successful signing response. Signing verification did not pass.');
    return authPassed ? 2 : 1;
  }
  const { changed, signatureValid, lighthouseValid } = inspectSignedTransaction(good.result, payer, original);
  console.log('System-only acceptance conflicts with checked-in require_one_of_programs; investigate deployed policy.');
  return authPassed && changed && signatureValid && lighthouseValid ? 0 : 1;
}

export function inspectSignedTransaction(result, payer, original) {
  const encoded = result.signed_transaction;
  if (typeof encoded !== 'string' || !encoded.length) throw new Error('Missing signed_transaction');
  const returned = Buffer.from(encoded, 'base64');
  const decoded = decodeTransaction(returned);
  const key = createPublicKey({
    key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), base58decode(payer)]),
    format: 'der', type: 'spki',
  });
  const signatureValid = result.signer_pubkey === payer && decoded.keys[0] === payer
    && verify(null, decoded.message, key, decoded.signatures[0]);
  const assertions = decoded.instructions.filter(ix => ix.program === LIGHTHOUSE);
  const last = decoded.instructions.at(-1);
  const lighthouseValid = last?.program === LIGHTHOUSE && last.accounts.length === 1
    && last.accounts[0] === payer && last.data.length === 12
    && last.data.subarray(0, 3).equals(Buffer.from([5, 0, 0])) && last.data[11] === 4;
  const changed = !returned.equals(original);
  console.log(`Transaction modified: ${changed}; Kora Ed25519 signature valid: ${signatureValid}`);
  console.log(`Instruction programs: ${decoded.instructions.map(ix => ix.program).join(', ')}`);
  console.log(`Lighthouse instructions: ${assertions.length}; trailing fee-payer balance assertion: ${lighthouseValid}`);
  if (lighthouseValid) console.log(`Asserted minimum lamports: ${last.data.readBigUInt64LE(3)}`);
  return { changed, signatureValid, lighthouseValid, decoded };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // Read only these two named credentials, never enumerate the environment.
  run(process.env.KORA_API_KEY, process.env.KORA_HMAC_SECRET)
    .then(code => { process.exitCode = code; })
    .catch(error => { console.error(`Probe failed: ${error.message}`); process.exitCode = 1; });
}
