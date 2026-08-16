package com.nh.admin.service;

import com.nh.admin.model.AuditLog;
import com.nh.admin.repository.AuditLogRepository;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

@Service
@RequiredArgsConstructor
public class AuditLogService {

    private final AuditLogRepository auditLogRepository;

    public void log(String action, Long targetId, String targetType, String reason) {
        log(action, targetId, targetType, reason, null);
    }

    public void log(String action, Long targetId, String targetType, String reason, String details) {
        AuditLog log = new AuditLog();
        log.setAction(action);
        log.setTargetId(targetId);
        log.setTargetType(targetType);
        log.setReason(reason);
        log.setDetails(details);
        log.setIpAddress(getClientIp());

        // 从请求属性获取管理员 ID
        try {
            var attrs = (ServletRequestAttributes) RequestContextHolder.getRequestAttributes();
            if (attrs != null) {
                HttpServletRequest req = attrs.getRequest();
                String adminId = (String) req.getAttribute("userId");
                if (adminId != null) {
                    log.setAdminId(Long.parseLong(adminId));
                }
            }
        } catch (Exception e) {
            // 忽略，异步日志场景可能无请求上下文
        }

        auditLogRepository.save(log);
    }

    private String getClientIp() {
        try {
            var attrs = (ServletRequestAttributes) RequestContextHolder.getRequestAttributes();
            if (attrs == null) return "unknown";
            HttpServletRequest req = attrs.getRequest();
            String xff = req.getHeader("X-Forwarded-For");
            if (xff != null && !xff.isEmpty()) {
                return xff.split(",")[0].trim();
            }
            return req.getRemoteAddr();
        } catch (Exception e) {
            return "unknown";
        }
    }
}
