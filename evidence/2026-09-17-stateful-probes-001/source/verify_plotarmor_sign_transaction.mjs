#!/usr/bin/env node
// Human-run, signing only. Never loads a wallet, keypair, dotenv, or broadcasts.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createKoraRpc, decodeTransaction, inspectSignedTransaction } from './verify_live_sign_transaction.mjs';

// Reuse the sibling program's installed Anchor/web3 boundary, read-only.
const requireProgram = createRequire(new URL('../../plotarmor-program/package.json', import.meta.url));
const { PublicKey, Transaction, TransactionInstruction } = requireProgram('@solana/web3.js');
const { BorshInstructionCoder } = requireProgram('@coral-xyz/anchor');
const idl = JSON.parse(readFileSync(new URL('../../plotarmor-program/target/idl/plotarmor.json', import.meta.url)));
export const PROGRAM = '3h9CzV9MJDeD5yjhVhdE6cupuXVRnLW1Cu6P14EJBKv2';
const SYSTEM = '11111111111111111111111111111111';
const DEVNET = 'https://api.devnet.solana.com';
export const DEVNET_GENESIS_HASH = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
const ixName = 'anchor_evidence_contract';
const sha256 = value => createHash('sha256').update(value).digest();

export function buildEvidenceProbe(payerAddress, anchorerAddress, blockhash, intent) {
  if (idl.address !== PROGRAM) throw new Error('IDL program address mismatch');
  if (!intent || Buffer.byteLength(intent) > 256) throw new Error('Supply a nonempty probe intent, at most 256 UTF-8 bytes');
  const payer = new PublicKey(payerAddress);
  const anchorer = new PublicKey(anchorerAddress);
  if (payer.equals(anchorer)) throw new Error('A separate funded anchorer is required by Kora rent policy');
  if (!PublicKey.isOnCurve(anchorer.toBytes())) throw new Error('Anchoring wallet must be an on-curve public key');
  const program = new PublicKey(PROGRAM);
  const derive = (...seeds) => PublicKey.findProgramAddressSync(seeds, program)[0];
  // Public synthetic evidence bytes, not a real contract. Stable across retries.
  const content = `PlotArmor Kora signing-only probe\n${anchorerAddress}\n${intent}\n`;
  const rawHash = sha256(content);
  const nonce = sha256(`PlotArmor Kora anchor nonce\n${anchorerAddress}\n${intent}\n`);
  const registry = derive(Buffer.from('config'));
  const artifact = derive(Buffer.from('contract_artifact'), rawHash);
  const evidence = derive(Buffer.from('evidence'), anchorer.toBuffer(), artifact.toBuffer());
  const anchor = derive(Buffer.from('anchor'), evidence.toBuffer(), nonce);
  const addresses = [registry, artifact, evidence, anchor, anchorer, new PublicKey(SYSTEM)];
  const definition = idl.instructions.find(ix => ix.name === ixName);
  const names = ['registry_config', 'contract_artifact', 'evidence_anchor', 'anchor_record', 'anchorer', 'system_program'];
  if (!definition || JSON.stringify(definition.accounts.map(a => a.name)) !== JSON.stringify(names)) {
    throw new Error('IDL account layout changed; review probe against source');
  }
  const expectedFlags = [[false, false], [true, false], [true, false], [true, false], [true, true], [false, false]];
  definition.accounts.forEach((a, i) => {
    if (Boolean(a.writable) !== expectedFlags[i][0] || Boolean(a.signer) !== expectedFlags[i][1]) {
      throw new Error('IDL account permissions changed');
    }
  });
  const data = new BorshInstructionCoder(idl).encode(ixName, {
    raw_contract_hash: [...rawHash], contract_kind: 0, anchor_nonce: [...nonce],
    anchor_mode_arg: 1, asserted_work_claim: new PublicKey(SYSTEM),
    external_ref_hash: Array(32).fill(0),
  });
  const instruction = new TransactionInstruction({ programId: program, data,
    keys: addresses.map((pubkey, i) => ({ pubkey, isWritable: expectedFlags[i][0], isSigner: expectedFlags[i][1] })),
  });
  const transaction = new Transaction({ feePayer: payer, recentBlockhash: blockhash }).add(instruction);
  const wire = transaction.serialize({ requireAllSignatures: false, verifySignatures: false });
  return { wire, rawHash, nonce, data, addresses: Object.fromEntries(names.map((name, i) => [name, addresses[i].toBase58()])) };
}

export async function runPlotArmor(apiKey, secret, anchorer, intent, fetcher = fetch) {
  if (!anchorer) throw new Error('Set PLOTARMOR_PROBE_USER to a funded devnet wallet PUBLIC address; no private key');
  const rpc = createKoraRpc(apiKey, secret, fetcher);
  async function solana(method, params) {
    const response = await fetcher(DEVNET, { method: 'POST', redirect: 'error',
      signal: AbortSignal.timeout(60000), headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    const json = await response.json();
    if (!response.ok || json.error) throw new Error(`Devnet ${method}: ${JSON.stringify(json.error ?? response.status)}`);
    return json.result;
  }
  if (await solana('getGenesisHash', []) !== DEVNET_GENESIS_HASH) throw new Error('Unexpected devnet genesis');
  const payerReply = await rpc('getPayerSigner', {});
  if (!payerReply.accepted) throw new Error('Authenticated public payer lookup failed');
  const payer = payerReply.result.signer_address;
  const hashReply = await rpc('getBlockhash', {});
  if (!hashReply.accepted) throw new Error('Authenticated blockhash lookup failed');
  const probe = buildEvidenceProbe(payer, anchorer, hashReply.result.blockhash, intent);
  console.log('Signing only, no broadcast. Instruction: anchor_evidence_contract, contract_kind=0, attested_devnet=1.');
  console.log(`Kora fee payer: ${payer}; user/rent payer: ${anchorer}; intent: ${intent}`);
  console.log(JSON.stringify({ accounts: probe.addresses, raw_contract_hash: probe.rawHash.toString('hex'),
    anchor_nonce: probe.nonce.toString('hex') }, null, 2));
  const simulation = await solana('simulateTransaction', [probe.wire.toString('base64'), {
    encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed',
  }]);
  console.log('Unsigned preflight simulation (does not prove wallet control):');
  console.log(JSON.stringify(simulation));
  if (!simulation?.value || simulation.value.err !== null) {
    console.log('Simulation failed; Kora signing was not requested. Resolve the reported account/program/funding error.');
    return 2;
  }
  const reply = await rpc('signTransaction', { transaction: probe.wire.toString('base64'),
    signer_key: payer, sig_verify: false, user_id: anchorer });
  console.log(`Signing accepted: ${reply.accepted ? 'YES' : 'NO'}`);
  if (!reply.accepted) {
    console.log('Lighthouse UNVERIFIED. The raw Kora rejection is printed above.');
    return 2;
  }
  const checked = inspectSignedTransaction(reply.result, payer, probe.wire);
  const original = decodeTransaction(probe.wire);
  const actual = checked.decoded.instructions;
  const preserved = actual.length === 2 && actual[0].program === PROGRAM
    && actual[0].data.equals(original.instructions[0].data)
    && JSON.stringify(actual[0].accounts) === JSON.stringify(original.instructions[0].accounts);
  const signersPreserved = checked.decoded.signatures.length === 2
    && checked.decoded.keys[1] === anchorer;
  console.log(`Original PlotArmor instruction preserved: ${preserved}; two signer slots preserved: ${signersPreserved}`);
  console.log('No broadcast performed. The user must authorize and sign the returned message before any future submission.');
  return checked.changed && checked.signatureValid && checked.lighthouseValid && preserved && signersPreserved ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runPlotArmor(process.env.KORA_API_KEY, process.env.KORA_HMAC_SECRET,
    process.env.PLOTARMOR_PROBE_USER, process.env.PLOTARMOR_PROBE_INTENT)
    .then(code => { process.exitCode = code; })
    .catch(error => { console.error(`Probe failed: ${error.message}`); process.exitCode = 1; });
}
