-- 迁移 2: 增加审计字段
-- 为 users 表增加 last_login_at 和 login_count
ALTER TABLE users ADD COLUMN last_login_at DATETIME NULL;
ALTER TABLE users ADD COLUMN login_count INT DEFAULT 0;

-- 为 tasks 表增加 view_count
ALTER TABLE tasks ADD COLUMN view_count INT DEFAULT 0;

-- 为 orders 表增加 refund_reason
ALTER TABLE orders ADD COLUMN refund_reason VARCHAR(500) NULL;
