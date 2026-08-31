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
lastReviewedAt: 2026-08-31
lastReviewedCommit: ea2a23d94e9e83f5ad1f463b5e890d8ed03445b9
lastReviewedNote: 'Reviewed for Issue #56: user setup and Docker examples now select MCP 0.1.1, the first package carrying the merged Supabase OAuth broker and atomic one-time consumption fixes.'
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

Copy `.env.example` and populate its Supabase, Redis, and MCP broker values. The remote server uses `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`, intentionally not Portal's separately retained `UPSTASH_REDIS_URL` and `UPSTASH_REDIS_TOKEN` pair.

GLAD dataset search tools additionally require a GLAD API key:

```bash
GLAD_API_KEY=your-glad-api-key
GLAD_API_BASE_URL=https://www.globallcadataaccess.org/api/v1
```

## Remote OAuth

Remote Streamable HTTP is an OAuth 2.1 protected resource. A compatible MCP host discovers `/.well-known/oauth-protected-resource/mcp`, opens the user's browser, and completes Authorization Code with S256 PKCE. The user signs in and consents in Next; usernames and passwords are never entered into the AI or MCP host.

The service is a token broker: the host receives a short-lived opaque MCP token, while the server keeps a distinct Supabase access/refresh session encrypted in Upstash. Only that Supabase access token reaches Edge or PostgREST. The first release uses operator-configured fixed host clients and does not expose Dynamic Client Registration.

`MCP_AUTH_MODE` controls migration:

- `broker_compat`: broker tokens plus the legacy encoded user API key, with identifier-free transition telemetry;
- `broker`: broker tokens only;
- `legacy`: rollback-only pre-migration authentication.

There is no OAuth demo or authorization-code display page. Operators register the exact broker callback `${MCP_PUBLIC_ORIGIN}/oauth/callback` as a confidential Supabase client and keep its secret plus `MCP_OAUTH_SESSION_ENCRYPTION_KEY` in an approved secret store.

## Starting MCP Server

### Client STDIO Server

```bash
corepack install --global pnpm@11.24.0
pnpm add --global @tiangong-lca/mcp-server

pnpm dlx dotenv-cli -e .env -- tiangong-lca-mcp-stdio
```

### Using Docker

```bash
# Build MCP server image using Dockerfile (optional)
docker build -t linancn/tiangong-lca-mcp-server:0.1.1 .

# Pull MCP server image
docker pull linancn/tiangong-lca-mcp-server:0.1.1

# Start MCP server using Docker
docker run -d \
    --name tiangong-lca-mcp-server \
    --publish 9278:9278 \
    --env-file .env \
    linancn/tiangong-lca-mcp-server:0.1.1
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
