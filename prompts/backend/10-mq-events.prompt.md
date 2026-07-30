---
name: mq-events
description: 实现 RabbitMQ 事件驱动架构（订单事件/通知/审计）
model: claude-4-sonnet
tags: [backend, mq, go]
depends_on: [task-service, payment-gateway, im-websocket]
---

# 任务：实现事件驱动架构（RabbitMQ）

## 目标
搭建 RabbitMQ 消息队列系统，解耦订单、支付、通知、审计等模块。

## 具体步骤

### 1. 消息定义 `backend/shared/events/events.go`
```go
package events

type EventType string

const (
  // 订单事件
  EventOrderCreated   EventType = "order.created"
  EventOrderPaid      EventType = "order.paid"
  EventOrderCancelled  EventType = "order.cancelled"
  EventOrderCompleted  EventType = "order.completed"
  EventOrderRefunded  EventType = "order.refunded"
  
  // 用户事件
  EventUserRegistered  EventType = "user.registered"
  EventUserLowCredit  EventType = "user.low_credit"
  EventUserBanned     EventType = "user.banned"
  
  // 任务事件
  EventTaskPublished  EventType = "task.published"
  EventTaskAssigned   EventType = "task.assigned"
  EventTaskExpired    EventType = "task.expired"
  
  // 通知事件
  EventNotifyPush     EventType = "notify.push"
  EventNotifySMS      EventType = "notify.sms"
  EventNotifyWXSub    EventType = "notify.wx_subscribe"
)

type Event struct {
  ID        string      `json:"id"`
  Type      EventType   `json:"type"`
  Timestamp int64       `json:"timestamp"`
  Source    string      `json:"source"`
  Data      interface{} `json:"data"`
  Retry     int         `json:"retry"`
}
```

### 2. 生产者封装 `backend/shared/mq/producer.go`
```go
package mq

import (
  "encoding/json"
  "github.com/rabbitmq/amqp091-go"
)

type Producer struct {
  ch    *amqp.Channel
  conn  *amqp.Connection
}

func NewProducer(url string) (*Producer, error) {
  conn, err := amqp.Dial(url)
  if err != nil { return nil, err }
  
  ch, err := conn.Channel()
  if err != nil { return nil, err }
  
  // 声明 Exchange（Topic 类型）
  ch.ExchangeDeclare("nh.events", "topic", true, false, false, false, nil)
  
  // 声明死信 Exchange
  ch.ExchangeDeclare("nh.dlx", "topic", true, false, false, false, nil)
  
  return &Producer{conn: conn, ch: ch}, nil
}

func (p *Producer) Publish(eventType events.EventType, data interface{}) error {
  body, _ := json.Marshal(events.Event{
    ID:        uuid.New().String(),
    Type:      eventType,
    Timestamp: time.Now().Unix(),
    Source:    "backend",
    Data:      data,
  })
  
  return p.ch.Publish(
    "nh.events",    // exchange
    string(eventType), // routing key
    false, false,
    amqp.Publishing{
      ContentType:  "application/json",
      Body:         body,
      DeliveryMode: amqp.Persistent, // 持久化
      MessageId:    uuid.New().String(),
      Timestamp:    time.Now(),
    })
}

// 延迟消息（基于 TTL + DLX）
func (p *Producer) PublishDelay(eventType events.EventType, data interface{}, delaySeconds int) error {
  body, _ := json.Marshal(/* ... */)
  
  return p.ch.Publish(
    "nh.delay",     // delay exchange
    string(eventType),
    false, false,
    amqp.Publishing{
      ContentType:  "application/json",
      Body:         body,
      Headers:      amqp.Table{"x-delay": int64(delaySeconds * 1000)},
      DeliveryMode: amqp.Persistent,
    })
}
```

### 3. 消费者封装 `backend/shared/mq/consumer.go`
```go
package mq

type Consumer struct {
  ch *amqp.Channel
}

func (c *Consumer) Subscribe(eventType events.EventType, handler func(*events.Event) error) error {
  // 声明队列（每个消费者独立队列）
  queueName := fmt.Sprintf("nh.q.%s", eventType)
  q, err := c.ch.QueueDeclare(queueName, true, false, false, false, nil)
  if err != nil { return err }
  
  // 绑定到 Exchange
  c.ch.QueueBind(q.Name, string(eventType), "nh.events", false, nil)
  
  // 设置 QoS（每次取1条，处理完再取下一条）
  c.ch.Qos(1, 0, false)
  
  msgs, err := c.ch.Consume(q.Name, "", false, false, false, false, nil)
  if err != nil { return err }
  
  go func() {
    for msg := range msgs {
      var event events.Event
      json.Unmarshal(msg.Body, &event)
      
      if err := handler(&event); err != nil {
        // 重试（最多3次）
        if event.Retry < 3 {
          event.Retry++
          // 重新入队（延迟递增）
          c.republish(&event, event.Retry * 5)
          msg.Ack(false)
        } else {
          // 进入死信队列
          c.sendToDLQ(&event, err)
          msg.Ack(false)
        }
      } else {
        msg.Ack(false)
      }
    }
  }()
  
  return nil
}
```

### 4. 事件处理器 `backend/risk-service/internal/handler/events.go`
```go
package handler

// 订单支付 → 风控检查
func (h *EventHandler) OnOrderPaid(event *events.Event) error {
  data := event.Data.(map[string]interface{})
  userID := int64(data["helperId"].(float64))
  
  // 检查该用户是否触发风控
  score, violations := h.riskEngine.Evaluate(userID, "order_paid")
  if score > 80 {
    h.alerter.Send(alert.LevelBlock, fmt.Sprintf("用户%d风险分过高: %d", userID, score), map[string]interface{}{
      "user_id": userID, "violations": violations,
    })
  }
  return nil
}

// 用户注册 → 发送欢迎通知
func (h *EventHandler) OnUserRegistered(event *events.Event) error {
  data := event.Data.(map[string]interface{})
  openid := data["openid"].(string)
  
  return h.wxNotify.SendSubscribe(openid, "welcome", map[string]string{
    "thing1": "欢迎加入邻里互助！",
    "thing2": "发布第一个任务吧",
  })
}

// 订单超时未支付 → 自动取消（延迟队列）
func (h *EventHandler) OnOrderTimeout(event *events.Event) error {
  data := event.Data.(map[string]interface{})
  orderID := int64(data["orderId"].(float64))
  
  return h.orderService.CancelTimeout(orderID)
}
```

### 5. 延迟队列配置（RabbitMQ）
```go
// 声明延迟 Exchange（基于 rabbitmq-delayed-message 插件）
func SetupDelayExchange(ch *amqp.Channel) {
  ch.ExchangeDeclare("nh.delay", "x-delayed-message", true, false, false, false, amqp.Table{
    "x-delayed-type": "topic",
  })
}
```

### 6. BFF 端发送事件 `src/modules/order/order.service.ts`
```typescript
// 订单支付成功后发布事件
async markOrderPaid(orderId: number) {
  await this.prisma.order.update({
    where: { id: orderId },
    data: { status: 'PAID', paidAt: new Date() }
  });
  
  // 发布到 RabbitMQ
  await this.mqProducer.publish(EventType.ORDER_PAID, {
    orderId,
    helperId: order.helperId,
    amount: order.totalAmount
  });
  
  // 发布延迟消息（15分钟未开始 → 自动取消）
  await this.mqProducer.publishDelay(
    EventType.ORDER_TIMEOUT,
    { orderId },
    15 * 60 // 15分钟
  );
}
```

### 7. 事件监控看板
```go
// GET /api/v1/mq/metrics
func (c *MetricsController) Metrics() map[string]interface{} {
  return map[string]interface{}{
    "messages_published": metrics.Get("mq.published"),
    "messages_consumed":  metrics.Get("mq.consumed"),
    "messages_failed":    metrics.Get("mq.failed"),
    "queue_lengths":      c.mq.GetQueueLengths(),
    "consumer_lag":       c.mq.GetConsumerLag(),
  }
}
```

### 8. 对应需求条目
#36, #37, #49, #62, #63, #64, #72, #73, #74, #77, #82

## 验收标准
- [ ] 消息持久化（重启不丢）
- [ ] 消费者宕机自动重平衡
- [ ] 延迟消息 15 分钟准时触发
- [ ] 死信队列正常接收失败消息
- [ ] 重试 3 次后进入 DLQ
- [ ] 事件监控指标可查
- [ ] 订单支付 → 通知 → 风控 链路通畅
- [ ] 消息积压告警（>10000 触发）

## 参考文件
- `specs/03-payment.md` → 延迟队列
- `specs/06-ops.md` → 告警监控
- `.trae/memory.md` → ADR + 禁止事项
