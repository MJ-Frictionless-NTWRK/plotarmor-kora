const plot="3h9CzV9MJDeD5yjhVhdE6cupuXVRnLW1Cu6P14EJBKv2";
const SIG = "3PnhZSwa1SX4ecbhDNXEK3wSSG7NNQ1oTkctM4AWmzRhmLz4ikMBqjUaQqj9sZYjLeEc7iQbVmb1WVKJB4pDVMgW";
const RPC = "https://api.devnet.solana.com";
const rpc = async (method, params) => (await (await fetch(RPC, {method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method,params})})).json()).result;
const tx = await rpc("getTransaction",[SIG,{encoding:"json",maxSupportedTransactionVersion:0,commitment:"finalized"}]);
const m = tx.transaction.message, meta = tx.meta, keys = m.accountKeys;
console.log("slot", tx.slot, "blockTime", tx.blockTime, new Date(tx.blockTime*1000).toISOString(), "version", tx.version, "err", JSON.stringify(meta.err));
console.log("fee", meta.fee);
console.log("numRequiredSignatures", m.header.numRequiredSignatures, "numSignatures", tx.transaction.signatures.length);
for (let i=0;i<m.header.numRequiredSignatures;i++) console.log("signer", i, keys[i], "sig", tx.transaction.signatures[i]);
console.log("first signature equals queried:", tx.transaction.signatures[0]===SIG);
keys.forEach((k,i)=>console.log("acct", i, k, "pre", meta.preBalances[i], "post", meta.postBalances[i], "delta", meta.postBalances[i]-meta.preBalances[i]));
m.instructions.forEach((ix,n)=>console.log("ix", n, "program", keys[ix.programIdIndex], "accounts", ix.accounts.map(a=>keys[a]).join(",")));
function bs58d(s){const A="123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";let n=0n;for(const c of s)n=n*58n+BigInt(A.indexOf(c));let h=n.toString(16);if(h.length%2)h="0"+h;let b=Buffer.from(h,"hex");const z=s.match(/^1*/)[0].length;return Buffer.concat([Buffer.alloc(z),b]);}
m.instructions.forEach((ix,n)=>{const d=bs58d(ix.data);console.log("ix",n,"data hex",d.toString("hex").slice(0,64));});
// Account created by PlotArmor: find post-balance accounts with pre 0
const info = await rpc("getMultipleAccounts",[keys,{encoding:"base64",commitment:"finalized"}]);
info.value.forEach((a,i)=>console.log("now", i, keys[i], a?`lamports ${a.lamports} owner ${a.owner} dataLen ${Buffer.from(a.data[0],"base64").length}`:"null"));
const KORA="HWfGUebvq9ez4EWZKXoDBiNfH8uQ2q3mpMqpVCHfMdSW", RENT="HZJTTwQMa6uyfA9AMXMmJKb9UrzxzGTKPAXQ2LKxgFLn";
const signerKeys = keys.slice(0, m.header.numRequiredSignatures);
const WRITER = signerKeys.find(k=>k!==KORA&&k!==RENT);
console.log("claimed fee payer match", keys[0]===KORA, "rent in keys", keys.includes(RENT), "writer", WRITER);
for (const [label,k] of [["writer",WRITER],["rent wallet",RENT],["Kora",KORA]]) { const i=keys.indexOf(k); console.log("balance", label, k, "pre", meta.preBalances[i], "post", meta.postBalances[i], "delta", meta.postBalances[i]-meta.preBalances[i]); }
console.log("instruction programs in order:", m.instructions.map(ix=>keys[ix.programIdIndex]).join(" , "));
const reg = m.instructions.find(ix=>keys[ix.programIdIndex]===plot);
if (reg) { const d=bs58d(reg.data);
  console.log("register_work_claim data bytes", d.length, "discriminator", d.subarray(0,8).toString("hex"));
  console.log("decoded content_kind", d[40], "claim_kind", d[41], "total_shares", d.readUInt16LE(42), "threshold_shares", d.readUInt16LE(44), "anchor_mode_arg", d[8+32+1+1+2+2+64]);
  console.log("external_ref_hash hex", d.subarray(8+32+6+64+1).toString("hex")); }
const b64 = await rpc("getTransaction",[SIG,{encoding:"base64",maxSupportedTransactionVersion:0,commitment:"finalized"}]);
console.log("serialized transaction bytes", Buffer.from(b64.transaction[0],"base64").length);
const owned = info.value.map((a,i)=>({a,i})).filter(({a,i})=>a&&a.owner===plot&&meta.preBalances[i]===0);
console.log("accounts owned by PlotArmor with pre 0:", owned.length, "sum lamports now", owned.reduce((s,{a})=>s+a.lamports,0));
(meta.logMessages||[]).forEach(l=>console.log("log",l));
