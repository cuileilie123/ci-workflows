#!/usr/bin/env python3
"""
告警冒烟测试脚本

自动执行两层冒烟测试并解析结果：
  1. 直连 Bridge：POST http://localhost:8080/alert → 验证 Bridge → Server酱/Bark
  2. 经 AlertManager：POST http://localhost:9093/api/v2/alerts → 验证完整链路

用法:
  python scripts/smoke-test-alerts.py
  python scripts/smoke-test-alerts.py --bridge-url http://localhost:8080
  python scripts/smoke-test-alerts.py --am-url http://localhost:9093
  python scripts/smoke-test-alerts.py --no-interactive   # 不等待用户确认推送
  python scripts/smoke-test-alerts.py --bridge-only       # 只跑直连 Bridge
  python scripts/smoke-test-alerts.py --am-only           # 只跑 AlertManager
"""

import sys
import time
import json
import urllib.request
import urllib.error
import argparse
from http.server import HTTPServer, BaseHTTPRequestHandler
import threading

# ============================================================
# 配色
# ============================================================
GREEN = '\033[32m'
RED = '\033[31m'
YELLOW = '\033[33m'
CYAN = '\033[36m'
BOLD = '\033[1m'
RESET = '\033[0m'


# ============================================================
# 小工具
# ============================================================
def print_header(title):
    print(f'\n{BOLD}{CYAN}{"=" * 60}')
    print(f'  {title}')
    print(f'{"=" * 60}{RESET}\n')


def print_pass(msg):
    print(f'  {GREEN}✅ {msg}{RESET}')


def print_fail(msg):
    print(f'  {RED}❌ {msg}{RESET}')


def print_info(msg):
    print(f'  {YELLOW}ℹ️  {msg}{RESET}')


def print_step(msg):
    print(f'  {CYAN}▶ {msg}{RESET}')


def http_post(url, payload, timeout=10):
    """发起 POST 请求，返回 (status_code, body_text)"""
    data = json.dumps(payload).encode('utf-8')
    req = urllib.request.Request(url, data=data, method='POST')
    req.add_header('Content-Type', 'application/json')
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.read().decode('utf-8')
    except urllib.error.HTTPError as e:
        body = ''
        try:
            body = e.read().decode('utf-8')
        except Exception:
            pass
        return e.code, body
    except urllib.error.URLError as e:
        return -1, str(e.reason)
    except Exception as e:
        return -2, str(e)


def http_get(url, timeout=5):
    """发起 GET 请求，返回 (status_code, body_text)"""
    try:
        with urllib.request.urlopen(url, timeout=timeout) as resp:
            return resp.status, resp.read().decode('utf-8')
    except urllib.error.HTTPError as e:
        return e.code, ''
    except Exception as e:
        return -1, str(e)


# ============================================================
# 测试用例 1：直连 Bridge
# ============================================================
def test_direct_bridge(bridge_url, interactive):
    print_header('TEST 1: 直连 Bridge — 验证 Bridge → Server酱/Bark')

    # 健康检查
    print_step(f'GET {bridge_url}/health')
    code, body = http_get(f'{bridge_url}/health')
    if code != 200 or 'ok' not in body.strip().lower():
        print_fail(f'Bridge 健康检查失败 (HTTP {code}): {body}')
        return False
    print_pass('Bridge 健康检查通过')

    payload = {
        'alerts': [{
            'status': 'firing',
            'labels': {
                'alertname': 'DirectBridgeTest',
                'severity': 'warning',
                'service': 'profit-sharing',
            },
            'annotations': {
                'summary': '[直连测试] 验证 Bridge → Server酱/Bark',
                'description': '如果你收到这条，说明 Bridge 本身没问题，问题出在 AlertManager 层。',
            },
        }]
    }

    if interactive:
        input(f'  {YELLOW}即将通过 Bridge 发送测试告警，确认手机/微信就绪后按回车...{RESET}')

    print_step(f'POST {bridge_url}/alert')
    code, body = http_post(f'{bridge_url}/alert', payload)

    if code != 200:
        print_fail(f'Bridge POST 失败 (HTTP {code}): {body}')
        return False

    # 解析 Bridge 返回
    try:
        resp = json.loads(body)
        forwarded = resp.get('forwarded', 0)
    except (json.JSONDecodeError, ValueError):
        forwarded = 0

    if forwarded >= 1:
        print_pass(f'Bridge 已转发 {forwarded} 条告警')
    else:
        print_fail(f'Bridge 返回 forwarded={forwarded}，未转发任何告警。响应: {body}')
        return False

    print_info('等待 5 秒让推送到达手机...')
    time.sleep(5)

    print_pass('请检查手机/微信是否收到 [直连测试] 消息')
    return True


# ============================================================
# 测试用例 2：经 AlertManager 完整链路
# ============================================================
def test_alertmanager(am_url, interactive):
    print_header('TEST 2: AlertManager 完整链路 — 验证 AM → Bridge → Server酱/Bark')

    # 健康检查
    print_step(f'GET {am_url}/-/healthy')
    code, body = http_get(f'{am_url}/-/healthy')
    if code != 200:
        print_fail(f'AlertManager 健康检查失败 (HTTP {code})')
        return False
    print_pass('AlertManager 健康检查通过')

    alert_name = f'SmokeTest{int(time.time())}'
    now = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    end = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(time.time() + 3600))

    payload = [{
        'labels': {
            'alertname': alert_name,
            'severity': 'critical',
            'service': 'profit-sharing',
        },
        'annotations': {
            'summary': f'[冒烟测试] {alert_name} 模拟分账异常告警',
            'description': '如果你收到此消息，说明 AlertManager → Bridge → Server酱/Bark 完整链路打通 ✅',
        },
        'startsAt': now,
        'endsAt': end,
    }]

    if interactive:
        input(f'  {YELLOW}即将通过 AlertManager 发送测试告警，确认手机/微信就绪后按回车...{RESET}')

    print_step(f'POST {am_url}/api/v2/alerts')
    code, body = http_post(f'{am_url}/api/v2/alerts', payload, timeout=10)

    if code != 200:
        print_fail(f'AlertManager POST 失败 (HTTP {code}): {body}')
        return False

    print_pass('AlertManager 已接收告警')

    # 等待 AlertManager group_wait（默认 30s）后推送
    print_info('AlertManager 默认 group_wait=30s，等待 35 秒让告警发出...')
    for i in range(35, 0, -5):
        print(f'    {i}s...', end='\r', flush=True)
        time.sleep(5)
    print(' ' * 20, end='\r')

    # 查询 AlertManager 确认告警已到达
    print_step(f'GET {am_url}/api/v2/alerts （查询是否已入列）')
    code, body = http_get(f'{am_url}/api/v2/alerts')
    if code == 200:
        try:
            alerts = json.loads(body)
            matched = [a for a in alerts
                       if a.get('labels', {}).get('alertname') == alert_name]
            if matched:
                state = matched[0].get('status', {}).get('state', 'unknown')
                receivers = matched[0].get('receivers', [])
                print_pass(f'AlertManager 已入列告警: state={state}, receivers={[r.get("name") for r in receivers]}')
            else:
                print_info('告警未在 AlertManager 列表中找到（可能已被推送后清除，属正常）')
        except (json.JSONDecodeError, ValueError):
            print_info('AlertManager 响应解析失败，但 POST 已返回 200，可手动确认')
    else:
        print_info(f'AlertManager 查询返回 {code}，POST 已成功，可手动确认')

    print_pass('请检查手机/微信是否收到 [冒烟测试] 消息')
    return True


# ============================================================
# main
# ============================================================
def main():
    parser = argparse.ArgumentParser(
        description='告警冒烟测试：验证 AlertManager → Bridge → Server酱/Bark 链路',
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument('--bridge-url', default='http://localhost:8080',
                        help='Webhook Bridge 地址（默认 http://localhost:8080）')
    parser.add_argument('--am-url', default='http://localhost:9093',
                        help='AlertManager 地址（默认 http://localhost:9093）')
    parser.add_argument('--no-interactive', action='store_true',
                        help='不等待用户回车，直接发送')
    parser.add_argument('--bridge-only', action='store_true',
                        help='只跑直连 Bridge 测试')
    parser.add_argument('--am-only', action='store_true',
                        help='只跑 AlertManager 完整链路测试')
    args = parser.parse_args()

    interactive = not args.no_interactive
    results = []

    print_header('🚀 告警冒烟测试')
    print(f'  Bridge URL:      {args.bridge_url}')
    print(f'  AlertManager URL: {args.am_url}')
    print(f'  交互模式:        {"是" if interactive else "否"}')

    # 选择测试用例
    run_bridge = True
    run_am = True
    if args.bridge_only:
        run_am = False
    if args.am_only:
        run_bridge = False

    if run_bridge:
        results.append(('直连 Bridge', test_direct_bridge(args.bridge_url, interactive)))

    if run_am:
        results.append(('AlertManager 完整链路', test_alertmanager(args.am_url, interactive)))

    # 汇总
    print_header('📊 测试汇总')
    all_pass = True
    for name, passed in results:
        if passed:
            print_pass(f'{name}: 通过')
        else:
            print_fail(f'{name}: 失败')
            all_pass = False

    print()
    if all_pass:
        print(f'{GREEN}{BOLD}🎉 全部测试通过！请确认手机/微信确实收到了推送消息。{RESET}')
        print(f'{YELLOW}提示: 脚本只验证了 HTTP 链路打通，推送消息是否到达手机取决于 Server酱/Bark 服务端。{RESET}')
        sys.exit(0)
    else:
        print(f'{RED}{BOLD}⚠️  有测试失败，请检查上方输出定位问题。{RESET}')
        sys.exit(1)


if __name__ == '__main__':
    main()
