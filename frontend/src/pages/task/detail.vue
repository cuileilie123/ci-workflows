<template>
  <view class="detail-page">
    <!-- 加载中 -->
    <view v-if="loading && !task" class="state state-loading">
      <text class="state-text">加载中...</text>
    </view>

    <!-- 加载失败 -->
    <view v-else-if="error && !task" class="state state-error">
      <text class="state-text">{{ error }}</text>
      <button class="state-btn" size="mini" @click="loadDetail">重新加载</button>
    </view>

    <!-- 详情内容 -->
    <view v-else-if="task" class="content">
      <!-- 标题 + 价格 + 状态 -->
      <view class="header-card">
        <view class="title-row">
          <text class="title">{{ task.title }}</text>
          <text class="status-tag" :style="{ backgroundColor: statusConfig.color }">{{ statusConfig.label }}</text>
        </view>
        <view class="price-row">
          <text class="price">¥{{ task.price }}</text>
          <text class="category-tag">{{ categoryLabel }}</text>
          <text class="urgency-tag" :class="'urgency-' + task.urgency.toLowerCase()">{{ urgencyLabel }}</text>
        </view>
      </view>

      <!-- 发布者信息 -->
      <view class="publisher-card">
        <image v-if="task.publisher?.avatar" class="avatar" :src="task.publisher.avatar" mode="aspectFill" />
        <view v-else class="avatar avatar-ph">
          <text class="avatar-ph-text">{{ publisherInitial }}</text>
        </view>
        <view class="publisher-info">
          <text class="nickname">{{ task.publisher?.nickname || '邻居' }}</text>
          <text class="publish-time">{{ relativeTime }}</text>
        </view>
        <view class="view-count">
          <text class="view-text">{{ task.viewCount }} 次浏览</text>
        </view>
      </view>

      <!-- 任务描述 -->
      <view class="desc-card">
        <text class="card-label">任务描述</text>
        <text class="desc-text">{{ task.description }}</text>
      </view>

      <!-- 图片展示 -->
      <view v-if="task.images && task.images.length" class="images-card">
        <text class="card-label">任务图片</text>
        <view class="img-grid">
          <image
            v-for="(img, idx) in task.images"
            :key="idx"
            class="img"
            :src="img"
            mode="aspectFill"
            @click="onPreviewImage(idx)"
          />
        </view>
      </view>

      <!-- 位置卡片 -->
      <view v-if="task.address" class="location-card" @click="onOpenLocation">
        <view class="loc-icon-wrap">
          <text class="loc-icon">📍</text>
        </view>
        <view class="loc-info">
          <text class="loc-label">任务位置</text>
          <text class="loc-address">{{ task.address }}</text>
        </view>
        <text class="loc-arrow">›</text>
      </view>

      <!-- 状态时间线 -->
      <view class="timeline-card">
        <text class="card-label">任务进度</text>
        <view class="timeline">
          <view
            v-for="(node, idx) in timeline"
            :key="idx"
            class="tl-node"
            :class="{ 'tl-done': node.done, 'tl-last': idx === timeline.length - 1 }"
          >
            <view class="tl-dot" :class="{ 'dot-done': node.done }">
              <text v-if="node.done" class="dot-check">✓</text>
            </view>
            <view class="tl-content">
              <text class="tl-title" :class="{ 'tl-title-done': node.done }">{{ node.title }}</text>
              <text v-if="node.desc" class="tl-desc">{{ node.desc }}</text>
            </view>
          </view>
        </view>
      </view>

      <!-- 改价待确认卡片（仅发布者在 PRICE_PENDING 状态可见） -->
      <view v-if="isPublisher && task.status === 'PRICE_PENDING' && priceChange" class="price-change-card">
        <view class="pc-head">
          <text class="pc-icon">📝</text>
          <text class="pc-title">工作人员发起改价，请确认</text>
        </view>
        <view class="pc-row">
          <view class="pc-cell">
            <text class="pc-label">原价格</text>
            <text class="pc-value old">¥{{ priceChange.oldPrice.toFixed(2) }}</text>
          </view>
          <text class="pc-arrow">→</text>
          <view class="pc-cell">
            <text class="pc-label">新价格</text>
            <text class="pc-value new">¥{{ priceChange.newPrice.toFixed(2) }}</text>
          </view>
        </view>
        <view v-if="priceChange.reason" class="pc-reason">
          <text class="pc-reason-label">改价原因：</text>
          <text class="pc-reason-text">{{ priceChange.reason }}</text>
        </view>
        <view class="pc-diff-tip" :class="pcDiffClass">
          <text class="pc-diff-text">{{ pcDiffText }}</text>
        </view>
      </view>

      <!-- 退款状态卡片（发布者在退款处理中可见） -->
      <view v-if="isPublisher && refundInfo" class="refund-card" :class="'refund-' + refundInfo.status.toLowerCase()">
        <view class="rf-head">
          <text class="rf-icon">{{ refundIcon }}</text>
          <text class="rf-title">{{ refundTitle }}</text>
        </view>
        <view class="rf-amount-row">
          <text class="rf-label">退款金额</text>
          <text class="rf-amount">¥{{ refundInfo.amount.toFixed(2) }}</text>
        </view>
        <view class="rf-tip">
          <text class="rf-tip-text">{{ refundTipText }}</text>
        </view>
        <view v-if="refundInfo.requestedAt" class="rf-meta">
          <text class="rf-meta-text">申请时间：{{ formatRefundTime(refundInfo.requestedAt) }}</text>
        </view>
        <view v-if="refundInfo.processedAt" class="rf-meta">
          <text class="rf-meta-text">处理时间：{{ formatRefundTime(refundInfo.processedAt) }}</text>
        </view>
        <view v-if="refundInfo.failReason" class="rf-meta">
          <text class="rf-meta-text rf-fail">失败原因：{{ refundInfo.failReason }}</text>
        </view>
      </view>
    </view>

    <!-- 底部操作栏 -->
    <view v-if="task && actions.length" class="action-bar">
      <button
        v-for="act in actions"
        :key="act.key"
        class="action-btn"
        :class="act.cls"
        :disabled="!!acting"
        @click="onAction(act)"
      >
        {{ acting && acting === act.key ? '处理中...' : act.label }}
      </button>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { onLoad, onShow, onShareAppMessage, onShareTimeline } from '@dcloudio/uni-app';
import { taskApi, paymentApi } from '@/api';
import { priceChangeApi } from '@/api/admin';
import { payForTask } from '@/utils/payment';
import { useUserStore } from '@/store/user';
import { TASK_CATEGORY_LABELS } from '@/types';
import type { Task, TaskStatus, PendingPriceChange, RefundRequestInfo } from '@/types';
import { tracker, EVENTS } from '@/utils/track';
import { requireVerification } from '@/utils/verification';
import { subscribeOnOrderCreate, subscribeOnOrderComplete } from '@/utils/subscribe';

const userStore = useUserStore();

const task = ref<Task | null>(null);
const loading = ref(false);
const error = ref('');
const acting = ref(''); // 正在处理的 action key
const priceChange = ref<PendingPriceChange | null>(null);
const refundInfo = ref<RefundRequestInfo | null>(null);
const relatedOrderId = ref<string | null>(null);

const statusConfigMap: Record<TaskStatus, { label: string; color: string }> = {
  OPEN: { label: '已报价', color: '#FF9500' },
  ASSIGNED: { label: '待支付', color: '#007AFF' },
  IN_PROGRESS: { label: '进行中', color: '#34C759' },
  COMPLETED: { label: '已完成', color: '#8E8E93' },
  CANCELLED: { label: '已取消', color: '#8E8E93' },
  PRICE_PENDING: { label: '改价待确认', color: '#9C27B0' },
  EXPIRED: { label: '已超时', color: '#FF3B30' },
};

const statusConfig = computed(() => statusConfigMap[task.value?.status ?? 'OPEN']);
const categoryLabel = computed(() => {
  const cat = task.value?.category;
  return cat ? TASK_CATEGORY_LABELS[cat] : '';
});

const urgencyLabel = computed(() => {
  const urgency = task.value?.urgency;
  const labels: Record<string, string> = {
    'LOW': '低',
    'NORMAL': '一般',
    'HIGH': '紧急',
    'URGENT': '非常紧急'
  };
  return labels[urgency as string] || '';
});

const isPublisher = computed(() => {
  const me = userStore.userInfo?.id;
  return !!(me && task.value && String(task.value.publisherId) === String(me));
});

const isHelper = computed(() => {
  const me = userStore.userInfo?.id;
  return !!(me && task.value?.helperId && String(task.value.helperId) === String(me));
});

const publisherInitial = computed(() => {
  const n = task.value?.publisher?.nickname || '邻';
  return n.slice(0, 1);
});

// 改价差额相关
const pcDiff = computed(() => {
  if (!priceChange.value) return 0;
  return priceChange.value.newPrice - priceChange.value.oldPrice;
});

const pcDiffClass = computed(() => {
  if (pcDiff.value > 0) return 'up';
  if (pcDiff.value < 0) return 'down';
  return '';
});

const pcDiffText = computed(() => {
  if (pcDiff.value === 0) return '价格未变化';
  const sign = pcDiff.value > 0 ? '+' : '';
  return `差额 ${sign}¥${pcDiff.value.toFixed(2)}（${pcDiff.value > 0 ? '确认后需补差支付' : '确认后将退回差额'}）`;
});

// ---- 退款状态展示 ----
const refundIcon = computed(() => {
  const s = refundInfo.value?.status;
  if (s === 'COMPLETED') return '✅';
  if (s === 'PROCESSING') return '⏳';
  if (s === 'FAILED') return '⚠️';
  return '💰';
});

const refundTitle = computed(() => {
  const s = refundInfo.value?.status;
  if (s === 'COMPLETED') return '退款已完成';
  if (s === 'PROCESSING') return '退款处理中';
  if (s === 'FAILED') return '退款失败';
  return '退款申请已提交';
});

const refundTipText = computed(() => {
  const s = refundInfo.value?.status;
  if (s === 'COMPLETED') return '退款已原路退回到您的微信钱包或银行卡，请注意查收。';
  if (s === 'PROCESSING') return '系统正在处理退款，预计 24 小时内原路退回。';
  if (s === 'FAILED') return '退款处理失败，请稍后重试或联系客服。';
  return '已支付金额将在 24 小时内原路退回到您的微信钱包或银行卡。';
});

function formatRefundTime(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const relativeTime = computed(() => {
  if (!task.value?.createdAt) return '';
  const diff = Date.now() - new Date(task.value.createdAt).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} 天前`;
  return new Date(task.value.createdAt).toLocaleDateString();
});

// 时间线节点
const timeline = computed(() => {
  if (!task.value) return [];
  const s = task.value.status;
  return [
    { title: '发布任务', desc: relativeTime.value, done: true },
    { title: '接单', desc: s === 'OPEN' ? '等待接单' : s === 'EXPIRED' ? '超时未接单' : '已接单', done: s !== 'OPEN' && s !== 'CANCELLED' && s !== 'EXPIRED' },
    { title: '支付', desc: ['ASSIGNED', 'IN_PROGRESS', 'COMPLETED'].includes(s) ? '已支付' : '待支付', done: ['IN_PROGRESS', 'COMPLETED'].includes(s) },
    { title: '开始服务', desc: ['IN_PROGRESS', 'COMPLETED'].includes(s) ? '进行中' : '待开始', done: ['IN_PROGRESS', 'COMPLETED'].includes(s) },
    { title: '完成', desc: s === 'COMPLETED' ? '已完成' : '待完成', done: s === 'COMPLETED' },
  ];
});

// 底部操作按钮（按角色 + 状态）
interface ActionItem {
  key: string;
  label: string;
  cls: string;
}

const actions = computed<ActionItem[]>(() => {
  if (!task.value) return [];
  const s = task.value.status;
  const list: ActionItem[] = [];
  const canContact = isPublisher.value || isHelper.value;
  // 联系TA（相关方可见）
  if (canContact && s !== 'CANCELLED' && s !== 'COMPLETED' && s !== 'EXPIRED') {
    list.push({ key: 'contact', label: '联系TA', cls: 'btn-secondary' });
  }
  if (s === 'OPEN') {
    if (isPublisher.value) {
      list.push({ key: 'cancel', label: '取消任务', cls: 'btn-danger' });
    } else {
      list.push({ key: 'accept', label: '我要接单', cls: 'btn-primary' });
    }
  } else if (s === 'ASSIGNED') {
    if (isPublisher.value) {
      list.push({ key: 'pay', label: '去支付', cls: 'btn-primary' });
    }
    if (isHelper.value) {
      list.push({ key: 'waitPay', label: '等待支付', cls: 'btn-secondary' });
    }
  } else if (s === 'IN_PROGRESS') {
    if (isPublisher.value) {
      list.push({ key: 'complete', label: '确认完成', cls: 'btn-primary' });
      list.push({ key: 'refund', label: '申请退款', cls: 'btn-danger' });
    }
  } else if (s === 'EXPIRED') {
    // 超时无人接单：发布者可申请退款（已支付金额原路退回）
    if (isPublisher.value) {
      list.push({ key: 'refund', label: '申请退款', cls: 'btn-danger' });
    }
  } else if (s === 'PRICE_PENDING') {
    if (isPublisher.value) {
      list.push({ key: 'rejectPrice', label: '拒绝改价', cls: 'btn-danger' });
      list.push({ key: 'confirmPrice', label: '确认改价', cls: 'btn-primary' });
    }
  }
  return list;
});

let taskId = '';

async function loadDetail(): Promise<void> {
  if (!taskId) return;
  loading.value = true;
  error.value = '';
  try {
    task.value = await taskApi.detail(taskId);

    // 埋点：任务详情查看
    tracker.track(EVENTS.TASK_CLICK, {
      taskId: taskId,
      userId: userStore.userInfo?.id,
      price: task.value?.price
    });

    // 如果是改价待确认状态，加载改价详情
    if (task.value?.status === 'PRICE_PENDING') {
      await loadPriceChange();
    } else {
      priceChange.value = null;
    }

    // 加载退款状态（发布者在 EXPIRED / IN_PROGRESS / CANCELLED 状态可能存在退款）
    await loadRefundInfo();
  } catch (e) {
    error.value = (e as Error).message || '加载失败';

    // 埋点：加载失败
    tracker.track(EVENTS.TASK_CLICK, {
      taskId: taskId,
      userId: userStore.userInfo?.id,
      status: 'failed',
      error: (e as Error).message
    });
  } finally {
    loading.value = false;
  }
}

// 加载退款状态：先找关联订单，再查退款申请
async function loadRefundInfo(): Promise<void> {
  refundInfo.value = null;
  relatedOrderId.value = null;
  if (!task.value || !isPublisher.value) return;
  // 仅在可能存在退款的状态下查询
  const s = task.value.status;
  if (!['EXPIRED', 'IN_PROGRESS', 'CANCELLED'].includes(s)) return;
  try {
    const orders = await paymentApi.getUserOrders();
    const taskIdStr = String(taskId);
    const matched = orders
      .filter((o) => {
        if ((o as any).taskId) return String((o as any).taskId) === taskIdStr;
        return o.taskTitle === task.value?.title;
      })
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    const targetOrder = matched[0];
    if (!targetOrder) return;
    relatedOrderId.value = targetOrder.id;
    const info = await paymentApi.getRefundStatus(targetOrder.id);
    // 仅在存在退款申请时展示（status=NONE 表示无退款申请）
    if (info && info.status !== 'NONE') {
      refundInfo.value = info;
    }
  } catch {
    refundInfo.value = null;
  }
}

async function loadPriceChange(): Promise<void> {
  try {
    const list = await priceChangeApi.listPending();
    priceChange.value = list.find((p) => p.taskId === String(taskId)) ?? null;
  } catch {
    priceChange.value = null;
  }
}

// ---- 操作处理 ----
async function onAction(act: ActionItem): Promise<void> {
  if (acting.value) return;
  const map: Record<string, () => Promise<void>> = {
    accept: doAccept,
    pay: doPay,
    waitPay: doWaitPay,
    complete: doComplete,
    refund: doRefund,
    cancel: doCancel,
    contact: doContact,
    confirmPrice: doConfirmPrice,
    rejectPrice: doRejectPrice,
  };
  const fn = map[act.key];
  if (!fn) return;
  acting.value = act.key;
  try {
    await fn();
  } finally {
    acting.value = '';
  }
}

function confirm(title: string, content: string): Promise<boolean> {
  return new Promise((resolve) => {
    uni.showModal({
      title,
      content,
      success: (r) => resolve(!!r.confirm),
      fail: () => resolve(false),
    });
  });
}

async function doAccept(): Promise<void> {
  // 前置校验：须完成手机号绑定、银行卡绑定、实名认证
  const verified = await requireVerification('接单');
  if (!verified) return;

  const ok = await confirm('确认接单', '接单后需按要求完成任务，确定接单吗？');
  if (!ok) return;
  try {
    await taskApi.accept(taskId);
    uni.showToast({ title: '接单成功', icon: 'success' });
    await loadDetail();
    
    // 埋点：接单事件
    tracker.track(EVENTS.ORDER_ACCEPT, { 
      taskId: taskId,
      userId: userStore.userInfo?.id
    });
    
    // 订阅订单状态变更
    subscribeOnOrderCreate();
  } catch (e) {
    uni.showToast({ title: (e as Error).message || '接单失败', icon: 'none' });
    // 埋点：接单失败事件
    tracker.track(EVENTS.ORDER_ACCEPT, { 
      taskId: taskId,
      userId: userStore.userInfo?.id,
      status: 'failed',
      error: (e as Error).message
    });
  }
}

async function doPay(): Promise<void> {
  const ok = await confirm('确认支付', `确认支付 ¥${task.value?.price} 接单报酬吗？`);
  if (!ok) return;
  try {
    const orderId = await payForTask(taskId);
    if (orderId) {
      uni.showToast({ title: '支付成功', icon: 'success' });
      // 跳转到订单详情页
      uni.navigateTo({ url: `/pages/order/detail?id=${orderId}` });
      
      // 埋点：支付成功事件
      tracker.track(EVENTS.PAY_SUCCESS, { 
        taskId: taskId,
        orderId: orderId,
        amount: task.value?.price,
        userId: userStore.userInfo?.id
      });
      
      // 订阅支付提醒和评价提醒
      subscribeOnOrderCreate();
    } else {
      uni.showToast({ title: '已取消支付', icon: 'none' });
      
      // 埋点：支付取消事件
      tracker.track(EVENTS.PAY_FAIL, { 
        taskId: taskId,
        reason: 'user_cancelled',
        userId: userStore.userInfo?.id
      });
    }
    await loadDetail();
  } catch (e) {
    uni.showToast({ title: (e as Error).message || '支付失败', icon: 'none' });
    
    // 埋点：支付失败事件
    tracker.track(EVENTS.PAY_FAIL, { 
      taskId: taskId,
      error: (e as Error).message,
      userId: userStore.userInfo?.id
    });
  }
}

async function doWaitPay(): Promise<void> {
  uni.showToast({ title: '请等待发布者支付', icon: 'none' });
}

async function doRefund(): Promise<void> {
  if (!task.value) return;
  const ok = await confirm(
    '申请退款',
    '确认申请退款吗？已支付金额将在 24 小时内原路退回到您的微信钱包或银行卡。',
  );
  if (!ok) return;
  try {
    // 优先使用已加载的关联订单 ID，否则查询用户订单匹配
    let orderId = relatedOrderId.value;
    if (!orderId) {
      const orders = await paymentApi.getUserOrders();
      const taskIdStr = String(taskId);
      const matched = orders
        .filter((o) => {
          if ((o as any).taskId) return String((o as any).taskId) === taskIdStr;
          return o.taskTitle === task.value?.title;
        })
        .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      orderId = matched[0]?.id;
    }
    if (!orderId) {
      throw new Error('未找到关联订单，无法退款');
    }
    // 使用新的 24h 原路退回接口
    const res = await paymentApi.requestRefund(orderId, '用户申请退款');
    uni.showToast({ title: res.message || '退款申请已提交', icon: 'none' });
    await loadDetail();
  } catch (e) {
    uni.showToast({ title: (e as Error).message || '退款失败', icon: 'none' });
  }
}

async function doComplete(): Promise<void> {
  const ok = await confirm('确认完成', '确认任务已完成？完成后将结算报酬。');
  if (!ok) return;
  try {
    await taskApi.complete(taskId);
    uni.showToast({ title: '任务已完成', icon: 'success' });
    await loadDetail();
    
    // 埋点：任务完成事件
    tracker.track(EVENTS.ORDER_COMPLETE, { 
      taskId: taskId,
      userId: userStore.userInfo?.id
    });
    
    // 订阅评价提醒
    subscribeOnOrderComplete();
  } catch (e) {
    uni.showToast({ title: (e as Error).message || '操作失败', icon: 'none' });
    
    // 埋点：任务完成失败事件
    tracker.track(EVENTS.ORDER_COMPLETE, { 
      taskId: taskId,
      userId: userStore.userInfo?.id,
      status: 'failed',
      error: (e as Error).message
    });
  }
}

async function doCancel(): Promise<void> {
  const ok = await confirm('取消任务', '取消后任务将无法恢复，确定取消吗？');
  if (!ok) return;
  try {
    const result = await taskApi.cancel(taskId);
    // 若有关联已支付订单，提示用户申请退款（24h 内原路退回）
    if (result.hasPaidOrder && result.orderId) {
      uni.showToast({ title: '任务已取消', icon: 'success' });
      const refundOk = await confirm(
        '申请退款',
        '检测到该任务有关联的已支付订单，是否申请退款？已支付金额将在 24 小时内原路退回到您的微信钱包或银行卡。',
      );
      if (refundOk) {
        try {
          const res = await paymentApi.requestRefund(result.orderId, '用户取消任务并申请退款');
          uni.showToast({ title: res.message || '退款申请已提交', icon: 'none' });
        } catch (e) {
          uni.showToast({ title: (e as Error).message || '退款申请失败', icon: 'none' });
        }
      }
    } else {
      uni.showToast({ title: '已取消', icon: 'success' });
    }
    await loadDetail();
  } catch (e) {
    uni.showToast({ title: (e as Error).message || '取消失败', icon: 'none' });
  }
}

async function doContact(): Promise<void> {
  if (!task.value) return;
  const peerId = isPublisher.value ? task.value.helperId : task.value.publisherId;
  if (!peerId) {
    uni.showToast({ title: '对方尚未接单', icon: 'none' });
    return;
  }
  const peerNickname = isPublisher.value
    ? ''
    : task.value.publisher?.nickname ?? '邻居';
  const peerAvatar = isPublisher.value
    ? ''
    : task.value.publisher?.avatar ?? '';
  uni.navigateTo({
    url: `/pages/chat/chat?peerId=${peerId}&peerNickname=${encodeURIComponent(peerNickname)}&peerAvatar=${encodeURIComponent(peerAvatar)}`,
  });
}

async function doConfirmPrice(): Promise<void> {
  if (!priceChange.value) return;
  const diff = pcDiff.value;
  const tip =
    diff > 0
      ? `确认改价？确认后需补差额 ¥${diff.toFixed(2)}，订单将重新进入待接单。`
      : diff < 0
        ? `确认改价？确认后将退回差额 ¥${Math.abs(diff).toFixed(2)}，订单将重新进入待接单。`
        : '确认改价？订单将重新进入待接单。';
  const ok = await confirm('确认改价', tip);
  if (!ok) return;
  try {
    const res = await priceChangeApi.confirm(taskId);
    const msg =
      res.settlement === 'SUPPLEMENT_PENDING'
        ? '已确认，请完成补差支付'
        : res.settlement === 'REFUNDED'
          ? '已确认，差额已退回钱包'
          : '已确认改价';
    uni.showToast({ title: msg, icon: 'success' });
    await loadDetail();
  } catch (e) {
    uni.showToast({ title: (e as Error).message || '确认失败', icon: 'none' });
  }
}

async function doRejectPrice(): Promise<void> {
  const ok = await confirm('拒绝改价', '拒绝后订单将恢复原价格与状态，确定拒绝吗？');
  if (!ok) return;
  try {
    await priceChangeApi.reject(taskId);
    uni.showToast({ title: '已拒绝改价', icon: 'success' });
    await loadDetail();
  } catch (e) {
    uni.showToast({ title: (e as Error).message || '操作失败', icon: 'none' });
  }
}

// ---- 图片预览 ----
function onPreviewImage(idx: number): void {
  if (!task.value?.images?.length) return;
  uni.previewImage({
    urls: task.value.images,
    current: task.value.images[idx],
  });
}

// ---- 地图 ----
function onOpenLocation(): void {
  if (!task.value) return;
  uni.openLocation({
    latitude: task.value.lat,
    longitude: task.value.lng,
    name: task.value.title,
    address: task.value.address,
    fail: () => {
      uni.showToast({ title: '打开地图失败', icon: 'none' });
    },
  });
}

// 接收页面参数
onLoad((options) => {
  taskId = (options as { id?: string })?.id || '';
});

// 分享给好友
onShareAppMessage(() => {
  tracker.track(EVENTS.SHARE_CLICK, {
    page: 'task_detail',
    taskId: taskId,
    shareType: 'friend'
  });

  return {
    title: task.value?.title || '邻里互助',
    path: `/pages/task/detail?id=${taskId}&ref=${userStore.userInfo?.id || ''}`,
    imageUrl: task.value?.images?.[0] || '/static/logo.png',
    desc: `悬赏 ¥${task.value?.price} · ${task.value?.address || '未知位置'}`
  };
});

// 分享到朋友圈
onShareTimeline(() => {
  tracker.track(EVENTS.SHARE_CLICK, {
    page: 'task_detail',
    taskId: taskId,
    shareType: 'timeline'
  });

  return {
    title: `【邻里互助】${task.value?.title || '邻里互助'} - ¥${task.value?.price}`,
    query: `id=${taskId}&ref=${userStore.userInfo?.id || ''}`,
    imageUrl: task.value?.images?.[0] || '/static/logo.png'
  };
});

// 页面显示时刷新数据并埋点（保留唯一的 onShow 钩子避免重复请求）
onShow(() => {
  loadDetail();
  tracker.track(EVENTS.PAGE_VIEW, { 
    page: 'task_detail',
    taskId: taskId
  });
});
</script>

<style lang="scss" scoped>
.detail-page {
  min-height: 100vh;
  padding: 24rpx 24rpx 160rpx;
  background-color: #f8f8f8;
}

.state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding-top: 200rpx;
  gap: 24rpx;
}

.state-text {
  font-size: 28rpx;
  color: #999;
}

.state-btn {
  background-color: #4caf50;
  color: #fff;
}

.content {
  display: flex;
  flex-direction: column;
  gap: 20rpx;
}

.header-card,
.publisher-card,
.desc-card,
.images-card,
.location-card,
.timeline-card {
  background-color: #fff;
  border-radius: 20rpx;
  padding: 28rpx;
  box-shadow: 0 2rpx 16rpx rgba(0, 0, 0, 0.04);
}

.title-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16rpx;
}

.title {
  flex: 1;
  font-size: 36rpx;
  font-weight: 600;
  color: #222;
  line-height: 1.4;
}

.status-tag {
  flex-shrink: 0;
  font-size: 22rpx;
  color: #fff;
  padding: 6rpx 16rpx;
  border-radius: 20rpx;
}

.price-row {
  display: flex;
  align-items: center;
  gap: 16rpx;
  margin-top: 16rpx;
}

.price {
  font-size: 40rpx;
  font-weight: 700;
  color: #e53935;
}

.category-tag {
  font-size: 24rpx;
  color: #666;
  background-color: #f0f0f0;
  padding: 4rpx 16rpx;
  border-radius: 16rpx;
}

.urgency-tag {
  font-size: 24rpx;
  color: #fff;
  padding: 4rpx 16rpx;
  border-radius: 16rpx;
  margin-left: 8rpx;
}

.urgency-low {
  background-color: #4CAF50;
}

.urgency-normal {
  background-color: #2196F3;
}

.urgency-high {
  background-color: #FF9800;
}

.urgency-urgent {
  background-color: #F44336;
}

.publisher-card {
  display: flex;
  align-items: center;
  gap: 20rpx;
}

.avatar {
  width: 80rpx;
  height: 80rpx;
  border-radius: 50%;
  flex-shrink: 0;
}

.avatar-ph {
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: #4caf50;
}

.avatar-ph-text {
  color: #fff;
  font-size: 32rpx;
}

.publisher-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6rpx;
}

.nickname {
  font-size: 28rpx;
  color: #333;
  font-weight: 500;
}

.publish-time {
  font-size: 24rpx;
  color: #999;
}

.view-count {
  flex-shrink: 0;
}

.view-text {
  font-size: 24rpx;
  color: #999;
}

.card-label {
  display: block;
  font-size: 26rpx;
  color: #888;
  margin-bottom: 16rpx;
}

.desc-text {
  font-size: 30rpx;
  color: #333;
  line-height: 1.7;
  white-space: pre-wrap;
}

.img-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
}

.img {
  width: 218rpx;
  height: 218rpx;
  border-radius: 12rpx;
}

.location-card {
  display: flex;
  align-items: center;
  gap: 16rpx;
}

.loc-icon-wrap {
  width: 64rpx;
  height: 64rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: #e8f5e9;
  border-radius: 50%;
  flex-shrink: 0;
}

.loc-icon {
  font-size: 32rpx;
}

.loc-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6rpx;
}

.loc-label {
  font-size: 24rpx;
  color: #888;
}

.loc-address {
  font-size: 28rpx;
  color: #333;
}

.loc-arrow {
  color: #bbb;
  font-size: 40rpx;
}

.timeline {
  display: flex;
  flex-direction: column;
}

.tl-node {
  display: flex;
  align-items: flex-start;
  gap: 20rpx;
  padding-bottom: 32rpx;
  position: relative;
}

.tl-node:not(.tl-last)::before {
  content: '';
  position: absolute;
  left: 15rpx;
  top: 40rpx;
  bottom: 0;
  width: 2rpx;
  background-color: #e0e0e0;
}

.tl-dot {
  width: 32rpx;
  height: 32rpx;
  border-radius: 50%;
  border: 2rpx solid #ddd;
  background-color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  z-index: 1;
}

.dot-done {
  background-color: #4caf50;
  border-color: #4caf50;
}

.dot-check {
  color: #fff;
  font-size: 20rpx;
  font-weight: 700;
}

.tl-content {
  display: flex;
  flex-direction: column;
  gap: 4rpx;
  padding-top: 2rpx;
}

.tl-title {
  font-size: 28rpx;
  color: #999;
}

.tl-title-done {
  color: #333;
  font-weight: 500;
}

.tl-desc {
  font-size: 24rpx;
  color: #aaa;
}

.action-bar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  gap: 16rpx;
  padding: 20rpx 24rpx;
  padding-bottom: calc(20rpx + env(safe-area-inset-bottom));
  background-color: #fff;
  box-shadow: 0 -2rpx 16rpx rgba(0, 0, 0, 0.06);
}

.action-btn {
  flex: 1;
  height: 88rpx;
  line-height: 88rpx;
  font-size: 30rpx;
  border-radius: 44rpx;
  margin: 0;

  &::after {
    border: none;
  }

  &[disabled] {
    opacity: 0.6;
  }
}

.btn-primary {
  background: #4caf50;
  background: linear-gradient(135deg, #4caf50, #2e7d32);
  color: #fff;
  box-shadow: 0 4rpx 12rpx rgba(76, 175, 80, 0.3);
  position: relative;
  overflow: hidden;
  -webkit-tap-highlight-color: transparent;
}

.btn-primary::before {
  content: '';
  position: absolute;
  top: 0;
  left: -100%;
  width: 100%;
  height: 100%;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.2), transparent);
  transition: left 0.5s;
}

.btn-primary:active::before,
.btn-primary.pressed::before {
  left: 100%;
}

/* 为触摸设备添加兼容性 */
.btn-primary:active {
  transform: scale(0.98);
  transition: transform 0.1s;
}

.btn-secondary {
  background-color: #f0f0f0;
  color: #333;
}

.btn-danger {
  background-color: #fff;
  color: #e53935;
  border: 1rpx solid #e53935;
}

// 改价待确认卡片
.price-change-card {
  background-color: #fff;
  border-radius: 20rpx;
  padding: 28rpx;
  border-left: 8rpx solid #9c27b0;
  box-shadow: 0 2rpx 16rpx rgba(0, 0, 0, 0.04);
}

.pc-head {
  display: flex;
  align-items: center;
  gap: 12rpx;
  margin-bottom: 20rpx;
}

.pc-icon {
  font-size: 36rpx;
}

.pc-title {
  font-size: 30rpx;
  font-weight: 600;
  color: #9c27b0;
}

.pc-row {
  display: flex;
  align-items: center;
  justify-content: space-around;
  padding: 20rpx 0;
  background-color: #faf5fb;
  border-radius: 12rpx;
}

.pc-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8rpx;
}

.pc-label {
  font-size: 24rpx;
  color: #888;
}

.pc-value {
  font-size: 36rpx;
  font-weight: 700;

  &.old {
    color: #999;
    text-decoration: line-through;
  }

  &.new {
    color: #e53935;
  }
}

.pc-arrow {
  font-size: 36rpx;
  color: #9c27b0;
}

.pc-reason {
  margin-top: 16rpx;
  padding: 16rpx;
  background-color: #f5f5f5;
  border-radius: 12rpx;
}

.pc-reason-label {
  font-size: 24rpx;
  color: #888;
}

.pc-reason-text {
  font-size: 26rpx;
  color: #555;
}

.pc-diff-tip {
  margin-top: 16rpx;
  padding: 16rpx 20rpx;
  border-radius: 12rpx;
  background-color: #f0f0f0;

  &.up {
    background-color: #fff3e0;
  }

  &.down {
    background-color: #e8f5e9;
  }
}

.pc-diff-text {
  font-size: 26rpx;
  color: #333;
}

// 退款状态卡片
.refund-card {
  background-color: #fff;
  border-radius: 20rpx;
  padding: 28rpx;
  border-left: 8rpx solid #FF9500;
  box-shadow: 0 2rpx 16rpx rgba(0, 0, 0, 0.04);
}

.refund-card.refund-completed {
  border-left-color: #34C759;
}

.refund-card.refund-processing {
  border-left-color: #007AFF;
}

.refund-card.refund-failed {
  border-left-color: #FF3B30;
}

.rf-head {
  display: flex;
  align-items: center;
  gap: 12rpx;
  margin-bottom: 20rpx;
}

.rf-icon {
  font-size: 36rpx;
}

.rf-title {
  font-size: 30rpx;
  font-weight: 600;
  color: #333;
}

.rf-amount-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20rpx;
  background-color: #fff8e1;
  border-radius: 12rpx;
  margin-bottom: 16rpx;
}

.refund-completed .rf-amount-row {
  background-color: #e8f5e9;
}

.refund-failed .rf-amount-row {
  background-color: #ffebee;
}

.rf-label {
  font-size: 26rpx;
  color: #888;
}

.rf-amount {
  font-size: 36rpx;
  font-weight: 700;
  color: #e53935;
}

.rf-tip {
  padding: 16rpx;
  background-color: #f5f5f5;
  border-radius: 12rpx;
  margin-bottom: 12rpx;
}

.rf-tip-text {
  font-size: 26rpx;
  color: #555;
  line-height: 1.6;
}

.rf-meta {
  margin-top: 8rpx;
}

.rf-meta-text {
  font-size: 24rpx;
  color: #999;
}

.rf-meta-text.rf-fail {
  color: #FF3B30;
}
</style>
