import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { buildStatefulProbe, verifyReturned } from './verify_stateful_signing.mjs';
import { PROGRAM } from './verify_plotarmor_sign_transaction.mjs';
const require = createRequire(new URL('../../plotarmor-program/package.json', import.meta.url));
const { PublicKey, Transaction } = require('@solana/web3.js');
const payer = '9hSR6S7WPtxmTojgo6GG3k4yDPecgJY292j7xrsUGWBu';
const authority = 'HZJTTwQMa6uyfA9AMXMmJKb9UrzxzGTKPAXQ2LKxgFLn';
const newOwner = new PublicKey(Buffer.from('58' + '66'.repeat(31), 'hex')).toBase58();
const hash = '11111111111111111111111111111111';
const sha = s => createHash('sha256').update(s).digest();
const pda = (...seeds) => PublicKey.findProgramAddressSync(seeds, new PublicKey(PROGRAM))[0];
const work = pda(Buffer.from('claim'), sha('root'), new PublicKey(authority).toBuffer());
const own = pda(Buffer.from('ownership'), work.toBuffer());
const fixture = { work_claim: work.toBase58(), ownership: own.toBase58(), latest_link: pda(Buffer.from('claim_artifact'),work.toBuffer(),sha('old-link')).toBase58() };
const intent = 'offline-stateful';

for (const name of ['add_version', 'add_owner', 'anchor_authorized_contract']) {
  test(`${name}: independently encoded arguments, rent authority, PDA seeds and signer slots`, () => {
    const built = buildStatefulProbe(name,payer,authority,hash,fixture,intent,newOwner);
    const ix = built.transaction.instructions[0];
    const raw = sha(`${intent}:${name}:content`), link = sha(`${intent}:${name}:link`), nonce = sha(`${intent}:${name}:anchor`);
    const disc = sha(`global:${name}`).subarray(0,8);
    const args = name === 'add_version' ? Buffer.concat([raw,Buffer.from([0]),link,nonce,Buffer.from([1]),new PublicKey(fixture.latest_link).toBuffer(),Buffer.alloc(32)])
      : name === 'add_owner' ? Buffer.from([1,0,0,1,0])
      : Buffer.concat([raw,Buffer.from([0]),nonce,Buffer.from([1]),Buffer.alloc(32)]);
    assert.deepEqual(ix.data, Buffer.concat([disc,args]));
    assert.deepEqual(ix.keys.filter(k=>k.isSigner).map(k=>[k.pubkey.toBase58(),k.isWritable]), [[authority,true]]);
    const a = built.accounts;
    if (name === 'add_version') {
      const content = pda(Buffer.from('content'),raw);
      assert.equal(a.content_artifact,content.toBase58());
      assert.equal(a.claim_artifact_link,pda(Buffer.from('claim_artifact'),work.toBuffer(),link).toBase58());
      assert.equal(a.anchor_record,pda(Buffer.from('anchor'),content.toBuffer(),nonce).toBase58());
    } else if (name === 'add_owner') {
      assert.equal(a.new_owner_record,pda(Buffer.from('owner'),own.toBuffer(),new PublicKey(newOwner).toBuffer()).toBase58());
      assert.equal(ix.keys.find(k=>k.pubkey.toBase58()===newOwner).isSigner,false);
    } else {
      const artifact = pda(Buffer.from('contract_artifact'),raw);
      const anchor = pda(Buffer.from('authorized_contract'),work.toBuffer(),artifact.toBuffer());
      assert.equal(a.contract_artifact,artifact.toBase58());
      assert.equal(a.authorized_contract_anchor,anchor.toBase58());
      assert.equal(a.anchor_record,pda(Buffer.from('anchor'),anchor.toBuffer(),nonce).toBase58());
    }
    const wire = built.transaction.serialize({requireAllSignatures:false,verifySignatures:false});
    const decoded = Transaction.from(wire);
    assert.deepEqual(decoded.signatures.map(s=>s.publicKey.toBase58()),[payer,authority]);
    assert.ok(decoded.signatures.every(s=>s.signature===null));
    assert.throws(()=>verifyReturned({signed_transaction:wire.toString('base64'),signer_pubkey:payer},payer,wire,authority),/Invalid Kora signature/);
  });
}

test('rent sponsorship and attribution guards reject Kora in authority roles', () => {
  assert.throws(()=>buildStatefulProbe('add_version',authority,authority,hash,fixture,intent,newOwner),/Rent payer/);
  assert.throws(()=>buildStatefulProbe('add_owner',payer,authority,hash,fixture,intent,payer),/synthetic ownership/);
});
