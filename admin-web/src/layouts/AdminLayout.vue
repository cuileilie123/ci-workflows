<template>
  <el-container class="layout">
    <el-aside width="200px">
      <div class="logo">运营管理后台</div>
      <el-menu :default-active="$route.path" router>
        <el-menu-item index="/dashboard"><el-icon><DataAnalysis /></el-icon>数据看板</el-menu-item>
        <el-menu-item index="/users"><el-icon><User /></el-icon>用户管理</el-menu-item>
        <el-menu-item index="/orders"><el-icon><Document /></el-icon>订单管理</el-menu-item>
        <el-menu-item index="/finance-settings"><el-icon><Wallet /></el-icon>财务设置</el-menu-item>
        <el-menu-item index="/moderation"><el-icon><Warning /></el-icon>内容审核</el-menu-item>
        <el-menu-item index="/tickets"><el-icon><ChatDotRound /></el-icon>客服工单</el-menu-item>
        <el-menu-item index="/promotions"><el-icon><Present /></el-icon>活动配置</el-menu-item>
      </el-menu>
    </el-aside>
    <el-container>
      <el-header class="header">
        <span>{{ authStore.user?.username || '管理员' }}</span>
        <el-button @click="logout" type="danger" size="small">退出</el-button>
      </el-header>
      <el-main>
        <router-view />
      </el-main>
    </el-container>
  </el-container>
</template>

<script setup>
import { useAuthStore } from '../store/auth'
import { useRouter } from 'vue-router'

const authStore = useAuthStore()
const router = useRouter()

function logout() {
  authStore.logout()
  router.push('/login')
}
</script>

<style scoped>
.layout { min-height: 100vh; }
.logo {
  height: 60px;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: #409eff;
  color: #fff;
  font-size: 18px;
  font-weight: bold;
}
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background-color: #fff;
  border-bottom: 1px solid #e4e7ed;
}
</style>
