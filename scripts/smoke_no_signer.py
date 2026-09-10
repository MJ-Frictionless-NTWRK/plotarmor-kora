#!/usr/bin/env python3
"""Run the pinned Kora executable with no signer and no inherited environment.

Requires Python 3.11+, a Kora executable, and a Redis server executable.
Never use this script for signer-backed testing or provide a fee-payer secret.
This is a native executable check, not evidence of a successful Docker build.
"""

import argparse
import hashlib
import hmac
import json
from pathlib import Path
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.request


ROOT = Path(__file__).resolve().parents[1]
API_KEY = "public-smoke-api"
HMAC_SECRET = "public-smoke-hmac-placeholder-32-characters"


def request(path, body=None, headers=None):
    data = None if body is None else body.encode()
    req = urllib.request.Request(
        "http://127.0.0.1:10000" + path, data=data, headers=headers or {}
    )
    try:
        with urllib.request.urlopen(req, timeout=3) as response:
            return response.status, response.read().decode()
    except urllib.error.HTTPError as error:
        return error.code, error.read().decode()


def auth_headers(body, *, timestamp=None):
    timestamp = str(int(time.time()) if timestamp is None else timestamp)
    signature = hmac.new(
        HMAC_SECRET.encode(), (timestamp + body).encode(), hashlib.sha256
    ).hexdigest()
    return {
        "Content-Type": "application/json",
        "x-api-key": API_KEY,
        "x-timestamp": timestamp,
        "x-hmac-signature": signature,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--kora", required=True, type=Path)
    parser.add_argument("--redis-server", required=True, type=Path)
    parser.add_argument("--redis-library-path")
    args = parser.parse_args()
    kora = str(args.kora.resolve())
    # Redis selects its mode from argv[0]; preserve the redis-server symlink name.
    redis = str(args.redis_server.absolute())

    # Refuse to test somebody else's service on the configured Kora port.
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 10000))
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        redis_port = probe.getsockname()[1]

    # Construct these from scratch. Do not copy or inspect os.environ.
    env = {
        "PATH": "/usr/bin:/bin",
        "NO_DNA": "1",
        "RPC_URL": "https://api.devnet.solana.com",
        "KORA_API_KEY": API_KEY,
        "KORA_HMAC_SECRET": HMAC_SECRET,
        "KORA_REDIS_URL": f"redis://127.0.0.1:{redis_port}",
    }
    redis_env = {"PATH": "/usr/bin:/bin"}
    if args.redis_library_path:
        redis_env["LD_LIBRARY_PATH"] = args.redis_library_path

    processes = []
    with tempfile.TemporaryDirectory(prefix="kora-no-signer-", dir="/tmp") as scratch:
        scratch = Path(scratch)
        # Kora calls dotenv(). An empty local file stops parent-directory lookup.
        (scratch / ".env").write_text("")
        policy = (ROOT / "kora.toml").read_text()
        config = scratch / "kora.toml"
        config.write_text(policy)

        def validate(path, expected_success):
            result = subprocess.run(
                [kora, "--config", str(path), "config", "validate"],
                cwd=scratch, env=env, capture_output=True, text=True, timeout=20,
            )
            if (result.returncode == 0) != expected_success:
                raise AssertionError(result.stdout + result.stderr)
            return result.stdout + result.stderr

        with (scratch / "redis.log").open("w+") as redis_log, (
            scratch / "kora.log"
        ).open("w+") as kora_log:
            try:
                processes.append(subprocess.Popen(
                    [redis, "--bind", "127.0.0.1", "--port", str(redis_port),
                     "--save", "", "--appendonly", "no", "--daemonize", "no"],
                    cwd=scratch, env=redis_env, stdout=redis_log, stderr=subprocess.STDOUT,
                ))
                for _ in range(50):
                    if processes[0].poll() is not None:
                        redis_log.seek(0)
                        raise RuntimeError(redis_log.read())
                    try:
                        with socket.create_connection(("127.0.0.1", redis_port), timeout=0.2):
                            break
                    except OSError:
                        time.sleep(0.1)
                else:
                    raise RuntimeError("Redis did not start")

                version = subprocess.check_output(
                    [kora, "--version"], cwd=scratch, env=env, text=True, timeout=10
                ).strip()
                assert version == "kora-cli 2.2.0-beta.8", version
                print("PASS: executable reports v2.2.0-beta.8")
                print(validate(config, True))
                print("PASS: exact policy parsed and accepted by Kora validator; signer omitted")

                missing_lighthouse = scratch / "missing-lighthouse.toml"
                missing_lighthouse.write_text(policy.replace(
                    '    "L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95",\n', ""
                ))
                assert "Lighthouse is enabled but" in validate(missing_lighthouse, False)
                print("PASS: validator rejects Lighthouse without its allowlisted program")

                bad_config = scratch / "unknown-field.toml"
                bad_config.write_text(policy.replace("[kora]\n", "[kora]\ninvalid_field = true\n"))
                assert "unknown field" in validate(bad_config, False)
                print("PASS: validator rejects unknown policy fields")

                saved_redis_url = env.pop("KORA_REDIS_URL")
                assert "Redis" in validate(config, False)
                env["KORA_REDIS_URL"] = saved_redis_url
                print("PASS: missing Redis URL fails validation instead of using in-memory quotas")

                processes.append(subprocess.Popen(
                    [kora, "--config", str(config), "rpc", "start",
                     "--no-load-signer", "--port", "10000"],
                    cwd=scratch, env=env, stdout=kora_log, stderr=subprocess.STDOUT,
                ))
                for _ in range(100):
                    if processes[-1].poll() is not None:
                        kora_log.seek(0)
                        raise RuntimeError(kora_log.read())
                    try:
                        if request("/liveness")[0] == 200:
                            break
                    except (OSError, urllib.error.URLError):
                        pass
                    time.sleep(0.1)
                else:
                    raise RuntimeError("Kora did not become live")
                print("PASS: exact policy starts without a signer; GET /liveness returns 200")

                body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "getVersion"})
                assert request("/", body, {"Content-Type": "application/json"})[0] == 401
                assert request("/", body, {"Content-Type": "application/json", "x-api-key": API_KEY})[0] == 401
                headers = auth_headers(body)
                status, response = request("/", body, headers)
                assert status == 200 and "result" in json.loads(response), response
                assert request("/", body, auth_headers(body, timestamp=int(time.time()) - 600))[0] == 401
                headers["x-hmac-signature"] = "00" * 32
                assert request("/", body, headers)[0] == 401
                print("PASS: API key plus valid HMAC required; stale and invalid HMAC rejected")

                disabled = json.dumps({"jsonrpc": "2.0", "id": 2, "method": "signAndSendTransaction", "params": {}})
                status, response = request("/", disabled, auth_headers(disabled))
                assert status >= 400 or "error" in json.loads(response), response
                print("PASS: signAndSendTransaction rejected")

                status, metrics = request("/metrics")
                assert status == 200 and "kora_http_requests_total" in metrics, metrics
                print("PASS: GET /metrics exposes HTTP metrics")
                balance_samples = [line for line in metrics.splitlines() if line.startswith("signer_balance_lamports{")]
                assert not balance_samples, "Unexpected signer balance series in no-signer test"
                print("UNVERIFIED: signer_balance_lamports samples and labels require human signer-backed check")
                print("ONE automated no-signer verification pass. Container build and signing behavior are not covered.")
            finally:
                for process in reversed(processes):
                    if process.poll() is None:
                        process.terminate()
                        try:
                            process.wait(timeout=15)
                        except subprocess.TimeoutExpired:
                            process.kill()
                            process.wait()


if __name__ == "__main__":
    main()
