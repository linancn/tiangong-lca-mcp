---
title: TianGong LCA MCP Maintainer Notes EN
docType: guide
scope: repo
status: active
authoritative: false
owner: mcp
language: en
whenToUse:
  - when you need maintainer-facing MCP development, formatting, testing, publish, or deployment commands in English
whenToUpdate:
  - when maintainer-facing runtime prerequisites, development commands, publish steps, or deployment notes change
checkPaths:
  - DEV_EN.md
  - DEV_CN.md
  - package.json
  - Dockerfile
  - .nvmrc
  - src/**
  - test/**
lastReviewedAt: 2026-04-24
lastReviewedCommit: bf48b7fd4c9115350b00fddba3d302188007f2f4
related:
  - AGENTS.md
  - .docpact/config.yaml
  - docs/agents/repo-validation.md
  - docs/agents/repo-architecture.md
  - DEV_CN.md
---

# TianGong-AI-MCP

[中文](https://github.com/linancn/tiangong-lca-mcp/blob/main/DEV_CN.md) | [English](https://github.com/linancn/tiangong-lca-mcp/blob/main/DEV_EN.md)

TianGong AI Model Context Protocol (MCP) Server supports STDIO and StreamableHttp protocols.

## Starting MCP Server

### Client STDIO Server

```bash
npm install -g @tiangong-lca/mcp-server

npx dotenv -e .env -- \
npx -p @tiangong-lca/mcp-server tiangong-lca-mcp-stdio
```

### Using Docker

```bash
# Build MCP server image using Dockerfile (optional)
docker build -t linancn/tiangong-lca-mcp-server:0.0.5 .

# Pull MCP server image
docker pull linancn/tiangong-lca-mcp-server:0.0.5

# Start MCP server using Docker
docker run -d \
    --name tiangong-lca-mcp-server \
    --publish 9278:9278 \
    --env-file .env \
    linancn/tiangong-lca-mcp-server:0.0.5
```

## Development

### Environment Setup

```bash
# Install Node.js
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.2/install.sh | bash
nvm install 24
nvm use 24

# Install dependencies
npm ci
```

### Code Formatting

```bash
# Format code using the linter
npm run lint
```

### Local Testing

#### STDIO Server

```bash
# Launch the STDIO Server using MCP Inspector
npm start
```

#### Launch MCP Inspector

```bash
npx @modelcontextprotocol/inspector
```

### Publishing

```bash
npm version patch
git push origin main --follow-tags
```

Publishing is handled by GitHub Actions trusted publishing. Tags must keep the existing single-package format `v<package.version>`; for example, package version `0.0.30` must be released from tag `v0.0.30`.

### scaffold

```bash
npx tsx src/tools/openlca_ipc_test.ts
```

### Deployment

```bash
docker build --no-cache -t 339712838008.dkr.ecr.us-east-1.amazonaws.com/tiangong-lca-mcp:0.0.6 .

aws ecr get-login-password --region us-east-1  | docker login --username AWS --password-stdin 339712838008.dkr.ecr.us-east-1.amazonaws.com

docker push 339712838008.dkr.ecr.us-east-1.amazonaws.com/tiangong-lca-mcp:0.0.6

docker run -d -p 9278:9278 --env-file .env 339712838008.dkr.ecr.us-east-1.amazonaws.com/tiangong-lca-mcp:0.0.6
```
