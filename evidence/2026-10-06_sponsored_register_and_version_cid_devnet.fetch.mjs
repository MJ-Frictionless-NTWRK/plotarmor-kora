// Independent finalized readout of two devnet transactions from the public RPC. Uses no repo code and no keys.
const SIGS = {
  register: "fFa8grTPZPnL8i2934g1qwdh4z8zFCGjvmWCSsfgGbqfKRxCkSzNVGqukUxvxkb3kZW7kvtHRQyoNwS4iLLEX5L",
  add_version: "5CNSubE6TC4APHo2WhBRDHUMMD4MDJ7rj1MP4fA5H6P62YiP7bJrxi2sVfLyBXAH7mP6MHAZWLf3CRAkusVsPitn",
};
const CID = "QmT2DLbRoj4JLPJb4PxGw95che5KYvaFkoaX3emGbtWjPX";
const PLOT = "3h9CzV9MJDeD5yjhVhdE6cupuXVRnLW1Cu6P14EJBKv2";
const KORA = "HWfGUebvq9ez4EWZKXoDBiNfH8uQ2q3mpMqpVCHfMdSW", RENT = "HZJTTwQMa6uyfA9AMXMmJKb9UrzxzGTKPAXQ2LKxgFLn";
const RPC = "https://api.devnet.solana.com";
const rpc = async (method, params) => (await (await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) })).json()).result;
const A = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function bs58d(s) { let n = 0n; for (const c of s) n = n * 58n + BigInt(A.indexOf(c)); let h = n.toString(16); if (h.length % 2) h = "0" + h; const z = s.match(/^1*/)[0].length; return Buffer.concat([Buffer.alloc(z), Buffer.from(h, "hex")]); }
function bs58e(b) { let n = 0n; for (const x of b) n = (n << 8n) | BigInt(x); let s = ""; while (n > 0n) { s = A[Number(n % 58n)] + s; n /= 58n; } for (const x of b) { if (x) break; s = "1" + s; } return s; }
const cidDigest = bs58d(CID);
console.log("CID", CID, "decoded bytes", cidDigest.length, "prefix", cidDigest.subarray(0, 2).toString("hex"), "digest", cidDigest.subarray(2).toString("hex"));
const pk = (buf, o) => bs58e(buf.subarray(o, o + 32));
let workClaim;
for (const [label, SIG] of Object.entries(SIGS)) {
  console.log("\n==== " + label + " " + SIG);
  const tx = await rpc("getTransaction", [SIG, { encoding: "json", maxSupportedTransactionVersion: 0, commitment: "finalized" }]);
  const m = tx.transaction.message, meta = tx.meta, keys = m.accountKeys;
  console.log("slot", tx.slot, "blockTime", tx.blockTime, new Date(tx.blockTime * 1000).toISOString(), "version", tx.version, "err", JSON.stringify(meta.err));
  console.log("fee", meta.fee);
  console.log("numRequiredSignatures", m.header.numRequiredSignatures, "numSignatures", tx.transaction.signatures.length);
  for (let i = 0; i < m.header.numRequiredSignatures; i++) console.log("signer", i, keys[i], "sig", tx.transaction.signatures[i]);
  console.log("first signature equals queried:", tx.transaction.signatures[0] === SIG);
  keys.forEach((k, i) => console.log("acct", i, k, "pre", meta.preBalances[i], "post", meta.postBalances[i], "delta", meta.postBalances[i] - meta.preBalances[i]));
  m.instructions.forEach((ix, n) => console.log("ix", n, "program", keys[ix.programIdIndex], "accounts", ix.accounts.map(a => keys[a]).join(",")));
  console.log("instruction programs in order:", m.instructions.map(ix => keys[ix.programIdIndex]).join(" , "));
  const WRITER = keys.slice(0, m.header.numRequiredSignatures).find(k => k !== KORA && k !== RENT);
  for (const [name, k] of [["writer", WRITER], ["rent wallet", RENT], ["Kora", KORA]]) { const i = keys.indexOf(k); console.log("balance", name, k, "pre", meta.preBalances[i], "post", meta.postBalances[i], "delta", meta.postBalances[i] - meta.preBalances[i]); }
  const info = await rpc("getMultipleAccounts", [keys, { encoding: "base64", commitment: "finalized" }]);
  info.value.forEach((a, i) => console.log("now", i, keys[i], a ? `lamports ${a.lamports} owner ${a.owner} dataLen ${Buffer.from(a.data[0], "base64").length}` : "null"));
  const owned = info.value.map((a, i) => ({ a, i })).filter(({ a, i }) => a && a.owner === PLOT && meta.preBalances[i] === 0);
  console.log("new accounts owned by PlotArmor with pre 0:", owned.length, "sum lamports now", owned.reduce((s, { a }) => s + a.lamports, 0));
  owned.forEach(({ a, i }) => console.log("new account", keys[i], "lamports", a.lamports, "dataLen", Buffer.from(a.data[0], "base64").length));
  const b64 = await rpc("getTransaction", [SIG, { encoding: "base64", maxSupportedTransactionVersion: 0, commitment: "finalized" }]);
  console.log("serialized transaction bytes", Buffer.from(b64.transaction[0], "base64").length);
  const ix = m.instructions.find(x => keys[x.programIdIndex] === PLOT);
  const d = bs58d(ix.data);
  console.log("PlotArmor instruction data bytes", d.length, "discriminator", d.subarray(0, 8).toString("hex"));
  if (label === "register") {
    console.log("decoded content_kind", d[40], "claim_kind", d[41], "total_shares", d.readUInt16LE(42), "threshold_shares", d.readUInt16LE(44), "anchor_mode_arg", d[8 + 32 + 1 + 1 + 2 + 2 + 64]);
    console.log("raw_hash", d.subarray(8, 40).toString("hex"));
    console.log("external_ref_hash", d.subarray(8 + 32 + 6 + 64 + 1).toString("hex"));
    workClaim = ix.accounts.map(a => keys[a])[2];
  } else {
    console.log("decoded content_kind", d[40], "anchor_mode_arg", d[8 + 32 + 1 + 64], "expected_previous_link", pk(d, 8 + 32 + 1 + 64 + 1));
    console.log("raw_hash", d.subarray(8, 40).toString("hex"));
    console.log("external_ref_hash", d.subarray(8 + 32 + 1 + 64 + 1 + 32).toString("hex"));
  }
  console.log("external_ref_hash equals CID digest:", d.subarray(d.length - 32).equals(cidDigest.subarray(2)));
  (meta.logMessages || []).forEach(l => console.log("log", l));
}
const c = await rpc("getMultipleAccounts", [[workClaim], { encoding: "base64", commitment: "finalized" }]);
const data = Buffer.from(c.value[0].data[0], "base64");
console.log("\n==== claim account", workClaim, "owner", c.value[0].owner, "lamports", c.value[0].lamports, "dataLen", data.length, "(finalized)");
console.log("root_artifact", pk(data, 8)); console.log("latest_artifact", pk(data, 40)); console.log("latest_link", pk(data, 72)); console.log("claimant", pk(data, 104)); console.log("ownership", pk(data, 136));
