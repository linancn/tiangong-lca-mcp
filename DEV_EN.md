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
  - pnpm-lock.yaml
  - pnpm-workspace.yaml
  - Dockerfile
  - .nvmrc
  - .gitattributes
  - src/**
  - test/**
  - scripts/**
lastReviewedAt: 2026-08-31
lastReviewedCommit: 5e442454172593bcaaa69dbefe32e9dbe8e92dc7
lastReviewedNote: 'Reviewed for Issue #52: maintainer guidance covers the fixed-client OAuth broker and the downstream actor-token path across PostgREST reads, ordinary dataset commands, and LifecycleModel bundle commands.'
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
corepack install --global pnpm@11.24.0
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

## Development

### Environment Setup

```bash
# Install Node.js
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.2/install.sh | bash
nvm install 24.19.0
nvm use 24.19.0

# Install the exact package manager and frozen dependency graph
corepack install --global pnpm@11.24.0
pnpm install --frozen-lockfile
```

### OAuth Broker Setup

The remote HTTP entry is configured from `.env.example`. For local workspace testing, copy the non-secret Supabase broker settings into a private env file and load the Edge/MCP Redis values from `tiangong-lca-edge-functions/.env`; both runtimes use `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`. Never substitute Portal's separate `UPSTASH_REDIS_URL`/`UPSTASH_REDIS_TOKEN` pair.

Dev requires these exact control-plane facts:

1. Supabase OAuth Server enabled with Dynamic Client Registration disabled and authorization path `/oauth/consent`.
2. A fixed confidential Supabase client whose redirect is `http://localhost:9278/oauth/callback`.
3. At least one fixed public MCP host client in `MCP_OAUTH_HOST_CLIENTS_JSON`; MCP Inspector CLI/TUI normally uses `http://127.0.0.1:6276/oauth/callback`.
4. A 32-byte random `MCP_OAUTH_SESSION_ENCRYPTION_KEY`, the Supabase client secret, and Redis REST token held outside Git.

Set `MCP_AUTH_MODE=broker_compat` for qualification, then `broker` after the legacy API-key retirement gate. `legacy` is an explicit rollback setting, not the normal local or production mode.

The authorization server exposes `/authorize`, `/token`, and `/revoke`; its upstream callback is `/oauth/callback`. Verify discovery before a live flow:

```bash
curl --fail http://localhost:9278/.well-known/oauth-protected-resource/mcp
curl --fail http://localhost:9278/.well-known/oauth-authorization-server
```

The live Dev proof must record PKCE, refresh rotation, replay failure, local revoke, database actor/client behavior, and inbound/downstream token inequality without printing any token or secret. Offline tests use a fake Supabase endpoint and do not replace that proof.

`Database_CRUD_Tool` keeps selects on actor-bound PostgREST. Ordinary create/save/delete calls the three `app_dataset_*` Edge commands and requires `DB-CORE-WRITE-01`; LifecycleModel create/save/delete calls the existing save/delete bundle endpoints and requires `EDGE-BUNDLE-01`. The fixed MCP OAuth client also needs `DB-CORE-READ-01`. Do not grant direct table DML or replace these commands with service-role writes.

### Code Formatting

```bash
# Read-only lint, format check, and TypeScript 7 typecheck
pnpm lint

# Explicit formatting write
pnpm format
```

### Local Testing

#### STDIO Server

```bash
# Launch the STDIO Server using MCP Inspector
pnpm start
```

#### Launch MCP Inspector

Use `pnpm start:server` or `pnpm start:server-local`. The cross-platform launcher starts the matching HTTP server and Inspector without POSIX-only environment syntax.

### Canonical Validation

```bash
pnpm prepush:gate
```

This runs read-only lint/typecheck, offline behavior tests, packed-consumer validation, build, exact toolchain checks, audit, dry-run pack, and a frozen clean-worktree rerun. Production, GLAD, Supabase, and OpenLCA calls are not part of this offline gate.

### Publishing

Publishing is handled by a separately tracked release task after the feature change merges. The trusted-publishing workflow installs with pnpm's frozen lock, runs the canonical gate, and keeps the existing single-package tag format `v<package.version>`; release `0.1.0` maps to `v0.1.0`.

### scaffold

```bash
pnpm exec tsx scripts/openlca-ipc-smoke.ts
```

### Deployment

```bash
docker build --no-cache -t 339712838008.dkr.ecr.us-east-1.amazonaws.com/tiangong-lca-mcp:0.1.0 .

aws ecr get-login-password --region us-east-1  | docker login --username AWS --password-stdin 339712838008.dkr.ecr.us-east-1.amazonaws.com

docker push 339712838008.dkr.ecr.us-east-1.amazonaws.com/tiangong-lca-mcp:0.1.0

docker run -d -p 9278:9278 --env-file .env 339712838008.dkr.ecr.us-east-1.amazonaws.com/tiangong-lca-mcp:0.1.0
```
