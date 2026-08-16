package com.nh.admin.controller;

import com.nh.admin.service.AuditLogService;
import lombok.RequiredArgsConstructor;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/v1/admin/users")
@RequiredArgsConstructor
public class UserAdminController {

    private final RedisTemplate<String, Object> redisTemplate;
    private final AuditLogService auditLogService;

    @GetMapping
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<Map<String, Object>> search(
            @RequestParam(required = false) String keyword,
            @RequestParam(required = false) Integer minCredit,
            @RequestParam(required = false) String status,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int size) {
        // TODO: 对接 BFF 用户数据库
        return ResponseEntity.ok(Map.of(
            "list", java.util.List.of(),
            "total", 0,
            "page", page
        ));
    }

    @PostMapping("/{id}/ban")
    @PreAuthorize("hasRole('SUPER_ADMIN')")
    public ResponseEntity<?> banUser(@PathVariable Long id, @RequestBody BanRequest req) {
        // TODO: 调用 BFF 接口封禁用户
        redisTemplate.opsForValue().set("user:ban:" + id, req.reason());
        auditLogService.log("BAN_USER", id, "USER", req.reason(), "duration: " + req.duration());
        return ResponseEntity.ok(Map.of("status", "banned"));
    }

    @PostMapping("/{id}/unban")
    @PreAuthorize("hasRole('SUPER_ADMIN')")
    public ResponseEntity<?> unbanUser(@PathVariable Long id, @RequestBody Map<String, String> req) {
        redisTemplate.delete("user:ban:" + id);
        auditLogService.log("UNBAN_USER", id, "USER", req.getOrDefault("reason", ""));
        return ResponseEntity.ok(Map.of("status", "unbanned"));
    }

    @PutMapping("/{id}/credit")
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<?> adjustCredit(@PathVariable Long id, @RequestBody CreditAdjustDTO dto) {
        // TODO: 调用 BFF 接口调整信用分
        auditLogService.log("ADJUST_CREDIT", id, "USER",
            dto.reason(), "adjustment: " + dto.amount());
        return ResponseEntity.ok(Map.of("status", "adjusted"));
    }

    @GetMapping("/{id}/logs")
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<?> behaviorLogs(@PathVariable Long id) {
        // TODO: 查询用户行为日志
        return ResponseEntity.ok(java.util.List.of());
    }

    record BanRequest(String reason, Integer duration) {}
    record CreditAdjustDTO(Integer amount, String reason) {}
}
