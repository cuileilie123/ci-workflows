#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
CORSBlockedBurst 告警验证脚本（Python 版本 · 高频爆发模式）
=========================================================================================
目标：验证 Prometheus 规则 CORSBlockedBurst 能在 1 分钟内触发：
        expr: sum(increase(cors_blocked_total[1m])) > 10
        for:  0m

原理：在 < 2s 内并发发送 ≥ 30 个**非法 Origin** 的 OPTIONS 预检请求，
      BFF CORS 中间件全部返回 403 → prometheus 每 15s 抓取一次 metrics
      → 1 分钟窗口的 increase() 很快就跨过 10 → 告警瞬间触发。

与 Node 版（cors-preflight-alert-test.mjs）的区别：
  - 纯爆发模式，只发送 EVIL Origin，不掺杂白名单请求（告警不被冲淡）
  - 默认 60 并发、60 请求，全部在 1~2s 内灌完
  - 自带 --poll-prometheus 参数，跑完会自动查 Prometheus 指标，
    给出 "sum(increase(cors_blocked_total[1m]))" 实时数值，确认确实 > 10

用法：
  # 1. 最简单：对准本地 BFF 打 60 个非法 OPTIONS
  python scripts/cors-burst-alert-test.py

  # 2. 指定 BFF 地址 + 加大火力（120 请求 / 24 并发）
  python scripts/cors-burst-alert-test.py \
      --target http://10.0.0.5:3000 \
      --evil-count 120 \
      --concurrency 24

  # 3. 打完自动查 Prometheus，验证 increase > 10（即告警条件被满足）
  python scripts/cors-burst-alert-test.py \
      --poll-prometheus http://localhost:9090 \
      --poll-times 8 \
      --poll-interval 10

  # 4. 超高压：200 请求 / 64 并发，模拟真实扫描器 1 分钟打跨 CORSBlockedBurst
  python scripts/cors-burst-alert-test.py \
      --evil-count 200 \
      --concurrency 64

预期结果：
  - 控制台显示：403(拦截) ≥ 30，HTTP 断言 PASS≥threshold(10)
  - Prometheus: 运行 `sum(increase(cors_blocked_total[1m]))` 得到 30+ → 告警 firing
  - Prometheus Alerts 页面: CORSBlockedBurst 从 green(inactive) → red(firing)
  - 告警通知: ~30s~1m 内经由 Alertmanager 送到 webhook-bridge → Bark/企业微信
"""

from __future__ import annotations

import argparse
import itertools
import os
import random
import socket
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from typing import Optional

# ------------------------------------------------------------------ constants
DEFAULT_TARGET = "http://localhost:3000"
DEFAULT_PATH = "/api/v1/auth/wx-login"
DEFAULT_EVIL_COUNT = 60
DEFAULT_CONCURRENCY = 32
BURST_THRESHOLD = 10  # 对齐 alert_rules.yml 里 CORSBlockedBurst 阈值 (>10)

# 非法 Origin 模板（对齐 Node 版本 cors-preflight-alert-test.mjs 的 EVIL_TEMPLATES）
# 核心原则：这些 origin **都不在** BFF main.ts 的白名单里 → 必然 403
EVIL_PATTERNS = [
    # 完全无关的随机域名（典型扫描器）
    lambda i: f"https://evil-scan-{i:03d}.top",
    # 仿冒子域名（钓鱼绕过尝试）
    lambda i: f"https://attacker-{i:03d}.neighborhood-help.xyz",
    # 协议降级（白名单是 https://neighborhood-help.com，这里用 http）
    lambda i: f"http://neighborhood-help{i:02d}.com",
    # 第三方 CDN 域
    lambda i: f"https://cdn{i:02d}.qcloud.la",
    # HTTPS localhost（注意：白名单只放 http://localhost，https:// 必拦截）
    lambda i: f"https://localhost:{30000 + i}",
    # 127.x.x.x 非标准段 + https（白名单是精确的 http://127.0.0.1:8080）
    lambda i: f"https://127.0.0.{50 + i}:{8080 + i}",
    # 127.0.1.x 段（白名单没配）
    lambda i: f"http://127.0.1.{10 + i}:3000",
    # 官方域名 + 非标准端口
    lambda i: f"https://neighborhood-help.com:{8443 + i}",
    # 内网 IP 直连
    lambda i: f"http://192.168.1.{10 + i}:3000",
    # 拼写错误（neighbourhood → neighbour hood 英式拼写）
    lambda i: f"https://neighbourhood-help{i:02d}.com",
]

UA_POOL = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/127.0.0.0 Safari/537.36",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 MicroMessenger/8.0.52",
    "PythonCorsBurstTest/1.0 (+monitoring-verify; purpose=CORSBlockedBurst)",
    "curl/8.4.0",
    "python-requests/2.31.0 (attack-scanner-emulation)",
]

# ---------------------------------------------------------------- dataclasses


@dataclass
class RequestResult:
    label: str
    origin: str
    status: int          # -1 表示网络错误
    req_id: str
    elapsed_ms: int
    error: Optional[str] = None


# ---------------------------------------------------------------- helpers


def _gen_evil_origin(index: int) -> tuple[str, str]:
    """返回 (label, origin)，保证每个请求的 origin 唯一，方便按 origin 聚合告警。"""
    tmpl = EVIL_PATTERNS[index % len(EVIL_PATTERNS)]
    # 引入一个批次号，保证即便 evil-count 很大 (>100)，origin 也不会重复
    variant = index // len(EVIL_PATTERNS) * len(EVIL_PATTERNS)
    label_idx = index  # 不 variant，标签更直观
    origin = tmpl(index + variant)
    label = f"evil-{index:03d}"
    return label, origin


def _spoof_xff() -> str:
    """伪造 X-Forwarded-For，模拟不同 IP 扫描。"""
    blocks = [random.randint(1, 254) for _ in range(4)]
    # 偶尔加个已知道文档 IP，方便 grep 区分
    if random.random() < 0.15:
        return random.choice(["203.0.113.45", "198.51.100.23"])
    return ".".join(str(b) for b in blocks)


def _send_one(url: str, path: str, timeout: float, label: str, origin: str,
              ua: str, xff: str) -> RequestResult:
    """发送单个 OPTIONS 预检请求（stdlib urllib，零第三方依赖）。"""
    full_url = url.rstrip("/") + path
    t0 = time.perf_counter()
    headers = {
        "Host": urllib.parse.urlparse(full_url).netloc,
        "Origin": origin,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "Authorization,Content-Type,X-Device-Fp",
        "User-Agent": ua,
        "Referer": origin + "/malicious",
        "Accept": "*/*",
        "Connection": "close",  # 不复用 TCP，模拟不同客户端
        "X-Forwarded-For": xff,
    }
    req = urllib.request.Request(full_url, headers=headers, method="OPTIONS")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            status = resp.getcode()
            req_id = dict(resp.headers).get("X-Request-Id", "-")
            elapsed_ms = int((time.perf_counter() - t0) * 1000)
            return RequestResult(label, origin, status, req_id, elapsed_ms)
    except urllib.error.HTTPError as e:
        # 403 会走到这里
        status = e.code
        req_id = dict(e.headers).get("X-Request-Id", "-") if e.headers else "-"
        elapsed_ms = int((time.perf_counter() - t0) * 1000)
        return RequestResult(label, origin, status, req_id, elapsed_ms)
    except (urllib.error.URLError, socket.timeout, ConnectionResetError, OSError) as e:
        elapsed_ms = int((time.perf_counter() - t0) * 1000)
        return RequestResult(label, origin, -1, "-", elapsed_ms, error=str(e)[:120])


def _query_prometheus(prom_url: str, promql: str, timeout: float = 5.0) -> Optional[float]:
    """调用 Prometheus /api/v1/query，返回 vector 第一个样本值；失败返回 None。"""
    params = urllib.parse.urlencode({"query": promql})
    query_url = f"{prom_url.rstrip('/')}/api/v1/query?{params}"
    import json
    try:
        with urllib.request.urlopen(query_url, timeout=timeout) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            if data.get("status") != "success":
                return None
            result = data.get("data", {}).get("result", [])
            if not result:
                return 0.0
            return float(result[0]["value"][1])
    except Exception as e:  # noqa: BLE001
        print(f"    [WARN] Prometheus 查询失败: {e}")
        return None


# ---------------------------------------------------------------- main


def main() -> int:
    parser = argparse.ArgumentParser(
        description="CORSBlockedBurst 告警触发脚本：1 分钟内灌 ≥ 30 个非法 Origin → 验证告警 firing",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("-t", "--target", default=DEFAULT_TARGET,
                        help=f"BFF 基础地址 (默认 {DEFAULT_TARGET})")
    parser.add_argument("-p", "--path", default=DEFAULT_PATH,
                        help=f"请求路径 (默认 {DEFAULT_PATH})")
    parser.add_argument("-n", "--evil-count", type=int, default=DEFAULT_EVIL_COUNT,
                        help=f"非法 Origin 请求总数 (默认 {DEFAULT_EVIL_COUNT}，建议 ≥ 30 才能稳跨阈值 10)")
    parser.add_argument("-c", "--concurrency", type=int, default=DEFAULT_CONCURRENCY,
                        help=f"并发数 (默认 {DEFAULT_CONCURRENCY}；大并发才能在 <2s 内灌完，模拟爆发扫描)")
    parser.add_argument("--timeout", type=float, default=6.0, help="单请求超时(秒) (默认 6.0)")
    parser.add_argument("--threshold", type=int, default=BURST_THRESHOLD,
                        help=f"告警阈值下限 (默认 {BURST_THRESHOLD}，和 alert_rules.yml 的 10 对齐)")

    parser.add_argument("--poll-prometheus", default=None, metavar="PROM_URL",
                        help="若提供 Prometheus 地址(如 http://localhost:9090)，"
                             "脚本跑完后自动轮询 sum(increase(cors_blocked_total[1m]))")
    parser.add_argument("--poll-times", type=int, default=10,
                        help="轮询 Prometheus 次数 (默认 10)")
    parser.add_argument("--poll-interval", type=int, default=8,
                        help="每次轮询间隔秒数 (默认 8s。Prometheus 抓取间隔默认 15s，所以 8~10s 合适)")

    parser.add_argument("--seed", type=int, default=42, help="随机种子，保证可复现 (默认 42)")
    parser.add_argument("--dry-run", action="store_true", help="只打印任务清单，不实际发请求")
    args = parser.parse_args()

    random.seed(args.seed)

    # ============================================================ BANNER
    sep = "=" * 72
    print(f"\n{sep}")
    print("  CORSBlockedBurst 告警触发脚本 · Python 爆发模式")
    print(f"  目标告警: sum(increase(cors_blocked_total[1m])) > {args.threshold}")
    print(sep)
    print(f"  target       = {args.target}")
    print(f"  path         = {args.path}")
    print(f"  evil-count   = {args.evil_count}")
    print(f"  concurrency  = {args.concurrency}")
    print(f"  timeout      = {args.timeout}s")
    print(f"  threshold    = >{args.threshold} 403 / 1min (对齐 CORSBlockedBurst)")
    if args.poll_prometheus:
        print(f"  poll-prom    = {args.poll_prometheus}  "
              f"(×{args.poll_times}, 每 {args.poll_interval}s)")
    print(sep + "\n")

    # ============================================================ 任务清单
    tasks = []
    for i in range(args.evil_count):
        label, origin = _gen_evil_origin(i)
        ua = UA_POOL[i % len(UA_POOL)]
        xff = _spoof_xff()
        tasks.append((label, origin, ua, xff))

    print(f"[TASK LIST] 共 {len(tasks)} 个非法 Origin 预检请求（全部期望 403）")
    preview = min(6, len(tasks))
    for k in range(preview):
        lb, og, ua, xff = tasks[k]
        print(f"  {lb:12s}  origin={og:52s}  xff={xff}")
    if len(tasks) > preview:
        print(f"  ... 剩余 {len(tasks) - preview} 条省略 ...")

    if args.dry_run:
        print("\n[DRY RUN] 不实际发送请求，退出。")
        return 0

    # ============================================================ 预热 + 时间基准
    print(f"\n[PRE-FLIGHT] 连通性探测（合法 origin 预期 204 或 403 皆可，只需验证 BFF 可达）")
    probe = _send_one(args.target, args.path, args.timeout, "probe",
                      "https://neighborhood-help.com", UA_POOL[0], "127.0.0.1")
    if probe.status == -1:
        print(f"  ❌ BFF {args.target} 不可达: {probe.error}")
        print("     请先启动 BFF:  cd bff ; pnpm start:dev  (或 docker 启动 bff 容器)")
        return 2
    print(f"  ✅ BFF 可达: HTTP {probe.status}  reqId={probe.req_id}")

    t_start = time.time()
    t_iso = time.strftime("%Y-%m-%d %H:%M:%S %Z", time.localtime(t_start))
    print(f"\n[BURST START] {t_iso}  「1 分钟窗口」从这个时刻开始计时")
    print("  1 分钟窗口截止时间: " +
          f"{time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(t_start + 60))}")

    # ============================================================ 并发发送
    results: list[RequestResult] = []
    progress_step = max(1, args.evil_count // 20)
    done = 0
    with ThreadPoolExecutor(max_workers=args.concurrency) as ex:
        future_map = {
            ex.submit(_send_one, args.target, args.path, args.timeout,
                      lb, og, ua, xff): (lb, og)
            for (lb, og, ua, xff) in tasks
        }
        for fut in as_completed(future_map):
            r = fut.result()
            results.append(r)
            done += 1
            if done % progress_step == 0 or done == len(tasks):
                pct = done * 100 // len(tasks)
                sys.stdout.write(f"\r  progress: {done}/{len(tasks)} ({pct}%)")
                sys.stdout.flush()
    sys.stdout.write("\n")

    t_end = time.time()
    total_ms = int((t_end - t_start) * 1000)
    qps = len(results) / max(total_ms / 1000.0, 0.001)

    # ============================================================ 汇总
    print(f"\n{sep}")
    print("  BURST 结果汇总")
    print(sep)
    counts = {"403": 0, "204": 0, "other": 0, "error": 0}
    for r in results:
        if r.status == -1:
            counts["error"] += 1
        elif r.status == 403:
            counts["403"] += 1
        elif r.status == 204:
            counts["204"] += 1
        else:
            counts["other"] += 1

    print(f"  耗时         : {total_ms} ms  ({total_ms/1000:.2f} s)")
    print(f"  QPS (平均)   : {qps:.1f} req/s")
    print(f"  并发数       : {args.concurrency}")
    print(f"  403 拦截     : {counts['403']}  (这些会计入 cors_blocked_total 指标)")
    print(f"  204 放行(异常): {counts['204']}  (若 >0 表示有 origin 被白名单误放，需检查模板)")
    print(f"  其他状态码   : {counts['other']}")
    print(f"  网络错误     : {counts['error']}")
    print()

    burst_ok = counts["403"] > args.threshold
    verdict_prefix = "✅" if burst_ok else "❌"
    print(f"  {verdict_prefix} 403 拦截数 {counts['403']} vs 阈值 {args.threshold}"
          f"  →  {'跨过阈值 → 告警应触发' if burst_ok else '未达阈值 → 建议加 --evil-count 重跑'}")

    # 抓一些样本 reqId 方便 grep
    evil_req_ids = [r.req_id for r in results if r.status == 403 and r.req_id and r.req_id != "-"]
    if evil_req_ids:
        print(f"\n  [LOG-CO-001] 样本 reqId（用于 grep BFF 日志）:")
        for rid in evil_req_ids[:5]:
            print(f"    grep '{rid}'  <BFF log / Loki 查询框>")

    # 其他状态码抽样（辅助排查若有的话）
    anomalies = [r for r in results if r.status not in (403, -1)]
    if anomalies:
        print(f"\n  [WARN] 有 {len(anomalies)} 个请求不是 403，抽样前 5 条：")
        for r in anomalies[:5]:
            print(f"    label={r.label:12s}  origin={r.origin:52s}  status={r.status}")

    print()

    # ============================================================ Prometheus 轮询
    if args.poll_prometheus:
        prom = args.poll_prometheus.rstrip("/")
        print(f"\n{sep}")
        print(f"  Prometheus 指标轮询  ({args.poll_times} 次 × {args.poll_interval}s)")
        print(sep)
        query_burst = "sum(increase(cors_blocked_total[1m]))"
        query_by_origin = "sum by (origin) (increase(cors_blocked_total[5m])) > 0"
        burst_crossed = False
        for poll in range(1, args.poll_times + 1):
            wait_t = (t_start + poll * args.poll_interval) - time.time()
            if wait_t > 0:
                # 到点再查，避免空转
                mins, secs = divmod(int(wait_t), 60)
                hint = f"等 {mins:d}m{secs:02d}s 后第 {poll}/{args.poll_times} 次查询..."
                sys.stdout.write(f"\r  {hint}")
                sys.stdout.flush()
                time.sleep(max(0, wait_t))
                sys.stdout.write("\r" + " " * len(hint) + "\r")

            t_now = time.strftime("%H:%M:%S")
            v = _query_prometheus(prom, query_burst)
            if v is None:
                print(f"  [{t_now}] poll {poll:2d}/{args.poll_times}  Prometheus 未返回，跳过")
                continue
            status_icon = "🔥" if v > args.threshold else "🔹"
            crossed = v > args.threshold
            if crossed and not burst_crossed:
                burst_crossed = True
                print(f"  [{t_now}] poll {poll:2d}/{args.poll_times}  "
                      f"{status_icon} sum(increase(cors_blocked_total[1m])) = {v:.2f}"
                      f"  > 阈值 {args.threshold}  →  ⚡ CORSBlockedBurst 告警已触发 ⚡")
                # 额外查一下按 origin 聚合 Top5
                try:
                    import json
                    params = urllib.parse.urlencode({"query": query_by_origin})
                    url = f"{prom}/api/v1/query?{params}"
                    with urllib.request.urlopen(url, timeout=5) as r:
                        data = json.loads(r.read().decode("utf-8"))
                        rows = [(float(x["value"][1]), x["metric"].get("origin", "?"))
                                for x in data.get("data", {}).get("result", [])]
                        rows.sort(reverse=True)
                    if rows:
                        print("      按 origin 聚合 Top5:")
                        for cnt, og in rows[:5]:
                            print(f"        {cnt:6.1f} ← {og}")
                except Exception as e:  # noqa: BLE001
                    print(f"      (origin 聚合查询失败: {e})")
            else:
                print(f"  [{t_now}] poll {poll:2d}/{args.poll_times}  "
                      f"{status_icon} sum(increase(cors_blocked_total[1m])) = {v:.2f}")

        # 最终结论
        print()
        if burst_crossed:
            print("  🎯 最终结论: Prometheus 1 分钟窗口内 increase "
                  "已 > 阈值，CORSBlockedBurst 告警在 Prometheus + Alertmanager 应处于 pending/firing")
        else:
            print("  ⚠ 最终结论: Prometheus 仍未观测到 increase 跨阈值。可能原因：")
            print("     ① Prometheus 未抓取到 BFF metrics（检查 monitoring/prometheus.yml 中 bff job）")
            print("     ② BFF /metrics 端点未暴露 cors_blocked_total（检查 MetricsService）")
            print("     ③ 窗口尚早，再等 1~2 次抓取周期（共 30s）后手动查询：")
            print(f"        open {prom}/graph?g0.expr=sum%28increase%28cors_blocked_total%5B1m%5D%29%29")

    # ============================================================ Quick Commands
    print(f"\n{sep}")
    print("  速查命令（复制粘贴）")
    print(sep)
    print("  1. BFF 日志 grep 锚点:")
    print('     grep \'WARN [CORS] [LOG-CO-001] status=403\'  <BFF 日志文件>')
    print()
    print("  2. Prometheus 表达式查询（cors_blocked_total 1m 窗口）:")
    print(f"     open {args.poll_prometheus or 'http://localhost:9090'}"
          + "/graph?g0.expr=sum%28increase%28cors_blocked_total%5B1m%5D%29%29")
    print()
    print("  3. Prometheus Alerts 页面（查看 CORSBlockedBurst 状态）:")
    print(f"     open {args.poll_prometheus or 'http://localhost:9090'}/alerts")
    print()
    print("  4. 再次触发一轮:")
    cmd = "python scripts/cors-burst-alert-test.py"
    if args.target != DEFAULT_TARGET:
        cmd += f" --target {args.target}"
    cmd += f" --evil-count {max(args.evil_count, 60)} --concurrency {args.concurrency}"
    if args.poll_prometheus:
        cmd += f" --poll-prometheus {args.poll_prometheus}"
    print(f"     {cmd}")
    print()

    return 0 if burst_ok else 1


if __name__ == "__main__":
    # Windows 下设置控制台为 UTF-8，避免中文乱码
    if os.name == "nt":
        try:
            sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
        except Exception:
            pass
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print("\n[INTERRUPTED] 用户取消。")
        sys.exit(130)
