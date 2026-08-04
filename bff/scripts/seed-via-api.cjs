/* 通过 BFF API 创建一条测试任务（走 POST /tasks），验证发布接口 + 列表可见 */
/* 运行：node bff/scripts/seed-via-api.cjs */
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

// ---- 加载 bff/.env（简单解析 KEY=VALUE）----
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*"?(.*?)"?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const { PrismaClient } = require('@prisma/client');
let Redis = null;
try {
  Redis = require('ioredis');
} catch (_) {
  // ioredis 不可用则跳过清缓存
}

const API = 'http://localhost:3000/api/v1';
const JWT_SECRET = process.env.JWT_SECRET || 'nh_dev_jwt_secret_2026_change_in_production';
const ACCESS_TTL = 2 * 60 * 60; // 2h，与 BFF 一致

const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
function signJwt(payload, secret, ttlSec) {
  const now = Math.floor(Date.now() / 1000);
  const full = { ...payload, iat: now, exp: now + ttlSec };
  const h = b64url({ alg: 'HS256', typ: 'JWT' });
  const p = b64url(full);
  const sig = crypto
    .createHmac('sha256', secret)
    .update(`${h}.${p}`)
    .digest('base64url');
  return `${h}.${p}.${sig}`;
}

const log = (m) => console.log('[seed] ' + m);

(async () => {
  const prisma = new PrismaClient();
  let redis = null;
  if (Redis) {
    try {
      redis = new Redis({
        host: 'localhost',
        port: 6379,
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        retryStrategy: () => null,
      });
      redis.on('error', () => {});
    } catch (_) {
      redis = null;
    }
  }

  try {
    // 1. upsert 测试用户
    const user = await prisma.user.upsert({
      where: { openid: 'smoke_test_openid' },
      update: {},
      create: {
        openid: 'smoke_test_openid',
        nickname: '冒烟测试员',
        creditScore: 100,
        role: 'USER',
        status: 'ACTIVE',
      },
    });
    log('user id=' + user.id + ' nickname=' + user.nickname);

    // 2. 签发 access token（与 auth.service issueTokens 逻辑一致）
    const token = signJwt(
      { sub: user.id.toString(), role: user.role, type: 'access' },
      JWT_SECRET,
      ACCESS_TTL,
    );
    log('access token signed (sub=' + user.id + ')');

    // 3. 清理旧冒烟任务（避免列表重复）
    const del = await prisma.task.deleteMany({
      where: { title: { contains: '冒烟测试' } },
    });
    log('cleaned old smoke tasks: ' + del.count);

    // 4. POST /api/v1/tasks（走发布接口）
    const body = {
      title: '冒烟测试-代拿快递',
      category: 'DELIVERY',
      description:
        '这是一条冒烟测试任务，用于验证附近任务列表与搜索功能是否正常工作。',
      price: 5.5,
      lat: 39.9042,
      lng: 116.4074,
      address: '北京市东城区',
    };
    const res = await fetch(`${API}/tasks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok || json.code !== 0) {
      throw new Error(
        'POST /tasks failed: HTTP ' + res.status + ' ' + JSON.stringify(json),
      );
    }
    log('POST /tasks OK, task id=' + json.data.id + ' status=' + json.data.status);

    // 5. 清 Redis nearby 缓存（避免 60s 内仍返回旧空列表）
    if (redis) {
      try {
        const keys = await redis.keys('nearby:*');
        if (keys.length) {
          await redis.del(...keys);
          log('cleared ' + keys.length + ' nearby cache keys');
        } else {
          log('no nearby cache to clear');
        }
      } catch (_) {
        log('redis clear skipped (unavailable) — BFF will degrade to DB');
      }
    } else {
      log('ioredis not loaded — skip cache clear');
    }

    // 6. GET /api/v1/tasks 验证列表可见
    const gres = await fetch(`${API}/tasks?lat=39.9042&lng=116.4074`);
    const gjson = await gres.json();
    if (gjson.code === 0 && Array.isArray(gjson.data.list)) {
      log('GET /tasks OK, list length=' + gjson.data.list.length);
      gjson.data.list.forEach((t, i) =>
        log(
          '  [' +
            i +
            '] ' +
            t.title +
            ' ¥' +
            t.price +
            ' dist=' +
            t.distance +
            'm publisher=' +
            (t.publisher && t.publisher.nickname),
        ),
      );
    } else {
      throw new Error('GET /tasks bad response: ' + JSON.stringify(gjson));
    }

    log('DONE — 请在微信开发者工具中下拉刷新附近任务列表页');
  } catch (e) {
    log('ERROR ' + (e.stack || e));
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
    if (redis) {
      try {
        await redis.quit();
      } catch (_) {}
    }
  }
})();
