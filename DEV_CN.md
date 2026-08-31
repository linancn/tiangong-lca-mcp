---
title: TianGong LCA MCP Maintainer Notes CN
docType: guide
scope: repo
status: active
authoritative: false
owner: mcp
language: zh-CN
whenToUse:
  - when you need Chinese maintainer-facing MCP development, formatting, testing, publish, or deployment commands
whenToUpdate:
  - when Chinese maintainer-facing runtime prerequisites, development commands, publish steps, or deployment notes change
checkPaths:
  - DEV_CN.md
  - DEV_EN.md
  - package.json
  - pnpm-lock.yaml
  - pnpm-workspace.yaml
  - Dockerfile
  - .nvmrc
  - src/**
  - test/**
  - scripts/**
lastReviewedAt: 2026-08-31
lastReviewedCommit: 66b624ded9831316e7c1b5b77373233df4463bb4
lastReviewedNote: '针对 Issue #60 完成复核：Node Alpine 镜像现会在 Corepack 前升级安全包，并要求修复后的 OpenSSL 与零 HIGH/CRITICAL ECR 扫描。'
related:
  - AGENTS.md
  - .docpact/config.yaml
  - docs/agents/repo-validation.md
  - docs/agents/repo-architecture.md
  - DEV_EN.md
---

# TianGong-LCA-MCP

[中文](https://github.com/linancn/tiangong-lca-mcp/blob/main/DEV_CN.md) | [English](https://github.com/linancn/tiangong-lca-mcp/blob/main/DEV_EN.md)

TianGong LCA Model Context Protocol (MCP) Server 支持 STDIO 和 StreamableHttp 两种协议。

## 启动 MCP 服务器

### 客户端 STDIO 服务器

```bash
corepack install --global pnpm@11.24.0
pnpm add --global @tiangong-lca/mcp-server

pnpm dlx dotenv-cli -e .env -- tiangong-lca-mcp-stdio
```

### 使用 Docker

```bash
# 使用 Dockerfile 构建 MCP 服务器镜像（可选）
docker build -t linancn/tiangong-lca-mcp-server:0.1.1 .

# 拉取 MCP 服务器镜像
docker pull linancn/tiangong-lca-mcp-server:0.1.1

# 使用 Docker 启动 MCP 服务器
docker run -d \
    --name tiangong-lca-mcp-server \
    --publish 9278:9278 \
    --env-file .env \
    linancn/tiangong-lca-mcp-server:0.1.1
```

## 开发

### 环境设置

```bash
# 安装 Node.js
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.2/install.sh | bash
nvm install 24.19.0
nvm use 24.19.0

# 安装精确包管理器并按冻结 lock 安装依赖
corepack install --global pnpm@11.24.0
pnpm install --frozen-lockfile
```

### OAuth Broker 配置

远程 HTTP 入口按 `.env.example` 配置。workspace 本地测试时，把非敏感 Supabase broker 配置放进私有 env 文件，并从 `tiangong-lca-edge-functions/.env` 读取 Edge/MCP 共用的 Redis 值；两个 runtime 都使用 `UPSTASH_REDIS_REST_URL` 与 `UPSTASH_REDIS_REST_TOKEN`。不要替换成 Portal 单独保留的 `UPSTASH_REDIS_URL`/`UPSTASH_REDIS_TOKEN`。

Dev 必须具备以下精确控制面事实：

1. 启用 Supabase OAuth Server，关闭 Dynamic Client Registration，authorization path 为 `/oauth/consent`。
2. 注册固定的 Supabase confidential client，回调精确为 `http://localhost:9278/oauth/callback`。
3. 在 `MCP_OAUTH_HOST_CLIENTS_JSON` 中至少配置一个固定 public MCP host client；MCP Inspector CLI/TUI 通常使用 `http://127.0.0.1:6276/oauth/callback`。
4. 使用随机 32 字节 `MCP_OAUTH_SESSION_ENCRYPTION_KEY`，并把它、Supabase client secret 与 Redis REST token 保存在 Git 之外。

资格验证期设置 `MCP_AUTH_MODE=broker_compat`；旧 API key 退役门禁通过后改为 `broker`。`legacy` 是显式回滚配置，不是常规本地或生产模式。

authorization server 暴露 `/authorize`、`/token` 与 `/revoke`；上游回调是 `/oauth/callback`。live flow 前先检查发现文档：

```bash
curl --fail http://localhost:9278/.well-known/oauth-protected-resource/mcp
curl --fail http://localhost:9278/.well-known/oauth-authorization-server
```

Dev live proof 必须记录 PKCE、refresh 轮换、重放失败、本地 revoke、数据库 actor/client 行为以及入站/下游 token 不相等；不得打印 token 或 secret。离线测试使用假的 Supabase endpoint，不能替代该证明。

离线 qualification 还会并发调用内存 raw store 的两次 `take()`，并要求准确一个 winner；这与生产 Upstash `GETDEL` 一致。一次性 OAuth state、code 或 refresh handle 禁止恢复为 `get()` / `await` / `delete()` 序列。

`Database_CRUD_Tool` 的读取继续使用绑定 actor 的 PostgREST。普通 create/save/delete 调用三条 `app_dataset_*` Edge 命令，并要求 `DB-CORE-WRITE-01`；LifecycleModel 的 create/save/delete 调用既有 save/delete bundle endpoint，并要求 `EDGE-BUNDLE-01`。固定 MCP OAuth client 还需要 `DB-CORE-READ-01`。禁止授予直接 table DML，也不要用 service-role 写入替代这些命令。

### 代码格式化

```bash
# 只读 lint、格式检查和 TypeScript 7 类型检查
pnpm lint

# 显式写入格式化结果
pnpm format
```

### 本地测试

#### 启动 MCP Inspector

使用 `pnpm start:server` 或 `pnpm start:server-local`。跨平台启动器会同时启动对应 HTTP 服务和 Inspector，不依赖 POSIX 专用环境变量语法。

### 标准验证

```bash
pnpm prepush:gate
```

该门禁包含只读 lint/typecheck、离线行为测试、打包消费者测试、构建、精确工具链检查、依赖审计、dry-run pack，以及在任意临时路径中的冻结 clean-worktree 重跑。该离线门禁不会访问生产、GLAD、Supabase 或 OpenLCA。

### 发布

功能变更合并后，由单独跟踪的 release task 执行发布。Trusted publishing workflow 使用 pnpm frozen lock 安装并运行标准门禁；Tag 继续使用本单包仓库的 `v<package.version>` 格式，本次 `0.1.1` 对应 `v0.1.1`。构建 ECS 镜像前必须读回 registry integrity，并确认发布包包含 packed-consumer 门禁证明过的 broker store/runtime、Supabase broker、auth middleware 与 HTTP app。

### 测试脚手架

```bash
pnpm exec tsx scripts/openlca-ipc-smoke.ts
```

### 发布

```bash
image_tag="oauth-$(git rev-parse --short=12 HEAD)-v0.1.1"
image_uri="339712838008.dkr.ecr.us-east-1.amazonaws.com/tiangong-lca-mcp"

docker build --no-cache --platform linux/arm64 -t "${image_uri}:${image_tag}" .

aws ecr get-login-password --region us-east-1  | docker login --username AWS --password-stdin 339712838008.dkr.ecr.us-east-1.amazonaws.com

docker push "${image_uri}:${image_tag}"

docker run -d -p 9278:9278 --env-file .env "${image_uri}:${image_tag}"
```

仓库 Dockerfile 会先启用 pnpm Corepack shim，再激活精确 pnpm `11.24.0`，并在最终 OCI `PATH` 中保留 `/pnpm/bin`。推送 ECR 前必须执行无缓存 `linux/arm64` 构建，并验证镜像架构与默认 `tiangong-lca-mcp-http` executable；只检查 Dockerfile 文本不足以证明镜像可用。

该构建会先执行 `apk upgrade --no-cache`。必须读回安装后的 OpenSSL package，使用推送前不存在且包含 commit 的 ECR tag，并等待扫描状态 COMPLETE 且 CRITICAL/HIGH 都为零，才可注册 ECS task revision。
