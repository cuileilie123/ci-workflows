---
name: task-list
description: 实现附近任务列表（Feed流+筛选+搜索）
model: claude-4-sonnet
tags: [frontend, task]
depends_on: [init-miniprogram, wx-login]
---

# 任务：实现附近任务列表页

## 目标
首页展示附近 3km 内的任务列表，支持下拉刷新、上拉加载、分类筛选、关键词搜索。

## 具体步骤

### 1. 创建 `src/pages/home/index.vue`

**布局结构：**
```
┌─────────────────┐
│  搜索栏(固定)    │
├─────────────────┤
│  分类 Grid(9宫格)│
├─────────────────┤
│  任务卡片列表     │
│  ┌───────────┐  │
│  │ 卡片1      │  │
│  ├───────────┤  │
│  │ 卡片2      │  │
│  └───────────┘  │
└─────────────────┘
```

### 2. 任务卡片组件 `components/task-card/index.vue`
```typescript
interface TaskCard {
  id: number;
  title: string;
  price: number;
  distance: number;    // 米
  location: string;     // POI 名称
  avatar: string;       // 发布者头像
  nickname: string;
  publishTime: string;   // 相对时间 "5分钟前"
  image?: string;       // 封面图
  category: string;
}
```

### 3. 下拉刷新 + 上拉加载
- `onPullDownRefresh` → 重置 page=1，重新请求
- `onReachBottom` → page++，追加数据
- 加载状态：loading / noMore / error

### 4. 分类筛选
- 顶部 9 宫格，点击切换选中态
- 选中分类 → 重置列表 → 带 category 参数请求
- "全部" 选项始终存在

### 5. 搜索功能
- 顶部搜索栏，防抖 500ms
- 输入关键词 → GET `/api/v1/tasks/search?q=xxx`
- 搜索结果复用任务卡片组件
- 搜索历史（本地存储，最多 10 条）

### 6. 地理位置获取
- 页面 onLoad 调 `wx.getLocation`
- 精度 `type: 'gcj02'`
- 失败降级：使用上次缓存位置
- 拒绝授权：展示提示引导去设置页

### 7. 空状态 & 错误状态
- 空列表：插画 + "附近暂无任务，去发布一个吧"
- 网络错误：插画 + 重试按钮
- 加载中：骨架屏（Skeleton）

## 验收标准
- [ ] 首次进入自动获取位置
- [ ] 下拉刷新正常
- [ ] 上拉加载更多正常
- [ ] 分类筛选正确
- [ ] 搜索防抖生效
- [ ] 骨架屏流畅

## 参考文件
- `specs/02-task.md` → 附近任务列表章节
- `.trae/memory.md` → GeoHash 精度说明
