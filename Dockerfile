# v2.2.0-beta.8, Linux amd64/arm64 OCI index, resolved from GHCR on 2026-09-10.
# Provisional devnet acceptance only. Re-check pin and audit scope in Phase 7.
FROM ghcr.io/solana-foundation/kora:v2.2.0-beta.8@sha256:1b929cd9b32e6a3dddb646669fbe0d30651e07377b2bface044cd84289df59bf

WORKDIR /app
COPY --chmod=0444 kora.toml signers.toml /app/
COPY --chmod=0555 scripts/start.sh /app/start.sh

ENV PORT=10000
ENV RPC_URL=https://api.devnet.solana.com
ENV RUST_LOG=info
ENV NO_DNA=1

USER 10001:1000
EXPOSE 10000
ENTRYPOINT ["/app/start.sh"]
CMD []
