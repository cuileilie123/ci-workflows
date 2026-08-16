<template>
  <div class="dashboard">
    <el-row :gutter="20">
      <el-col :span="6">
        <el-card><el-statistic title="在线用户" :value="realtime.onlineUsers" /></el-card>
      </el-col>
      <el-col :span="6">
        <el-card><el-statistic title="今日订单" :value="realtime.todayOrders" /></el-card>
      </el-col>
      <el-col :span="6">
        <el-card><el-statistic title="今日GMV" :value="realtime.todayGmv" prefix="¥" /></el-card>
      </el-col>
      <el-col :span="6">
        <el-card><el-statistic title="新用户" :value="realtime.todayNewUsers" /></el-card>
      </el-col>
    </el-row>
    <el-empty description="图表功能待对接数据分析服务" style="margin-top: 40px" />
  </div>
</template>

<script setup>
import { ref } from 'vue'
const realtime = ref({ onlineUsers: 0, todayOrders: 0, todayGmv: 0, todayNewUsers: 0 })
</script>
