package com.nh.admin.controller;

import com.nh.admin.service.AuditLogService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/v1/admin/tickets")
@RequiredArgsConstructor
public class TicketController {

    private final AuditLogService auditLogService;

    @GetMapping
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<Map<String, Object>> list(
            @RequestParam(defaultValue = "OPEN") String status,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int size) {
        // TODO: 对接工单数据库
        return ResponseEntity.ok(Map.of(
            "list", List.of(),
            "total", 0,
            "page", page
        ));
    }

    @PostMapping("/{id}/assign")
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<?> assign(@PathVariable Long id, @RequestBody AssignRequest req) {
        // TODO: 分配工单逻辑
        auditLogService.log("ASSIGN_TICKET", id, "TICKET",
            "分配给管理员: " + req.adminId());
        return ResponseEntity.ok(Map.of("status", "assigned"));
    }

    @PostMapping("/{id}/reply")
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<?> reply(@PathVariable Long id, @RequestBody ReplyRequest req) {
        // TODO: 回复工单 + 通知用户
        auditLogService.log("REPLY_TICKET", id, "TICKET", req.message());
        return ResponseEntity.ok(Map.of("status", "replied"));
    }

    @PostMapping("/{id}/close")
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<?> close(@PathVariable Long id, @RequestBody CloseRequest req) {
        // TODO: 关闭工单 + 满意度调查
        auditLogService.log("CLOSE_TICKET", id, "TICKET",
            "满意度: " + req.satisfaction());
        return ResponseEntity.ok(Map.of("status", "closed"));
    }

    record AssignRequest(Long adminId) {}
    record ReplyRequest(String message) {}
    record CloseRequest(Integer satisfaction) {}
}
