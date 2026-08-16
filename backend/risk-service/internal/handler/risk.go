package handler

import (
	"net/http"
	"strconv"
	"time"

	"neighborhood-help/risk-service/internal/model"
	"neighborhood-help/risk-service/internal/repository"
	"neighborhood-help/risk-service/internal/service"
	"neighborhood-help/risk-service/pkg/alert"
	"neighborhood-help/risk-service/pkg/fingerprint"
	"neighborhood-help/risk-service/pkg/rules"

	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"
)

// RiskHandler 风控 HTTP Handler
type RiskHandler struct {
	analyzer   *service.BehaviorAnalyzer
	repo       *repository.RiskRepository
	alerter    *alert.Alerter
	redis      *redis.Client
}

// NewRiskHandler 创建 Handler
func NewRiskHandler(
	redis *redis.Client,
	ruleEngine *rules.Engine,
	alerter *alert.Alerter,
) *RiskHandler {
	return &RiskHandler{
		analyzer:   service.NewBehaviorAnalyzer(redis, ruleEngine),
		repo:       repository.NewRiskRepository(redis),
		alerter:    alerter,
		redis:      redis,
	}
}

// CheckRequest 风险检查请求
type CheckRequest struct {
	UserID   int64                  `json:"user_id" binding:"required"`
	DeviceFP string                 `json:"device_fp"`
	IP       string                 `json:"ip"`
	Action   string                 `json:"action"`
	Lat      float64                `json:"lat"`
	Lng      float64                `json:"lng"`
	Metadata map[string]interface{} `json:"metadata"`
}

// CheckResponse 风险检查响应
type CheckResponse struct {
	Passed     bool              `json:"passed"`
	Score      int               `json:"score"`
	Level      string            `json:"level"`
	Violations []rules.Violation `json:"violations,omitempty"`
	Message    string            `json:"message,omitempty"`
}

// Check 通用风险检查
func (h *RiskHandler) Check(c *gin.Context) {
	var req CheckRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	ctx := c.Request.Context()
	var violations []rules.Violation
	totalScore := 0

	// 1. 检测操作频率
	if req.Action != "" {
		violated, count, reason := h.analyzer.CheckActionRate(ctx, req.UserID, req.Action)
		if violated {
			violations = append(violations, rules.Violation{
				Rule:   service.RuleRapidAction,
				Score:  40,
				Reason: reason,
			})
			totalScore += 40
		}
		if req.Metadata == nil {
			req.Metadata = make(map[string]interface{})
		}
		req.Metadata["action_count"] = count
	}

	// 2. 检测 GPS 跳跃
	if req.Lat != 0 && req.Lng != 0 {
		violated, dist, reason := h.analyzer.CheckGPSJump(ctx, req.UserID, req.Lat, req.Lng)
		if violated {
			violations = append(violations, rules.Violation{
				Rule:   service.RuleGPSJump,
				Score:  50,
				Reason: reason,
			})
			totalScore += 50
		}
		if req.Metadata == nil {
			req.Metadata = make(map[string]interface{})
		}
		req.Metadata["gps_distance"] = dist
	}

	// 3. 检测 IP 聚集
	if req.IP != "" {
		violated, count, reason := h.analyzer.CheckIPCluster(ctx, req.IP, req.UserID)
		if violated {
			violations = append(violations, rules.Violation{
				Rule:   service.RuleIPCluster,
				Score:  30,
				Reason: reason,
			})
			totalScore += 30
		}
		if req.Metadata == nil {
			req.Metadata = make(map[string]interface{})
		}
		req.Metadata["ip_account_count"] = count
	}

	// 4. 规则引擎评估
	ruleCtx := &rules.RuleContext{
		UserID:   req.UserID,
		DeviceFP: req.DeviceFP,
		IP:       req.IP,
		Action:   req.Action,
		Metadata: req.Metadata,
	}
	ruleViolations, ruleScore := h.analyzer.EvaluateRisk(ctx, ruleCtx)
	violations = append(violations, ruleViolations...)
	totalScore += ruleScore

	// 限制在 0-100
	if totalScore > 100 {
		totalScore = 100
	}

	// 确定风险等级
	level := "info"
	if totalScore >= 95 {
		level = "ban"
	} else if totalScore >= 80 {
		level = "block"
	} else if totalScore >= 60 {
		level = "warn"
	}

	// 更新风险分
	h.repo.UpdateRiskScore(ctx, req.UserID, totalScore)

	// 保存风险记录
	if len(violations) > 0 {
		for _, v := range violations {
			h.repo.SaveRiskRecord(ctx, &model.RiskRecord{
				UserID:   req.UserID,
				Rule:     v.Rule,
				Score:    v.Score,
				Reason:   v.Reason,
				Action:   req.Action,
				DeviceFP: req.DeviceFP,
				IP:       req.IP,
			})
		}

		// 发送告警
		alertLevel := alert.LevelInfo
		if totalScore >= 95 {
			alertLevel = alert.LevelBan
		} else if totalScore >= 80 {
			alertLevel = alert.LevelBlock
		} else if totalScore >= 60 {
			alertLevel = alert.LevelWarn
		}
		h.alerter.Send(alertLevel,
			"用户风险检测异常",
			map[string]interface{}{
				"user_id":    req.UserID,
				"score":      totalScore,
				"level":      level,
				"violations": violations,
			},
		)
	}

	// 返回结果
	resp := CheckResponse{
		Passed:     totalScore < 60,
		Score:      totalScore,
		Level:      level,
		Violations: violations,
	}
	if !resp.Passed {
		resp.Message = "风险检测未通过"
	}

	c.JSON(http.StatusOK, resp)
}

// Report 上报行为事件
func (h *RiskHandler) Report(c *gin.Context) {
	var req struct {
		UserID   int64                  `json:"user_id" binding:"required"`
		Action   string                 `json:"action" binding:"required"`
		DeviceFP string                 `json:"device_fp"`
		IP       string                 `json:"ip"`
		Metadata map[string]interface{} `json:"metadata"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	ctx := c.Request.Context()
	h.analyzer.CheckActionRate(ctx, req.UserID, req.Action)

	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

// GetScore 查询用户风险分
func (h *RiskHandler) GetScore(c *gin.Context) {
	userID, err := strconv.ParseInt(c.Param("userId"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user_id"})
		return
	}

	ctx := c.Request.Context()
	score, err := h.repo.GetRiskScore(ctx, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, score)
}

// Ban 封禁用户
func (h *RiskHandler) Ban(c *gin.Context) {
	var req struct {
		UserID int64  `json:"user_id" binding:"required"`
		Reason string `json:"reason"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	ctx := c.Request.Context()
	h.repo.UpdateRiskScore(ctx, req.UserID, 100)

	h.alerter.Send(alert.LevelBan,
		"用户被封禁",
		map[string]interface{}{
			"user_id": req.UserID,
			"reason":  req.Reason,
		},
	)

	c.JSON(http.StatusOK, gin.H{"status": "banned", "user_id": req.UserID})
}

// Dashboard 风控看板数据
func (h *RiskHandler) Dashboard(c *gin.Context) {
	ctx := c.Request.Context()

	// 获取近 24h 风险记录
	now := time.Now()
	records, _ := h.redis.ZRevRangeByScore(ctx, "risk:records", &redis.ZRangeBy{
		Min:    strconv.FormatInt(now.Add(-24*time.Hour).Unix(), 10),
		Max:    "+inf",
		Offset: 0,
		Count:  100,
	}).Result()

	// 统计各等级用户数
	infoCount, _ := h.redis.SCard(ctx, "risk:level:info").Result()
	warnCount, _ := h.redis.SCard(ctx, "risk:level:warn").Result()
	blockCount, _ := h.redis.SCard(ctx, "risk:level:block").Result()
	banCount, _ := h.redis.SCard(ctx, "risk:level:ban").Result()

	c.JSON(http.StatusOK, gin.H{
		"records_24h": len(records),
		"users": gin.H{
			"info":  infoCount,
			"warn":  warnCount,
			"block": blockCount,
			"ban":   banCount,
		},
	})
}

// GenerateFingerprint 生成设备指纹
func (h *RiskHandler) GenerateFingerprint(c *gin.Context) {
	var info fingerprint.DeviceInfo
	if err := c.ShouldBindJSON(&info); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	fp := fingerprint.Generate(&info)
	c.JSON(http.StatusOK, gin.H{"fingerprint": fp})
}
