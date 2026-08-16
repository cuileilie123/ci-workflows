package rules

import (
	"fmt"
	"time"
)

// Violation 违规记录
type Violation struct {
	Rule   string `json:"rule"`
	Score  int    `json:"score"`
	Reason string `json:"reason"`
}

// RuleContext 规则评估上下文
type RuleContext struct {
	UserID   int64                  `json:"user_id"`
	DeviceFP string                 `json:"device_fp"`
	IP       string                 `json:"ip"`
	Action   string                 `json:"action"`
	Metadata map[string]interface{} `json:"metadata"`
}

// Rule 规则接口
type Rule interface {
	Name() string
	Evaluate(ctx *RuleContext) (violated bool, score int, reason string)
}

// Engine 规则引擎
type Engine struct {
	rules []Rule
}

// Add 添加规则
func (e *Engine) Add(rule Rule) {
	e.rules = append(e.rules, rule)
}

// Evaluate 评估所有规则
func (e *Engine) Evaluate(ctx *RuleContext) []Violation {
	var violations []Violation
	for _, rule := range e.rules {
		if violated, score, reason := rule.Evaluate(ctx); violated {
			violations = append(violations, Violation{
				Rule:   rule.Name(),
				Score:  score,
				Reason: reason,
			})
		}
	}
	return violations
}

// NewAccountRule 新账号规则
type NewAccountRule struct {
	threshold time.Duration
}

func (r *NewAccountRule) Name() string { return "new_account" }
func (r *NewAccountRule) Evaluate(ctx *RuleContext) (bool, int, string) {
	if createdAt, ok := ctx.Metadata["created_at"].(time.Time); ok {
		if time.Since(createdAt) < r.threshold {
			return true, 20, fmt.Sprintf("新账号（注册不足 %v）", r.threshold)
		}
	}
	return false, 0, ""
}

// RapidActionRule 高频操作规则
type RapidActionRule struct {
	limit  int
	window time.Duration
}

func (r *RapidActionRule) Name() string { return "rapid_action" }
func (r *RapidActionRule) Evaluate(ctx *RuleContext) (bool, int, string) {
	// 由行为分析服务通过 Redis 计数，此处仅作规则定义
	if count, ok := ctx.Metadata["action_count"].(int); ok {
		if count > r.limit {
			return true, 40, fmt.Sprintf("%v 内操作 %d 次（限制 %d 次）", r.window, count, r.limit)
		}
	}
	return false, 0, ""
}

// GPSJumpRule GPS 跳跃规则
type GPSJumpRule struct {
	maxDistance float64
}

func (r *GPSJumpRule) Name() string { return "gps_jump" }
func (r *GPSJumpRule) Evaluate(ctx *RuleContext) (bool, int, string) {
	if dist, ok := ctx.Metadata["gps_distance"].(float64); ok {
		if dist > r.maxDistance {
			return true, 50, fmt.Sprintf("GPS 跳跃 %.0f km（限制 %.0f km）", dist, r.maxDistance)
		}
	}
	return false, 0, ""
}

// IPClusterRule IP 聚集规则
type IPClusterRule struct {
	limit int
}

func (r *IPClusterRule) Name() string { return "ip_cluster" }
func (r *IPClusterRule) Evaluate(ctx *RuleContext) (bool, int, string) {
	if count, ok := ctx.Metadata["ip_account_count"].(int); ok {
		if count > r.limit {
			return true, 30, fmt.Sprintf("同 IP %d 个账号（限制 %d 个）", count, r.limit)
		}
	}
	return false, 0, ""
}

// SelfDealingRule 自买自卖规则
type SelfDealingRule struct{}

func (r *SelfDealingRule) Name() string { return "self_dealing" }
func (r *SelfDealingRule) Evaluate(ctx *RuleContext) (bool, int, string) {
	if pubID, ok := ctx.Metadata["publisher_id"].(int64); ok {
		if helperID, ok2 := ctx.Metadata["helper_id"].(int64); ok2 && pubID == helperID {
			return true, 60, "发布者与接单者为同一账号"
		}
	}
	return false, 0, ""
}

// DefaultRules 创建默认规则引擎
func DefaultRules() *Engine {
	e := &Engine{}
	e.Add(&NewAccountRule{threshold: 24 * time.Hour})
	e.Add(&RapidActionRule{limit: 30, window: 60 * time.Second})
	e.Add(&GPSJumpRule{maxDistance: 200.0})
	e.Add(&IPClusterRule{limit: 10})
	e.Add(&SelfDealingRule{})
	return e
}
