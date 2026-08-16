package com.nh.admin.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/v1/admin/dashboard")
@RequiredArgsConstructor
public class DashboardController {

    private final RedisTemplate<String, Object> redisTemplate;

    @GetMapping("/realtime")
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<Map<String, Object>> realtime() {
        Long onlineUsers = redisTemplate.opsForSet().size("online:users");
        if (onlineUsers == null) onlineUsers = 0L;

        return ResponseEntity.ok(Map.of(
            "onlineUsers", onlineUsers,
            "todayOrders", 0,      // TODO: 对接 BFF 数据库
            "todayGmv", 0.0,       // TODO: 对接 BFF 数据库
            "todayNewUsers", 0     // TODO: 对接 BFF 数据库
        ));
    }

    @GetMapping("/trend")
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<Map<String, Object>> trend(
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate start,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate end) {
        // TODO: 对接数据分析服务
        return ResponseEntity.ok(Map.of(
            "dau", List.of(),
            "gmv", List.of(),
            "retention", Map.of()
        ));
    }

    @GetMapping("/alerts")
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<List<Map<String, Object>>> alerts() {
        // TODO: 对接风控告警服务
        return ResponseEntity.ok(List.of());
    }
}
