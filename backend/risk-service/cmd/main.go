package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"neighborhood-help/risk-service/internal/handler"
	"neighborhood-help/risk-service/pkg/alert"
	"neighborhood-help/risk-service/pkg/rules"

	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"
	"github.com/spf13/viper"
)

func main() {
	// 1. 加载配置
	viper.SetConfigFile("config/config.yaml")
	viper.SetDefault("server.port", 8080)
	viper.SetDefault("redis.addr", "localhost:6379")
	viper.SetDefault("alert.channels", []string{})

	if err := viper.ReadInConfig(); err != nil {
		log.Printf("配置文件读取失败，使用默认配置: %v", err)
	}

	// 2. 初始化 Redis
	rdb := redis.NewClient(&redis.Options{
		Addr:     viper.GetString("redis.addr"),
		Password: viper.GetString("redis.password"),
		DB:       viper.GetInt("redis.db"),
		PoolSize: viper.GetInt("redis.pool_size"),
	})

	ctx := context.Background()
	if err := rdb.Ping(ctx).Err(); err != nil {
		log.Fatalf("Redis 连接失败: %v", err)
	}
	log.Println("Redis 连接成功")

	// 3. 初始化规则引擎
	ruleEngine := rules.DefaultRules()

	// 4. 初始化告警服务
	alerter := alert.NewAlerter()

	// 配置企业微信 Webhook
	if webhookURL := viper.GetString("alert.wechat_webhook_url"); webhookURL != "" {
		alerter.AddChannel(&alert.WechatWebhookChannel{URL: webhookURL})
		log.Println("企业微信告警已启用")
	}

	// 配置邮件告警
	if emailTo := viper.GetStringSlice("alert.email_to"); len(emailTo) > 0 {
		alerter.AddChannel(&alert.EmailChannel{
			SMTP: viper.GetString("alert.smtp_addr"),
			To:   emailTo,
		})
		log.Println("邮件告警已启用")
	}

	// 5. 初始化 Handler
	riskHandler := handler.NewRiskHandler(rdb, ruleEngine, alerter)

	// 6. 创建 Gin 路由
	gin.SetMode(gin.ReleaseMode)
	router := gin.Default()

	// 健康检查
	router.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok", "service": "risk-service"})
	})

	// API v1 路由
	v1 := router.Group("/api/v1/risk")
	{
		v1.POST("/check", riskHandler.Check)
		v1.POST("/report", riskHandler.Report)
		v1.GET("/score/:userId", riskHandler.GetScore)
		v1.POST("/ban", riskHandler.Ban)
		v1.GET("/dashboard", riskHandler.Dashboard)
		v1.POST("/fingerprint", riskHandler.GenerateFingerprint)
	}

	// 7. 启动服务
	port := viper.GetString("server.port")
	if port == "" {
		port = "8080"
	}

	srv := &http.Server{
		Addr:         ":" + port,
		Handler:      router,
		ReadTimeout:  5 * time.Second,
		WriteTimeout: 10 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	// 优雅关闭
	go func() {
		log.Printf("风控服务启动，监听端口 %s", port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("服务启动失败: %v", err)
		}
	}()

	// 等待中断信号
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	log.Println("正在关闭服务...")

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Fatalf("服务关闭失败: %v", err)
	}
	log.Println("服务已关闭")
}
