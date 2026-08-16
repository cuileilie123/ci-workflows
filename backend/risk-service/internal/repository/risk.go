package repository

import (
	"context"
	"strconv"
	"time"

	"neighborhood-help/risk-service/internal/model"

	"github.com/redis/go-redis/v9"
)

// RiskRepository 风险数据仓库（Redis 存储）
type RiskRepository struct {
	redis *redis.Client
}

// NewRiskRepository 创建仓库
func NewRiskRepository(redis *redis.Client) *RiskRepository {
	return &RiskRepository{redis: redis}
}

// SaveRiskRecord 保存风险记录
func (r *RiskRepository) SaveRiskRecord(ctx context.Context, record *model.RiskRecord) error {
	key := "risk:records"
	data := map[string]interface{}{
		"user_id":    record.UserID,
		"rule":       record.Rule,
		"score":      record.Score,
		"reason":     record.Reason,
		"action":     record.Action,
		"device_fp":  record.DeviceFP,
		"ip":         record.IP,
		"created_at": time.Now().Unix(),
	}
	return r.redis.ZAdd(ctx, key, redis.Z{
		Score:  float64(time.Now().Unix()),
		Member: data,
	}).Err()
}

// GetRiskScore 获取用户风险分
func (r *RiskRepository) GetRiskScore(ctx context.Context, userID int64) (*model.RiskScore, error) {
	key := "risk:score:" + strconv.FormatInt(userID, 10)
	data, err := r.redis.HGetAll(ctx, key).Result()
	if err != nil {
		return nil, err
	}

	if len(data) == 0 {
		return &model.RiskScore{
			UserID:    userID,
			Score:     0,
			Level:     "info",
			UpdatedAt: time.Now(),
		}, nil
	}

	// 解析数据
	score := 0
	level := "info"
	if s, ok := data["score"]; ok {
		if parsed, err := strconv.Atoi(s); err == nil {
			score = parsed
		}
	}
	if l, ok := data["level"]; ok {
		level = l
	}

	return &model.RiskScore{
		UserID: userID,
		Score:  score,
		Level:  level,
	}, nil
}

// UpdateRiskScore 更新用户风险分
func (r *RiskRepository) UpdateRiskScore(ctx context.Context, userID int64, score int) error {
	key := "risk:score:" + strconv.FormatInt(userID, 10)

	level := "info"
	if score >= 95 {
		level = "ban"
	} else if score >= 80 {
		level = "block"
	} else if score >= 60 {
		level = "warn"
	}

	return r.redis.HMSet(ctx, key, map[string]interface{}{
		"user_id":    userID,
		"score":      score,
		"level":      level,
		"updated_at": time.Now().Unix(),
	}).Err()
}

// SaveDeviceRecord 保存设备记录
func (r *RiskRepository) SaveDeviceRecord(ctx context.Context, record *model.DeviceRecord) error {
	key := "device:" + record.DeviceFP
	return r.redis.HMSet(ctx, key, map[string]interface{}{
		"user_id":   record.UserID,
		"ip":        record.IP,
		"last_seen": time.Now().Unix(),
	}).Err()
}
