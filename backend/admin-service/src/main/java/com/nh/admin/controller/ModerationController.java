package com.nh.admin.controller;

import com.nh.admin.service.AuditLogService;
import lombok.RequiredArgsConstructor;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/v1/admin/moderation")
@RequiredArgsConstructor
public class ModerationController {

    private final RedisTemplate<String, Object> redisTemplate;
    private final AuditLogService auditLogService;

    @GetMapping("/pending")
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<Map<String, Object>> pending(
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int size) {
        // TODO: 对接内容审核队列
        return ResponseEntity.ok(Map.of(
            "list", List.of(),
            "total", 0,
            "page", page
        ));
    }

    @PostMapping("/{id}/approve")
    @PreAuthorize("hasRole('MODERATOR') or hasRole('ADMIN')")
    public ResponseEntity<?> approve(@PathVariable Long id) {
        // TODO: 审核通过逻辑
        auditLogService.log("APPROVE_CONTENT", id, "CONTENT", "审核通过");
        return ResponseEntity.ok(Map.of("status", "approved"));
    }

    @PostMapping("/{id}/reject")
    @PreAuthorize("hasRole('MODERATOR') or hasRole('ADMIN')")
    public ResponseEntity<?> reject(@PathVariable Long id, @RequestBody RejectRequest req) {
        // TODO: 审核拒绝逻辑 + 通知用户
        auditLogService.log("REJECT_CONTENT", id, "CONTENT", req.reason());
        return ResponseEntity.ok(Map.of("status", "rejected"));
    }

    @GetMapping("/stats")
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<Map<String, Integer>> stats() {
        // TODO: 对接审核统计
        return ResponseEntity.ok(Map.of(
            "pending", 0,
            "approved_today", 0,
            "rejected_today", 0
        ));
    }

    record RejectRequest(String reason) {}
}
