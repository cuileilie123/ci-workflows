#!/usr/bin/env python3
"""
AlertManager → Server酱 / Bark 消息桥

接收 AlertManager 的 webhook（POST /alert），转换格式后转发到：
  1. Server酱 Turbo（推送到个人微信）：https://sct.ftqq.com/
  2. Bark（推送到 iOS）：https://bark.day.app/

特性：
  - 纯 Python 标准库，无需 pip install 任何依赖
  - 支持同时配置两个通道，有哪个配哪个，互不干扰
  - 自动区分 firing / resolved 状态，用不同 emoji 标注
  - 内置 /health 健康检查端点

环境变量：
  SERVERCHAN_SENDKEY   Server酱 Turbo 的 SendKey（留空则不启用该通道）
  BARK_DEVICE_KEY      Bark 的 DeviceKey（留空则不启用该通道）
  BARK_SERVER          Bark 自建服务器地址（默认 https://api.day.app）
  ALERT_TITLE_PREFIX   告警标题前缀（如 [邻里互助生产环境]）
  PORT                 监听端口（默认 8080）
"""

import json
import os
import urllib.request
import urllib.parse
from http.server import HTTPServer, BaseHTTPRequestHandler

SERVERCHAN_SENDKEY = os.environ.get('SERVERCHAN_SENDKEY', '')
BARK_DEVICE_KEY = os.environ.get('BARK_DEVICE_KEY', '')
BARK_SERVER = os.environ.get('BARK_SERVER', 'https://api.day.app')
ALERT_PREFIX = os.environ.get('ALERT_TITLE_PREFIX', '[告警]')
PORT = int(os.environ.get('PORT', '8080'))


def send_serverchan(title, content):
    """转发到 Server酱 Turbo（推送个人微信）"""
    if not SERVERCHAN_SENDKEY:
        return
    url = f'https://sctapi.ftqq.com/{SERVERCHAN_SENDKEY}.send'
    data = urllib.parse.urlencode({'title': title[:32], 'desp': content}).encode()
    req = urllib.request.Request(url, data=data, method='POST')
    req.add_header('Content-Type', 'application/x-www-form-urlencoded')
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            print(f'[ServerChan] ✅ 发送成功 (HTTP {resp.status})')
    except Exception as e:
        print(f'[ServerChan] ❌ 发送失败: {e}')


def send_bark(title, content):
    """转发到 Bark（推送 iOS 通知）"""
    if not BARK_DEVICE_KEY:
        return
    url = f'{BARK_SERVER}/{BARK_DEVICE_KEY}'
    data = json.dumps({'title': title, 'body': content}).encode()
    req = urllib.request.Request(url, data=data, method='POST')
    req.add_header('Content-Type', 'application/json')
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            print(f'[Bark] ✅ 发送成功 (HTTP {resp.status})')
    except Exception as e:
        print(f'[Bark] ❌ 发送失败: {e}')


def format_alert(alert):
    """将单条 AlertManager alert 转为 (title, content)"""
    status = alert.get('status', 'unknown')
    labels = alert.get('labels', {})
    annotations = alert.get('annotations', {})

    alertname = labels.get('alertname', 'UnknownAlert')
    severity = labels.get('severity', 'unknown')
    service = labels.get('service', 'unknown')

    emoji = '🔴' if status == 'firing' else '🟢'
    title = f'{ALERT_PREFIX} {emoji} {alertname} [{severity}]'

    lines = [
        f'**状态**: {status}',
        f'**告警名**: {alertname}',
        f'**严重度**: {severity}',
        f'**服务**: {service}',
    ]
    for k, v in annotations.items():
        lines.append(f'**{k}**: {v}')
    # 附带额外 label（排除已展示的字段）
    for k, v in labels.items():
        if k not in ('alertname', 'severity', 'service'):
            lines.append(f'- {k}: {v}')

    return title, '\n'.join(lines)


class WebhookHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/health':
            self.send_response(200)
            self.send_header('Content-Type', 'text/plain')
            self.end_headers()
            self.wfile.write(b'ok')
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        if self.path != '/alert':
            self.send_response(404)
            self.end_headers()
            return

        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length)

        try:
            payload = json.loads(body)
            alerts = payload.get('alerts', [])

            for alert in alerts:
                title, content = format_alert(alert)
                send_serverchan(title, content)
                send_bark(title, content)

            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            resp = json.dumps({'success': True, 'forwarded': len(alerts)}).encode()
            self.wfile.write(resp)
            print(f'[Webhook] 处理了 {len(alerts)} 条告警')

        except Exception as e:
            print(f'[Webhook] ❌ 处理失败: {e}')
            self.send_response(500)
            self.end_headers()

    def log_message(self, fmt, *args):
        # 简化日志，避免 http.server 默认格式刷屏
        print(f'[HTTP] {self.address_string()} - {fmt % args}')


if __name__ == '__main__':
    server = HTTPServer(('0.0.0.0', PORT), WebhookHandler)
    print(f'🔔 Webhook Bridge listening on :{PORT}')
    print(f'  ServerChan (个人微信): {"✅ 已配置" if SERVERCHAN_SENDKEY else "❌ 未配置"}')
    print(f'  Bark (iOS 推送):       {"✅ 已配置" if BARK_DEVICE_KEY else "❌ 未配置"}')
    server.serve_forever()
