import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { buildSponsoredTransaction, verifyKoraReturn, sumRent, RENT_WALLET, RECORD_SIZES, MAX_RENT_LAMPORTS, APP_PARAMS } from './sponsored_register_demo.mjs';
import { buildRegistrationProbe } from './verify_register_work_claim.mjs';
import { PROGRAM } from './verify_plotarmor_sign_transaction.mjs';
const require = createRequire(new URL('../../plotarmor-program/package.json', import.meta.url));
const { PublicKey, Transaction, TransactionInstruction } = require('@solana/web3.js');
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
  assert.throws(() => sumRent(five), /exactly the six/);
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
  assert.ok(data.subarray(8 + 32 + 7 + 64).equals(Buffer.alloc(32)), 'external_ref_hash stays zero in the script');
});

test('the plain registration probe keeps its original arguments', () => {
  const data = buildRegistrationProbe(payer, writer, hash, intent).data;
  assert.equal(data[8 + 32], 0);
  assert.equal(data[8 + 32 + 1], 0);
  assert.equal(data.readUInt16LE(8 + 32 + 2), 1);
  assert.equal(data.readUInt16LE(8 + 32 + 4), 1);
});
