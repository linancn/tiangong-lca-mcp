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
lastReviewedCommit: 976e61ef5ba3c43f459a82512fe1b4d98970b7d7
lastReviewedNote: 'Reviewed for Issue #62: the no-cache ARM64 ECR path now disables provenance, verifies one scan-compatible manifest, and retains explicit patched-OpenSSL readback plus the zero-HIGH/CRITICAL gate.'
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

Offline qualification also calls the in-memory raw store with two concurrent `take()` operations and requires exactly one winner. This mirrors production Upstash `GETDEL`; do not reintroduce a `get()`/`await`/`delete()` sequence for one-time OAuth state, code, or refresh handles.

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

Publishing is handled by a separately tracked release task after the feature change merges. The trusted-publishing workflow installs with pnpm's frozen lock, runs the canonical gate, and keeps the existing single-package tag format `v<package.version>`; release `0.1.1` maps to `v0.1.1`. Before building the ECS image, read back the registry integrity and verify that the published archive contains the broker store/runtime, Supabase broker, auth middleware, and HTTP app proved by the packed-consumer gate.

### scaffold

```bash
pnpm exec tsx scripts/openlca-ipc-smoke.ts
```

### Deployment

```bash
set -euo pipefail

image_tag="oauth-$(git rev-parse --short=12 HEAD)-v0.1.1"
image_uri="339712838008.dkr.ecr.us-east-1.amazonaws.com/tiangong-lca-mcp"

docker build --no-cache --provenance=false --platform linux/arm64 -t "${image_uri}:${image_tag}" .

aws ecr get-login-password --region us-east-1  | docker login --username AWS --password-stdin 339712838008.dkr.ecr.us-east-1.amazonaws.com

docker push "${image_uri}:${image_tag}"

aws ecr describe-images --region us-east-1 --repository-name tiangong-lca-mcp --image-ids "imageTag=${image_tag}" --query 'imageDetails[0].imageManifestMediaType' --output text

aws ecr start-image-scan --region us-east-1 --repository-name tiangong-lca-mcp --image-id "imageTag=${image_tag}"

aws ecr wait image-scan-complete --region us-east-1 --repository-name tiangong-lca-mcp --image-id "imageTag=${image_tag}"

scan_gate="$(aws ecr describe-image-scan-findings --region us-east-1 --repository-name tiangong-lca-mcp --image-id "imageTag=${image_tag}" --query '[imageScanStatus.status, imageScanFindings.findingSeverityCounts.CRITICAL || `0`, imageScanFindings.findingSeverityCounts.HIGH || `0`]' --output text)"
expected_scan_gate="$(printf 'COMPLETE\t0\t0')"
if [ "${scan_gate}" != "${expected_scan_gate}" ]; then
  printf 'ECR scan gate failed: %s\n' "${scan_gate}" >&2
  exit 1
fi

docker run -d -p 9278:9278 --env-file .env "${image_uri}:${image_tag}"
```

The checked-in Dockerfile enables the pnpm Corepack shim before activating exact pnpm `11.24.0`, and retains `/pnpm/bin` in the final OCI `PATH`. Before ECR push, run a no-cache `linux/arm64` build and verify the image architecture plus the default `tiangong-lca-mcp-http` executable; regex-only Dockerfile proof is insufficient.

That build first runs `apk upgrade --no-cache`. Read back the installed OpenSSL packages and use a previously absent commit-bearing ECR tag. Keep `--provenance=false`: Amazon ECR basic scanning rejects an OCI index, so the pushed artifact must resolve to a single image manifest. Wait for scan status COMPLETE with zero CRITICAL/HIGH findings before running it or registering an ECS task revision.
