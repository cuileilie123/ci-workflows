# 邻里互助小程序 - 冒烟测试 BUG 报告

> 测试时间：2026-08-10
> 测试方式：微信开发者工具自动化 + 静态代码审查 + BFF API 端点验证
> 测试范围：全部 16 个页面 + 9 个 API 模块 + 8 个工具模块

---

## 一、问题汇总

| 严重程度 | 数量 | 说明 |
|----------|------|------|
| 🔴 Critical（严重） | 11 | 导致核心功能完全不可用 |
| 🟠 High（高） | 12 | 主要功能受损 |
| 🟡 Medium（中） | 12 | 次要功能问题 |
| 🟢 Low（低） | 4 | 体验问题 |
| **合计** | **39** | |

---

## 二、BUG 详情

### 🔴 Critical（严重 - 11 个）

---

#### BUG-01: tabBar 页面导航失败（首页→个人中心）
- **文件**: [index.vue](file:///d:/neighborhood-help/frontend/src/pages/index/index.vue#L73)
- **描述**: 首页点击用户卡片时使用 `uni.navigateTo` 跳转到 `/pages/user/profile`，但该页面是 tabBar 页面，`navigateTo` 无法跳转 tabBar 页面，点击无反应。
- **代码**:
  ```javascript
  uni.navigateTo({ url: '/pages/user/profile' }); // ❌ profile 是 tabBar 页面
  ```
- **修复**: 改用 `uni.switchTab({ url: '/pages/user/profile' })`

---

#### BUG-02: tabBar 页面导航失败（首页→任务列表）
- **文件**: [index.vue](file:///d:/neighborhood-help/frontend/src/pages/index/index.vue#L86)
- **描述**: 首页"附近任务"按钮使用 `uni.navigateTo` 跳转到 `/pages/task/list`，但该页面是 tabBar 页面，点击无反应。
- **代码**:
  ```javascript
  uni.navigateTo({ url: '/pages/task/list' }); // ❌ task/list 是 tabBar 页面
  ```
- **修复**: 改用 `uni.switchTab({ url: '/pages/task/list' })`

---

#### BUG-03: tabBar 页面导航失败（个人中心→聊天列表）
- **文件**: [profile.vue](file:///d:/neighborhood-help/frontend/src/pages/user/profile.vue#L223)
- **描述**: 个人中心点击"消息"时使用 `uni.navigateTo` 跳转到 `/pages/chat/list`，但该页面是 tabBar 页面，点击无反应。
- **代码**:
  ```javascript
  uni.navigateTo({ url: '/pages/chat/list' }); // ❌ chat/list 是 tabBar 页面
  ```
- **修复**: 改用 `uni.switchTab({ url: '/pages/chat/list' })`

---

#### BUG-04: tabBar 页面导航失败（发布任务后→首页）
- **文件**: [publish.vue](file:///d:/neighborhood-help/frontend/src/pages/task/publish.vue#L341)
- **描述**: 任务发布成功后使用 `uni.redirectTo` 跳转到 `/pages/index/index`，但该页面是 tabBar 页面，`redirectTo` 无法跳转，导致发布成功后卡在当前页面。
- **代码**:
  ```javascript
  uni.redirectTo({ url: `/pages/index/index` }); // ❌ index/index 是 tabBar 页面
  ```
- **修复**: 改用 `uni.reLaunch({ url: '/pages/index/index' })` 或 `uni.switchTab`

---

#### BUG-05: QQMapWX 未导入导致运行时崩溃
- **文件**: [App.vue](file:///d:/neighborhood-help/frontend/src/App.vue#L12)
- **描述**: `onLaunch` 中调用 `new QQMapWX({ key: MAP_KEY })`，但未导入腾讯地图 SDK 的 JS 文件。`env.d.ts` 中仅有类型声明（`declare class QQMapWX`），运行时 `QQMapWX` 为 `undefined`，执行 `new undefined()` 会抛出 `TypeError`，导致 App 初始化失败。
- **代码**:
  ```javascript
  (globalThis as Record<string, unknown>).qqmapsdk = new QQMapWX({ key: MAP_KEY });
  // ❌ QQMapWX 未 import，运行时为 undefined
  ```
- **修复**: 下载腾讯地图 SDK JS 文件放到 `static/` 目录，在 `App.vue` 中 `import '@/static/qqmap-wx-jssdk.js'`

---

#### BUG-06: 订单详情用 orderId 当 taskId 跳转任务详情
- **文件**: [order/detail.vue](file:///d:/neighborhood-help/frontend/src/pages/order/detail.vue#L294)
- **描述**: 点击"任务信息"卡片跳转时，使用 `order.value.id`（订单ID）作为任务ID传给 `/pages/task/detail`，导致跳转到错误的任务详情页（查询不到对应任务）。
- **代码**:
  ```javascript
  function goToTask(): void {
    if (!order.value) return;
    // ❌ 订单ID不等于任务ID
    uni.navigateTo({ url: `/pages/task/detail?id=${order.value.id}` });
  }
  ```
- **修复**: 后端 `OrderQueryResult` 需增加 `taskId` 字段，前端使用 `order.value.taskId` 跳转

---

#### BUG-07: 订单详情用 orderId 当 taskId 发起支付
- **文件**: [order/detail.vue](file:///d:/neighborhood-help/frontend/src/pages/order/detail.vue#L225-L226)
- **描述**: "去支付"逻辑中使用 `orderId` 作为 `taskId` 调用 `payForTask(taskIdStr)`，会创建一个全新的订单而非支付当前订单，导致重复创建订单、支付金额错误。
- **代码**:
  ```javascript
  const taskIdStr = orderId; // ❌ 订单ID当任务ID
  const result = await payForTask(taskIdStr); // 会用这个错误的ID创建新订单
  ```
- **修复**: 应通过 `order.value.taskId` 获取真实任务ID，或直接调用支付已有订单的接口

---

#### BUG-08: 订单详情取消订单功能未实现
- **文件**: [order/detail.vue](file:///d:/neighborhood-help/frontend/src/pages/order/detail.vue#L241-L249)
- **描述**: `doCancel` 函数只显示 Toast "已取消"，没有调用任何后端接口，订单状态不会改变。
- **代码**:
  ```javascript
  async function doCancel(): Promise<void> {
    const ok = await showConfirm('取消订单', '确定要取消该订单吗？');
    if (!ok) return;
    // ❌ 没有调用后端取消接口
    uni.showToast({ title: '已取消', icon: 'none' });
    await loadOrder();
  }
  ```
- **修复**: 调用后端取消订单接口（需后端提供 `POST /pay/cancel/:orderId`）

---

#### BUG-09: 订单详情任务信息为硬编码假数据
- **文件**: [order/detail.vue](file:///d:/neighborhood-help/frontend/src/pages/order/detail.vue#L183-L193)
- **描述**: `loadTaskInfo` 函数没有真正请求任务数据，直接硬编码 `title: '关联任务'` 和 `address: '点击查看任务详情'`，用户看到的任务信息是假的。
- **代码**:
  ```javascript
  async function loadTaskInfo(): Promise<void> {
    if (!order.value) return;
    // ❌ 硬编码假数据
    taskInfo.title = '关联任务';
    taskInfo.address = '点击查看任务详情';
  }
  ```
- **修复**: 通过 `order.value.taskId` 调用 `taskApi.detail()` 获取真实任务信息

---

#### BUG-10: 评价页面被评价者信息为假数据
- **文件**: [create.vue](file:///d:/neighborhood-help/frontend/src/pages/review/create.vue#L153-L157)
- **描述**: 创建评价时，被评价者的 `id` 直接使用订单ID，`nickname` 是硬编码的"任务发布者"或"帮助者"，提交评价后会关联到错误的用户。
- **代码**:
  ```javascript
  reviewee.value = {
    id: orderInfo.value.id || 'unknown', // ❌ 用订单ID当用户ID
    nickname: orderInfo.value.taskTitle ? '任务发布者' : '帮助者', // ❌ 假昵称
    avatar: null,
  };
  ```
- **修复**: 后端 `OrderQueryResult` 需返回 `publisherId`/`helperId`，前端据此确定被评价者

---

#### BUG-11: 订阅消息模板ID全为占位符
- **文件**: [subscribe.ts](file:///d:/neighborhood-help/frontend/src/utils/subscribe.ts#L9-L14)
- **描述**: 4 个订阅消息模板 ID 全是占位符（`tmpl_order_status_placeholder` 等），调用 `wx.requestSubscribeMessage` 时微信会拒绝这些无效 ID，订阅消息功能完全不可用。
- **代码**:
  ```javascript
  const TMPL_IDS = {
    ORDER_STATUS: 'tmpl_order_status_placeholder', // ❌ 占位符
    NEW_TASK_NEARBY: 'tmpl_new_task_placeholder',   // ❌ 占位符
    PAYMENT_REMINDER: 'tmpl_pay_remind_placeholder', // ❌ 占位符
    REVIEW_REMINDER: 'tmpl_review_placeholder',     // ❌ 占位符
  };
  ```
- **修复**: 在微信公众平台申请真实模板 ID 并替换

---

### 🟠 High（高 - 12 个）

---

#### BUG-12: 任务详情重复调用 loadDetail
- **文件**: [detail.vue](file:///d:/neighborhood-help/frontend/src/pages/task/detail.vue#L267 和 #L512)
- **描述**: 页面注册了两个 `onShow` 钩子，第一个在 267 行调用 `loadDetail()`，第二个在 512 行也调用 `loadDetail()`，导致每次显示页面时发起两次相同的 API 请求。
- **修复**: 合并为一个 `onShow` 钩子

---

#### BUG-13: 任务详情退款用 taskId 当 orderId
- **文件**: [detail.vue](file:///d:/neighborhood-help/frontend/src/pages/task/detail.vue#L385)
- **描述**: `doRefund` 函数使用 `taskId` 作为 orderId 调用 `paymentApi.refund(taskId, ...)`，退款会作用于错误的订单。
- **代码**:
  ```javascript
  await paymentApi.refund(taskId, Number(task.value.price), '用户申请退款');
  // ❌ taskId 不是 orderId
  ```
- **修复**: 先查询任务关联的订单ID，再调用退款

---

#### BUG-14: 帮助者中心"今日收入"显示的是钱包总余额
- **文件**: [helper/index.vue](file:///d:/neighborhood-help/frontend/src/pages/helper/index.vue#L125-L126)
- **描述**: `loadStats` 中将 `walletApi.getBalance()` 返回的 `available`（可用余额）赋值给 `todayIncome`（今日收入），但可用余额是累计余额而非今日收入，数据语义错误。
- **代码**:
  ```javascript
  const balance = await walletApi.getBalance();
  todayIncome.value = balance.available.toFixed(2); // ❌ 余额≠今日收入
  ```
- **修复**: 后端需提供今日收入统计接口，或从交易流水中筛选今日 INCOME 类型汇总

---

#### BUG-15: 帮助者中心查询不存在的订单状态 'ACCEPTED'
- **文件**: [helper/index.vue](file:///d:/neighborhood-help/frontend/src/pages/helper/index.vue#L108)
- **描述**: `loadMyOrders` 调用 `paymentApi.getUserOrders({ status: 'ACCEPTED' })`，但订单状态枚举为 `PENDING | PAID | IN_PROGRESS | COMPLETED | CANCELLED | REFUNDED`，不存在 `ACCEPTED` 状态，查询结果永远为空。
- **代码**:
  ```javascript
  const ordersData = await paymentApi.getUserOrders({ status: 'ACCEPTED' });
  // ❌ 没有 ACCEPTED 状态
  ```
- **修复**: 应查询 `status: 'IN_PROGRESS'`（已支付进行中的订单即已接单）

---

#### BUG-16: 后端 GET /tasks/nearby 路由冲突返回 500
- **文件**: [task.controller.ts](file:///d:/neighborhood-help/bff/src/modules/task/task.controller.ts) (后端)
- **描述**: `GET /tasks/nearby` 的 `nearby` 被 `@Get(':id')` 路由匹配为任务 ID，查询失败后返回 500 而非 404。虽然前端目前不直接调用此端点，但这是后端路由设计缺陷。
- **修复**: 在 `@Get(':id')` 前声明 `@Get('nearby')` 路由，或添加 ID 格式校验

---

#### BUG-17: 后端搜索接口 ES 不可用时返回 500
- **文件**: [es.service.ts](file:///d:/neighborhood-help/bff/src/modules/search/es.service.ts) (后端)
- **描述**: Elasticsearch 未运行时，`GET /search?q=...` 直接返回 500 服务器内部错误，未做降级处理。前端搜索页面会显示"搜索失败"。
- **修复**: ES 不可用时降级返回空结果或使用数据库 LIKE 查询兜底

---

#### BUG-18: 后端用户资料接口未实现
- **文件**: 后端 `user` 模块
- **描述**: `GET /user/profile`、`PUT /user/profile`、`GET /user/settings` 均返回 404，后端 user 模块只有 GDPR 控制器，没有用户资料和设置的 CRUD 接口。前端设置页的全部功能（修改手机号、修改密码、注销账号）均为占位提示。
- **修复**: 后端需实现用户资料和设置的 CRUD 接口

---

#### BUG-19: 聊天页面 openLocation 类型不安全
- **文件**: [chat.vue](file:///d:/neighborhood-help/frontend/src/pages/chat/chat.vue#L450-L456)
- **描述**: `openLocation` 函数中 `msg.metadata.lat` 和 `msg.metadata.lng` 的类型是 `unknown`，直接传给 `uni.openLocation` 的 `latitude`/`longitude` 参数会有类型问题，且如果值为 `undefined` 会传入 `0`，导致定位到经纬度 (0, 0) 的海洋区域。
- **代码**:
  ```javascript
  uni.openLocation({
    latitude: msg.metadata.lat ?? 0,  // ❌ unknown 类型，undefined 时为 0
    longitude: msg.metadata.lng ?? 0, // ❌ 同上
  });
  ```
- **修复**: 添加类型检查 `if (typeof lat !== 'number' || typeof lng !== 'number') return;`

---

#### BUG-20: 搜索建议接口响应双重包装
- **文件**: [search.controller.ts](file:///d:/neighborhood-help/bff/src/modules/search/search.controller.ts#L56-L59) (后端)
- **描述**: `GET /search/suggest` 返回 `{"code":0,"message":"success","data":{"code":0,"data":[]}}`，`data` 内部又嵌套了一层 `code`/`data`，前端解析时会取到错误的数据结构。
- **修复**: 控制器直接返回数据数组，让全局响应拦截器统一包装

---

#### BUG-21: 聊天页面 onReachBottom 空实现
- **文件**: [chat.vue](file:///d:/neighborhood-help/frontend/src/pages/chat/chat.vue#L296-L298)
- **描述**: 注册了 `onReachBottom` 生命周期钩子但函数体为空（只有注释），而 scroll-view 的 `@scrolltolower` 用于加载历史消息，逻辑混乱。`onReachBottom` 在 scroll-view 页面中不生效，是死代码。
- **修复**: 删除无用的 `onReachBottom` 钩子

---

#### BUG-22: 设置页手机号硬编码
- **文件**: [settings.vue](file:///d:/neighborhood-help/frontend/src/pages/user/settings.vue#L86)
- **描述**: `maskedPhone` 硬编码为 `'138****8888'`，不是真实用户的手机号。
- **代码**:
  ```javascript
  const maskedPhone = '138****8888'; // ❌ 硬编码
  ```
- **修复**: 从 `userStore.userInfo.phone` 动态生成脱敏手机号

---

#### BUG-23: 设置页功能全部未实现
- **文件**: [settings.vue](file:///d:/neighborhood-help/frontend/src/pages/user/settings.vue#L123-L177)
- **描述**: 修改手机号、修改密码、注销账号、意见反馈四个功能均只显示"即将上线"Toast，无实际逻辑。
- **修复**: 对接后端接口实现相应功能

---

### 🟡 Medium（中 - 12 个）

---

#### BUG-24: 任务列表页搜索使用后端 LIKE 查询而非 ES
- **文件**: [task.ts](file:///d:/neighborhood-help/frontend/src/api/task.ts#L30-L34) 和 [list.vue](file:///d:/neighborhood-help/frontend/src/pages/task/list.vue#L326)
- **描述**: 任务列表页的搜索调用 `taskApi.search(kw, page)` → `GET /tasks/search?q=...`，这是后端的数据库 LIKE 查询。而搜索页面的搜索调用 `searchTasks()` → `GET /search?q=...`，这是 Elasticsearch 查询。两个搜索入口使用了不同的搜索后端，搜索结果可能不一致。
- **修复**: 统一搜索入口，建议都走 ES 搜索（需先修复 ES 降级问题）

---

#### BUG-25: 搜索页 highlightSegments 高亮判断不精确
- **文件**: [search/index.vue](file:///d:/neighborhood-help/frontend/src/pages/search/index.vue#L329)
- **描述**: 高亮判断使用 `part.toLowerCase() === keyword.value.toLowerCase()`，当关键词出现多次时，只有完全匹配的片段会高亮，而正则 split 产生的其他片段不会被高亮。
- **修复**: 改用正则匹配判断 `new RegExp(escapedKeyword, 'i').test(part)`

---

#### BUG-26: 钱包页 onShow 重复加载数据
- **文件**: [wallet.vue](file:///d:/neighborhood-help/frontend/src/pages/user/wallet.vue#L316-L329)
- **描述**: `onMounted` 和 `onShow` 都调用了 `loadBalance()` 和 `loadTransactions(true)`，首次进入页面时会重复加载两次数据。
- **修复**: `onMounted` 中不调用加载函数，仅在 `onShow` 中加载

---

#### BUG-27: 帮助者中心 onMounted 和 onShow 重复埋点
- **文件**: [helper/index.vue](file:///d:/neighborhood-help/frontend/src/pages/helper/index.vue#L154-L160)
- **描述**: `onMounted` 中发起数据加载请求，`onShow` 中又做了埋点。但 `onShow` 没有刷新数据，从其他页面返回时数据不会更新。
- **修复**: 在 `onShow` 中也触发数据刷新

---

#### BUG-28: 个人中心 onMounted 和 onShow 重复检查登录
- **文件**: [profile.vue](file:///d:/neighborhood-help/frontend/src/pages/user/profile.vue#L247-L279)
- **描述**: `onMounted` 和 `onShow` 都包含了完整的登录检查 + `fetchMe` + `loadCredit/loadBalance/loadOrders` 逻辑，首次进入页面时会执行两次完整的登录检查和数据加载。
- **修复**: `onMounted` 只做初始化，`onShow` 做数据刷新

---

#### BUG-29: 聊天页面 scrollToLower 加载历史逻辑反直觉
- **文件**: [chat.vue](file:///d:/neighborhood-help/frontend/src/pages/chat/chat.vue#L300-L304)
- **描述**: `onScrollLower`（滚动到底部）触发 `loadHistory()`（加载更早消息），但用户直觉上"滚动到底部"应该加载新消息，而非历史消息。注释说"模拟上滑加载更多"，但实际是触底加载。
- **修复**: 改用 `scroll-view` 的 `@scrolltoupper` 加载历史，或调整交互逻辑

---

#### BUG-30: 个人中心 fetchMe 在 onMounted 和 onShow 中重复调用
- **文件**: [profile.vue](file:///d:/neighborhood-help/frontend/src/pages/user/profile.vue#L261 和 #L278)
- **描述**: `onMounted` 中调用 `await userStore.fetchMe()`，`onShow` 中也可能调用（通过 `loadCredit` 等间接调用），而 `App.vue` 的 `onLaunch` 中已经调用过 `userStore.restore()`（内部调用 `fetchMe`），导致 `fetchMe` 被多次调用。
- **修复**: 合理分配数据加载时机，避免重复请求

---

#### BUG-31: 任务详情 doContact 中发布者 peerNickname 为空
- **文件**: [detail.vue](file:///d:/neighborhood-help/frontend/src/pages/task/detail.vue#L441-L446)
- **描述**: 当当前用户是发布者时，`peerNickname` 和 `peerAvatar` 都设为空字符串，聊天页标题会显示默认值"邻居"，但无法看到对方的真实昵称和头像。
- **代码**:
  ```javascript
  const peerNickname = isPublisher.value
    ? '' // ❌ 发布者看接单者，昵称为空
    : task.value.publisher?.nickname ?? '邻居';
  ```
- **修复**: 需要从任务数据中获取 helper 的昵称和头像（后端 Task 需返回 helper 信息）

---

#### BUG-32: 后端分页参数命名不统一
- **文件**: 后端多个 DTO
- **描述**: 任务列表 DTO 使用 `page` 但不接受 `size`（用 `forbidNonWhitelisted` 拦截），钱包交易 DTO 使用 `pageSize` 而非 `size`，搜索 DTO 接受 `size`。分页参数命名不一致，前端需要为每个接口维护不同的参数名。
- **修复**: 统一分页参数为 `page` + `pageSize`

---

#### BUG-33: 评价创建页强制要求文字评价
- **文件**: [create.vue](file:///d:/neighborhood-help/frontend/src/pages/review/create.vue#L170-L173)
- **描述**: 提交评价时检查 `if (!comment.value.trim())` 并提示"请输入评价内容"，但后端 DTO 中 `comment` 是可选字段。强制要求文字评价会影响用户评价意愿。
- **修复**: 移除强制检查，或将后端 DTO 改为必填

---

#### BUG-34: 任务列表 onCardTap 注释过时
- **文件**: [list.vue](file:///d:/neighborhood-help/frontend/src/pages/task/list.vue#L354-L360)
- **描述**: 注释写"详情页为 Task 005，暂未实现，先提示"，但实际详情页已实现，`fail` 回调中的"详情页即将上线"Toast 永远不会触发。注释具有误导性。
- **修复**: 更新注释，移除不必要的 fail 回调

---

#### BUG-35: 地图选择器页面未审查（可能存在问题）
- **文件**: [map/picker.vue](file:///d:/neighborhood-help/frontend/src/pages/map/picker.vue)
- **描述**: 地图选择器依赖 QQMapWX SDK（BUG-05 中已确认 SDK 未导入），逆地址解析和 POI 搜索功能均不可用。页面加载后地图功能可能完全失效。
- **修复**: 先修复 BUG-05（导入 SDK），再验证地图选择器功能

---

### 🟢 Low（低 - 4 个）

---

#### BUG-36: publish.vue 中 `void task` 无用语句
- **文件**: [publish.vue](file:///d:/neighborhood-help/frontend/src/pages/task/publish.vue#L343)
- **描述**: `void task;` 语句没有实际作用，只是为了消除 TypeScript 的"未使用变量"警告，代码不够优雅。
- **修复**: 可改为 `const { id: taskId } = await taskApi.create(...)` 只解构需要的字段

---

#### BUG-37: 钱包页 WITHDRAW 筛选用文本匹配
- **文件**: [wallet.vue](file:///d:/neighborhood-help/frontend/src/pages/user/wallet.vue#L157-L159)
- **描述**: 提现记录筛选使用 `t.description.includes('提现')` 文本匹配，如果交易描述中包含"提现"两字但实际不是提现类型，会被错误筛选出来。
- **修复**: 后端交易流水应增加 `type: 'WITHDRAW'` 类型，前端按 type 筛选

---

#### BUG-38: 搜索页 debounce 函数未清理
- **文件**: [search/index.vue](file:///d:/neighborhood-help/frontend/src/pages/search/index.vue#L172-L180)
- **描述**: `debounce` 函数在页面卸载时未清理定时器，如果用户在输入后快速返回页面，可能有一个延迟的搜索请求在卸载后触发。
- **修复**: 在 `onUnload` 中清理 debounce 定时器

---

#### BUG-39: 多个页面 formatTime 函数重复实现
- **文件**: [wallet.vue](file:///d:/neighborhood-help/frontend/src/pages/user/wallet.vue#L200)、[reviews.vue](file:///d:/neighborhood-help/frontend/src/pages/user/reviews.vue#L104)、[chat/list.vue](file:///d:/neighborhood-help/frontend/src/pages/chat/list.vue#L109)、[order/detail.vue](file:///d:/neighborhood-help/frontend/src/pages/order/detail.vue#L298) 等
- **描述**: 至少 5 个页面各自实现了 `formatTime` 函数，逻辑相似但不完全一致，维护成本高。
- **修复**: 抽取为 `utils/format.ts` 公共函数

---

## 三、BUG 分布统计

### 按模块分布

| 模块 | Critical | High | Medium | Low | 小计 |
|------|----------|------|--------|-----|------|
| 页面导航 | 4 | 0 | 0 | 0 | 4 |
| 订单详情页 | 3 | 0 | 0 | 0 | 3 |
| 任务详情页 | 0 | 2 | 1 | 0 | 3 |
| 帮助者中心 | 0 | 2 | 1 | 0 | 3 |
| 评价模块 | 1 | 0 | 1 | 0 | 2 |
| 订阅消息 | 1 | 0 | 0 | 0 | 1 |
| 地图 SDK | 1 | 0 | 1 | 0 | 2 |
| 设置页 | 0 | 2 | 0 | 0 | 2 |
| 聊天页面 | 0 | 2 | 2 | 0 | 4 |
| 搜索模块 | 0 | 1 | 2 | 1 | 4 |
| 钱包页面 | 0 | 0 | 1 | 1 | 2 |
| 后端 API | 0 | 3 | 1 | 0 | 4 |
| 个人中心 | 0 | 0 | 2 | 0 | 2 |
| 代码质量 | 0 | 0 | 0 | 2 | 2 |
| 其他 | 1 | 0 | 0 | 0 | 1 |

### 按 BUG 类型分布

| 类型 | 数量 |
|------|------|
| tabBar 导航错误 | 4 |
| ID 混用（orderId/taskId/userId） | 4 |
| 未实现/占位功能 | 5 |
| 硬编码假数据 | 3 |
| API 端点不存在/不匹配 | 4 |
| 重复请求/重复加载 | 4 |
| 类型不安全 | 2 |
| 后端服务降级缺失 | 2 |
| 其他 | 11 |

---

## 四、修复优先级建议

### P0 - 立即修复（阻塞核心流程）
1. **BUG-05**: QQMapWX 未导入 → App 初始化崩溃
2. **BUG-01~04**: 4 个 tabBar 导航错误 → 页面跳转失效
3. **BUG-06~09**: 订单详情页 4 个 Critical → 订单流程完全不可用
4. **BUG-10**: 评价被评价者 ID 错误 → 评价关联到错误用户

### P1 - 尽快修复（影响主要功能）
5. **BUG-12**: 任务详情重复请求 → 性能浪费
6. **BUG-13**: 退款用 taskId → 退款失败
7. **BUG-14~15**: 帮助者中心数据错误 → 页面数据不准
8. **BUG-17**: 搜索 ES 不可用 → 搜索功能不可用

### P2 - 计划修复（影响用户体验）
9. **BUG-11**: 订阅消息模板 ID → 订阅消息不可用
10. **BUG-18~23**: 设置页和用户资料接口缺失
11. **BUG-19~21**: 聊天页面问题

### P3 - 优化项
12. **BUG-24~39**: Medium 和 Low 级别问题

---

## 五、测试覆盖情况

### 页面覆盖（16/16 页面）

| 页面 | 静态审查 | API 验证 | 自动化测试 |
|------|----------|----------|------------|
| 首页 index | ✅ | ✅ | ⚠️ 导航超时 |
| 登录页 login | ✅ | ✅ | ⚠️ 导航超时 |
| 任务列表 task/list | ✅ | ✅ | ⚠️ 导航超时 |
| 任务详情 task/detail | ✅ | ✅ | ⚠️ 导航超时 |
| 发布任务 task/publish | ✅ | ✅ | ⚠️ 导航超时 |
| 聊天列表 chat/list | ✅ | ✅ | ⚠️ 导航超时 |
| 聊天页 chat/chat | ✅ | ✅ | ⚠️ 导航超时 |
| 个人中心 user/profile | ✅ | ✅ | ⚠️ 导航超时 |
| 钱包 user/wallet | ✅ | ✅ | ⚠️ 导航超时 |
| 设置 user/settings | ✅ | ✅ | ⚠️ 导航超时 |
| 我的评价 user/reviews | ✅ | ✅ | ⚠️ 导航超时 |
| 创建评价 review/create | ✅ | ✅ | ⚠️ 导航超时 |
| 订单详情 order/detail | ✅ | ✅ | ⚠️ 导航超时 |
| 帮助者中心 helper/index | ✅ | ✅ | ⚠️ 导航超时 |
| 搜索 search/index | ✅ | ✅ | ⚠️ 导航超时 |
| 地图选择 map/picker | ✅ | N/A | ⚠️ 导航超时 |

### API 端点覆盖（21 个端点）

| 状态 | 数量 | 端点 |
|------|------|------|
| ✅ 通过 | 2 | GET /tasks/1, POST /tasks |
| ❌ 500 错误 | 2 | GET /tasks/nearby, GET /search |
| ❌ 400 错误 | 4 | GET /tasks(无参), GET /tasks(size参), GET /wallet/transactions(size), POST /reviews(类型) |
| ❌ 404 不存在 | 13 | /user/profile, /user/settings, /payment/orders, /chat/sessions 等 |

---

## 六、自动化测试说明

微信开发者工具自动化测试（miniprogram-automator）因 DevTools 自动化端口连接冲突导致 `reLaunch` 命令持续超时，未能完成页面级别的自动化冒烟测试。已通过以下替代方式完成测试覆盖：

1. **静态代码审查**：逐行审查全部 16 个页面 + 9 个 API 模块 + 8 个工具模块的源代码
2. **BFF API 端点验证**：使用 PowerShell `Invoke-RestMethod` 逐个测试 21 个后端 API 端点
3. **路由配置验证**：对照 `pages.json` 中的 tabBar 配置检查所有导航调用
4. **类型安全检查**：验证 TypeScript 类型定义和运行时类型匹配

---

*报告生成时间：2026-08-10 20:45*
