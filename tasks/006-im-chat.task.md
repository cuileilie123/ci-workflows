# Task 006: 即时通讯（IM）

- **Prompts**:
  - `prompts/bff/05-im-websocket.prompt.md`
- **执行顺序**: 6
- **状态**: completed
- **依赖**: Task 002
- **预估时间**: 3 小时
- **说明**: WebSocket 长连接 + MongoDB 消息存储 + 已读回执 + 离线消息推送 + 敏感词过滤
- **验收**:
  - [x] WebSocket 连接成功（JWT 验证）
  - [x] 心跳 30s 正常保活
  - [x] 断线 90s 自动断开
  - [x] 消息发送/接收实时（< 200ms）
  - [x] 已读回执生效
  - [x] 离线消息登录后推送
  - [x] 敏感词替换为 ***
  - [x] 消息持久化到 MongoDB
  - [x] 图片/语音上传到 COS
  - [x] 断线指数退避重连
