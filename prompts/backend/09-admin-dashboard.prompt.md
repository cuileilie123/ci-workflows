---
name: admin-dashboard
description: 实现运营管理后台（Vue3+Element Plus + Spring Boot）
model: claude-4-sonnet
tags: [backend, admin, java]
depends_on: [task-service, review-credit, wallet-withdraw, risk-control]
---

# 任务：实现运营管理后台

## 目标
搭建 Web 端运营管理后台，支持数据看板、用户管理、订单管理、内容审核、客服工单、活动配置。

## 具体步骤

### 1. 后端（Java Spring Boot 3.x）

**项目结构：**
```
backend/admin-service/
├── src/main/java/com/nh/admin/
│   ├── controller/      # REST 控制器
│   ├── service/         # 业务逻辑
│   ├── repository/      # 数据访问
│   ├── model/           # 实体类
│   ├── dto/             # 传输对象
│   ├── config/          # 配置类
│   └── security/        # 鉴权
├── src/main/resources/
│   ├── application.yml
│   └── db/migration/    # Flyway 迁移脚本
├── pom.xml
└── Dockerfile
```

### 2. 管理员鉴权 `security/AdminAuthConfig.java`
```java
@Configuration
@EnableWebSecurity
@EnableMethodSecurity  // 方法级权限
public class AdminAuthConfig {
  
  @Bean
  public SecurityFilterChain filterChain(HttpSecurity http) {
    http
      .csrf(csrf -> csrf.disable())
      .sessionManagement(sm -> sm.sessionCreationPolicy(STATELESS))
      .authorizeHttpRequests(auth -> auth
        .requestMatchers("/api/v1/admin/auth/**").permitAll()
        .anyRequest().hasRole("ADMIN")
      )
      .addFilterBefore(jwtAuthFilter(), UsernamePasswordAuthenticationFilter.class);
    return http.build();
  }
}

// 角色注解
@GetMapping("/api/v1/admin/users")
@PreAuthorize("hasRole('SUPER_ADMIN')")
public PageResult<UserDTO> listUsers(@RequestParam int page) { ... }
```

### 3. 数据看板 `controller/DashboardController.java`
```java
@RestController
@RequestMapping("/api/v1/admin/dashboard")
public class DashboardController {
  
  @GetMapping("/realtime")
  public Map<String, Object> realtime() {
    // 实时数据：在线用户、今日订单、今日GMV
    return Map.of(
      "onlineUsers", redisTemplate.opsForSet().size("online:users"),
      "todayOrders", orderMapper.countToday(),
      "todayGmv", orderMapper.sumTodayGmv(),
      "todayNewUsers", userMapper.countToday()
    );
  }
  
  @GetMapping("/trend")
  public Map<String, Object> trend(
      @RequestParam @DateTimeFormat(iso = ISO.DATE) LocalDate start,
      @RequestParam @DateTimeFormat(iso = ISO.DATE) LocalDate end) {
    // DAU/MAU 趋势、GMV 曲线、留存漏斗
    return Map.of(
      "dau", analyticsService.dailyActiveUsers(start, end),
      "gmv", analyticsService.gmvTrend(start, end),
      "retention", analyticsService.retentionCohort(start, end)
    );
  }
  
  @GetMapping("/alerts")
  public List<AlertDTO> alerts() {
    // 异常告警：投诉激增、退款率飙升、风控拦截
    return alertService.getActiveAlerts();
  }
}
```

### 4. 用户管理 `controller/UserAdminController.java`
```java
@RestController
@RequestMapping("/api/v1/admin/users")
public class UserAdminController {
  
  @GetMapping
  public PageResult<UserDTO> search(
      @RequestParam(required = false) String keyword,
      @RequestParam(required = false) Integer minCredit,
      @RequestParam(required = false) String status,
      @RequestParam int page, @RequestParam int size) {
    return userService.searchAdmin(keyword, minCredit, status, page, size);
  }
  
  @PostMapping("/{id}/ban")
  @PreAuthorize("hasRole('SUPER_ADMIN')")
  public void banUser(@PathVariable Long id, @RequestBody BanRequest req) {
    userService.ban(id, req.getReason(), req.getDuration());
    auditLogService.log("BAN_USER", id, req.getReason());
  }
  
  @PutMapping("/{id}/credit")
  @PreAuthorize("hasRole('ADMIN')")
  public void adjustCredit(@PathVariable Long id, @RequestBody CreditAdjustDTO dto) {
    // 需要审批流（SUPER_ADMIN 确认）
    approvalService.createCreditAdjustment(id, dto, SecurityUtils.currentUser());
  }
  
  @GetMapping("/{id}/logs")
  public List<BehaviorLogDTO> behaviorLogs(@PathVariable Long id) {
    return logService.getUserLogs(id);
  }
}
```

### 5. 订单管理 `controller/OrderAdminController.java`
```java
@RestController
@RequestMapping("/api/v1/admin/orders")
public class OrderAdminController {
  
  @GetMapping
  public PageResult<OrderDTO> list(
      @RequestParam(required = false) String status,
      @RequestParam(required = false) String keyword,
      @RequestParam int page) {
    return orderService.adminSearch(status, keyword, page);
  }
  
  @PostMapping("/{id}/refund")
  public void forceRefund(@PathVariable Long id, @RequestBody RefundRequest req) {
    orderService.adminRefund(id, req.getReason());
  }
  
  @PostMapping("/{id}/cancel")
  public void cancelOrder(@PathVariable Long id, @RequestBody CancelRequest req) {
    orderService.adminCancel(id, req.getReason(), req.getCompensation());
  }
  
  @GetMapping("/export")
  public void export(HttpServletResponse response,
                      @RequestParam String startDate,
                      @RequestParam String endDate) {
    // 导出 CSV
    response.setContentType("text/csv");
    response.setHeader("Content-Disposition", "attachment; filename=orders.csv");
    orderService.exportCsv(response, startDate, endDate);
  }
}
```

### 6. 内容审核 `controller/ModerationController.java`
```java
@RestController
@RequestMapping("/api/v1/admin/moderation")
public class ModerationController {
  
  @GetMapping("/pending")
  public PageResult<ModerationItemDTO> pending(@RequestParam int page) {
    return moderationService.getPending(page);
  }
  
  @PostMapping("/{id}/approve")
  public void approve(@PathVariable Long id) {
    moderationService.approve(id);
  }
  
  @PostMapping("/{id}/reject")
  public void reject(@PathVariable Long id, @RequestBody RejectRequest req) {
    moderationService.reject(id, req.getReason());
    // 通知用户
    notificationService.send(userId, "内容审核未通过：" + req.getReason());
  }
  
  @GetMapping("/stats")
  public Map<String, Integer> stats() {
    return Map.of(
      "pending", moderationService.countPending(),
      "approved_today", moderationService.countApprovedToday(),
      "rejected_today", moderationService.countRejectedToday()
    );
  }
}
```

### 7. 客服工单 `controller/TicketController.java`
```java
@RestController
@RequestMapping("/api/v1/admin/tickets")
public class TicketController {
  
  @GetMapping
  public PageResult<TicketDTO> list(
      @RequestParam String status, // OPEN/IN_PROGRESS/RESOLVED/CLOSED
      @RequestParam int page) {
    return ticketService.list(status, page);
  }
  
  @PostMapping("/{id}/assign")
  public void assign(@PathVariable Long id, @RequestBody AssignRequest req) {
    ticketService.assign(id, req.getAdminId());
  }
  
  @PostMapping("/{id}/reply")
  public void reply(@PathVariable Long id, @RequestBody ReplyRequest req) {
    ticketService.reply(id, req.getMessage());
    // 通知用户
    notificationService.sendTicketUpdate(id);
  }
  
  @PostMapping("/{id}/close")
  public void close(@PathVariable Long id, @RequestBody CloseRequest req) {
    ticketService.close(id, req.getSatisfaction());
  }
}
```

### 8. 活动配置 `controller/PromotionController.java`
```java
@RestController
@RequestMapping("/api/v1/admin/promotions")
public class PromotionController {
  
  @GetMapping
  public List<PromotionDTO> list() {
    return promotionService.listActive();
  }
  
  @PostMapping
  public PromotionDTO create(@RequestBody CreatePromotionDTO dto) {
    return promotionService.create(dto);
  }
  
  @PutMapping("/{id}")
  public PromotionDTO update(@PathVariable Long id, @RequestBody UpdatePromotionDTO dto) {
    return promotionService.update(id, dto);
  }
  
  @DeleteMapping("/{id}")
  public void delete(@PathVariable Long id) {
    promotionService.delete(id);
  }
  
  @GetMapping("/ab-test")
  public Map<String, Object> abTestResults(@RequestParam String experimentId) {
    return analyticsService.getAbTestResults(experimentId);
  }
}
```

### 9. 前端（Vue 3 + Element Plus）
```
admin-web/
├── src/
│   ├── views/
│   │   ├── dashboard/       # 数据看板
│   │   ├── users/           # 用户管理
│   │   ├── orders/          # 订单管理
│   │   ├── moderation/      # 内容审核
│   │   ├── tickets/         # 客服工单
│   │   └── promotions/      # 活动配置
│   ├── components/          # 公共组件
│   ├── stores/              # Pinia
│   ├── router/              # 路由
│   ├── api/                 # 接口封装
│   └── layouts/             # 布局
├── package.json
└── vite.config.ts
```

### 10. 看板页面 `views/dashboard/index.vue`
```vue
<template>
  <div class="dashboard">
    <!-- 实时数据卡片 -->
    <el-row :gutter="20">
      <el-col :span="6"><stat-card title="在线用户" :value="realtime.onlineUsers" icon="User" /></el-col>
      <el-col :span="6"><stat-card title="今日订单" :value="realtime.todayOrders" icon="Document" /></el-col>
      <el-col :span="6"><stat-card title="今日GMV" :value="realtime.todayGmv" prefix="¥" icon="Money" /></el-col>
      <el-col :span="6"><stat-card title="新用户" :value="realtime.todayNewUsers" icon="Plus" /></el-col>
    </el-row>
    
    <!-- 趋势图表 -->
    <el-row :gutter="20" class="mt-20">
      <el-col :span="16"><dau-chart :data="trend.dau" /></el-col>
      <el-col :span="8"><gmv-chart :data="trend.gmv" /></el-col>
    </el-row>
    
    <!-- 告警列表 -->
    <el-row class="mt-20">
      <el-col :span="24">
        <alert-list :items="alerts" @resolve="resolveAlert" />
      </el-col>
    </el-row>
  </div>
</template>
```

### 11. Docker Compose 追加
```yaml
# 追加到 docker-compose.yml
admin-service:
  build: ./backend/admin-service
  container_name: nh-admin
  ports:
    - "8081:8081"
  environment:
    - DB_HOST=mysql
    - REDIS_HOST=redis
  depends_on:
    - mysql
    - redis

admin-web:
  build: ./admin-web
  container_name: nh-admin-web
  ports:
    - "3001:80"
  depends_on:
    - admin-service
```

## 验收标准
- [ ] 管理员登录（独立 JWT + 角色鉴权）
- [ ] 数据看板实时刷新（WebSocket 推送）
- [ ] 用户搜索/筛选/封禁/信用分调整
- [ ] 订单详情查看/手动退款/取消
- [ ] 内容审核队列（图片对比 + 批量操作）
- [ ] 客服工单流转（分配/回复/关闭/满意度）
- [ ] 活动 CRUD + AB 测试数据
- [ ] 数据导出 CSV 正常
- [ ] 审计日志记录完整
- [ ] Docker 部署成功

## 参考文件
- `specs/06-ops.md` → 全部章节
- `specs/05-risk.md` → 风控对接
- `.trae/memory.md` → 禁止事项 + 命名规范
