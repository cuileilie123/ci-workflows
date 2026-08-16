-- ============================================================
-- 信用分复合索引性能测试脚本
-- ============================================================

-- 1. 生成模拟用户数据（100个用户）
-- 假设已有用户，直接使用现有用户ID

-- 2. 生成模拟任务数据
-- 假设已有任务，直接使用现有任务ID

-- 3. 生成模拟订单数据（为每个任务创建订单）
-- 插入大量订单数据用于测试
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

-- 4. 生成模拟评价数据（为已完成的订单创建评价）
INSERT INTO reviews (order_id, reviewer_id, reviewee_id, rating, tags, comment, created_at)
SELECT 
  o.id,
  o.task_id % 100 + 1 AS reviewer_id,
  o.helper_id AS reviewee_id,
  FLOOR(1 + RAND() * 5) AS rating,
  JSON_ARRAY(
    ELT(FLOOR(1 + RAND() * 5), '准时到达', '态度友善', '专业靠谱', '超出预期', '沟通顺畅'),
    ELT(FLOOR(1 + RAND() * 5), '准时到达', '态度友善', '专业靠谱', '超出预期', '沟通顺畅')
  ) AS tags,
  CONCAT('这是一个模拟评价，用于测试索引性能。评价内容长度随机生成，模拟真实用户评价。', FLOOR(RAND() * 1000)) AS comment,
  DATE_SUB(NOW(), INTERVAL FLOOR(RAND() * 365) DAY) AS created_at
FROM orders o
WHERE o.status = 'COMPLETED'
LIMIT 300;

-- 5. 检查数据量
SELECT 'orders' AS table_name, COUNT(*) AS row_count FROM orders
UNION ALL
SELECT 'reviews', COUNT(*) FROM reviews;

-- ============================================================
-- 性能测试：对比复合索引效果
-- ============================================================

-- 测试 1: Review 表复合索引测试
-- 查询：按 reviewee_id 和 created_at DESC 排序查询最近50条评价

-- 测试查询（使用复合索引）
SELECT 
  'Test 1: Review 复合索引查询' AS test_name,
  COUNT(*) AS result_count
FROM reviews
WHERE reviewee_id = 5
ORDER BY created_at DESC
LIMIT 50;

-- 查看执行计划
EXPLAIN SELECT * FROM reviews
WHERE reviewee_id = 5
ORDER BY created_at DESC
LIMIT 50;

-- 测试 2: Order 表复合索引测试
-- 查询：按 helper_id 和 status 查询已完成订单

SELECT 
  'Test 2: Order 复合索引查询' AS test_name,
  COUNT(*) AS result_count
FROM orders
WHERE helper_id = 5 AND status = 'COMPLETED';

-- 查看执行计划
EXPLAIN SELECT * FROM orders
WHERE helper_id = 5 AND status = 'COMPLETED';

-- 测试 3: Order 表反向复合索引测试
-- 查询：按 status 和 helper_id 查询

SELECT 
  'Test 3: Order 反向复合索引查询' AS test_name,
  COUNT(*) AS result_count
FROM orders
WHERE status = 'COMPLETED' AND helper_id = 5;

-- 查看执行计划
EXPLAIN SELECT * FROM orders
WHERE status = 'COMPLETED' AND helper_id = 5;

-- 测试 4: 信用分计算模拟查询（完整流程）
-- 模拟 getCompletedCount 查询
SELECT 
  'Test 4: 信用分计算-完成订单数' AS test_name,
  COUNT(*) AS completed_count
FROM orders o
WHERE o.helper_id = 5 AND o.status = 'COMPLETED';

-- 模拟 getCancelCount 查询
SELECT 
  'Test 4: 信用分计算-取消订单数' AS test_name,
  COUNT(*) AS cancel_count
FROM orders o
WHERE o.status = 'CANCELLED' AND o.helper_id = 5;

-- 测试 5: Review 表全量查询 vs 限制查询对比
SELECT 
  'Test 5a: Review 全量查询（无限制）' AS test_name,
  COUNT(*) AS result_count
FROM reviews
WHERE reviewee_id = 5;

SELECT 
  'Test 5b: Review 限制查询（最近50条）' AS test_name,
  COUNT(*) AS result_count
FROM reviews
WHERE reviewee_id = 5
ORDER BY created_at DESC
LIMIT 50;

-- ============================================================
-- 性能对比测试（使用 SQL_NO_CACHE 避免缓存影响）
-- ============================================================

-- 测试查询耗时（Review 复合索引）
SELECT SQL_NO_CACHE * FROM reviews
WHERE reviewee_id = 5
ORDER BY created_at DESC
LIMIT 50;

-- 测试查询耗时（Order 复合索引）
SELECT SQL_NO_CACHE * FROM orders
WHERE helper_id = 5 AND status = 'COMPLETED';
