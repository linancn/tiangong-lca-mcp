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
lastReviewedAt: 2026-04-24
lastReviewedCommit: bf48b7fd4c9115350b00fddba3d302188007f2f4
related:
  - AGENTS.md
  - .docpact/config.yaml
  - DEV_CN.md
  - README.md
---

# TianGong-LCA-MCP

[中文](https://github.com/linancn/tiangong-lca-mcp/blob/main/README_CN.md) | [English](https://github.com/linancn/tiangong-lca-mcp/blob/main/README.md)

TianGong LCA Model Context Protocol (MCP) Server 支持 STDIO 和 Streamable Http 两种协议。

## 启动 MCP 服务器

### 客户端 STDIO 服务器

```bash
npm install -g @tiangong-lca/mcp-server

npx dotenv -e .env -- \
npx -p @tiangong-lca/mcp-server tiangong-lca-mcp-stdio
```

### 使用 Docker

```bash
# 使用 Dockerfile 构建 MCP 服务器镜像（可选）
docker build -t linancn/tiangong-lca-mcp-server:0.0.5 .

# 拉取 MCP 服务器镜像
docker pull linancn/tiangong-lca-mcp-server:0.0.5

# 使用 Docker 启动 MCP 服务器
docker run -d \
    --name tiangong-lca-mcp-server \
    --publish 9278:9278 \
    --env-file .env \
    linancn/tiangong-lca-mcp-server:0.0.5
```

### 本地测试

#### STDIO 服务器

```bash
# 使用 MCP Inspector 启动 STDIO 服务器
npm start
```

#### Streamable Http 服务器

```bash
npm run start:server
```

#### Streamable Http Local 服务器

```bash
npm run start:server-local
```

#### 启动 MCP Inspector

```bash
DANGEROUSLY_OMIT_AUTH=true npx @modelcontextprotocol/inspector
```
