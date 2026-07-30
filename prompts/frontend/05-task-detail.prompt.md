---
name: task-detail
description: 实现任务详情页（状态机UI+聊天+接单）
model: claude-4-sonnet
tags: [frontend, task]
depends_on: [task-list, wx-login]
---

# 任务：实现任务详情页

## 目标
展示任务完整信息，根据状态展示不同操作按钮，支持联系发布者、接单、确认完成。

## 具体步骤

### 1. 创建 `src/pages/task/detail.vue`

**页面结构：**
```
┌─────────────────────┐
│  标题 + 价格标签     │
├─────────────────────┤
│  发布者信息(头像/名)  │
├─────────────────────┤
│  任务描述(Markdown)  │
├─────────────────────┤
│  图片展示(可预览)     │
├─────────────────────┤
│  位置卡片(地图缩略图)  │
├─────────────────────┤
│  状态时间线          │
├─────────────────────┤
│  底部操作栏(浮动)     │
└─────────────────────┘
```

### 2. 状态机 UI
```typescript
type TaskStatus = 'OPEN' | 'ASSIGNED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';

const statusConfig = {
  OPEN:         { label: '待接单', color: '#FF9500', actions: ['接单', '联系TA'] },
  ASSIGNED:     { label: '已接单', color: '#007AFF', actions: ['开始服务', '联系TA'] },
  IN_PROGRESS:  { label: '进行中', color: '#34C759', actions: ['确认完成', '联系TA'] },
  COMPLETED:    { label: '已完成', color: '#8E8E93', actions: ['评价', '查看评价'] },
  CANCELLED:    { label: '已取消', color: '#8E8E93', actions: [] }
};
```

### 3. 底部操作栏（根据角色 + 状态动态渲染）
- 发布者视角 + OPEN → 显示"取消任务"
- 发布者视角 + ASSIGNED → 显示"确认开始"、"取消任务"
- 其他用户视角 + OPEN → 显示"我要接单"
- 双方都有 → "联系TA"（跳转聊天）

### 4. 接单逻辑
- 点击"我要接单" → 二次确认弹窗
- POST `/api/v1/tasks/:id/accept`
- 成功 → 刷新详情 → 显示"已接单"
- 失败 → Toast 提示原因（信用不足/已被接/已过期）

### 5. 图片预览
- 点击图片 → `wx.previewImage`
- 支持左右滑动切换
- 长按保存（权限判断）

### 6. 地图卡片
- 展示任务位置缩略图（静态图 API）
- 点击 → 跳转 `pages/map/index` 全屏地图
- 显示任务位置 + 当前位置 + 路线

### 7. 状态时间线
- 垂直时间轴组件
- 节点：发布 → 接单 → 开始 → 完成
- 已完成节点绿色打勾，未完成灰色

## 验收标准
- [ ] 不同状态展示正确
- [ ] 操作按钮权限正确
- [ ] 接单流程顺畅
- [ ] 图片预览正常
- [ ] 地图卡片可点击
- [ ] 时间线节点正确

## 参考文件
- `specs/02-task.md` → 任务状态机
- `.trae/memory.md` → ADR-004 订单状态机
