package model

import "time"

// RiskRecord 风险记录
type RiskRecord struct {
	ID        int64     `json:"id"`
	UserID    int64     `json:"user_id"`
	Rule      string    `json:"rule"`
	Score     int       `json:"score"`
	Reason    string    `json:"reason"`
	Action    string    `json:"action"`
	DeviceFP  string    `json:"device_fp"`
	IP        string    `json:"ip"`
	CreatedAt time.Time `json:"created_at"`
}

// RiskScore 用户风险分
type RiskScore struct {
	UserID    int64     `json:"user_id"`
	Score     int       `json:"score"`     // 0-100
	Level     string    `json:"level"`     // info/warn/block/ban
	UpdatedAt time.Time `json:"updated_at"`
}

// DeviceRecord 设备记录
type DeviceRecord struct {
	ID        int64     `json:"id"`
	UserID    int64     `json:"user_id"`
	DeviceFP  string    `json:"device_fp"`
	IP        string    `json:"ip"`
	LastSeen  time.Time `json:"last_seen"`
}
