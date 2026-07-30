---
name: user-profile
description: 实现个人中心页面（钱包/订单/评价/设置）
model: claude-4-sonnet
tags: [frontend]
depends_on: [wx-login, wallet-withdraw, review-credit]
---

# 任务：实现个人中心

## 目标
完整的用户个人中心，包含钱包、订单管理、评价列表、设置。

## 具体步骤

### 1. 个人中心页 `pages/user/index.vue`
```vue
<template>
  <scroll-view class="user-page">
    <!-- 头部：头像+昵称+信用分 -->
    <view class="header">
      <image :src="user.avatar" class="avatar" />
      <view class="info">
        <text class="nickname">{{ user.nickname }}</text>
        <view class="credit-row">
          <text>信用分</text>
          <text class="credit-score">{{ user.creditScore }}</text>
          <credit-ring :score="user.creditScore" :max="200" size="40" />
        </view>
      </view>
    </view>
    
    <!-- 钱包卡片 -->
    <view class="wallet-card" @click="goWallet">
      <view class="wallet-row">
        <text class="label">可用余额</text>
        <text class="amount">¥{{ wallet.balance }}</text>
      </view>
      <view class="wallet-row">
        <text class="label">冻结中</text>
        <text class="frozen">¥{{ wallet.frozen }}</text>
      </view>
      <button class="withdraw-btn" @click.stop="goWithdraw">提现</button>
    </view>
    
    <!-- 订单 Tabs -->
    <view class="order-tabs">
      <view v-for="tab in tabs" :key="tab.status"
            :class="['tab', { active: currentTab === tab.status }]"
            @click="switchTab(tab.status)">
        {{ tab.label }}
        <text v-if="tab.count" class="badge">{{ tab.count }}</text>
      </view>
    </view>
    
    <!-- 订单列表 -->
    <order-card v-for="order in orders" :key="order.id" :order="order" />
    
    <!-- 设置入口 -->
    <view class="settings">
      <cell-item title="我的评价" icon="star" @click="goReviews" />
      <cell-item title="帮助中心" icon="help" @click="goHelp" />
      <cell-item title="联系客服" icon="service" @click="goChat" />
      <cell-item title="关于" icon="info" @click="goAbout" />
      <cell-item title="退出登录" icon="logout" @click="logout" />
    </view>
  </scroll-view>
</template>
```

### 2. 订单卡片组件 `components/order-card/index.vue`
```vue
<template>
  <view class="order-card" @click="$emit('click', order)">
    <view class="order-header">
      <text class="order-id">#{{ order.id }}</text>
      <text class="order-status" :style="{ color: statusColor }">{{ statusText }}</text>
    </view>
    <view class="order-body">
      <image v-if="order.task.images[0]" :src="order.task.images[0]" class="cover" />
      <view class="order-info">
        <text class="title">{{ order.task.title }}</text>
        <text class="price">¥{{ order.totalAmount }}</text>
        <text class="time">{{ formatTime(order.createdAt) }}</text>
      </view>
    </view>
    <view class="order-actions">
      <button v-if="showPay" @click.stop="pay">去支付</button>
      <button v-if="showCancel" @click.stop="cancel">取消</button>
      <button v-if="showConfirm" @click.stop="confirm">确认完成</button>
      <button v-if="showReview" @click.stop="goReview">去评价</button>
    </view>
  </view>
</template>
```

### 3. 设置页 `pages/user/settings.vue`
```vue
<template>
  <view class="settings-page">
    <cell-group title="账号">
      <cell-item title="手机号" :value="maskedPhone" @click="changePhone" />
      <cell-item title="修改密码" @click="changePassword" />
      <cell-item title="注销账号" danger @click="deleteAccount" />
    </cell-group>
    
    <cell-group title="通知">
      <switch-item title="订单状态推送" v-model="notifyOrder" />
      <switch-item title="优惠活动通知" v-model="notifyPromo" />
      <switch-item title="夜间免打扰" v-model="dndMode" />
    </cell-group>
    
    <cell-group title="隐私">
      <switch-item title="隐藏手机号" v-model="hidePhone" />
      <switch-item title="关闭位置历史" v-model="clearLocation" />
    </cell-group>
    
    <cell-group title="通用">
      <cell-item title="清除缓存" :value="cacheSize" @click="clearCache" />
      <cell-item title="意见反馈" @click="feedback" />
      <cell-item title="版本" :value="version" />
    </cell-group>
  </view>
</template>
```

### 4. 帮助者中心 `pages/helper/index.vue`
```vue
<template>
  <view class="helper-page">
    <!-- 今日数据 -->
    <view class="today-stats">
      <stat-item label="今日接单" :value="todayCount" />
      <stat-item label="今日收入" :value="'¥' + todayIncome" />
      <stat-item label="完成率" :value="completionRate + '%'" />
    </view>
    
    <!-- 附近待接单 -->
    <view class="section-title">附近待接单</view>
    <task-card v-for="t in nearbyTasks" :key="t.id" :task="t" compact />
    
    <!-- 我的接单 -->
    <view class="section-title">我的接单</view>
    <order-card v-for="o in myOrders" :key="o.id" :order="o" />
  </view>
</template>
```

### 5. 评价列表页 `pages/user/reviews.vue`
```vue
<template>
  <view class="reviews-page">
    <!-- 评分统计 -->
    <view class="rating-overview">
      <text class="big-score">{{ avgRating }}</text>
      <star-rating :value="avgRating" readonly />
      <text class="total">共 {{ reviews.length }} 条评价</text>
    </view>
    
    <!-- 标签统计 -->
    <view class="tag-cloud">
      <text v-for="tag in tagStats" :key="tag.name"
            :class="['tag', { hot: tag.count > 5 }]">
        {{ tag.name }} ({{ tag.count }})
      </text>
    </view>
    
    <!-- 评价列表 -->
    <review-item v-for="r in reviews" :key="r.id" :review="r" />
  </view>
</template>
```

### 6. 对应需求条目
#13, #18, #21, #22, #25, #31, #47, #95

## 验收标准
- [ ] 头像/昵称/信用分展示正确
- [ ] 钱包余额/冻结金额正确
- [ ] 订单 Tabs 切换正常
- [ ] 订单状态按钮权限正确
- [ ] 设置项持久化
- [ ] 评价列表展示正确
- [ ] 帮助者数据看板正确
- [ ] 退出登录清除 Token

## 参考文件
- `specs/01-auth.md` → 用户信息
- `specs/03-payment.md` → 钱包
- `.trae/memory.md` → 禁止事项
