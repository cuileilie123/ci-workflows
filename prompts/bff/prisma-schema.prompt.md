---
name: prisma-schema
description: 创建完整 Prisma Schema（全部数据模型+迁移）
model: claude-4-sonnet
tags: [bff, database]
depends_on: [nestjs-init]
---

# 任务：创建完整 Prisma Schema

## 目标
定义全部数据模型并生成迁移脚本。

## Prisma Schema `src/prisma/schema.prisma`

```prisma
// ============================================================
// 社区邻里有偿互助平台 - 完整数据模型
// ============================================================

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "mysql"
  url      = env("DATABASE_URL")
}

// ===== 用户 =====
model User {
  id           BigInt    @id @default(autoincrement())
  openid       String    @unique @map("openid")
  phone        String?   @db.VarChar(20)
  nickname     String    @db.VarChar(64)
  avatar       String?   @db.VarChar(512)
  creditScore  Int       @default(100) @map("credit_score")
  role         Role      @default(USER)
  status       UserStatus @default(ACTIVE)
  deviceFp     String?   @map("device_fp") @db.VarChar(64)
  createdAt    DateTime  @default(now()) @map("created_at")
  updatedAt    DateTime  @updatedAt @map("updated_at")
  deletedAt    DateTime? @map("deleted_at")

  // 关系
  publishedTasks  Task[]    @relation("Publisher")
  acceptedTasks   Task[]    @relation("Helper")
  wallet          Wallet?
  sentReviews     Review[]  @relation("Reviewer")
  receivedReviews Review[]  @relation("Reviewee")
  orders          Order[]   @relation("HelperOrders")

  @@index([creditScore])
  @@index([role])
  @@index([status])
  @@map("users")
}

enum Role {
  USER
  HELPER
  ADMIN
}

enum UserStatus {
  ACTIVE
  BANNED
  SUSPENDED
}

// ===== 任务 =====
model Task {
  id           BigInt    @id @default(autoincrement())
  publisherId  BigInt    @map("publisher_id")
  helperId     BigInt?   @map("helper_id")
  title        String    @db.VarChar(100)
  description  String    @db.Text
  price        Decimal   @db.Decimal(10, 2)
  lat          Decimal   @db.Decimal(10, 7)
  lng          Decimal   @db.Decimal(10, 7)
  geohash      String    @db.VarChar(12)
  address      String    @db.VarChar(256)
  category     TaskCategory
  images       Json      @default("[]")
  status       TaskStatus @default(OPEN)
  expireAt     DateTime  @map("expire_at")
  createdAt    DateTime  @default(now()) @map("created_at")
  updatedAt    DateTime  @updatedAt @map("updated_at")
  deletedAt    DateTime? @map("deleted_at")

  // 关系
  publisher    User      @relation("Publisher", fields: [publisherId], references: [id])
  helper       User?     @relation("Helper", fields: [helperId], references: [id])
  order        Order?

  @@index([geohash])
  @@index([status, expireAt])
  @@index([publisherId])
  @@index([helperId])
  @@index([category, status])
  @@map("tasks")
}

enum TaskCategory {
  DELIVERY
  SHOPPING
  CLEANING
  REPAIR
  TUTORING
  PET_CARE
  MOVING
  OTHER
}

enum TaskStatus {
  OPEN
  ASSIGNED
  IN_PROGRESS
  COMPLETED
  CANCELLED
}

// ===== 订单 =====
model Order {
  id            BigInt      @id @default(autoincrement())
  taskId        BigInt      @unique @map("task_id")
  helperId      BigInt      @map("helper_id")
  totalAmount   Decimal     @db.Decimal(10, 2) @map("total_amount")
  platformFee   Decimal     @db.Decimal(10, 2) @map("platform_fee")
  status        OrderStatus @default(PENDING)
  paidAt        DateTime?   @map("paid_at")
  completedAt   DateTime?   @map("completed_at")
  refundAmount  Decimal?    @db.Decimal(10, 2) @map("refund_amount")
  createdAt     DateTime    @default(now()) @map("created_at")
  updatedAt     DateTime    @updatedAt @map("updated_at")

  // 关系
  task          Task        @relation(fields: [taskId], references: [id])
  helper        User        @relation("HelperOrders", fields: [helperId], references: [id])
  review        Review?
  transactions  Transaction[]

  @@index([helperId])
  @@index([status])
  @@index([createdAt])
  @@map("orders")
}

enum OrderStatus {
  PENDING
  PAID
  IN_PROGRESS
  COMPLETED
  CANCELLED
  REFUNDED
}

// ===== 钱包 =====
model Wallet {
  id        BigInt   @id @default(autoincrement())
  userId    BigInt   @unique @map("user_id")
  balance   Decimal  @default(0) @db.Decimal(12, 2)
  frozen    Decimal  @default(0) @db.Decimal(12, 2)
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  user          User           @relation(fields: [userId], references: [id])
  transactions  Transaction[]

  @@map("wallets")
}

// ===== 交易流水（复式记账） =====
model Transaction {
  id           BigInt          @id @default(autoincrement())
  walletId     BigInt          @map("wallet_id")
  orderId      BigInt?         @map("order_id")
  type         TransactionType
  amount       Decimal         @db.Decimal(10, 2)
  balanceAfter Decimal         @db.Decimal(12, 2) @map("balance_after")
  description  String          @db.VarChar(255)
  createdAt    DateTime        @default(now()) @map("created_at")

  wallet  Wallet @relation(fields: [walletId], references: [id])
  order   Order? @relation(fields: [orderId], references: [id])

  @@index([walletId, createdAt])
  @@index([orderId])
  @@map("transactions")
}

enum TransactionType {
  INCOME
  EXPENSE
  FREEZE
  UNFREEZE
}

// ===== 评价 =====
model Review {
  id           BigInt   @id @default(autoincrement())
  orderId      BigInt   @unique @map("order_id")
  reviewerId   BigInt   @map("reviewer_id")
  revieweeId   BigInt   @map("reviewee_id")
  rating       Int      // 1-5
  tags         Json     @default("[]")
  comment      String?  @db.VarChar(500)
  createdAt    DateTime @default(now()) @map("created_at")

  order     Order @relation(fields: [orderId], references: [id])
  reviewer  User  @relation("Reviewer", fields: [reviewerId], references: [id])
  reviewee  User  @relation("Reviewee", fields: [revieweeId], references: [id])

  @@index([revieweeId])
  @@index([rating])
  @@map("reviews")
}

// ===== 审计日志 =====
model AuditLog {
  id        BigInt   @id @default(autoincrement())
  adminId   BigInt?  @map("admin_id")
  action    String    @db.VarChar(64)
  targetType String   @db.VarChar(32) @map("target_type")
  targetId  BigInt   @map("target_id")
  detail    Json?
  ip        String?   @db.VarChar(45)
  createdAt DateTime @default(now()) @map("created_at")

  @@index([adminId])
  @@index([targetType, targetId])
  @@index([createdAt])
  @@map("audit_logs")
}

// ===== 敏感词 =====
model SensitiveWord {
  id        BigInt   @id @default(autoincrement())
  word      String    @unique @db.VarChar(64)
  level     Int       @default(1) // 1-警告 2-拦截 3-封号
  createdAt DateTime @default(now()) @map("created_at")

  @@map("sensitive_words")
}

// ===== 优惠券 =====
model Coupon {
  id          BigInt    @id @default(autoincrement())
  code        String    @unique @db.VarChar(32)
  type        String    @db.VarChar(16) // FIXED / PERCENT
  value       Decimal   @db.Decimal(10, 2)
  minAmount   Decimal   @default(0) @map("min_amount") @db.Decimal(10, 2)
  validFrom   DateTime  @map("valid_from")
  validTo     DateTime  @map("valid_to")
  usedCount   Int       @default(0) @map("used_count")
  maxUsage    Int       @default(100) @map("max_usage")
  createdAt   DateTime  @default(now()) @map("created_at")

  @@index([validTo])
  @@map("coupons")
}

// ===== 客服工单 =====
model Ticket {
  id          BigInt      @id @default(autoincrement())
  userId      BigInt      @map("user_id")
  adminId     BigInt?     @map("admin_id")
  subject     String      @db.VarChar(128)
  content     String      @db.Text
  status      TicketStatus @default(OPEN)
  priority    Int         @default(3) // 1最高 5最低
  satisfaction Int?       @map("satisfaction")
  createdAt   DateTime    @default(now()) @map("created_at")
  updatedAt   DateTime    @updatedAt @map("updated_at")
  closedAt    DateTime?   @map("closed_at")

  @@index([status])
  @@index([userId])
  @@index([adminId])
  @@map("tickets")
}

enum TicketStatus {
  OPEN
  IN_PROGRESS
  RESOLVED
  CLOSED
}
```

## 执行步骤

1. 将上述内容写入 `bff/src/prisma/schema.prisma`
2. 设置环境变量：`export DATABASE_URL="mysql://root:pass@localhost:3306/neighborhood_help"`
3. 运行迁移：`cd bff && pnpm prisma migrate dev --name init`
4. 生成客户端：`pnpm prisma generate`
5. 验证：`pnpm prisma studio`（可视化检查表结构）

## 验收标准
- [ ] 迁移成功，15 张表全部创建
- [ ] 所有索引正确建立
- [ ] Prisma Client 生成无报错
- [ ] 外键关系正确
- [ ] Enum 映射正确
- [ ] `prisma studio` 可正常打开

## 对应需求条目
#51, #53, #54, #58, #59, #68, #83, #96
