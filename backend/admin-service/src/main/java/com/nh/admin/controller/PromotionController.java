package com.nh.admin.controller;

import com.nh.admin.service.AuditLogService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/v1/admin/promotions")
@RequiredArgsConstructor
public class PromotionController {

    private final AuditLogService auditLogService;

    @GetMapping
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<List<Map<String, Object>>> list() {
        // TODO: 对接活动数据库
        return ResponseEntity.ok(List.of());
    }

    @PostMapping
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<?> create(@RequestBody CreatePromotionDTO dto) {
        // TODO: 创建活动逻辑
        auditLogService.log("CREATE_PROMOTION", null, "PROMOTION", dto.name());
        return ResponseEntity.ok(Map.of("status", "created", "id", 1));
    }

    @PutMapping("/{id}")
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<?> update(@PathVariable Long id, @RequestBody UpdatePromotionDTO dto) {
        // TODO: 更新活动逻辑
        auditLogService.log("UPDATE_PROMOTION", id, "PROMOTION", dto.name());
        return ResponseEntity.ok(Map.of("status", "updated"));
    }

    @DeleteMapping("/{id}")
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<?> delete(@PathVariable Long id) {
        // TODO: 删除活动逻辑
        auditLogService.log("DELETE_PROMOTION", id, "PROMOTION", "删除活动");
        return ResponseEntity.ok(Map.of("status", "deleted"));
    }

    @GetMapping("/ab-test")
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<Map<String, Object>> abTestResults(@RequestParam String experimentId) {
        // TODO: AB 测试数据
        return ResponseEntity.ok(Map.of(
            "experimentId", experimentId,
            "results", Map.of()
        ));
    }

    record CreatePromotionDTO(String name, String description, String type,
                              Double discount, String startTime, String endTime) {}
    record UpdatePromotionDTO(String name, String description, String type,
                              Double discount, String startTime, String endTime) {}
}
