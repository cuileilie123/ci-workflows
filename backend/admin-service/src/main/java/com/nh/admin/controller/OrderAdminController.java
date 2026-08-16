package com.nh.admin.controller;

import com.nh.admin.service.AuditLogService;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.io.IOException;
import java.io.PrintWriter;
import java.util.Map;

@RestController
@RequestMapping("/api/v1/admin/orders")
@RequiredArgsConstructor
public class OrderAdminController {

    private final AuditLogService auditLogService;

    @GetMapping
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<Map<String, Object>> list(
            @RequestParam(required = false) String status,
            @RequestParam(required = false) String keyword,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int size) {
        // TODO: 对接 BFF 订单数据库
        return ResponseEntity.ok(Map.of(
            "list", java.util.List.of(),
            "total", 0,
            "page", page
        ));
    }

    @PostMapping("/{id}/refund")
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<?> forceRefund(@PathVariable Long id, @RequestBody RefundRequest req) {
        // TODO: 调用 BFF 支付退款接口
        auditLogService.log("FORCE_REFUND", id, "ORDER", req.reason());
        return ResponseEntity.ok(Map.of("status", "refunded"));
    }

    @PostMapping("/{id}/cancel")
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<?> cancelOrder(@PathVariable Long id, @RequestBody CancelRequest req) {
        // TODO: 调用 BFF 订单取消接口
        auditLogService.log("ADMIN_CANCEL_ORDER", id, "ORDER",
            req.reason(), "compensation: " + req.compensation());
        return ResponseEntity.ok(Map.of("status", "cancelled"));
    }

    @GetMapping("/export")
    @PreAuthorize("hasRole('ADMIN')")
    public void export(HttpServletResponse response,
                       @RequestParam String startDate,
                       @RequestParam String endDate) throws IOException {
        response.setContentType("text/csv");
        response.setHeader("Content-Disposition", "attachment; filename=orders.csv");

        PrintWriter writer = response.getWriter();
        writer.println("ID,Title,Price,Status,CreatedAt");
        // TODO: 查询真实数据并导出
        writer.println("示例数据，待对接真实数据库");
        writer.flush();
    }

    record RefundRequest(String reason) {}
    record CancelRequest(String reason, Double compensation) {}
}
