---
name: monitoring-logging
description: 实现全链路监控（Prometheus+Grafana+ELK+Jaeger）
model: claude-4-sonnet
tags: [backend, devops]
depends_on: [nestjs-init, risk-control, admin-dashboard]
---

# 任务：实现全链路监控与日志

## 目标
搭建完整的可观测性体系：指标（Metrics）+ 日志（Logging）+ 链路追踪（Tracing）。

## 具体步骤

### 1. Prometheus 配置 `monitoring/prometheus.yml`
```yaml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

alerting:
  alertmanagers:
    - static_configs:
        - targets: ['alertmanager:9093']

rule_files:
  - 'alert_rules.yml'

scrape_configs:
  - job_name: 'bff-nestjs'
    metrics_path: '/metrics'
    static_configs:
      - targets: ['bff:3000']
        labels:
          service: 'bff'
          env: 'production'
  
  - job_name: 'risk-go'
    metrics_path: '/metrics'
    static_configs:
      - targets: ['risk-service:8080']
        labels:
          service: 'risk'
          env: 'production'
  
  - job_name: 'admin-java'
    metrics_path: '/actuator/prometheus'
    static_configs:
      - targets: ['admin-service:8081']
        labels:
          service: 'admin'
          env: 'production'
  
  - job_name: 'redis'
    static_configs:
      - targets: ['redis-exporter:9121']
  
  - job_name: 'mysql'
    static_configs:
      - targets: ['mysqld-exporter:9104']
  
  - job_name: 'rabbitmq'
    static_configs:
      - targets: ['rabbitmq-exporter:9419']
```

### 2. 告警规则 `monitoring/alert_rules.yml`
```yaml
groups:
  - name: service_alerts
    rules:
      - alert: HighErrorRate
        expr: |
          (sum(rate(http_requests_total{status=~"5.."}[5m])) by (service)
          / sum(rate(http_requests_total[5m])) by (service)) > 0.05
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "{{ $labels.service }} 5xx 错误率 > 5%"
          description: "当前错误率: {{ $value | humanizePercentage }}"
      
      - alert: HighLatencyP99
        expr: |
          histogram_quantile(0.99, sum(rate(http_request_duration_seconds_bucket[5m])) by (le, service))
          > 2
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "{{ $labels.service }} P99 延迟 > 2s"
      
      - alert: RedisDown
        expr: redis_up == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "Redis 不可用"
      
      - alert: MySQLHighConnections
        expr: mysql_global_status_threads_connected > 80
        for: 2m
        labels:
          severity: warning
        annotations:
          summary: "MySQL 连接数过高: {{ $value }}"
      
      - alert: QueueBacklog
        expr: rabbitmq_queue_messages_ready > 10000
        for: 1m
        labels:
          severity: warning
        annotations:
          summary: "队列积压: {{ $value }} 条消息"
      
      - alert: DiskSpaceLow
        expr: (1 - node_filesystem_avail_bytes / node_filesystem_size_bytes) > 0.85
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "磁盘使用率 > 85%"
```

### 3. NestJS 指标埋点 `bff/src/common/metrics/prometheus.middleware.ts`
```typescript
import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { Registry, Counter, Histogram } from 'prom-client';

const register = new Registry();
register.setDefaultLabels({ app: 'nh-bff' });

const httpRequestsTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'route', 'status'],
  registers: [register]
});

const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration',
  labelNames: ['method', 'route'],
  buckets: [0.05, 0.1, 0.5, 1, 2, 5, 10],
  registers: [register]
});

// 业务指标
const taskPublishedTotal = new Counter({
  name: 'task_published_total',
  help: 'Total tasks published',
  labelNames: ['category'],
  registers: [register]
});

const orderPaidTotal = new Counter({
  name: 'order_paid_total',
  help: 'Total orders paid',
  labelNames: ['amount_range'],
  registers: [register]
});

const activeUsersGauge = new Gauge({
  name: 'active_users',
  help: 'Currently active users',
  registers: [register]
});

@Injectable()
export class PrometheusMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const start = Date.now();
    const route = req.route?.path || req.path;
    
    res.on('finish', () => {
      const duration = (Date.now() - start) / 1000;
      const labels = { method: req.method, route, status: String(res.statusCode) };
      
      httpRequestsTotal.inc(labels);
      httpRequestDuration.observe({ method: req.method, route }, duration);
    });
    
    next();
  }
}

// /metrics 端点
@Controller('metrics')
export class MetricsController {
  @Get()
  async getMetrics(): Promise<string> {
    return register.metrics();
  }
}

// 业务埋点装饰器
export function TrackMetric(name: string) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const original = descriptor.value;
    descriptor.value = async function (...args: any[]) {
      const start = Date.now();
      try {
        const result = await original.apply(this, args);
        const duration = Date.now() - start;
        // 记录自定义指标
        return result;
      } catch (err) {
        throw err;
      }
    };
  };
}
```

### 4. Grafana 看板 `monitoring/grafana-dashboard.json`
```json
{
  "title": "邻里互助 - 服务监控",
  "panels": [
    {
      "title": "QPS by Service",
      "type": "graph",
      "datasource": "Prometheus",
      "targets": [{
        "expr": "sum(rate(http_requests_total[1m])) by (service)",
        "legendFormat": "{{ service }}"
      }]
    },
    {
      "title": "Error Rate by Service",
      "type": "graph",
      "datasource": "Prometheus",
      "targets": [{
        "expr": "sum(rate(http_requests_total{status=~\"5..\"}[5m])) by (service) / sum(rate(http_requests_total[5m])) by (service)",
        "legendFormat": "{{ service }}"
      }]
    },
    {
      "title": "P99 Latency",
      "type": "graph",
      "datasource": "Prometheus",
      "targets": [{
        "expr": "histogram_quantile(0.99, sum(rate(http_request_duration_seconds_bucket[5m])) by (le, service))",
        "legendFormat": "{{ service }}"
      }]
    },
    {
      "title": "Redis Memory Usage",
      "type": "singlestat",
      "datasource": "Prometheus",
      "targets": [{ "expr": "redis_memory_used_bytes" }]
    },
    {
      "title": "Queue Length",
      "type": "graph",
      "datasource": "Prometheus",
      "targets": [{
        "expr": "rabbitmq_queue_messages_ready",
        "legendFormat": "{{ queue }}"
      }]
    },
    {
      "title": "Active Users",
      "type": "singlestat",
      "datasource": "Prometheus",
      "targets": [{ "expr": "active_users" }]
    },
    {
      "title": "GMV Today",
      "type": "singlestat",
      "datasource": "Prometheus",
      "targets": [{
        "expr": "sum(order_paid_total * on(amount_range) group_right() metric_for_gmv)",
        "instant": true
      }]
    }
  ]
}
```

### 5. ELK 日志收集

**Filebeat 配置 `monitoring/filebeat.yml`：**
```yaml
filebeat.inputs:
  - type: log
    paths:
      - /var/log/bff/*.log
    fields:
      service: bff
    json.keys_under_root: true
    json.add_error_key: true

  - type: log
    paths:
      - /var/log/risk/*.log
    fields:
      service: risk

  - type: log
    paths:
      - /var/log/admin/*.log
    fields:
      service: admin

output.logstash:
  hosts: ["logstash:5044"]

processors:
  - add_docker_metadata:
      host: "unix:///var/run/docker.sock"
  - drop_fields:
      fields: ["agent", "ecs", "input", "log"]
```

**Logstash 管道 `monitoring/logstash/pipeline.conf`：**
```
input {
  beats { port => 5044 }
}

filter {
  # 解析 JSON 日志
  if [message] =~ /^\{/ {
    json {
      source => "message"
      target => "parsed"
    }
  }
  
  # 提取 trace_id
  if [parsed][trace_id] {
    mutate { add_field => { "trace_id" => "%{[parsed][trace_id]}" } }
  }
  
  # 错误日志标记
  if [parsed][level] == "error" {
    mutate { add_tag => ["error"] }
  }
  
  # 添加环境标记
  mutate { add_field => { "env" => "production" } }
}

output {
  elasticsearch {
    hosts => ["http://elasticsearch:9200"]
    index => "logs-%{[fields][service]}-%{+YYYY.MM.dd}"
    template_name => "logs"
    template_overwrite => true
  }
}
```

### 6. OpenTelemetry 分布式追踪 `bff/src/common/tracing/otel.config.ts`
```typescript
import { NodeSDK } from '@opentelemetry/sdk-node';
import { JaegerExporter } from '@opentelemetry/exporter-jaeger';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { NestInstrumentation } from '@opentelemetry/instrumentation-nestjs-core';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { PrismaInstrumentation } from '@prisma/instrumentation';

const jaegerExporter = new JaegerExporter({
  endpoint: process.env.JAEGER_ENDPOINT || 'http://jaeger:14268/api/traces',
});

const sdk = new NodeSDK({
  resource: new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: 'nh-bff',
    [SemanticResourceAttributes.SERVICE_VERSION]: '0.1.0',
    [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: process.env.NODE_ENV || 'development',
  }),
  spanProcessor: new BatchSpanProcessor(jaegerExporter),
  instrumentations: [
    new NestInstrumentation(),
    new HttpInstrumentation({
      ignoreIncomingRequestHook: (req) => {
        return req.url?.includes('/health') || req.url?.includes('/metrics');
      },
    }),
    new PrismaInstrumentation(),
  ],
});

sdk.start();
console.log('OpenTelemetry tracing initialized');

// 优雅关闭
process.on('SIGTERM', () => {
  sdk.shutdown().then(() => process.exit(0));
});
```

### 7. Docker Compose 追加监控栈
```yaml
# 追加到 docker-compose.yml
prometheus:
  image: prom/prometheus:latest
  container_name: nh-prometheus
  ports:
    - "9090:9090"
  volumes:
    - ./monitoring/prometheus.yml:/etc/prometheus/prometheus.yml
    - ./monitoring/alert_rules.yml:/etc/prometheus/alert_rules.yml
    - prom_data:/prometheus
  command:
    - '--config.file=/etc/prometheus/prometheus.yml'
    - '--storage.tsdb.path=/prometheus'
    - '--storage.tsdb.retention.time=30d'

grafana:
  image: grafana/grafana:latest
  container_name: nh-grafana
  ports:
    - "3002:3000"
  environment:
    - GF_SECURITY_ADMIN_PASSWORD=admin123
  volumes:
    - grafana_data:/var/lib/grafana
    - ./monitoring/grafana-dashboard.json:/etc/grafana/provisioning/dashboards/dashboard.json
  depends_on:
    - prometheus

alertmanager:
  image: prom/alertmanager:latest
  container_name: nh-alertmanager
  ports:
    - "9093:9093"
  volumes:
    - ./monitoring/alertmanager.yml:/etc/alertmanager/alertmanager.yml

elasticsearch-monitor:
  image: docker.elastic.co/elasticsearch/elasticsearch:8.12.0
  container_name: nh-es-monitor
  ports:
    - "9201:9200"
  environment:
    - discovery.type=single-node
    - xpack.security.enabled=false
    - "ES_JAVA_OPTS=-Xms512m -Xmx512m"

logstash:
  image: docker.elastic.co/logstash/logstash:8.12.0
  container_name: nh-logstash
  ports:
    - "5044:5044"
  volumes:
    - ./monitoring/logstash/pipeline.conf:/usr/share/logstash/pipeline/pipeline.conf
  depends_on:
    - elasticsearch-monitor

jaeger:
  image: jaegertracing/all-in-one:latest
  container_name: nh-jaeger
  ports:
    - "16686:16686"  # UI
    - "14268:14268"  # Collector
  environment:
    - COLLECTOR_OTLP_ENABLED=true

filebeat:
  image: docker.elastic.co/beats/filebeat:8.12.0
  container_name: nh-filebeat
  user: root
  volumes:
    - ./monitoring/filebeat.yml:/usr/share/filebeat/filebeat.yml
    - /var/log:/var/log:ro
    - /var/run/docker.sock:/var/run/docker.sock
  depends_on:
    - logstash
```

### 8. 告警通知 `monitoring/alertmanager.yml`
```yaml
global:
  resolve_timeout: 5m
  wechat_api_url: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send'

route:
  group_by: ['alertname', 'service']
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h
  receiver: 'wechat-webhook'
  
  routes:
    - match:
        severity: critical
      receiver: 'pagerduty'
      repeat_interval: 1h

receivers:
  - name: 'wechat-webhook'
    webhook_configs:
      - url: 'http://webhook-bridge:8080/wechat'
        send_resolved: true
  
  - name: 'pagerduty'
    pagerduty_configs:
      - service_key: 'your_pd_integration_key'
        send_resolved: true

inhibit_rules:
  - source_match:
      severity: 'critical'
    target_match:
      severity: 'warning'
    equal: ['alertname', 'service']
```

### 9. 对应需求条目
#45, #75, #76, #77, #78, #79, #80, #81, #82

## 验收标准
- [ ] Prometheus 抓取所有服务指标
- [ ] Grafana 看板展示实时数据
- [ ] 告警规则触发（模拟 5xx 测试）
- [ ] 企业微信收到告警通知
- [ ] ELK 日志按服务分索引
- [ ] 日志可按 trace_id 关联查询
- [ ] Jaeger UI 展示完整调用链
- [ ] 队列积压告警生效
- [ ] 磁盘/内存告警生效
- [ ] Docker 全栈启动成功

## 参考文件
- `specs/06-ops.md` → 数据看板 + 告警
- `.trae/memory.md` → ADR + 禁止事项
