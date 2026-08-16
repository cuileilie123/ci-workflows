-- CreateTable
-- 添加 Review 表复合索引
CREATE INDEX `Review_revieweeId_createdAt_idx` ON `reviews`(`reviewee_id`, `created_at` DESC);

-- 添加 Order 表复合索引
CREATE INDEX `Order_helperId_status_idx` ON `orders`(`helper_id`, `status`);
CREATE INDEX `Order_status_helperId_idx` ON `orders`(`status`, `helper_id`);
