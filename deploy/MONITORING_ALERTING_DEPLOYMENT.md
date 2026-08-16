# 监控告警部署指南（Prometheus + AlertManager + Server酱/Bark 通知）

> 适用场景：邻里互助平台生产环境。快速拉起 Prometheus 监控套件并接通分账异常（以及基础设施）告警，告警消息直接推送到个人微信（Server酱）或 iOS 通知（Bark）。
>
> 整套方案基于 Docker Compose，单机即可运行。**不需要企业微信**。

---

## 0. 能力总览

| 能力 | 组件 | 端口 | 用途 |
|------|------|------|------|
| 指标抓取 | Prometheus v2.53 | `9090` | 定期从业务端点拉取指标并持久化 |
| 告警路由 | AlertManager v0.27 | `9093` | 去重、分组、重试、静默，推送告警 |
| 消息适配 | Webhook Bridge (Python) | `8080` | 将 AlertManager webhook 转换为 Server酱/Bark API 调用 |
| Redis 指标 | redis_exporter | `9121` | 暴露 Redis 运行指标（RedisDown 告警用） |
| 业务指标 | BFF (NestJS) `/metrics` | `3000` | 分账 `profit_share_total` + Node.js 默认指标 |

告警链路（以分账异常为例）：

```
支付回调 handleNotify()
  → callWxProfitSharing() 抛 ECONNRESET
    → [LOG-PS-108] logger.error() + metrics.recordException()
      → BFF /metrics 暴露 profit_share_total{result="exception"} += 1
        → Prometheus 每 15s 抓取
          → alert_rules.yml 规则 ProfitShareException（increase>0 立即触发）
            → AlertManager 路由到 push-bridge
              → webhook-bridge.py 转换格式
                → Server酱：个人微信收到推送
                → Bark：iOS 通知栏收到推送
```

---

## 1. 前置条件

### 1.1 服务器要求

- Docker Engine ≥ 20.10 + Docker Compose Plugin ≥ 2.x
- 最低资源：2C/4G（Prometheus + 业务栈同机），推荐 4C/8G
- 磁盘：至少 20G 可用空间（TSDB 默认保留 30 天，大约占 5~15G）
- 安全组/防火墙需放开：`9090`（Prometheus UI，**建议仅内网开放**）、`9093`、`8080`（容器间使用可不公网暴露）

### 1.2 申请 Server酱 SendKey 或 Bark DeviceKey

> 两个通道**不需要都配**，有哪个配哪个即可。

#### 方案 A：Server酱 Turbo（推送到个人微信）

1. 打开 https://sct.ftqq.com/ ，用微信扫码登录
2. 进入「SendKey」页面，复制你的 SendKey（格式如 `SCT1234567890abcdef`）
3. 用微信关注「Server 酱」服务号（否则消息推不到微信）
4. 保存好 SendKey，后面填到环境变量 `SERVERCHAN_SENDKEY`

> 免费版限制：每天最多 5 条消息，超出会被限流。生产环境建议升级 Pro 或改用 Bark。

#### 方案 B：Bark（推送到 iOS 通知）

1. App Store 搜索并安装 **Bark**（免费，无限制）
2. 打开 App，首页会显示你的专属推送 URL，格式如：
   ```
   https://api.day.app/XXXXXXXXXXXXXXXXXXXX
   ```
   其中 `XXXXXXXXXXXXXXXXXXXX` 就是你的 DeviceKey
3. 保存好 DeviceKey，后面填到环境变量 `BARK_DEVICE_KEY`

> Bark 消息推送走 APNs，实时性更好，且无频率限制。推荐 iOS 用户优先使用。
>
> 如果你自建了 Bark 服务器（Docker 部署 bark-server），把服务器地址填到 `BARK_SERVER`，默认用官方 `https://api.day.app`。

---

## 2. 部署 5 步曲

### Step 1 — 检查主服务网络

Prometheus 必须能解析到 `bff`、`redis`、`alertmanager` 等容器名。主栈 [docker-compose.yml](file:///d:/neighborhood-help/docker-compose.yml) 启动后会自动创建 `neighborhood-help_default` 网络，监控栈在 [docker-compose.monitoring.yml](file:///d:/neighborhood-help/docker-compose.monitoring.yml) 里已声明复用该网络。

先确保主服务已启动（至少 `bff` 和 `redis`）：

```bash
cd /opt/neighborhood-help          # 改成你在服务器上的实际路径
docker compose up -d bff redis     # 或全量：docker compose up -d
```

验证 BFF 指标端点已经可用：

```bash
# 在服务器上执行（注意 /metrics 不走 api/v1 前缀）
curl -sS http://localhost:3000/metrics | grep profit_share_total
```

预期至少能看到 3 条 HELP/TYPE：
```
# HELP profit_share_total ...
# TYPE profit_share_total counter
```

> 如果返回 `404`，请确认 [main.ts](file:///d:/neighborhood-help/bff/src/main.ts#L37-L40) 的 `exclude: ['metrics']` 生效，以及 [CommonModule](file:///d:/neighborhood-help/bff/src/common/common.module.ts#L13-L17) 注册了 `MetricsController`。

### Step 2 — 配置环境变量

在仓库根目录 `.env` 中追加（如果没有 `.env`，可从 `.env.example` 复制）：

```bash
# ===== 监控告警推送 =====

# 方案一：Server酱 Turbo（推送到个人微信）
# 申请地址: https://sct.ftqq.com/  登录后复制 SendKey
SERVERCHAN_SENDKEY=SCT你的SendKey贴这里

# 方案二：Bark（推送到 iOS 通知）
# App Store 安装 Bark 后复制 DeviceKey
BARK_DEVICE_KEY=你的DeviceKey贴这里
# 如果自建了 Bark 服务器，改这里；默认用官方
# BARK_SERVER=https://api.day.app

# 告警标题前缀（带环境标记，避免多环境告警混在一起）
MONITOR_ALERT_PREFIX=[邻里互助生产环境]
```

> **至少配置一个通道**（Server酱 或 Bark），两个都配则同时推送。
> 也可以 `export` 到 shell。推荐写 `.env` 文件，Docker Compose 会自动读取。

### Step 3 — 一键拉起监控套件

```bash
cd /opt/neighborhood-help

# 主栈 + 监控栈 合并编排
docker compose \
  -f docker-compose.yml \
  -f docker-compose.monitoring.yml \
  up -d prometheus alertmanager redis-exporter webhook-bridge
```

等待 10 秒后检查容器健康：

```bash
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" | grep nh-
```

预期 4 个容器都显示 `healthy`：

```
NAMES               STATUS                    PORTS
nh-prometheus       Up 5s (healthy)          0.0.0.0:9090->9090/tcp
nh-alertmanager     Up 4s (healthy)          0.0.0.0:9093->9093/tcp
nh-redis-exporter   Up 4s                    0.0.0.0:9121->9121/tcp
nh-webhook-bridge   Up 4s (healthy)          0.0.0.0:8080->8080/tcp
```

确认 webhook-bridge 启动日志中显示通道已配置：

```bash
docker logs nh-webhook-bridge 2>&1 | head -5
```

预期输出：
```
🔔 Webhook Bridge listening on :8080
  ServerChan (个人微信): ✅ 已配置
  Bark (iOS 推送):       ✅ 已配置
```

### Step 4 — 冒烟测试：手动触发一次推送

用 curl 向 AlertManager 注入一条测试告警，确认链路能从头到尾打通：

```bash
curl -X POST http://localhost:9093/api/v2/alerts \
  -H "Content-Type: application/json" \
  -d '[{
    "labels": {
      "alertname": "ManualSmokeTest",
      "severity": "warning",
      "service": "smoke"
    },
    "annotations": {
      "summary": "[冒烟测试] 这是一条手动触发的测试告警",
      "description": "如果你收到这条消息，说明 Prometheus → AlertManager → Webhook Bridge → Server酱/Bark 链路全部打通 ✅"
    },
    "startsAt": "2026-08-15T00:00:00Z",
    "endsAt":   "2026-08-15T23:59:59Z"
  }]'
```

10~30 秒内：
- **Server酱**：个人微信「Server 酱」服务号收到推送消息
- **Bark**：iOS 通知栏弹出告警通知

如果 2 分钟都没收到，直接跳到 **第 6 节 Troubleshooting**。

### Step 5 — 验证分账告警规则已加载

打开 Prometheus UI：`http://<服务器IP>:9090`

1. 顶部菜单 → **Status → Rules**。应该看到：
   - `ProfitShareException`（critical，increase>0 立即）
   - `ProfitShareFail`（warning，10 分钟>3 笔）
   - `ProfitShareHighFailRate`（critical，15 分钟失败率>30%）
   - 以及原来的 `HighErrorRate / RedisDown / QueueBacklog` 等通用规则
2. 顶部菜单 → **Graph**，输入 `profit_share_total` → Execute。
   应看到 `bff:3000` 返回的样本，三个 label（success/fail/exception）初始都为 0 或空。
3. 顶部菜单 → **Status → Targets**。所有 target State = `UP`，Last scrape 时间正常。

---

## 3. 分账告警规则详解

定义位置：[monitoring/alert_rules.yml](file:///d:/neighborhood-help/monitoring/alert_rules.yml#L49-L84)

### 3.1 ProfitShareException —— 分账调用即抛异常

```yaml
increase(profit_share_total{result="exception"}[5m]) > 0
for: 0m   # 零容忍，出现 1 次立刻告警
severity: critical
```

**业务含义**：支付回调进入 `callWxProfitSharing()` → catch 块（`[LOG-PS-108]`）。订单状态是 PAID 但钱没分出去，必须尽快排查或触发对账任务补跑。

**常见根因**：
- 商户号 API v3 证书过期 / serialNo 配置错误 → 401
- `WX_PROFIT_SHARING_RECEIVER_MCH_ID` 未在微信商户后台绑定为分账接收方 → 400 `PARAM_ERROR`
- 微信 API 偶发网络抖动（ECONNRESET、ETIMEDOUT）→ 这种情况重试通常成功
- 接收方商户号被风控，单日收款超限

---

### 3.2 ProfitShareFail —— 10 分钟内 ≥3 笔分账未完成

```yaml
increase(profit_share_total{result="fail"}[10m]) > 3
for: 1m
severity: warning
```

**业务含义**：分账返回 success=false。包含两种情况：
- 配置了接收方但 `receiver.enabled=false`（返回前直接走 LOG-PS-102 跳过）
- `callWxProfitSharing` 内部 catch 后返回空 shareOrderId

**常见根因**：
- 运维同事暂时关闭了 `WX_PROFIT_SHARING_ENABLED=false`（业务窗口内临时不开分账）
- 接收方 mchId 未配置但依然有订单流入
- 微信单次返回失败但重试后成功（如果重复率不高可以忽略）

---

### 3.3 ProfitShareHighFailRate —— 15 分钟窗口失败率 > 30%

```yaml
sum(rate(profit_share_total{result="fail"}[15m]))
/ clamp_min(sum(rate(profit_share_total[15m])), 0.001)
> 0.3
for: 5m
severity: critical
```

**业务含义**：大面积分账失败，通常预示系统性故障（而非个别订单偶发）。

**常见根因**：
- 微信商户平台做了批次风控（所有分账请求返回 `RULE_LIMIT`）
- 接收方商户号被冻结/注销
- 平台抽成规则异常，导致单笔分账金额超限（>订单金额 30% 等）

---

## 4. 日常操作 Playbook

### 4.1 收到 ProfitShareException 后怎么办（5 分钟内按顺序执行）

```
Step 1. 打开 BFF 日志 → 过滤 [PROFIT-SHARE] ❌
        journalctl -u nh-bff -n 500 --no-pager | grep "分账调用失败"
        # Docker 部署：docker logs --tail 1000 nh-bff | grep "PROFIT-SHARE"

Step 2. 找到报错信息字段 error=...
        - 401 AUTH_FAIL: 更新证书或检查 API_V3_KEY
        - 400 PARAM_ERROR: 检查 WX_PROFIT_SHARING_RECEIVER_* 是否匹配商户后台配置
        - ECONNRESET / ETIMEDOUT: 网络抖动，继续观察 3 分钟，如果数量不增长（<3 条）可忽略
        - RULE_LIMIT / ACCOUNT_BLOCK: 立即联系微信支付技术支持解封

Step 3. 手工触发对账任务（如果部署了），或者在支付管理后台手动重放分账
        TODO: 附对账任务入口地址
```

### 4.2 临时静默告警

> 维护窗口期（例如微信商户后台正在变更配置）不希望被消息轰炸。

1. 打开 `http://<服务器IP>:9093/#/silences`
2. 点击 **New Silence**
3. Matchers 填：`severity = warning` 或 `alertname = ProfitShareFail`
4. 设置过期时间（最长 2 小时，防止忘了恢复）
5. 填 Creator / Comment（强制留痕，写清楚"谁，什么原因，预计多久恢复"）

### 4.3 即时查看当前分账成功率

Prometheus **Graph** 页输入：

```promql
1 - (
  sum(rate(profit_share_total{result=~"fail|exception"}[1h]))
  / clamp_min(sum(rate(profit_share_total[1h])), 0.001)
)
```

显示最近 1 小时分账成功率百分比，期望 > 99.5%。

### 4.4 热更新规则文件（无需重启容器）

改完 [monitoring/alert_rules.yml](file:///d:/neighborhood-help/monitoring/alert_rules.yml) 后：

```bash
# Prometheus reload
curl -X POST http://localhost:9090/-/reload

# AlertManager reload（如果改了 alertmanager.yml）
curl -X POST http://localhost:9093/-/reload
```

---

## 5. 安全加固建议

默认配置仅用于内网，如果长期运行生产：

| 加固项 | 操作 |
|--------|------|
| 端口不暴露公网 | 把 `docker-compose.monitoring.yml` 中 `9090:9090` 等改成 `127.0.0.1:9090:9090`，用 Nginx 反向代理 + Basic Auth 对外 |
| Nginx 加鉴权 | `htpasswd -c /etc/nginx/.htpasswd admin`，proxy_pass 到 `http://127.0.0.1:9090` |
| 限制 Webhook 来源 | 在 `webhook-bridge` 前加 Nginx 仅允许 AlertManager 容器来源 IP 访问 `/alert` |
| TSDB 定期备份 | 用 docker volume 备份 `prometheus_data`，或配置 `remote_write` 到对象存储 |
| Server酱 额度 | 免费版每天 5 条上限，高频告警场景建议升级 Pro 或改用 Bark（无限制） |

---

## 6. Troubleshooting 速查表

| 现象 | 诊断命令 | 常见修复 |
|------|----------|----------|
| `curl localhost:3000/metrics` 返回 404 | `docker logs nh-bff \| grep MetricsController` | 检查 BFF 构建镜像是否包含最新 `metrics.service.ts`；可能老镜像没重新 build，执行 `docker compose build bff && docker compose up -d bff` |
| Prometheus UI 打开 Targets，bff State = DOWN | Prometheus 容器里 `wget -qO- http://bff:3000/metrics` | 两容器是否在同一 Docker 网络？`docker inspect nh-prometheus \| grep Networks`；如果显示 isolated network，走 `docker compose -f docker-compose.yml -f docker-compose.monitoring.yml up -d` 重新启动 |
| 告警触发了，但 Server酱/Bark 没收到 | `docker logs nh-webhook-bridge --tail 100` | ① SendKey/DeviceKey 写错（含空格/换行）；② Server酱 免费版当天 5 条已用完；③ 服务器无法访问 `sctapi.ftqq.com` 或 `api.day.app`（检查出口网络/DNS） |
| webhook-bridge 日志显示 `[ServerChan] ❌ 发送失败: HTTP Error 401` | 检查 `.env` 中的 `SERVERCHAN_SENDKEY` | SendKey 已失效或被重置，重新登录 sct.ftqq.com 复制最新 SendKey |
| AlertManager UI 里 alert 是 PENDING 没发 | Prometheus → Status → Rules，看 `for:` 倒计时 | PENDING 是 `for` 窗内，等超时后就会 FIRING；`for: 0m` 的规则应立即转为 FIRING |
| profit_share_total 指标始终只有 Node.js 默认指标 | 模拟一次支付成功回调 → 分账成功 | 指标 Counter 初始不显示样本很正常，只有 `recordSuccess/Fail/Exception` 被调用过后才会出现带 label 的样本 |

---

## 7. 回滚与停用监控

```bash
# 仅停监控三件套，业务不影响
docker compose \
  -f docker-compose.yml \
  -f docker-compose.monitoring.yml \
  down prometheus alertmanager redis-exporter webhook-bridge

# 彻底删除监控数据卷（慎用！会丢失历史指标）
docker volume rm neighborhood-help_prometheus_data neighborhood-help_alertmanager_data
```

---

## 附录 A — 关键文件位置索引

| 文件 | 作用 |
|------|------|
| [docker-compose.monitoring.yml](file:///d:/neighborhood-help/docker-compose.monitoring.yml) | 监控栈 compose（Prometheus + AlertManager + redis-exporter + webhook-bridge） |
| [monitoring/prometheus.yml](file:///d:/neighborhood-help/monitoring/prometheus.yml) | Prometheus 抓取目标 + AlertManager 地址 |
| [monitoring/alert_rules.yml](file:///d:/neighborhood-help/monitoring/alert_rules.yml) | 全部告警规则（含 3 条分账规则） |
| [monitoring/alertmanager.yml](file:///d:/neighborhood-help/monitoring/alertmanager.yml) | AlertManager 路由 + 接收方（指向 webhook-bridge:8080/alert） |
| [monitoring/webhook-bridge.py](file:///d:/neighborhood-help/monitoring/webhook-bridge.py) | 消息桥脚本（AlertManager → Server酱/Bark，纯 Python stdlib） |
| [.env.example](file:///d:/neighborhood-help/.env.example#L55-L67) | 环境变量模板（SERVERCHAN_SENDKEY / BARK_DEVICE_KEY） |
| [metrics.service.ts](file:///d:/neighborhood-help/bff/src/common/metrics.service.ts) | BFF 内部指标定义（profit_share_total） |
| [metrics.controller.ts](file:///d:/neighborhood-help/bff/src/common/metrics.controller.ts) | `/metrics` 端点实现 |
| [payment.service.ts](file:///d:/neighborhood-help/bff/src/modules/payment/payment.service.ts) | 分账三处埋点：SUCCESS (#L404) / FAIL (#L413) / EXCEPTION (#L1258) |

---

## 附录 B — Webhook Bridge 架构说明

```
                    AlertManager
                         │
                    POST /alert
                         │
                         ▼
              ┌─────────────────────┐
              │  webhook-bridge.py  │
              │  (python:3-alpine)  │
              └──────┬───────┬──────┘
                     │       │
          ┌──────────┘       └──────────┐
          ▼                             ▼
  Server酱 Turbo API            Bark API
  sctapi.ftqq.com              api.day.app
  (推送到个人微信)              (推送到 iOS 通知)
```

- 脚本位于 [monitoring/webhook-bridge.py](file:///d:/neighborhood-help/monitoring/webhook-bridge.py)，仅使用 Python 标准库（`http.server` + `urllib`），**无 pip 依赖**
- Docker 镜像用官方 `python:3.12-alpine`，脚本通过 volume 挂载，**无需构建自定义镜像**
- 两个推送通道独立工作：配了哪个走哪个，都配了就都推
- 健康检查端点 `GET /health` 返回 `ok`

---

*文档版本 v1.1 · 2026-08-15 · 适用于代码 commit 引入 MetricsService 之后*
