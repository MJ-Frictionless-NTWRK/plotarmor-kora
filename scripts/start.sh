#!/bin/sh
set -eu

# Refuse an unauthenticated deployment or an accidental in-memory quota store.
# Never inspect, expand, copy, or log the fee-payer secret here. Kora loads it.
: "${KORA_API_KEY:?Set KORA_API_KEY in the runtime secret store}"
: "${KORA_HMAC_SECRET:?Set KORA_HMAC_SECRET in the runtime secret store}"
: "${KORA_REDIS_URL:?Set KORA_REDIS_URL to the private quota store}"
: "${RPC_URL:?Set RPC_URL to the devnet RPC endpoint}"

# The shared metrics listener is pinned to the same port in kora.toml.
if [ "${PORT:-10000}" != "10000" ]; then
    echo 'PORT must be 10000 to match kora.toml metrics.port' >&2
    exit 1
fi

exec /usr/local/bin/kora --config /app/kora.toml rpc start \
    --signers-config /app/signers.toml --port 10000
