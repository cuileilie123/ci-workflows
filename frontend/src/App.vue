<script setup lang="ts">
import { onLaunch, onShow, onHide } from '@dcloudio/uni-app';
import { useUserStore } from '@/store/user';
import { getAccessToken } from '@/utils/request';

onLaunch(async () => {
  const userStore = useUserStore();

  // 监听强制登出（Token 刷新失败 / Refresh Token 过期）
  uni.$on('auth:expired', () => {
    userStore.clearLocal();
    uni.reLaunch({ url: '/pages/auth/login' });
  });

  // 启动鉴权：无 token 直接跳登录；有 token 则校验 /auth/me
  if (!getAccessToken()) {
    uni.reLaunch({ url: '/pages/auth/login' });
    return;
  }
  await userStore.restore();
});

onShow(() => {
  // 应用回到前台
});

onHide(() => {
  // 应用进入后台
});
</script>

<style>
/* 全局样式在 uni.scss 中定义 */
</style>
