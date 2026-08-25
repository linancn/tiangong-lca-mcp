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
lastReviewedAt: 2026-08-25
lastReviewedCommit: 6871ce361cc6f382654424be1064a24c1edf2031
lastReviewedNote: 'Reviewed for release Issue #48: maintainer tag, package, and deployment examples consistently target 0.1.0.'
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
corepack install --global pnpm@11.23.0
pnpm add --global @tiangong-lca/mcp-server

pnpm dlx dotenv-cli -e .env -- tiangong-lca-mcp-stdio
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

## 开发

### 环境设置

```bash
# 安装 Node.js
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.2/install.sh | bash
nvm install 24.19.0
nvm use 24.19.0

# 安装精确包管理器并按冻结 lock 安装依赖
corepack install --global pnpm@11.23.0
pnpm install --frozen-lockfile
```

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

功能变更合并后，由单独跟踪的 release task 执行发布。Trusted publishing workflow 使用 pnpm frozen lock 安装并运行标准门禁；Tag 继续使用本单包仓库的 `v<package.version>` 格式，本次 `0.1.0` 对应 `v0.1.0`。

### 测试脚手架

```bash
pnpm exec tsx scripts/openlca-ipc-smoke.ts
```

### 发布

```bash
docker build --no-cache -t 339712838008.dkr.ecr.us-east-1.amazonaws.com/tiangong-lca-mcp:0.1.0 .

aws ecr get-login-password --region us-east-1  | docker login --username AWS --password-stdin 339712838008.dkr.ecr.us-east-1.amazonaws.com

docker push 339712838008.dkr.ecr.us-east-1.amazonaws.com/tiangong-lca-mcp:0.1.0

docker run -d -p 9278:9278 --env-file .env 339712838008.dkr.ecr.us-east-1.amazonaws.com/tiangong-lca-mcp:0.1.0
```
