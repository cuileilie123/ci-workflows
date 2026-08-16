package com.nh.admin.repository;

import com.nh.admin.model.AuditLog;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface AuditLogRepository extends JpaRepository<AuditLog, Long> {
    List<AuditLog> findByAdminIdOrderByCreatedAtDesc(Long adminId);
    List<AuditLog> findByActionOrderByCreatedAtDesc(String action);
}
