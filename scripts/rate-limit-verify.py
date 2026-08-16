#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Rate-limit verification script for /api/v1/wallet/withdraw.

Usage:
    # Pass token directly
    python scripts/rate-limit-verify.py --token "eyJhbGciOi..."

    # Read token from file (one line, no surrounding quotes)
    python scripts/rate-limit-verify.py --token-file token.txt

    # Custom server / amount / interval
    python scripts/rate-limit-verify.py --token "xxx" --host http://localhost:3000 --amount 1 --interval 0.2

    # Reset Redis rate-limit key before running (needs docker on PATH)
    python scripts/rate-limit-verify.py --token "xxx" --reset --user-id 123

Exit code:
    0  rate limit verified (4th+ request got 429)
    1  rate limit NOT triggered as expected
    2  invalid arguments / setup error
"""

import argparse
import json
import subprocess
import sys
import time
import urllib.error
import urllib.request


DEFAULT_HOST = "http://localhost:3000"
DEFAULT_AMOUNT = 1
DEFAULT_INTERVAL = 0.2          # seconds between requests
TOTAL_REQUESTS = 5              # 3 allowed + 2 over-limit
RATE_LIMIT_THRESHOLD = 3        # per hour
WITHDRAW_PATH = "/api/v1/wallet/withdraw"


def http_post_json(url: str, headers: dict, body: dict, timeout: float = 5.0):
    """Send POST and return (status_code, body_text). Non-2xx -> status from error response."""
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        url, data=data, method="POST",
        headers={**headers, "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        # 4xx/5xx lands here; we want the status code and body
        try:
            body_text = e.read().decode("utf-8", errors="replace")
        except Exception:
            body_text = ""
        return e.code, body_text
    except urllib.error.URLError as e:
        return -1, f"URLError: {e.reason}"
    except Exception as e:
        return -1, f"Exception: {e}"


def reset_redis_rate_limit(user_id: str) -> bool:
    """Clear the rate-limit counter in Redis via docker exec."""
    key = f"ratelimit:withdraw:{user_id}"
    try:
        subprocess.run(
            ["docker", "exec", "nh-redis", "redis-cli", "DEL", key],
            check=True, capture_output=True, timeout=10,
        )
        print(f"[RESET] Redis key cleared: {key}")
        return True
    except FileNotFoundError:
        print(f"[RESET] docker not on PATH; cannot clear key {key}")
        return False
    except subprocess.CalledProcessError as e:
        print(f"[RESET] failed: {e.stderr.decode(errors='replace')}")
        return False


def truncate(text: str, max_len: int = 120) -> str:
    text = (text or "").strip().replace("\n", " ")
    return text if len(text) <= max_len else text[:max_len] + "..."


def main():
    parser = argparse.ArgumentParser(
        description="Verify /wallet/withdraw rate limiting (3/hour -> 429 on 4th)."
    )
    token_group = parser.add_mutually_exclusive_group(required=True)
    token_group.add_argument("--token", help="JWT access token (Bearer xxx)")
    token_group.add_argument("--token-file", help="Path to a file containing the JWT token")
    parser.add_argument("--host", default=DEFAULT_HOST, help=f"BFF host (default: {DEFAULT_HOST})")
    parser.add_argument("--amount", type=float, default=DEFAULT_AMOUNT,
                        help=f"Withdraw amount (default: {DEFAULT_AMOUNT})")
    parser.add_argument("--interval", type=float, default=DEFAULT_INTERVAL,
                        help=f"Seconds between requests (default: {DEFAULT_INTERVAL})")
    parser.add_argument("--reset", action="store_true",
                        help="Clear Redis rate-limit key before running (requires docker)")
    parser.add_argument("--user-id", help="User ID (only used with --reset to build the Redis key)")
    args = parser.parse_args()

    # --- Resolve token ---
    if args.token_file:
        try:
            with open(args.token_file, "r", encoding="utf-8") as f:
                token = f.read().strip().strip('"').strip("'")
        except OSError as e:
            print(f"[ERROR] cannot read token file: {e}", file=sys.stderr)
            sys.exit(2)
    else:
        token = args.token.strip()

    if not token:
        print("[ERROR] empty token", file=sys.stderr)
        sys.exit(2)

    # --- Optional reset ---
    if args.reset:
        if not args.user_id:
            print("[ERROR] --reset requires --user-id", file=sys.stderr)
            sys.exit(2)
        reset_redis_rate_limit(args.user_id)

    # --- Run the 5 sequential requests ---
    url = f"{args.host.rstrip('/')}{WITHDRAW_PATH}"
    headers = {"Authorization": f"Bearer {token}"}
    body = {"amount": args.amount}

    print(f"\n=== Rate-limit verification ===")
    print(f"Endpoint : POST {url}")
    print(f"Body     : {json.dumps(body)}")
    print(f"Requests : {TOTAL_REQUESTS} (threshold = {RATE_LIMIT_THRESHOLD}/hour)")
    print(f"Interval : {args.interval}s\n")

    results = []
    print(f"{'#':<4}{'Status':<10}{'Body':<60}")
    print("-" * 74)

    for i in range(1, TOTAL_REQUESTS + 1):
        status, body_text = http_post_json(url, headers, body)
        results.append((i, status, body_text))
        print(f"{i:<4}{str(status):<10}{truncate(body_text, 60)}")
        if i < TOTAL_REQUESTS:
            time.sleep(args.interval)

    # --- Analysis ---
    print("\n=== Result ===")
    over_limit_statuses = [s for (_, s, _) in results[RATE_LIMIT_THRESHOLD:]]

    # Any 429 in the over-limit range => rate limiting is working
    rate_limit_triggered = any(s == 429 for s in over_limit_statuses)

    # Bonus: show whether early requests were allowed through (2xx or business error, NOT 429)
    allowed_statuses = [s for (_, s, _) in results[:RATE_LIMIT_THRESHOLD]]
    allowed_clean = [s for s in allowed_statuses if s != 429]

    print(f"First {RATE_LIMIT_THRESHOLD} requests (should be allowed):")
    print(f"  statuses = {allowed_statuses}")
    print(f"  non-429  = {len(allowed_clean)}/{RATE_LIMIT_THRESHOLD}")
    print(f"Remaining {TOTAL_REQUESTS - RATE_LIMIT_THRESHOLD} requests (should hit 429):")
    print(f"  statuses = {over_limit_statuses}")
    print(f"  429 seen = {sum(1 for s in over_limit_statuses if s == 429)}")

    if rate_limit_triggered:
        print("\n[PASS] Rate limiting is working: 429 returned after threshold exceeded.")
        sys.exit(0)
    else:
        print("\n[FAIL] Rate limiting NOT triggered as expected. Possible causes:")
        print("  - Redis not connected to BFF (check BFF logs)")
        print("  - Token belongs to a different user than the one already rate-limited")
        print("  - Rate-limit key already expired or was reset")
        print("  - Amount validation failed before rate-limit check (check body messages)")
        sys.exit(1)


if __name__ == "__main__":
    main()
