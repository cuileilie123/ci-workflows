---
name: subscribe-share
description: 实现微信订阅消息 + 分享卡片 + 埋点
model: claude-4-sonnet
tags: [frontend]
depends_on: [wx-login, task-detail]
---

# 任务：实现订阅消息 + 分享 + 埋点

## 目标
接入微信订阅消息推送、分享卡片配置、全链路埋点上报。

## 具体步骤

### 1. 微信订阅消息 `utils/subscribe.ts`
```typescript
// 订阅模板 ID（微信公众平台申请）
const TMPL_IDS = {
  ORDER_STATUS: 'YOUR_TMPL_ORDER_STATUS',     // 订单状态变更
  NEW_TASK_NEARBY: 'YOUR_TMPL_NEW_TASK',      // 附近新任务
  PAYMENT_REMINDER: 'YOUR_TMPL_PAY_REMIND',  // 支付提醒
  REVIEW_REMINDER: 'YOUR_TMPL_REVIEW',       // 评价提醒
};

export async function requestSubscribe(types: string[]) {
  const tmplIds = types.map(t => TMPL_IDS[t]).filter(Boolean);
  if (tmplIds.length === 0) return;
  
  try {
    const res = await wx.requestSubscribeMessage({ tmplIds });
    // res = { tmplId1: 'accept' | 'reject' | 'ban' }
    reportSubscribeResult(res);
  } catch (e) {
    console.warn('订阅消息失败', e);
  }
}

// 在关键节点触发订阅
export function subscribeOnTaskPublish() {
  requestSubscribe(['ORDER_STATUS', 'NEW_TASK_NEARBY']);
}

export function subscribeOnOrderCreate() {
  requestSubscribe(['ORDER_STATUS', 'PAYMENT_REMINDER']);
}

export function subscribeOnOrderComplete() {
  requestSubscribe(['REVIEW_REMINDER']);
}
```

### 2. 分享卡片 `pages/task/detail.vue`
```typescript
// 分享给好友
onShareAppMessage(() => {
  return {
    title: task.value.title,
    path: `/pages/task/detail?id=${task.value.id}&ref=${userStore.userInfo.id}`,
    imageUrl: task.value.images?.[0] || '/static/share-default.png',
    desc: `悬赏 ¥${task.value.price} · ${task.value.location}`
  };
});

// 分享到朋友圈
onShareTimeline(() => {
  return {
    title: `【邻里互助】${task.value.title} - ¥${task.value.price}`,
    query: `id=${task.value.id}&ref=${userStore.userInfo.id}`,
    imageUrl: task.value.images?.[0] || '/static/share-default.png'
  };
});
```

### 3. 埋点系统 `utils/track.ts`
```typescript
interface TrackEvent {
  event: string;
  props: Record<string, any>;
  userId?: number;
  timestamp: number;
  sessionId: string;
}

class Tracker {
  private queue: TrackEvent[] = [];
  private sessionId = this.genSessionId();
  private flushTimer: any;
  
  constructor() {
    // 每 10 秒批量上报
    this.flushTimer = setInterval(() => this.flush(), 10000);
    
    // 页面隐藏时立即上报
    wx.onAppHide(() => this.flush());
  }
  
  track(event: string, props: Record<string, any> = {}) {
    this.queue.push({
      event,
      props: { ...props, page: getCurrentPage() },
      userId: useUserStore().userInfo?.id,
      timestamp: Date.now(),
      sessionId: this.sessionId
    });
    
    // 关键事件立即上报
    if (['pay_success', 'order_create', 'task_publish'].includes(event)) {
      this.flush();
    }
  }
  
  private async flush() {
    if (this.queue.length === 0) return;
    
    const batch = this.queue.splice(0, this.queue.length);
    try {
      await wx.request({
        url: `${BASE_URL}/api/v1/track`,
        method: 'POST',
        data: { events: batch },
        header: { Authorization: `Bearer ${getToken()}` }
      });
    } catch {
      // 失败放回队列头部
      this.queue.unshift(...batch);
    }
  }
  
  // 页面停留时长
  trackPageView(pageName: string) {
    const startTime = Date.now();
    return () => {
      const duration = Date.now() - startTime;
      this.track('page_view', { page: pageName, duration });
    };
  }
}

export const tracker = new Tracker();

// 全局事件名常量
export const EVENTS = {
  APP_LAUNCH: 'app_launch',
  PAGE_VIEW: 'page_view',
  TASK_PUBLISH: 'task_publish',
  TASK_CLICK: 'task_click',
  ORDER_CREATE: 'order_create',
  PAY_SUCCESS: 'pay_success',
  PAY_FAIL: 'pay_fail',
  ORDER_ACCEPT: 'order_accept',
  ORDER_COMPLETE: 'order_complete',
  REVIEW_SUBMIT: 'review_submit',
  SHARE_CLICK: 'share_click',
  SEARCH: 'search',
  SUBSCRIBE: 'subscribe',
} as const;
```

### 4. 埋点 BFF 端 `src/modules/track/track.controller.ts`
```typescript
@Post()
async receiveTrack(@Body() dto: TrackBatchDto) {
  // 批量写入（异步，不阻塞）
  this.mqProducer.publish('analytics.events', dto.events);
  return { code: 200, message: 'ok' };
}
```

### 5. 埋点 Go 消费端 `backend/analytics/main.go`
```go
package main

import (
  "encoding/json"
  "fmt"
  "log"
  "os"
  "github.com/elastic/go-elasticsearch/v8"
)

type TrackEvent struct {
  Event     string                 `json:"event"`
  Props     map[string]interface{} `json:"props"`
  UserID    *int64                 `json:"user_id"`
  Timestamp int64                  `json:"timestamp"`
  SessionID string                 `json:"session_id"`
}

func main() {
  es, _ := elasticsearch.NewDefaultClient()
  
  // 从 RabbitMQ 消费
  // ... (MQ consumer setup)
  
  for event := range eventChan {
    // 写入 ES
    body, _ := json.Marshal(event)
    es.Index(
      "analytics-"+time.Now().Format("2006.01.02"),
      bytes.NewReader(body),
    )
    
    // 实时统计（Redis 计数器）
    rdb.Incr(ctx, fmt.Sprintf("metric:%s:%s", event.Event, time.Now().Format("2006-01-02-15")))
  }
}
```

### 6. 对应需求条目
#24, #25, #96, #97

## 验收标准
- [ ] 订单状态变更推送成功
- [ ] 分享卡片信息正确
- [ ] 分享带 ref 参数（归因追踪）
- [ ] 埋点事件上报不丢
- [ ] 关键事件实时上报
- [ ] 页面停留时长准确
- [ ] ES 索引按日期分片
- [ ] 用户拒绝订阅有降级方案

## 参考文件
- `specs/06-ops.md` → 数据看板
- `.trae/memory.md` → 禁止事项
