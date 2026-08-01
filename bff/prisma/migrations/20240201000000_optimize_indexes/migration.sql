-- 迁移 3: 优化索引
-- 复合索引优化查询
CREATE INDEX idx_tasks_category_status_created ON tasks(category, status, created_at DESC);
CREATE INDEX idx_orders_status_created ON orders(status, created_at DESC);

-- 交易流水复合索引
CREATE INDEX idx_transactions_wallet_created ON transactions(wallet_id, created_at);

-- 评价索引
CREATE INDEX idx_reviews_reviewee_rating ON reviews(reviewee_id, rating);

-- 审计日志索引
CREATE INDEX idx_audit_logs_target ON audit_logs(target_type, target_id);

-- 任务地理索引
CREATE INDEX idx_tasks_geohash ON tasks(geohash);
CREATE INDEX idx_tasks_status_expire ON tasks(status, expire_at);
