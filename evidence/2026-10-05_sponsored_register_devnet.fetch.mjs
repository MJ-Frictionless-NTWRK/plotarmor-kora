const SIG = "59ntRv2vP4a5guNf9z1hGZZXkFmGk1YGRufFZjNxAGBdhfioMryeCzVoJAfgTTeJsyeyQFn11cW9YZBqn98C5LPk";
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
const plot="3h9CzV9MJDeD5yjhVhdE6cupuXVRnLW1Cu6P14EJBKv2";
const info = await rpc("getMultipleAccounts",[keys,{encoding:"base64",commitment:"finalized"}]);
info.value.forEach((a,i)=>console.log("now", i, keys[i], a?`lamports ${a.lamports} owner ${a.owner} dataLen ${Buffer.from(a.data[0],"base64").length}`:"null"));
console.log("claimed fee payer match", keys[0]==="HWfGUebvq9ez4EWZKXoDBiNfH8uQ2q3mpMqpVCHfMdSW", "writer in keys", keys.includes("4p5u6WvMN6BEc8jNmvBMiao1bG1gdJ4UJD5CA9AUZirh"), "rent in keys", keys.includes("HZJTTwQMa6uyfA9AMXMmJKb9UrzxzGTKPAXQ2LKxgFLn"));
const b64 = await rpc("getTransaction",[SIG,{encoding:"base64",maxSupportedTransactionVersion:0,commitment:"finalized"}]);
console.log("serialized transaction bytes", Buffer.from(b64.transaction[0],"base64").length);
const owned = info.value.map((a,i)=>({a,i})).filter(({a,i})=>a&&a.owner===plot&&meta.preBalances[i]===0);
console.log("accounts owned by PlotArmor with pre 0:", owned.length, "sum lamports now", owned.reduce((s,{a})=>s+a.lamports,0));
(meta.logMessages||[]).forEach(l=>console.log("log",l));
