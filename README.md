---
title: TianGong LCA MCP README EN
docType: guide
scope: repo
status: active
authoritative: false
owner: mcp
language: en
whenToUse:
  - when you need English user-facing MCP package setup, Docker usage, local startup, or inspector examples
whenToUpdate:
  - when English startup commands, Docker usage, package invocation, or user-facing MCP examples change
checkPaths:
  - README.md
  - README_CN.md
  - package.json
  - Dockerfile
  - mcp_config.json
  - src/index.ts
  - src/index_server.ts
  - src/index_server_local.ts
  - src/http_app.ts
  - src/http_app_local.ts
lastReviewedAt: 2026-08-25
lastReviewedCommit: 6871ce361cc6f382654424be1064a24c1edf2031
lastReviewedNote: 'Reviewed for release Issue #48: public Docker examples consistently target MCP server 0.1.0.'
related:
  - AGENTS.md
  - .docpact/config.yaml
  - DEV_EN.md
  - README_CN.md
---

# TianGong-LCA-MCP

[中文](https://github.com/linancn/tiangong-lca-mcp/blob/main/README_CN.md) | [English](https://github.com/linancn/tiangong-lca-mcp/blob/main/README.md)

TianGong LCA Model Context Protocol (MCP) Server supports STDIO and Streamable Http protocols.

## Environment

GLAD dataset search tools require a GLAD API key in the server environment:

```bash
GLAD_API_KEY=your-glad-api-key
GLAD_API_BASE_URL=https://www.globallcadataaccess.org/api/v1
```

## Starting MCP Server

### Client STDIO Server

```bash
corepack install --global pnpm@11.23.0
pnpm add --global @tiangong-lca/mcp-server

pnpm dlx dotenv-cli -e .env -- tiangong-lca-mcp-stdio
```

### Using Docker

```bash
# Build MCP server image using Dockerfile (optional)
docker build -t linancn/tiangong-lca-mcp-server:0.1.0 .

# Pull MCP server image
docker pull linancn/tiangong-lca-mcp-server:0.1.0

# Start MCP server using Docker
docker run -d \
    --name tiangong-lca-mcp-server \
    --publish 9278:9278 \
    --env-file .env \
    linancn/tiangong-lca-mcp-server:0.1.0
```

## Local Testing

### STDIO Server

```bash
# Launch the STDIO Server using MCP Inspector
pnpm start
```

### Streamable Http Server

```bash
pnpm start:server
```

#### Streamable Http Local Server

```bash
pnpm start:server-local
```

The HTTP start commands launch MCP Inspector through a cross-platform Node argv wrapper and inject the development-only Inspector environment without POSIX shell syntax.
