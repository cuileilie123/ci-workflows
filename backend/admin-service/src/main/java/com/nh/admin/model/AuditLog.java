package com.nh.admin.model;

import jakarta.persistence.*;
import lombok.Data;
import java.time.LocalDateTime;

@Data
@Entity
@Table(name = "audit_logs", indexes = {
    @Index(name = "idx_audit_user", columnList = "admin_id"),
    @Index(name = "idx_audit_action", columnList = "action"),
    @Index(name = "idx_audit_time", columnList = "created_at")
})
public class AuditLog {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "admin_id", nullable = false)
    private Long adminId;

    @Column(nullable = false)
    private String action; // BAN_USER, REFUND_ORDER, APPROVE_CONTENT, etc.

    @Column(name = "target_id")
    private Long targetId;

    @Column(name = "target_type")
    private String targetType; // USER, ORDER, CONTENT, TICKET

    private String reason;

    @Column(columnDefinition = "TEXT")
    private String details;

    @Column(name = "ip_address")
    private String ipAddress;

    @Column(name = "created_at")
    private LocalDateTime createdAt;

    @PrePersist
    void onCreate() {
        createdAt = LocalDateTime.now();
    }
}
