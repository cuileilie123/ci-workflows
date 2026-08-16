package fingerprint

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
)

// DeviceInfo 设备信息结构
type DeviceInfo struct {
	Canvas   string `json:"canvas"`    // Canvas 指纹
	WebGL    string `json:"webgl"`     // WebGL 渲染指纹
	UA       string `json:"ua"`        // User-Agent
	ScreenW  int    `json:"sw"`        // 屏幕宽
	ScreenH  int    `json:"sh"`        // 屏幕高
	Timezone string `json:"tz"`        // 时区
	Language string `json:"lang"`      // 语言
}

// Generate 生成设备指纹
func Generate(info *DeviceInfo) string {
	raw := fmt.Sprintf("%s|%s|%s|%dx%d|%s|%s",
		info.Canvas, info.WebGL, info.UA,
		info.ScreenW, info.ScreenH,
		info.Timezone, info.Language)

	hash := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(hash[:])
}

// Similarity 计算两个指纹的相似度（0-1）
func Similarity(fp1, fp2 string) float64 {
	if len(fp1) != len(fp2) {
		return 0
	}
	diff := 0
	for i := 0; i < len(fp1); i++ {
		if fp1[i] != fp2[i] {
			diff++
		}
	}
	return 1.0 - float64(diff)/float64(len(fp1))
}
