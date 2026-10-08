# Devnet stateful Kora signing coverage, 2026-09-17

Live execution finished at 17:41:45 UTC. All three requested instructions passed
on their first live attempt. Registration also passed its signing refresh during
setup. There were no live failures or retries. Earlier credential-readiness and
local startup failures remain preserved in ../2026-09-17-stateful-readiness/.

| Instruction | Status | Raw Kora request / response | Fully signed raw simulation | Authority delta (lamports) |
| --- | --- | --- | --- | --- |
| add_version | PASS | [request](006-kora-signTransaction.request.json), [response](006-kora-signTransaction.response.txt) | [simulation](007-devnet-simulateTransaction.response.txt) | -3,190,240 |
| add_owner | PASS | [request](010-kora-signTransaction.request.json), [response](010-kora-signTransaction.response.txt) | [simulation](011-devnet-simulateTransaction.response.txt) | -1,031,240 |
| anchor_authorized_contract | PASS | [request](014-kora-signTransaction.request.json), [response](014-kora-signTransaction.response.txt) | [simulation](015-devnet-simulateTransaction.response.txt) | -3,027,680 |
| register_work_claim refresh | PASS | [request](../2026-09-17-stateful-setup-001/005-kora-signTransaction.request.json), [response](../2026-09-17-stateful-setup-001/005-kora-signTransaction.response.txt) | [simulation](../2026-09-17-stateful-setup-001/006-devnet-simulateTransaction.response.txt) | -7,147,560 |

Each PASS includes unsigned preflight, a valid Kora Ed25519 signature, unchanged
PlotArmor instruction data/account order/account privileges, unchanged blockhash
and fee payer, exactly one appended Lighthouse assertion, an ordinary authority
signature added without message changes, and successful sigVerify=true simulation
of that exact fully signed transaction without blockhash replacement. Saved raw
request/response bodies, base64 transactions, IDL, arguments, account maps, balance
summaries and verification summaries allow reconstruction. Authentication headers
are omitted so credentials are not persisted. Requests and responses are otherwise
the original JSON RPC bodies.

Kora necessarily signs the returned Lighthouse-bearing message, not the original
pre-Lighthouse message. Verification reconstructs that permitted message change
and compares exact serialized messages, in addition to checking the original
PlotArmor instruction byte-for-byte.

All four Lighthouse assertions target Kora fee payer
`HWfGUebvq9ez4EWZKXoDBiNfH8uQ2q3mpMqpVCHfMdSW` and require at least
**4,999,990,000 lamports**. The ordinary authority/rent payer is
`HZJTTwQMa6uyfA9AMXMmJKb9UrzxzGTKPAXQ2LKxgFLn`.
Each Kora transaction simulation debits the fee payer 10,000 lamports and the
authority the rent amount above. Those are simulated debits, not actual spending.

## Actual setup broadcast

Exactly one transaction was broadcast, directly through devnet RPC and paid and
signed solely by the ordinary authority wallet. It contains only registration,
no Kora signature and no Lighthouse instruction. The registration created the
WorkClaim and matching Ownership/admin used by all three probes. The probe stage
read and validated their owners, discriminators, claimant/admin fields and PDAs.

Setup signature:

`4V1gZYiuRWNWvUY52o1rNwVBjA6aASrg2SZ25JyReXYiP3683kY1WkPDArkT1Jmg3N53davDv2pJEgbtKtUWPaC6`

[Confirmed signature status](../2026-09-17-stateful-setup-001/011-devnet-getSignatureStatuses.response.txt),
[on-chain transaction and metadata](../2026-09-17-stateful-setup-001/012-devnet-getTransaction.response.txt),
[fixture accounts](fixture.json).

The setup preflight debited the ordinary authority 7,152,560 lamports including
its 5,000-lamport network fee. No add_version, add_owner, authorized-contract or
Kora-signed registration probe was broadcast. The synthetic new owner is a public
Edwards basepoint address; no ownership addition was persisted.

## Coverage and constraints

This run produced **4 qualifying live signing passes**: 3 new instruction shapes
and 1 registration refresh. The three target probes used confirmed state and do
not depend on M2. Source inspection and the M2 diff confirm RegistryConfig was
already present; rent is charged to claimant for add_version and admin for the
other two.

Historical plus current evidence now covers **5 of 6 application instructions**.
sign_contract remains unprobed through Kora; its current five-account client
shape needs the pending M2 deployment alignment. anchor_evidence_contract retains
its historical pass and was not refreshed here. Thus four shapes have fresh
fully signed simulation evidence today, not six. The separate four-pass numerical
verification requirement is satisfied by this run; this does not establish full
policy, security, deployment, application integration or instruction coverage.

Valid authenticated Kora calls succeeded today. Wrong-HMAC rejection and
infrastructure-only policy rejection were not rerun. Lighthouse was freshly
verified structurally and in the successful fully signed simulations. No kora.toml
change, sign-and-send enablement, redeployment, commit or push was performed.
The Kora fee-payer private-key file was never opened.

The combined offline suite passed before live execution. A read-only replay of
the saved artifacts independently rechecked all four Kora signatures, all four
fully signed messages, raw simulation success/balance deltas, and the single
ordinary-wallet setup send. That replay is not counted as another live pass.
