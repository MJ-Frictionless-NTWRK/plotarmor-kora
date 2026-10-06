import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { buildSponsoredTransaction, buildSponsoredVersionTransaction, verifyKoraReturn, sumRent, parseWorkClaim, cidToExternalRefHash, RENT_WALLET, RECORD_SIZES, VERSION_RECORDS, MAX_RENT_LAMPORTS, APP_PARAMS } from './sponsored_register_demo.mjs';
import { buildRegistrationProbe, buildAddVersionProbe } from './verify_register_work_claim.mjs';
import { PROGRAM } from './verify_plotarmor_sign_transaction.mjs';
const require = createRequire(new URL('../../plotarmor-program/package.json', import.meta.url));
const { PublicKey, Transaction, TransactionInstruction } = require('@solana/web3.js');
const { BorshInstructionCoder } = require('@coral-xyz/anchor');
const bs58 = require('bs58');
const idl = JSON.parse(readFileSync(new URL('../../plotarmor-program/target/idl/plotarmor.json', import.meta.url)));
// Public RFC 8032 test-vector address and Edwards basepoint; no key generation or private key material.
const payer = '9hSR6S7WPtxmTojgo6GG3k4yDPecgJY292j7xrsUGWBu';
const writer = new PublicKey(Buffer.from('58' + '66'.repeat(31), 'hex')).toBase58();
const hash = '11111111111111111111111111111111';
const intent = 'offline-sponsored';
const rent = 7_147_560;
const LIGHTHOUSE = 'L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95';

const lighthouseIx = (target = payer) => {
  const data = Buffer.alloc(12);
  data.set([5, 0, 0]); data.writeBigUInt64LE(4_000_000_000n, 3); data[11] = 4;
  return new TransactionInstruction({ programId: new PublicKey(LIGHTHOUSE), data, keys: [{ pubkey: new PublicKey(target), isSigner: false, isWritable: false }] });
};
// Simulated Kora reply without a Kora signature: structure is checked before the signature.
function fakeReturn(wire, mutate = tx => tx) {
  const tx = mutate(Transaction.from(wire).add(lighthouseIx()));
  return { signed_transaction: tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64'), signer_pubkey: payer };
}

test('unsigned Design B transaction: transfer then unchanged registration, three signer slots', () => {
  const { wire, records } = buildSponsoredTransaction(payer, writer, hash, rent, intent);
  const tx = Transaction.from(wire);
  assert.deepEqual(tx.signatures.map(s => s.publicKey.toBase58()).sort(), [payer, RENT_WALLET, writer].sort());
  assert.equal(tx.signatures[0].publicKey.toBase58(), payer);
  assert.ok(tx.signatures.every(s => s.signature === null));
  assert.equal(tx.instructions.length, 2);
  const [transfer, registration] = tx.instructions;
  assert.equal(transfer.programId.toBase58(), '11111111111111111111111111111111');
  assert.deepEqual(transfer.keys.map(k => k.pubkey.toBase58()), [RENT_WALLET, writer]);
  assert.equal(transfer.data.readUInt32LE(0), 2);
  assert.equal(transfer.data.readBigUInt64LE(4), BigInt(rent));
  const probe = buildRegistrationProbe(payer, writer, hash, intent, APP_PARAMS);
  assert.equal(registration.programId.toBase58(), PROGRAM);
  assert.deepEqual(registration.data, probe.data);
  assert.deepEqual(registration.keys.map(k => k.pubkey.toBase58()), Object.values(probe.addresses));
  assert.deepEqual(records, probe.addresses);
  assert.ok(wire.length < 1232 - 20, 'Room for the 12-byte Lighthouse instruction and its program key');
});

test('Kora reply with only a Lighthouse append passes structure and then requires a valid Kora signature', () => {
  const { wire } = buildSponsoredTransaction(payer, writer, hash, rent, intent);
  assert.throws(() => verifyKoraReturn(fakeReturn(wire), payer, wire, writer), /Invalid Kora signature/);
});

test('Kora reply mutations are rejected by the matching check', () => {
  const { wire } = buildSponsoredTransaction(payer, writer, hash, rent, intent);
  const cases = [
    [tx => { tx.instructions[0].data.writeBigUInt64LE(BigInt(rent + 1), 4); return tx; }, /Transfer instruction changed/],
    [tx => { tx.instructions[1].data[9] ^= 1; return tx; }, /Registration instruction changed/],
    [tx => { tx.recentBlockhash = 'SysvarRent111111111111111111111111111111111'; return tx; }, /blockhash/],
    [tx => tx.add(lighthouseIx()), /exactly one Lighthouse/],
    [tx => { tx.instructions[2] = lighthouseIx(writer); return tx; }, /Lighthouse assertion is not/],
    [tx => { tx.instructions.splice(2, 1, tx.instructions[0]); tx.instructions[0] = lighthouseIx(); return tx; }, /Transfer instruction changed/],
  ];
  for (const [mutate, error] of cases) assert.throws(() => verifyKoraReturn(fakeReturn(wire, mutate), payer, wire, writer), error);
  const unsignedReply = Transaction.from(Buffer.from(fakeReturn(wire).signed_transaction, 'base64'));
  unsignedReply.signatures[1].signature = Buffer.alloc(64, 1);
  const presigned = { signed_transaction: unsignedReply.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64'), signer_pubkey: payer };
  assert.throws(() => verifyKoraReturn(presigned, payer, wire, writer), /Unexpected non-Kora signature/);
  assert.throws(() => verifyKoraReturn(fakeReturn(wire), payer, wire, RENT_WALLET), /Unexpected signer set/);
});

test('rent quote sums exactly six live values and enforces the gateway cap', () => {
  const sept30 = { content_artifact: 904240, work_claim: 1717040, ownership: 1209040, owner_record: 1031240, claim_artifact_link: 1219200, anchor_record: 1066800 };
  assert.deepEqual(Object.values(RECORD_SIZES), [50, 210, 110, 75, 112, 82]);
  assert.equal(sumRent(sept30), 7147560);
  assert.throws(() => sumRent({ ...sept30, work_claim: 1717040 + MAX_RENT_LAMPORTS }), /gateway cap/);
  assert.throws(() => sumRent({ ...sept30, anchor_record: 0 }), /Invalid rent/);
  assert.throws(() => sumRent({ ...sept30, anchor_record: 1.5 }), /Invalid rent/);
  const { anchor_record, ...five } = sept30;
  assert.throws(() => sumRent(five), /Rent quote must cover exactly/);
  assert.throws(() => buildSponsoredTransaction(payer, writer, hash, MAX_RENT_LAMPORTS + 1, intent), /gateway cap/);
  assert.throws(() => buildSponsoredTransaction(RENT_WALLET, writer, hash, rent, intent), /distinct/);
});

test('sponsored script sends the app arguments: content_kind 1, claim_kind 1, shares 100/100, attested devnet', () => {
  const { wire } = buildSponsoredTransaction(payer, writer, hash, rent, intent);
  const data = Transaction.from(wire).instructions[1].data;
  assert.equal(data.length, 143);
  assert.equal(data[8 + 32], 1, 'content_kind');
  assert.equal(data[8 + 32 + 1], 1, 'claim_kind');
  assert.equal(data.readUInt16LE(8 + 32 + 2), 100, 'total_shares');
  assert.equal(data.readUInt16LE(8 + 32 + 4), 100, 'threshold_shares');
  assert.equal(data[8 + 32 + 6 + 64], 1, 'anchor_mode_arg');
  assert.ok(data.subarray(8 + 32 + 7 + 64).equals(Buffer.alloc(32)), 'external_ref_hash is zero when no CID is given');
});

test('the plain registration probe keeps its original arguments', () => {
  const data = buildRegistrationProbe(payer, writer, hash, intent).data;
  assert.equal(data[8 + 32], 0);
  assert.equal(data[8 + 32 + 1], 0);
  assert.equal(data.readUInt16LE(8 + 32 + 2), 1);
  assert.equal(data.readUInt16LE(8 + 32 + 4), 1);
});

// ---- CID option: external_ref_hash is the sha2-256 digest inside the CIDv0, as the app computes it ----
const cidFor = digest => (bs58.default ?? bs58).encode(Buffer.concat([Buffer.from([0x12, 0x20]), digest]));
const KNOWN_CID = 'QmT2DLbRoj4JLPJb4PxGw95che5KYvaFkoaX3emGbtWjPX';
const KNOWN_DIGEST = '45914b08915ab9dda49fc41c7da8655123afedef07ba0963f4f840edb74d01ba'; // sha256('plotarmor test')

test('cidToExternalRefHash returns the digest inside a CIDv0 and rejects anything else', () => {
  assert.equal(createHash('sha256').update('plotarmor test').digest('hex'), KNOWN_DIGEST);
  assert.equal(Buffer.from(cidToExternalRefHash(KNOWN_CID)).toString('hex'), KNOWN_DIGEST);
  assert.equal(cidToExternalRefHash(KNOWN_CID).length, 32);
  assert.throws(() => cidToExternalRefHash(''), /Not a valid CIDv0/);
  assert.throws(() => cidToExternalRefHash('Qm123'), /Not a valid CIDv0/);
  assert.throws(() => cidToExternalRefHash('bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'), /Not a valid CIDv0/);
  assert.throws(() => cidToExternalRefHash('Qm' + '0'.repeat(44)), /Invalid|base58|decode/i); // 0 is not in the base58 alphabet
  const wrongPrefix = (bs58.default ?? bs58).encode(Buffer.concat([Buffer.from([0x13, 0x20]), Buffer.alloc(32, 7)]));
  assert.throws(() => cidToExternalRefHash(wrongPrefix.padEnd(46, 'A').slice(0, 46)), /Not a valid CIDv0|prefix|length/);
});

const appFile = new URL('../../plotarmor-demo/src/vault/ipfs.ts', import.meta.url);
test('cidToExternalRefHash matches the app implementation (plotarmor-demo src/vault/ipfs.ts) on 40 CIDs', { skip: !existsSync(appFile) && 'plotarmor-demo not present' }, async () => {
  const app = await import(appFile.href);
  const digests = [Buffer.from(KNOWN_DIGEST, 'hex'), Buffer.alloc(32, 0), Buffer.alloc(32, 255),
    ...Array.from({ length: 37 }, (_, i) => createHash('sha256').update(`cid-parity-${i}`).digest())];
  for (const digest of digests) {
    const cid = cidFor(digest);
    if (cid.length !== 46) continue; // v0 CIDs from sha256 are always 46; guard against odd leading-zero cases
    assert.deepEqual(cidToExternalRefHash(cid), Array.from(app.cidToExternalRefHash(cid)), cid);
    assert.deepEqual(cidToExternalRefHash(cid), app.cidToExternalRefHashArray(cid), cid);
  }
});

test('with a CID the registration instruction carries that digest and nothing else changes', () => {
  const ref = cidToExternalRefHash(KNOWN_CID);
  const plain = Transaction.from(buildSponsoredTransaction(payer, writer, hash, rent, intent).wire).instructions[1].data;
  const withCid = Transaction.from(buildSponsoredTransaction(payer, writer, hash, rent, intent, ref).wire).instructions[1].data;
  assert.equal(withCid.length, 143);
  assert.equal(withCid.subarray(8 + 32 + 7 + 64).toString('hex'), KNOWN_DIGEST);
  assert.ok(withCid.subarray(0, 8 + 32 + 7 + 64).equals(plain.subarray(0, 8 + 32 + 7 + 64)), 'only external_ref_hash differs');
  const decoded = new BorshInstructionCoder(idl).decode(withCid);
  assert.equal(decoded.name, 'register_work_claim');
  assert.deepEqual(Array.from(decoded.data.external_ref_hash), ref);
});

// ---- add_version through the sponsored path ----
const workClaim = 'fcT9HJWSCgU6co6K2ic2qxVThxXhc8EPAngP99mwq16'; // work_claim of the 2026-10-05 devnet registration; only referenced
const head = 'BpsMTsw9uxmmgmy1iVjgwaLfoyKMGuoisyBQ8sTrxvmG';
const versionArgs = { workClaim, expectedPreviousLink: head, externalRefHash: cidToExternalRefHash(KNOWN_CID) };

test('add_version transaction: transfer then add_version, exact data, accounts and signer slots', () => {
  const { wire, records } = buildSponsoredVersionTransaction(payer, writer, hash, 3_190_240, 'version-intent', versionArgs);
  const tx = Transaction.from(wire);
  assert.deepEqual(tx.signatures.map(s => s.publicKey.toBase58()).sort(), [payer, RENT_WALLET, writer].sort());
  assert.equal(tx.signatures[0].publicKey.toBase58(), payer);
  assert.equal(tx.instructions.length, 2);
  const [transfer, version] = tx.instructions;
  assert.deepEqual(transfer.keys.map(k => k.pubkey.toBase58()), [RENT_WALLET, writer]);
  assert.equal(transfer.data.readBigUInt64LE(4), 3_190_240n);
  assert.equal(version.programId.toBase58(), PROGRAM);
  assert.equal(version.data.length, 170);
  assert.equal(version.data.subarray(0, 8).toString('hex'), 'a72a0018536d3df8');
  const decoded = new BorshInstructionCoder(idl).decode(version.data);
  assert.equal(decoded.name, 'add_version');
  assert.equal(decoded.data.content_kind, APP_PARAMS.content_kind);
  assert.equal(decoded.data.anchor_mode_arg, 1);
  assert.equal(decoded.data.expected_previous_link.toBase58(), head);
  assert.deepEqual(Array.from(decoded.data.external_ref_hash), versionArgs.externalRefHash);
  // Accounts in IDL order with IDL flags; the anchor is derived from the content artifact (add_version.rs).
  const names = ['registry_config', 'work_claim', 'content_artifact', 'claim_artifact_link', 'anchor_record', 'claimant', 'system_program'];
  assert.deepEqual(version.keys.map(k => k.pubkey.toBase58()), names.map(n => records[n]));
  assert.deepEqual(version.keys.map(k => [k.isWritable, k.isSigner]), [[false, false], [true, false], [true, false], [true, false], [true, false], [true, true], [false, false]]);
  assert.equal(records.work_claim, workClaim);
  assert.equal(records.claimant, writer);
  const program = new PublicKey(PROGRAM);
  const derive = (...seeds) => PublicKey.findProgramAddressSync(seeds, program)[0];
  const probe = buildAddVersionProbe(payer, writer, hash, 'version-intent', { workClaim, expectedPreviousLink: head });
  const content = derive(Buffer.from('content'), probe.rawHash);
  assert.equal(records.content_artifact, content.toBase58());
  assert.equal(records.anchor_record, derive(Buffer.from('anchor'), content.toBuffer(), probe.anchorNonce).toBase58());
  assert.equal(records.claim_artifact_link, derive(Buffer.from('claim_artifact'), new PublicKey(workClaim).toBuffer(), probe.linkNonce).toBase58());
  assert.ok(wire.length < 1232 - 20, 'Room for the Lighthouse instruction');
});

test('add_version: a fresh intent gives new content, link and anchor accounts; the claim stays', () => {
  const a = buildSponsoredVersionTransaction(payer, writer, hash, 3_190_240, 'v-a', versionArgs).records;
  const b = buildSponsoredVersionTransaction(payer, writer, hash, 3_190_240, 'v-b', versionArgs).records;
  for (const n of VERSION_RECORDS) assert.notEqual(a[n], b[n], n);
  assert.equal(a.work_claim, b.work_claim);
});

test('add_version rent: three records, exact names, cap and guards', () => {
  const sept30 = { content_artifact: 904240, claim_artifact_link: 1219200, anchor_record: 1066800 };
  assert.deepEqual(VERSION_RECORDS, ['content_artifact', 'claim_artifact_link', 'anchor_record']);
  assert.equal(sumRent(sept30, VERSION_RECORDS), 3_190_240);
  assert.throws(() => sumRent({ ...sept30, work_claim: 1 }, VERSION_RECORDS), /Rent quote must cover exactly/);
  assert.throws(() => sumRent(sept30), /Rent quote must cover exactly/, 'the six-record default does not accept a version quote');
  assert.throws(() => buildSponsoredVersionTransaction(payer, writer, hash, MAX_RENT_LAMPORTS + 1, 'x', versionArgs), /gateway cap/);
  assert.throws(() => buildSponsoredVersionTransaction(RENT_WALLET, writer, hash, 1, 'x', versionArgs), /distinct/);
});

test('Kora reply checks apply to add_version too, including a changed lineage head', () => {
  const { wire } = buildSponsoredVersionTransaction(payer, writer, hash, 3_190_240, 'version-intent', versionArgs);
  assert.throws(() => verifyKoraReturn(fakeReturn(wire), payer, wire, writer), /Invalid Kora signature/); // structure passes, signature is the fake
  const cases = [
    [tx => { tx.instructions[1].data[8 + 32 + 1 + 64 + 1] ^= 1; return tx; }, /Registration instruction changed/], // expected_previous_link
    [tx => { tx.instructions[1].data[9] ^= 1; return tx; }, /Registration instruction changed/],
    [tx => { tx.instructions[0].data.writeBigUInt64LE(3_190_241n, 4); return tx; }, /Transfer instruction changed/],
    [tx => tx.add(lighthouseIx()), /exactly one Lighthouse/],
  ];
  for (const [mutate, error] of cases) assert.throws(() => verifyKoraReturn(fakeReturn(wire, mutate), payer, wire, writer), error);
});

test('parseWorkClaim reads the head and claimant at the program offsets', () => {
  const data = Buffer.alloc(210);
  new PublicKey(head).toBuffer().copy(data, 72);
  new PublicKey(writer).toBuffer().copy(data, 104);
  new PublicKey(workClaim).toBuffer().copy(data, 40);
  assert.deepEqual(parseWorkClaim(data), { rootArtifact: '11111111111111111111111111111111', latestArtifact: workClaim, latestLink: head, claimant: writer });
  assert.throws(() => parseWorkClaim(Buffer.alloc(100)), /too short/);
});

test('the script never reads, prints or saves the writer secret key', () => {
  const source = readFileSync(new URL('./sponsored_register_demo.mjs', import.meta.url), 'utf8');
  assert.ok(!/\.secretKey|secretKey\b/.test(source), 'no secretKey property access anywhere in the script');
  assert.ok(!/writeFileSync\([^)]*writer[^A-Za-z]/.test(source.replace(/writerAddress/g, 'addr')), 'save never receives the writer object');
  assert.ok(/Keypair\.generate\(\)/.test(source) && /never saved or printed/.test(source));
  assert.equal((source.match(/Keypair\.fromSecretKey/g) ?? []).length, 1, 'only the rent wallet file is loaded');
  assert.ok(!/KORA_FEE_PAYER_SECRET|fee-payer key file/i.test(source.replace(/Never reads Kora's fee-payer key\./, '')));
});
