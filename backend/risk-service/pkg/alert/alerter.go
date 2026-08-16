package alert

import (
	"fmt"
	"log"
	"net/http"
	"strings"
)

// AlertLevel 告警级别
type AlertLevel int

const (
	LevelInfo  AlertLevel = iota // 记录日志
	LevelWarn                    // 标记观察
	LevelBlock                   // 限制操作
	LevelBan                     // 封禁账号
)

func (l AlertLevel) String() string {
	return []string{"INFO", "WARN", "BLOCK", "BAN"}[l]
}

// Channel 告警通道接口
type Channel interface {
	Notify(level AlertLevel, msg string, metadata map[string]interface{}) error
}

// Alerter 告警服务
type Alerter struct {
	channels []Channel
}

// NewAlerter 创建告警服务
func NewAlerter() *Alerter {
	return &Alerter{}
}

// AddChannel 添加告警通道
func (a *Alerter) AddChannel(ch Channel) {
	a.channels = append(a.channels, ch)
}

// Send 发送告警
func (a *Alerter) Send(level AlertLevel, msg string, metadata map[string]interface{}) {
	for _, ch := range a.channels {
		go func(c Channel) {
			if err := c.Notify(level, msg, metadata); err != nil {
				log.Printf("告警发送失败: %v", err)
			}
		}(ch)
	}

	// 高危操作：直接记录封禁日志
	if level >= LevelBan {
		log.Printf("[封禁] %s - metadata: %v", msg, metadata)
	}
}

// WechatWebhookChannel 企业微信 Webhook 通道
type WechatWebhookChannel struct {
	URL string
}

func (c *WechatWebhookChannel) Notify(level AlertLevel, msg string, metadata map[string]interface{}) error {
	payload := fmt.Sprintf(`{"msgtype":"text","text":{"content":"[风控告警][%s] %s"}}`, level.String(), msg)

	resp, err := http.Post(c.URL, "application/json", strings.NewReader(payload))
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	return nil
}

// EmailChannel 邮件通道（简化版）
type EmailChannel struct {
	SMTP   string
	To     []string
	From   string
}

func (c *EmailChannel) Notify(level AlertLevel, msg string, metadata map[string]interface{}) error {
	// 实际项目中应使用 net/smtp 发送邮件
	log.Printf("[邮件告警][%s] 收件人: %v, 内容: %s", level.String(), c.To, msg)
	return nil
}
