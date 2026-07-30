---
name: risk-control
description: 实现风控系统（设备指纹+行为分析+刷单识别+告警）
model: claude-4-opus
tags: [backend, risk, go]
depends_on: [task-service, review-credit]
---

# 任务：实现风控系统（Go 微服务）

## 目标
独立 Go 微服务，负责设备指纹生成、行为异常检测、刷单识别、实时告警。

## 具体步骤

### 1. 项目结构（Go + Gin）
```
backend/risk-service/
├── cmd/main.go
├── internal/
│   ├── handler/       # HTTP 路由
│   ├── service/        # 业务逻辑
│   ├── model/          # 数据模型
│   ├── repository/     # 数据访问
│   └── middleware/     # 中间件
├── pkg/
│   ├── fingerprint/    # 设备指纹
│   ├── rules/          # 规则引擎
│   └── alert/         # 告警通知
├── config/config.yaml
├── Dockerfile
└── go.mod
```

### 2. 设备指纹生成 `pkg/fingerprint/generator.go`
```go
package fingerprint

import (
  "crypto/sha256"
  "encoding/hex"
  "fmt"
)

type DeviceInfo struct {
  Canvas   string `json:"canvas"`    // Canvas 指纹
  WebGL    string `json:"webgl"`     // WebGL 渲染指纹
  UA       string `json:"ua"`        // User-Agent
  ScreenW  int    `json:"sw"`        // 屏幕宽
  ScreenH  int    `json:"sh"`        // 屏幕高
  Timezone string `json:"tz"`        // 时区
  Language string `json:"lang"`      // 语言
}

func Generate(info *DeviceInfo) string {
  raw := fmt.Sprintf("%s|%s|%s|%dx%d|%s|%s",
    info.Canvas, info.WebGL, info.UA,
    info.ScreenW, info.ScreenH,
    info.Timezone, info.Language)
  
  hash := sha256.Sum256([]byte(raw))
  return hex.EncodeToString(hash[:])
}

// 相似度比较（汉明距离）
func Similarity(fp1, fp2 string) float64 {
  if len(fp1) != len(fp2) { return 0 }
  diff := 0
  for i := 0; i < len(fp1); i++ {
    if fp1[i] != fp2[i] { diff++ }
  }
  return 1.0 - float64(diff)/float64(len(fp1))
}
```

### 3. 行为分析引擎 `internal/service/behavior.go`
```go
package service

import (
  "time"
  "backend/risk-service/internal/model"
  "github.com/redis/go-redis/v9"
)

const (
  RuleRapidAction   = "rapid_action"    // 5秒内连续操作
  RuleIPCluster     = "ip_cluster"      // 同一IP段多账号
  RuleGPSJump       = "gps_jump"        // GPS瞬间移动>200km
  RuleNewAccount    = "new_account"     // 新号高频操作
  RuleSelfDealing   = "self_dealing"    // 自买自卖
)

type BehaviorAnalyzer struct {
  redis *redis.Client
}

// 检测发布/接单频率
func (b *BehaviorAnalyzer) CheckActionRate(userID int64, actionType string) (bool, string) {
  key := fmt.Sprintf("rate:%d:%s", userID, actionType)
  count, _ := b.redis.Incr(ctx, key).Result()
  b.redis.Expire(ctx, key, 60*time.Second)
  
  if count > 30 { // 1分钟30次
    return true, RuleRapidAction
  }
  return false, ""
}

// GPS 漂移检测
func (b *BehaviorAnalyzer) CheckGPSJump(userID int64, lat, lng float64) (bool, string) {
  key := fmt.Sprintf("loc:%d", userID)
  prev, err := b.redis.GeoPos(ctx, key, "current").Result()
  
  if err == nil && len(prev) > 0 {
    dist := haversine(lat, lng, prev[0].Latitude, prev[0].Longitude)
    if dist > 200 { // 超过200km
      return true, RuleGPSJump
    }
  }
  
  b.redis.GeoAdd(ctx, key, &redis.GeoLocation{
    Name: "current", Latitude: lat, Longitude: lng,
  })
  return false, ""
}

// IP 聚集检测
func (b *BehaviorAnalyzer) CheckIPCluster(ip string) (bool, string) {
  key := fmt.Sprintf("ip:%s:accounts", ip)
  count, _ := b.redis.SCard(ctx, key).Result()
  if count > 10 { // 同IP段超过10个账号
    return true, RuleIPCluster
  }
  return false, ""
}
```

### 4. 规则引擎 `pkg/rules/engine.go`
```go
package rules

type Rule interface {
  Name() string
  Evaluate(ctx *RuleContext) (violated bool, score int, reason string)
}

type RuleContext struct {
  UserID    int64
  DeviceFP  string
  IP        string
  Action    string
  Metadata  map[string]interface{}
}

type Engine struct {
  rules []Rule
}

func (e *Engine) Add(rule Rule) { e.rules = append(e.rules, rule) }

func (e *Engine) Evaluate(ctx *RuleContext) []Violation {
  var violations []Violation
  for _, rule := range e.rules {
    if violated, score, reason := rule.Evaluate(ctx); violated {
      violations = append(violations, Violation{
        Rule: rule.Name(), Score: score, Reason: reason,
      })
    }
  }
  return violations
}

// 预置规则集
func DefaultRules() *Engine {
  e := &Engine{}
  e.Add(&NewAccountRule{threshold: 24 * time.Hour})
  e.Add(&RapidActionRule{limit: 30, window: 60 * time.Second})
  e.Add(&GPSJumpRule{maxDistance: 200.0})
  e.Add(&IPClusterRule{limit: 10})
  e.Add(&SelfDealingRule{})
  return e
}
```

### 5. 告警服务 `pkg/alert/alerter.go`
```go
package alert

type AlertLevel int

const (
  LevelInfo  AlertLevel = iota  // 记录日志
  LevelWarn                    // 标记观察
  LevelBlock                   // 限制操作
  LevelBan                     // 封禁账号
)

type Alerter struct {
  channels []Channel
}

func (a *Alerter) Send(level AlertLevel, msg string, metadata map[string]interface{}) {
  for _, ch := range a.channels {
    go ch.Notify(level, msg, metadata)
  }
  
  // 高危直接封禁
  if level == LevelBan {
    userID := metadata["user_id"].(int64)
    // 调用用户服务封禁接口
  }
}

// 支持的告警通道
// 1. 企业微信 Webhook
// 2. 邮件
// 3. 短信
// 4. 钉钉
```

### 6. HTTP API `internal/handler/risk.go`
| Method | Path | 说明 |
|--------|------|------|
| POST | `/api/v1/risk/check` | 通用风险检查（BFF 调用） |
| POST | `/api/v1/risk/report` | 上报行为事件 |
| GET  | `/api/v1/risk/score/:userId` | 查询用户风险分 |
| POST | `/api/v1/risk/ban` | 封禁用户（Admin） |
| GET  | `/api/v1/risk/dashboard` | 风控看板数据 |

### 7. 配置 `config/config.yaml`
```yaml
server:
  port: 8080
  read_timeout: 5s

redis:
  addr: localhost:6379
  pool_size: 50

rules:
  rapid_action:
    enabled: true
    limit: 30
    window: 60s
  gps_jump:
    enabled: true
    max_distance_km: 200
  ip_cluster:
    enabled: true
    limit: 10
  new_account:
    enabled: true
    threshold_hours: 24
  self_dealing:
    enabled: true

alert:
  channels:
    - type: wechat_webhook
      url: https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx
    - type: email
      smtp: smtp.exmail.qq.com
      to: [risk-team@company.com]
  
  thresholds:
    info: 30    # 风险分 > 30 告警
    warn: 60    # > 60 标记
    block: 80   # > 80 限制
    ban: 95     # > 95 封禁

database:
  dsn: "root:pass@tcp(localhost:3306)/risk_db?charset=utf8mb4"
```

### 8. Dockerfile
```dockerfile
FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o risk-service ./cmd/main.go

FROM alpine:3.19
RUN apk --no-cache add ca-certificates tzdata
ENV TZ=Asia/Shanghai
COPY --from=builder /app/risk-service .
COPY --from=builder /app/config ./config
EXPOSE 8080
CMD ["./risk-service"]
```

## 验收标准
- [ ] 设备指纹生成稳定（同设备相同）
- [ ] 5秒内30次操作被拦截
- [ ] GPS 瞬间移动 200km+ 被标记
- [ ] 同 IP 10+ 账号触发告警
- [ ] 风险分计算正确
- [ ] 告警推送到企业微信
- [ ] 封禁接口生效
- [ ] Docker 镜像可运行
- [ ] 压测 QPS > 5000

## 参考文件
- `specs/05-risk.md` → 全部章节
- `.trae/memory.md` → 禁止事项
