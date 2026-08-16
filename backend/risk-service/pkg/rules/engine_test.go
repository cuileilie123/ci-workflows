package rules

import (
	"testing"
	"time"
)

func TestDefaultRules(t *testing.T) {
	engine := DefaultRules()
	if len(engine.rules) != 5 {
		t.Errorf("默认规则数应为 5, 得到 %d", len(engine.rules))
	}
}

func TestRapidActionRule(t *testing.T) {
	rule := &RapidActionRule{limit: 30, window: 60 * time.Second}

	// 未超过限制
	ctx := &RuleContext{
		Metadata: map[string]interface{}{"action_count": 20},
	}
	violated, _, _ := rule.Evaluate(ctx)
	if violated {
		t.Error("操作次数未超过限制时不应触发")
	}

	// 超过限制
	ctx.Metadata["action_count"] = 35
	violated, score, reason := rule.Evaluate(ctx)
	if !violated {
		t.Error("操作次数超过限制时应触发")
	}
	if score != 40 {
		t.Errorf("违规分数应为 40, 得到 %d", score)
	}
	if reason == "" {
		t.Error("违规原因不应为空")
	}
}

func TestGPSJumpRule(t *testing.T) {
	rule := &GPSJumpRule{maxDistance: 200.0}

	// 正常距离
	ctx := &RuleContext{
		Metadata: map[string]interface{}{"gps_distance": 50.0},
	}
	violated, _, _ := rule.Evaluate(ctx)
	if violated {
		t.Error("正常距离不应触发")
	}

	// 跳跃距离
	ctx.Metadata["gps_distance"] = 300.0
	violated, score, _ := rule.Evaluate(ctx)
	if !violated {
		t.Error("GPS 跳跃应触发")
	}
	if score != 50 {
		t.Errorf("违规分数应为 50, 得到 %d", score)
	}
}

func TestIPClusterRule(t *testing.T) {
	rule := &IPClusterRule{limit: 10}

	// 正常账号数
	ctx := &RuleContext{
		Metadata: map[string]interface{}{"ip_account_count": 5},
	}
	violated, _, _ := rule.Evaluate(ctx)
	if violated {
		t.Error("账号数未超过限制不应触发")
	}

	// 超过限制
	ctx.Metadata["ip_account_count"] = 15
	violated, score, _ := rule.Evaluate(ctx)
	if !violated {
		t.Error("同 IP 账号数超过限制应触发")
	}
	if score != 30 {
		t.Errorf("违规分数应为 30, 得到 %d", score)
	}
}

func TestSelfDealingRule(t *testing.T) {
	rule := &SelfDealingRule{}

	// 不同账号
	ctx := &RuleContext{
		Metadata: map[string]interface{}{
			"publisher_id": int64(1),
			"helper_id":    int64(2),
		},
	}
	violated, _, _ := rule.Evaluate(ctx)
	if violated {
		t.Error("不同账号不应触发")
	}

	// 同一账号
	ctx.Metadata["publisher_id"] = int64(1)
	ctx.Metadata["helper_id"] = int64(1)
	violated, score, _ := rule.Evaluate(ctx)
	if !violated {
		t.Error("自买自卖应触发")
	}
	if score != 60 {
		t.Errorf("违规分数应为 60, 得到 %d", score)
	}
}

func TestEngineEvaluate(t *testing.T) {
	engine := DefaultRules()

	// 无违规
	ctx := &RuleContext{
		UserID: 1,
		Metadata: map[string]interface{}{
			"action_count":      10,
			"gps_distance":      50.0,
			"ip_account_count":  5,
			"publisher_id":      int64(1),
			"helper_id":         int64(2),
		},
	}
	violations := engine.Evaluate(ctx)
	if len(violations) != 0 {
		t.Errorf("无违规时 violations 应为空, 得到 %d", len(violations))
	}

	// 多项违规
	ctx2 := &RuleContext{
		UserID: 2,
		Metadata: map[string]interface{}{
			"action_count":      50,
			"gps_distance":      300.0,
			"ip_account_count":  15,
			"publisher_id":      int64(3),
			"helper_id":         int64(3),
		},
	}
	violations2 := engine.Evaluate(ctx2)
	if len(violations2) < 3 {
		t.Errorf("多项违规时应触发多条规则, 得到 %d", len(violations2))
	}
}
