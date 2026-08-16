FROM golang:1.22-alpine AS builder

WORKDIR /app

# 安装依赖
COPY go.mod go.sum ./
RUN go mod download

# 复制源码并编译
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o risk-service ./cmd/main.go

# 运行镜像
FROM alpine:3.19

RUN apk --no-cache add ca-certificates tzdata
ENV TZ=Asia/Shanghai

WORKDIR /app
COPY --from=builder /app/risk-service .
COPY --from=builder /app/config ./config

EXPOSE 8080

CMD ["./risk-service"]
