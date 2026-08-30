---
title: TianGong LCA MCP README CN
docType: guide
scope: repo
status: active
authoritative: false
owner: mcp
language: zh-CN
whenToUse:
  - when you need Chinese user-facing MCP package setup, Docker usage, local startup, or inspector examples
whenToUpdate:
  - when Chinese startup commands, Docker usage, package invocation, or user-facing MCP examples change
checkPaths:
  - README_CN.md
  - README.md
  - package.json
  - Dockerfile
  - mcp_config.json
  - src/index.ts
  - src/index_server.ts
  - src/index_server_local.ts
  - src/http_app.ts
  - src/http_app_local.ts
lastReviewedAt: 2026-08-31
lastReviewedCommit: ffd98dd53f0927e246fb1f315a10bc343bdd3167
lastReviewedNote: '针对 Issue #52 完成复核：远程 Streamable HTTP 现已说明浏览器 OAuth 2.1、固定客户端、broker token 隔离、Edge/MCP 共用 Redis 变量名和迁移模式；STDIO、本地 HTTP 与 0.1.0 包版本不变。'
related:
  - AGENTS.md
  - .docpact/config.yaml
  - DEV_CN.md
  - README.md
---

# TianGong-LCA-MCP

[中文](https://github.com/linancn/tiangong-lca-mcp/blob/main/README_CN.md) | [English](https://github.com/linancn/tiangong-lca-mcp/blob/main/README.md)

TianGong LCA Model Context Protocol (MCP) Server 支持 STDIO 和 Streamable Http 两种协议。

## 环境变量

复制 `.env.example` 并填写 Supabase、Redis 和 MCP broker 配置。远程服务使用 `UPSTASH_REDIS_REST_URL` 与 `UPSTASH_REDIS_REST_TOKEN`；它们有意区别于 Portal 单独保留的 `UPSTASH_REDIS_URL` 与 `UPSTASH_REDIS_TOKEN`。

GLAD 数据集查询工具还需要配置 GLAD API key：

```bash
GLAD_API_KEY=your-glad-api-key
GLAD_API_BASE_URL=https://www.globallcadataaccess.org/api/v1
```

## 远程 OAuth

远程 Streamable HTTP 是 OAuth 2.1 protected resource。兼容的 MCP host 会发现 `/.well-known/oauth-protected-resource/mcp`，打开用户浏览器，并通过 Authorization Code + S256 PKCE 完成授权。用户在 Next 中登录和确认授权；用户名、密码不会交给 AI 或 MCP host。

服务采用 token broker：host 只拿到短期不透明 MCP token；服务端把另一套 Supabase access/refresh session 加密存入 Upstash。只有 Supabase access token 会访问 Edge 或 PostgREST。首个版本只支持运维预注册的固定 host client，不开放 Dynamic Client Registration。

`MCP_AUTH_MODE` 控制迁移状态：

- `broker_compat`：接受 broker token，并临时兼容旧的编码用户 API key，同时只输出无标识迁移遥测；
- `broker`：只接受 broker token；
- `legacy`：仅用于回滚的旧认证模式。

服务不再提供 OAuth demo 或显示 authorization code 的页面。运维需把精确回调 `${MCP_PUBLIC_ORIGIN}/oauth/callback` 注册为 Supabase confidential client，并把 client secret 与 `MCP_OAUTH_SESSION_ENCRYPTION_KEY` 存入批准的 secret store。

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
docker build -t linancn/tiangong-lca-mcp-server:0.1.0 .

# 拉取 MCP 服务器镜像
docker pull linancn/tiangong-lca-mcp-server:0.1.0

# 使用 Docker 启动 MCP 服务器
docker run -d \
    --name tiangong-lca-mcp-server \
    --publish 9278:9278 \
    --env-file .env \
    linancn/tiangong-lca-mcp-server:0.1.0
```

### 本地测试

#### STDIO 服务器

```bash
# 使用 MCP Inspector 启动 STDIO 服务器
pnpm start
```

#### Streamable Http 服务器

```bash
pnpm start:server
```

#### Streamable Http Local 服务器

```bash
pnpm start:server-local
```

HTTP 启动命令通过跨平台 Node argv wrapper 启动 MCP Inspector，并在 wrapper 内注入仅用于开发的 Inspector 环境，不依赖 POSIX shell 语法。
