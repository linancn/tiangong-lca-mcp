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
lastReviewedAt: 2026-08-26
lastReviewedCommit: 9286ade85e175e5327231cfeebdb5698674b7935
lastReviewedNote: 'Reviewed for release Issue #48: public Docker examples consistently target MCP server 0.1.0 under the then-current pnpm 11.23.0 baseline. Reviewed for Issue #50: the active client setup command now pins pnpm 11.24.0 without changing the 0.1.0 package or Docker evidence.'
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

GLAD 数据集查询工具需要在服务器环境中配置 GLAD API key：

```bash
GLAD_API_KEY=your-glad-api-key
GLAD_API_BASE_URL=https://www.globallcadataaccess.org/api/v1
```

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
