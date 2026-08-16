package com.nh.admin.controller;

import com.nh.admin.security.JwtUtil;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/v1/admin/auth")
@RequiredArgsConstructor
public class AuthController {

    private final JwtUtil jwtUtil;
    private final PasswordEncoder passwordEncoder;

    @Value("${admin.jwt.secret}")
    private String jwtSecret;

    @PostMapping("/login")
    public ResponseEntity<?> login(@RequestBody LoginRequest req) {
        // 简化版：演示用固定账号验证（生产环境应查数据库）
        if (!"admin".equals(req.username()) || !"admin123".equals(req.password())) {
            return ResponseEntity.badRequest().body(Map.of("error", "用户名或密码错误"));
        }

        String token = jwtUtil.generateToken(1L, "admin", "SUPER_ADMIN");
        return ResponseEntity.ok(Map.of(
            "token", token,
            "user", Map.of(
                "id", 1,
                "username", "admin",
                "role", "SUPER_ADMIN"
            )
        ));
    }

    record LoginRequest(String username, String password) {}
}
