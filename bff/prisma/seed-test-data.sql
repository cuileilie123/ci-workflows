-- ============================================================
-- 信用分复合索引性能测试脚本
-- ============================================================

-- 1. 生成模拟订单数据
INSERT INTO orders (task_id, helper_id, total_amount, platform_fee, status, created_at, updated_at)
SELECT 
  t.id,
  (FLOOR(1 + RAND() * 100)) AS helper_id,
  ROUND(50 + RAND() * 450, 2) AS total_amount,
  ROUND((50 + RAND() * 450) * 0.1, 2) AS platform_fee,
  ELT(FLOOR(1 + RAND() * 6), 'PENDING', 'PAID', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'REFUNDED') AS status,
  DATE_SUB(NOW(), INTERVAL FLOOR(RAND() * 365) DAY) AS created_at,
  NOW() AS updated_at
FROM tasks t
CROSS JOIN (SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4 UNION SELECT 5) nums
LIMIT 500;

-- 2. 生成模拟评价数据
INSERT INTO reviews (order_id, reviewer_id, reviewee_id, rating, tags, comment, created_at)
SELECT 
  o.id,
  (o.task_id % 100) + 1 AS reviewer_id,
  o.helper_id AS reviewee_id,
  FLOOR(1 + RAND() * 5) AS rating,
  JSON_ARRAY(
    ELT(FLOOR(1 + RAND() * 5), '准时到达', '态度友善', '专业靠谱', '超出预期', '沟通顺畅'),
    ELT(FLOOR(1 + RAND() * 5), '准时到达', '态度友善', '专业靠谱', '超出预期', '沟通顺畅')
  ) AS tags,
  CONCAT('模拟评价内容', FLOOR(RAND() * 1000)) AS comment,
  DATE_SUB(NOW(), INTERVAL FLOOR(RAND() * 365) DAY) AS created_at
FROM orders o
WHERE o.status = 'COMPLETED'
LIMIT 300;
