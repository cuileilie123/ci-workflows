package service

import (
	"context"
	"fmt"
	"math"
	"time"

	"neighborhood-help/risk-service/pkg/rules"

	"github.com/redis/go-redis/v9"
)

const (
	RuleRapidAction = "rapid_action"
	RuleIPCluster   = "ip_cluster"
	RuleGPSJump     = "gps_jump"
	RuleNewAccount  = "new_account"
	RuleSelfDealing = "self_dealing"
)

// BehaviorAnalyzer 行为分析器
type BehaviorAnalyzer struct {
	redis  *redis.Client
	rules  *rules.Engine
}

// NewBehaviorAnalyzer 创建行为分析器
func NewBehaviorAnalyzer(redis *redis.Client, ruleEngine *rules.Engine) *BehaviorAnalyzer {
	return &BehaviorAnalyzer{
		redis: redis,
		rules: ruleEngine,
	}
}

// CheckActionRate 检测操作频率
func (b *BehaviorAnalyzer) CheckActionRate(ctx context.Context, userID int64, actionType string) (bool, int, string) {
	key := fmt.Sprintf("rate:%d:%s", userID, actionType)
	count, err := b.redis.Incr(ctx, key).Result()
	if err != nil {
		return false, 0, ""
	}
	b.redis.Expire(ctx, key, 60*time.Second)

	if count > 30 {
		return true, int(count), fmt.Sprintf("1 分钟内操作 %d 次（限制 30 次）", count)
	}
	return false, int(count), ""
}

// CheckGPSJump 检测 GPS 跳跃
func (b *BehaviorAnalyzer) CheckGPSJump(ctx context.Context, userID int64, lat, lng float64) (bool, float64, string) {
	key := fmt.Sprintf("loc:%d", userID)
	prev, err := b.redis.GeoPos(ctx, key, "current").Result()

	if err == nil && len(prev) > 0 {
		dist := haversine(lat, lng, prev[0].Latitude, prev[0].Longitude)
		if dist > 200 {
			return true, dist, fmt.Sprintf("GPS 跳跃 %.1f km（限制 200 km）", dist)
		}
	}

	b.redis.GeoAdd(ctx, key, &redis.GeoLocation{
		Name:      "current",
		Latitude:  lat,
		Longitude: lng,
	})
	b.redis.Expire(ctx, key, 24*time.Hour)
	return false, 0, ""
}

// CheckIPCluster 检测 IP 聚集
func (b *BehaviorAnalyzer) CheckIPCluster(ctx context.Context, ip string, userID int64) (bool, int, string) {
	key := fmt.Sprintf("ip:%s:accounts", ip)
	b.redis.SAdd(ctx, key, userID)
	b.redis.Expire(ctx, key, 24*time.Hour)

	count, _ := b.redis.SCard(ctx, key).Result()
	if count > 10 {
		return true, int(count), fmt.Sprintf("同 IP %d 个账号（限制 10 个）", count)
	}
	return false, int(count), ""
}

// EvaluateRisk 综合风险评估
func (b *BehaviorAnalyzer) EvaluateRisk(ctx context.Context, req *rules.RuleContext) ([]rules.Violation, int) {
	violations := b.rules.Evaluate(req)

	// 计算总风险分
	totalScore := 0
	for _, v := range violations {
		totalScore += v.Score
	}

	// 限制在 0-100
	if totalScore > 100 {
		totalScore = 100
	}

	return violations, totalScore
}

// Haversine 距离计算（km）
func haversine(lat1, lng1, lat2, lng2 float64) float64 {
	const R = 6371.0
	toRad := func(d float64) float64 { return d * math.Pi / 180 }

	dLat := toRad(lat2 - lat1)
	dLng := toRad(lng2 - lng1)

	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(toRad(lat1))*math.Cos(toRad(lat2))*
			math.Sin(dLng/2)*math.Sin(dLng/2)

	c := 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
	return R * c
}
