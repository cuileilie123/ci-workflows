<script setup lang="ts">
import { onLaunch, onShow, onHide } from '@dcloudio/uni-app';
import { useUserStore } from '@/store/user';
import { useChatStore } from '@/store/chat';
import { getAccessToken } from '@/utils/request';
import { getListenerCounts } from '@/utils/socket';

onLaunch(async () => {
  const userStore = useUserStore();
  const chatStore = useChatStore();

  // 监听强制登出（Token 刷新失败 / Refresh Token 过期）
  uni.$on('auth:expired', () => {
    chatStore.reset();
    userStore.clearLocal();
    uni.reLaunch({ url: '/pages/auth/login' });
  });

  // 启动鉴权：无 token 直接跳登录；有 token 则校验 /auth/me
  if (!getAccessToken()) {
    uni.reLaunch({ url: '/pages/auth/login' });
    return;
  }
  await userStore.restore();

  // 登录态恢复成功 → 初始化聊天服务
  if (userStore.isLoggedIn) {
    chatStore.init();
    chatStore.connect();
    chatStore.loadConversations().catch(() => {});
  }

  // 暴露调试函数到全局（供自动化测试使用）
  try {
    const app = getApp();
    if (app) {
      app.getListenerCounts = getListenerCounts;
    }
  } catch (_) { /* ignore */ }
});

onShow(() => {
  // 应用回到前台：恢复聊天连接
  const userStore = useUserStore();
  const chatStore = useChatStore();
  if (userStore.isLoggedIn) {
    chatStore.init();
    chatStore.connect();
  }
});

onHide(() => {
  // 应用进入后台：断开聊天连接（节省电量/服务器资源）
  const chatStore = useChatStore();
  chatStore.disconnect();
});
</script>

<style>
/* 全局样式在 uni.scss 中定义 */
</style>
