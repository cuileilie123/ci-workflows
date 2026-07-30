# Task 012: 全链路监控 + 日志

- **Prompts**:
  - `prompts/backend/13-monitoring-logging.prompt.md`
- **执行顺序**: 12
- **状态**: pending
- **依赖**: Task 010
- **预估时间**: 3 小时
- **说明**: Prometheus + Grafana + ELK + Jaeger + 告警通知
- **验收**:
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
