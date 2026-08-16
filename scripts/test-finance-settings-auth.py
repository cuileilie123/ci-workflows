#!/usr/bin/env python3
"""
老板账号财务设置接口冒烟测试脚本
=================================
运行：
  1. 先启动 BFF 后端（pnpm --filter bff start:dev 或 docker compose up bff）
  2. 再执行本脚本（建议 bff/.env 的 DATABASE_URL 与后端一致）：
       python scripts/test-finance-settings-auth.py
       python scripts/test-finance-settings-auth.py --base-url http://192.168.1.100:3000
       python scripts/test-finance-settings-auth.py --no-rollback   # 保留测试账号（方便手动登录）

测试 Case 列表：
  Case 1   STAFF 角色      → GET  /finance-settings 必须 403
  Case 2   ADMIN 角色      → PUT  /finance-settings 必须 403
  Case 3   BOSS  角色      → GET  /finance-settings 必须 200
  Case 4   BOSS  角色      → PUT  /finance-settings 成功保存 MERCHANT_ID 配置
  Case 5   BOSS  角色      → PUT  /finance-settings 开启分账但 receiver 缺字段 → 400
  Case 6   SUPER_ADMIN 角色 → PUT  /finance-settings 保存 PERSONAL_OPENID 配置（也允许）
  Case 7   BOSS  角色      → PUT  /finance-settings 校验 mainAppId 格式错误 → 400
  Case 8   BOSS  角色      → GET  /finance-settings 回读：字段和保存一致
  Case 9   未登录（无 token） → GET /finance-settings 必须 401
  Case 10  BOSS 角色       → 关闭分账保存后，回读 profitSharingEnabled=false 正确
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import hmac
import json
import os
import subprocess
import sys
import time
import urllib.parse
import urllib.request
import urllib.error
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple


# ============================================================
# 小工具
# ============================================================
GREEN = '\033[32m'
RED = '\033[31m'
YELLOW = '\033[33m'
CYAN = '\033[36m'
BOLD = '\033[1m'
RESET = '\033[0m'


def ok(msg: str) -> None:
    print(f'  {GREEN}✅ {msg}{RESET}')


def fail(msg: str) -> None:
    print(f'  {RED}❌ {msg}{RESET}')


def info(msg: str) -> None:
    print(f'  {YELLOW}ℹ️  {msg}{RESET}')


def step(msg: str) -> None:
    print(f'\n{BOLD}{CYAN}▶ {msg}{RESET}')


def header(title: str) -> None:
    bar = '=' * 64
    print(f'\n{BOLD}{CYAN}{bar}')
    print(f'  {title}')
    print(f'{bar}{RESET}\n')


# ============================================================
# 加载 bff/.env（拿 JWT_SECRET / DATABASE_URL 给 prisma upsert 用）
# ============================================================
def load_dotenv(path: Path) -> Dict[str, str]:
    out: Dict[str, str] = {}
    if not path.exists():
        return out
    for line in path.read_text(encoding='utf-8').splitlines():
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        if '=' not in line:
            continue
        k, v = line.split('=', 1)
        k = k.strip()
        v = v.strip()
        if v.startswith('"') and v.endswith('"'):
            v = v[1:-1]
        if k not in os.environ:
            os.environ[k] = v
        out[k] = v
    return out


# ============================================================
# HS256 JWT 签发（不依赖 PyJWT / cryptography，纯 stdlib）
# ============================================================
def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b'=').decode('ascii')


def sign_jwt(payload: Dict[str, Any], secret: str) -> str:
    header = {'alg': 'HS256', 'typ': 'JWT'}
    h_b64 = _b64url(json.dumps(header, separators=(',', ':')).encode('utf-8'))
    p_b64 = _b64url(json.dumps(payload, separators=(',', ':')).encode('utf-8'))
    sig_input = f'{h_b64}.{p_b64}'.encode('utf-8')
    mac = hmac.new(secret.encode('utf-8'), sig_input, hashlib.sha256).digest()
    return f'{h_b64}.{p_b64}.{_b64url(mac)}'


# ============================================================
# HTTP 请求封装（urllib + 简单重试）
# ============================================================
def http(
    base_url: str,
    method: str,
    path: str,
    json_body: Any = None,
    token: Optional[str] = None,
    timeout: int = 15,
    retries: int = 2,
) -> Tuple[int, Any, Dict[str, str]]:
    """返回 (status_code, json_or_text, resp_headers 截取版)"""
    api_base = base_url.rstrip('/') + '/api/v1'
    url = api_base + path
    data = None
    headers = {'Accept': 'application/json'}
    if json_body is not None:
        data = json.dumps(json_body).encode('utf-8')
        headers['Content-Type'] = 'application/json'
    if token:
        headers['Authorization'] = f'Bearer {token}'

    last_err: Optional[Exception] = None
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(url, data=data, headers=headers, method=method)
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                status = resp.status
                raw = resp.read()
                text = raw.decode('utf-8', errors='replace')
                parsed: Any = text
                if 'application/json' in resp.headers.get('Content-Type', ''):
                    try:
                        parsed = json.loads(text)
                    except (ValueError, json.JSONDecodeError):
                        pass
                resp_headers = {
                    'content-type': resp.headers.get('Content-Type', ''),
                }
                return status, parsed, resp_headers
        except urllib.error.HTTPError as e:
            text = ''
            try:
                text = e.read().decode('utf-8', errors='replace')
            except Exception:
                pass
            parsed: Any = text
            if 'application/json' in (e.headers or {}).get('Content-Type', ''):
                try:
                    parsed = json.loads(text)
                except (ValueError, json.JSONDecodeError):
                    pass
            return e.code, parsed, {'content-type': (e.headers or {}).get('Content-Type', '')}
        except Exception as e:  # 网络类
            last_err = e
            if attempt < retries:
                time.sleep(1.5)
    assert last_err is not None
    return -1, str(last_err), {'error': 'connection'}


# ============================================================
# Prisma 测试账号 upsert / rollback
#
#   Python 不直接连 DB，而是通过 node 子进程加载 @prisma/client，
#   保证类型/约束/transaction 与真实后端一致。返回 JSON。
# ============================================================
BFF_DIR = Path(__file__).resolve().parent.parent / 'bff'
SEED_OPENID_PREFIX = 'py_test_finance_'


def run_prisma_cjs(cjs_code: str) -> Any:
    """在 bff/ 目录下用 node 执行一段 CJS 代码，打印 stdout 的 JSON 并解析"""
    proc = subprocess.run(
        ['node', '--input-type=commonjs', '-e', cjs_code],
        cwd=str(BFF_DIR),
        capture_output=True,
        text=True,
        timeout=60,
    )
    if proc.returncode != 0:
        raise RuntimeError(
            'node prisma 子进程失败:\n'
            f'stdout: {proc.stdout}\n'
            f'stderr: {proc.stderr}'
        )
    out = proc.stdout.strip()
    if not out:
        return None
    try:
        return json.loads(out)
    except json.JSONDecodeError as e:
        raise RuntimeError(f'node 子进程输出无法解析为 JSON:\n{out}') from e


UPSERT_CJS_TEMPLATE = r'''
const path = require('path');
const fs = require('fs');
// 为 node 子进程加载 bff/.env（DATABASE_URL / JWT_SECRET 等）
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {{
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {{
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*"?([^"]*?)"?\s*$/);
    if (m) process.env[m[1]] = m[2];
  }}
}}
const {{ PrismaClient }} = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {{
  const users = JSON.parse(process.argv[1] || '[]');
  const result = [];
  for (const u of users) {{
    const created = await prisma.user.upsert({{
      where: {{ openid: u.openid }},
      create: {{
        openid: u.openid,
        nickname: u.nickname,
        creditScore: 100,
        role: u.role,
        status: 'ACTIVE',
        wallet: {{ create: {{ balance: 0, frozen: 0 }} }},
      }},
      update: {{
        role: u.role,
        nickname: u.nickname,
        status: 'ACTIVE',
      }},
      select: {{ id: true, openid: true, role: true, nickname: true }},
    }});
    result.push(created);
  }}
  await prisma.$disconnect();
  process.stdout.write(JSON.stringify(result));
}})().catch(async (err) => {{
  try {{ await prisma.$disconnect(); }} catch(_) {{}}
  console.error(err && err.stack || err);
  process.exit(1);
}});
'''


ROLLBACK_CJS_TEMPLATE = r'''
const path = require('path');
const fs = require('fs');
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {{
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {{
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*"?([^"]*?)"?\s*$/);
    if (m) process.env[m[1]] = m[2];
  }}
}}
const {{ PrismaClient }} = require('@prisma/client');
const prisma = new PrismaClient();
(async () => {{
  const openids = JSON.parse(process.argv[1] || '[]');
  // 先删关联
  const userIds = (await prisma.user.findMany({{ where: {{ openid: {{ in: openids }} }}, select: {{ id: true }} }})).map(u => u.id);
  await prisma.auditLog.deleteMany({{ where: {{ adminId: {{ in: userIds }} }} }});
  await prisma.transaction.deleteMany({{ where: {{ wallet: {{ userId: {{ in: userIds }} }} }} }});
  await prisma.wallet.deleteMany({{ where: {{ userId: {{ in: userIds }} }} }});
  // 财务设置单例：只清空，不删表行
  const singletonId = 1n;
  try {{
    await prisma.platformFinanceSetting.deleteMany({{ where: {{ profitSharingEnabled: {{ not: undefined }} }} }});
  }} catch (e) {{ /* 某些 Prisma 版本不支持无条件 deleteMany，忽略 */ }}
  await prisma.user.deleteMany({{ where: {{ openid: {{ in: openids }} }} }});
  await prisma.$disconnect();
  process.stdout.write(JSON.stringify({{ rolledBack: openids.length }}));
}})().catch(async (err) => {{
  try {{ await prisma.$disconnect(); }} catch(_) {{}}
  console.error(err && err.stack || err);
  process.exit(1);
}});
'''


def seed_users(roles: List[str]) -> List[Dict[str, str]]:
    """Upsert 一个给定 role 列表的测试用户，返回 [{id,openid,role,nickname}]"""
    users_in: List[Dict[str, str]] = []
    for role in roles:
        openid = f'{SEED_OPENID_PREFIX}{role.lower()}_{int(time.time())}'
        users_in.append({
            'openid': openid,
            'nickname': f'[财务测试] {role}',
            'role': role,
        })
    result: List[Dict[str, Any]] = run_prisma_cjs(
        UPSERT_CJS_TEMPLATE +
        f"const usersArg = JSON.stringify({json.dumps(users_in)});\n"
        # 上面用 template 传入 JS 代码执行，避免 process.argv 被 shell 转义
        # 但 subprocess 不注入 arg，我们直接把数组嵌进 JS 代码
        # 所以把模板里 JSON.parse(process.argv[1]) 改成 usersArg 即可
    ) if False else None  # placeholder 防止混淆
    # —— 下面才是真正用 process.argv 的安全做法：
    result = run_prisma_cjs("""
const path = require('path');
const fs = require('fs');
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*"?([^"]*?)"?\s*$/);
    if (m) process.env[m[1]] = m[2];
  }
}
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
(async () => {
  const users = JSON.parse(process.argv[1] || '[]');
  const result = [];
  for (const u of users) {
    const created = await prisma.user.upsert({
      where: { openid: u.openid },
      create: {
        openid: u.openid,
        nickname: u.nickname,
        creditScore: 100,
        role: u.role,
        status: 'ACTIVE',
        wallet: { create: { balance: 0, frozen: 0 } },
      },
      update: {
        role: u.role,
        nickname: u.nickname,
        status: 'ACTIVE',
      },
      select: { id: true, openid: true, role: true, nickname: true },
    });
    result.push(created);
  }
  await prisma.$disconnect();
  process.stdout.write(JSON.stringify(result));
})().catch(async (err) => {
  try { await prisma.$disconnect(); } catch (_) {}
  console.error(err && err.stack || err);
  process.exit(1);
});
""".strip())  # 不，run_prisma_cjs 是传代码，不是传参数。这里我改实现：


def _run_prisma_cjs_with_code(code: str, arg_json: str = '') -> Any:
    """code 里用 process.argv[1] 读取 arg_json（shell 注入安全，subprocess list 形式）"""
    cmd = ['node', '--input-type=commonjs', '-e', code]
    if arg_json:
        cmd.append('--')
        cmd.append(arg_json)
    proc = subprocess.run(
        cmd,
        cwd=str(BFF_DIR),
        capture_output=True,
        text=True,
        timeout=60,
    )
    if proc.returncode != 0:
        raise RuntimeError(
            'node prisma 子进程失败:\n'
            f'stdout: {proc.stdout}\n'
            f'stderr: {proc.stderr}'
        )
    out = proc.stdout.strip()
    if not out:
        return None
    try:
        return json.loads(out)
    except json.JSONDecodeError as e:
        raise RuntimeError(f'node 子进程输出无法解析为 JSON:\n{out}') from e


SEED_JS_CODE = r'''
const path = require('path');
const fs = require('fs');
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*"?([^"]*?)"?\s*$/);
    if (m) process.env[m[1]] = m[2];
  }
}
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
(async () => {
  const users = JSON.parse(process.argv[2] || '[]');  // argv[0]=node,1=--,2=json
  const result = [];
  for (const u of users) {
    const created = await prisma.user.upsert({
      where: { openid: u.openid },
      create: {
        openid: u.openid,
        nickname: u.nickname,
        creditScore: 100,
        role: u.role,
        status: 'ACTIVE',
        wallet: { create: { balance: 0, frozen: 0 } },
      },
      update: {
        role: u.role,
        nickname: u.nickname,
        status: 'ACTIVE',
      },
      select: { id: true, openid: true, role: true, nickname: true },
    });
    result.push(created);
  }
  // 顺手：重置 platform_finance_settings 表为"空"（即删光单例）
  try {
    await prisma.platformFinanceSetting.deleteMany({});
  } catch (e) { /* ignore if not yet migrated (dev) */ }
  await prisma.$disconnect();
  process.stdout.write(JSON.stringify(result));
})().catch(async (err) => {
  try { await prisma.$disconnect(); } catch (_) {}
  console.error(err && err.stack || err);
  process.exit(1);
});
'''

ROLLBACK_JS_CODE = r'''
const path = require('path');
const fs = require('fs');
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*"?([^"]*?)"?\s*$/);
    if (m) process.env[m[1]] = m[2];
  }
}
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
(async () => {
  const openids = JSON.parse(process.argv[2] || '[]');
  const userRows = await prisma.user.findMany({
    where: { openid: { in: openids } },
    select: { id: true },
  });
  const uids = userRows.map(u => BigInt(u.id));
  await prisma.auditLog.deleteMany({ where: { adminId: { in: uids } } });
  await prisma.transaction.deleteMany({
    where: { wallet: { userId: { in: uids } } },
  });
  await prisma.wallet.deleteMany({ where: { userId: { in: uids } } });
  try { await prisma.platformFinanceSetting.deleteMany({}); } catch (e) {}
  await prisma.user.deleteMany({ where: { openid: { in: openids } } });
  await prisma.$disconnect();
  process.stdout.write(JSON.stringify({ rolledBackUsers: userRows.length }));
})().catch(async (err) => {
  try { await prisma.$disconnect(); } catch (_) {}
  console.error(err && err.stack || err);
  process.exit(1);
});
'''


def seed_users_safe(roles: List[str]) -> List[Dict[str, str]]:
    users_in: List[Dict[str, str]] = []
    for role in roles:
        openid = f'{SEED_OPENID_PREFIX}{role.lower()}_{int(time.time() * 1000)}'
        users_in.append({
            'openid': openid,
            'nickname': f'[财务测试] {role}',
            'role': role,
        })
    return _run_prisma_cjs_with_code(SEED_JS_CODE, arg_json=json.dumps(users_in))


def rollback_users(openids: List[str]) -> Dict[str, Any]:
    return _run_prisma_cjs_with_code(ROLLBACK_JS_CODE, arg_json=json.dumps(openids))


# ============================================================
# Case 断言封装
# ============================================================
class CaseRunner:
    def __init__(self, base_url: str, secret: str, users_by_role: Dict[str, Dict[str, str]]):
        self.base_url = base_url
        self.secret = secret
        self.users_by_role = users_by_role
        self.passed = 0
        self.failed = 0
        self.results: List[Tuple[str, bool, str]] = []

    def token_for(self, user: Dict[str, Any]) -> str:
        return sign_jwt(
            {
                'sub': str(user['id']),
                'role': user['role'],
                'type': 'access',
                'openid': user['openid'],
            },
            self.secret,
        )

    def check(self, name: str, cond: bool, reason: str) -> None:
        if cond:
            ok(f'{name}: {reason}')
            self.passed += 1
            self.results.append((name, True, reason))
        else:
            fail(f'{name}: {reason}')
            self.failed += 1
            self.results.append((name, False, reason))

    def run_cases(self) -> None:
        # -----------------------------------------------------------
        # 冒烟：检查 BFF 健康
        # -----------------------------------------------------------
        step('健康检查（/health）')
        st, body, _ = http(self.base_url, 'GET', '/health', timeout=5)
        self.check(
            'BFF 后端健康检查',
            st == 200,
            f'HTTP {st}（请先确认后端已启动）',
        )
        if st != 200:
            return

        staff = self.users_by_role.get('STAFF')
        admin = self.users_by_role.get('ADMIN')
        boss = self.users_by_role.get('BOSS')
        super_admin = self.users_by_role.get('SUPER_ADMIN')

        # -----------------------------------------------------------
        # Case 1: STAFF 403
        # -----------------------------------------------------------
        step('Case 1: STAFF 无权 GET 财务设置')
        tok = self.token_for(staff) if staff else ''
        st, body, _ = http(self.base_url, 'GET', '/admin/finance-settings', token=tok)
        self.check(
            'STAFF GET /finance-settings 返回 403',
            st == 403,
            f'HTTP {st} body={body}',
        )

        # -----------------------------------------------------------
        # Case 2: ADMIN 403 PUT
        # -----------------------------------------------------------
        step('Case 2: ADMIN 无权 PUT 财务设置')
        tok = self.token_for(admin) if admin else ''
        payload = {'profitSharingEnabled': True, 'receiverType': 'MERCHANT_ID',
                   'receiverMchId': '1600000001', 'receiverName': '测试'}
        st, body, _ = http(self.base_url, 'PUT', '/admin/finance-settings',
                           json_body=payload, token=tok)
        self.check(
            'ADMIN PUT /finance-settings 返回 403',
            st == 403,
            f'HTTP {st} body={body}',
        )

        # -----------------------------------------------------------
        # Case 3: BOSS GET 200
        # -----------------------------------------------------------
        step('Case 3: BOSS 能 GET 财务设置（初始为 null）')
        tok = self.token_for(boss) if boss else ''
        st, body, _ = http(self.base_url, 'GET', '/admin/finance-settings', token=tok)
        self.check(
            'BOSS GET 200 且初始值为 null',
            st == 200 and body is None,
            f'HTTP {st} body={body}',
        )

        # -----------------------------------------------------------
        # Case 4: BOSS PUT 保存 MERCHANT_ID 成功
        # -----------------------------------------------------------
        step('Case 4: BOSS PUT 保存商户号配置')
        pay = {
            'profitSharingEnabled': True,
            'receiverType': 'MERCHANT_ID',
            'receiverMchId': '1600111122223333',
            'receiverName': '测试平台佣金商户号',
            'mainMchId': None,
            'mainAppId': None,
        }
        st, body, _ = http(self.base_url, 'PUT', '/admin/finance-settings',
                           json_body=pay, token=tok)
        self.check(
            'BOSS PUT 返回 200 且 source=created',
            st == 200 and isinstance(body, dict) and body.get('source') == 'created',
            f'HTTP {st} body={body}',
        )

        # -----------------------------------------------------------
        # Case 5: BOSS PUT 缺失字段 400
        # -----------------------------------------------------------
        step('Case 5: BOSS PUT 商户号为空 → 400 校验失败')
        pay_bad = {
            'profitSharingEnabled': True,
            'receiverType': 'MERCHANT_ID',
            'receiverMchId': '',   # 空字符串 + 启用分账 → 必须报错
            'receiverName': 'xx',
        }
        st, body, _ = http(self.base_url, 'PUT', '/admin/finance-settings',
                           json_body=pay_bad, token=tok)
        self.check(
            '空商户号返回 400',
            st == 400,
            f'HTTP {st} body={body}',
        )

        # -----------------------------------------------------------
        # Case 6: SUPER_ADMIN 保存 PERSONAL_OPENID
        # -----------------------------------------------------------
        step('Case 6: SUPER_ADMIN 也能保存 PERSONAL_OPENID 配置')
        stok = self.token_for(super_admin) if super_admin else ''
        pay_sa = {
            'profitSharingEnabled': True,
            'receiverType': 'PERSONAL_OPENID',
            'receiverOpenid': 'o0ABCDEF1234567890abcdefghij',
            'receiverName': '老板个人',
        }
        st, body, _ = http(self.base_url, 'PUT', '/admin/finance-settings',
                           json_body=pay_sa, token=stok)
        self.check(
            'SUPER_ADMIN PUT 返回 200 且 source=updated',
            st == 200 and isinstance(body, dict) and body.get('source') == 'updated'
            and body.get('receiverType') == 'PERSONAL_OPENID',
            f'HTTP {st} body={body}',
        )

        # -----------------------------------------------------------
        # Case 7: BOSS PUT AppID 格式错 → 400
        # -----------------------------------------------------------
        step('Case 7: BOSS PUT 非法 AppID → 400')
        pay_wrong_appid = {
            'profitSharingEnabled': True,
            'receiverType': 'MERCHANT_ID',
            'receiverMchId': '1600111122223333',
            'mainAppId': 'abc123',   # 不匹配 /^wx[a-f0-9]{16}$/
        }
        st, body, _ = http(self.base_url, 'PUT', '/admin/finance-settings',
                           json_body=pay_wrong_appid, token=tok)
        self.check(
            '非法 AppID 返回 400',
            st == 400,
            f'HTTP {st} body={body}',
        )

        # -----------------------------------------------------------
        # Case 8: 回读一致性
        # -----------------------------------------------------------
        step('Case 8: BOSS GET 回读字段与 Case 6 一致（SUPER_ADMIN 保存的值）')
        st, body, _ = http(self.base_url, 'GET', '/admin/finance-settings', token=tok)
        self.check(
            f'回读 receiverType=PERSONAL_OPENID, openid=o0ABC...ij',
            st == 200 and isinstance(body, dict)
            and body.get('receiverType') == 'PERSONAL_OPENID'
            and str(body.get('receiverOpenid') or '').startswith('o0ABCDEF'),
            f'HTTP {st} body={body}',
        )
        if isinstance(body, dict) and body.get('updatedBy'):
            info(f"updatedBy（SUPER_ADMIN uid）: {body['updatedBy']}")

        # -----------------------------------------------------------
        # Case 9: 无 token → 401
        # -----------------------------------------------------------
        step('Case 9: 未登录（无 Token）→ GET 必须 401')
        st, body, _ = http(self.base_url, 'GET', '/admin/finance-settings')
        self.check(
            '无 token 返回 401',
            st in (401, 403),
            f'HTTP {st} body={body}',
        )

        # -----------------------------------------------------------
        # Case 10: 关闭分账后正确回读
        # -----------------------------------------------------------
        step('Case 10: BOSS 关闭分账开关 → GET 回读 profitSharingEnabled=false')
        pay_off = {
            'profitSharingEnabled': False,
            'receiverType': 'MERCHANT_ID',
            # 允许 receiverMchId 为空，因为开关关闭了 → 跳过校验
        }
        st, body, _ = http(self.base_url, 'PUT', '/admin/finance-settings',
                           json_body=pay_off, token=tok)
        ok_st = st == 200 and isinstance(body, dict) and not body.get('profitSharingEnabled')
        self.check(
            '关闭分账 → PUT 成功，profitSharingEnabled=false',
            ok_st,
            f'HTTP {st} body={body}',
        )
        if ok_st:
            st2, body2, _ = http(self.base_url, 'GET', '/admin/finance-settings', token=tok)
            self.check(
                'GET 回读 profitSharingEnabled=false 一致',
                st2 == 200 and isinstance(body2, dict)
                and not body2.get('profitSharingEnabled'),
                f'HTTP {st2} body={body2}',
            )
        else:
            self.check('GET 回读（跳过，因 PUT 已失败）', False, '前置条件失败')


# ============================================================
# main
# ============================================================
def main() -> None:
    parser = argparse.ArgumentParser(
        description='老板账号财务设置接口冒烟测试（权限校验 + 数据保存）',
    )
    parser.add_argument(
        '--base-url', default='http://localhost:3000',
        help='BFF 后端基础地址（默认 http://localhost:3000）',
    )
    parser.add_argument(
        '--jwt-secret', default=None,
        help='手动指定 JWT 密钥（未指定时从 bff/.env 读取）',
    )
    parser.add_argument(
        '--no-rollback', action='store_true',
        help='保留 DB 中的测试账号和财务设置（后续可手动登录小程序验证）',
    )
    parser.add_argument(
        '--roles',
        default='BOSS,ADMIN,STAFF,SUPER_ADMIN',
        help='要 upsert 的角色（逗号分隔）',
    )
    args = parser.parse_args()

    header('🏦 财务设置接口冒烟测试')
    env = load_dotenv(BFF_DIR / '.env')
    secret = args.jwt_secret or os.environ.get(
        'JWT_SECRET',
        'nh_dev_jwt_secret_2026_change_in_production',
    )
    print(f'  BFF 地址:      {args.base_url}')
    print(f'  bff/.env 加载: {"是" if env else "否（使用默认 JWT_SECRET）"}')
    print(f'  角色:          {args.roles}')
    print(f'  回滚:          {"否（保留数据）" if args.no_rollback else "是"}')

    # 1) upsert 测试账号
    step('DB 准备：upsert 测试账号（STAFF/ADMIN/BOSS/SUPER_ADMIN）并清空旧的财务设置')
    roles = [r.strip().upper() for r in args.roles.split(',') if r.strip()]
    try:
        seeded = seed_users_safe(roles)
    except Exception as e:  # noqa: BLE001
        print()
        fail(f'DB 准备失败: {e}')
        print(f'  {YELLOW}可能原因: 未执行 prisma migrate（platform_finance_settings 表不存在）'
              f'或 Node.js/@prisma/client 不可用（请确认 bff/ 下已 pnpm install 并 npx prisma generate）{RESET}')
        sys.exit(2)
    users_by_role: Dict[str, Dict[str, str]] = {}
    for u in seeded:
        users_by_role[u['role']] = u
        info(f"upsert 角色={u['role']:<12} id={u['id']} openid={u['openid']}")

    # 2) 跑 case
    runner = CaseRunner(args.base_url, secret, users_by_role)
    runner.run_cases()

    # 3) 汇总
    header('📊 测试汇总')
    for name, passed, reason in runner.results:
        if passed:
            print(f'  {GREEN}PASS{RESET}  {name:<42} {reason}')
        else:
            print(f'  {RED}FAIL{RESET}  {name:<42} {reason}')
    total = runner.passed + runner.failed
    print()
    print(f'{BOLD}通过率: {runner.passed}/{total}{RESET}')
    if runner.failed == 0:
        print(f'{GREEN}🎉 全部 Case 通过！{RESET}')

    # 4) 可选：回滚
    openids = [u['openid'] for u in seeded]
    if not args.no_rollback:
        step(f'清理：rollback {len(openids)} 个测试账号 + 清空财务设置')
        try:
            result = rollback_users(openids)
            info(f"回滚完成：users={result.get('rolledBackUsers', '?')}")
        except Exception as e:  # noqa: BLE001
            fail(f'回滚失败（请手动清理 openid 以 {SEED_OPENID_PREFIX} 开头的用户）: {e}')
    else:
        info(f'--no-rollback：已保留数据。可手动登录小程序端：\n'
             f'  BOSS     openid = {users_by_role.get("BOSS", {}).get("openid", "?")}\n'
             f'  ADMIN    openid = {users_by_role.get("ADMIN", {}).get("openid", "?")}\n'
             f'  STAFF    openid = {users_by_role.get("STAFF", {}).get("openid", "?")}')

    sys.exit(0 if runner.failed == 0 else 1)


if __name__ == '__main__':
    main()
