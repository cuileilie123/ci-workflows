package fingerprint

import (
	"testing"
)

func TestGenerate(t *testing.T) {
	info := &DeviceInfo{
		Canvas:   "canvas_fp_123",
		WebGL:    "webgl_fp_456",
		UA:       "Mozilla/5.0",
		ScreenW:  1920,
		ScreenH:  1080,
		Timezone: "Asia/Shanghai",
		Language: "zh-CN",
	}

	fp1 := Generate(info)
	if len(fp1) != 64 { // SHA256 hex length
		t.Errorf("指纹长度错误: 期望 64, 得到 %d", len(fp1))
	}

	// 相同设备信息应生成相同指纹
	fp2 := Generate(info)
	if fp1 != fp2 {
		t.Error("相同设备信息应生成相同指纹")
	}

	// 不同设备信息应生成不同指纹
	info2 := &DeviceInfo{UA: "Different UA"}
	fp3 := Generate(info2)
	if fp1 == fp3 {
		t.Error("不同设备信息应生成不同指纹")
	}
}

func TestSimilarity(t *testing.T) {
	fp1 := "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890"
	fp2 := "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890"
	fp3 := "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef"

	sim1 := Similarity(fp1, fp2)
	if sim1 != 1.0 {
		t.Errorf("相同指纹相似度应为 1.0, 得到 %f", sim1)
	}

	sim2 := Similarity(fp1, fp3)
	if sim2 >= 0.5 {
		t.Errorf("不同指纹相似度应较低, 得到 %f", sim2)
	}

	// 不同长度应返回 0
	sim3 := Similarity(fp1, "short")
	if sim3 != 0 {
		t.Errorf("不同长度指纹相似度应为 0, 得到 %f", sim3)
	}
}
