---
title: mcp AI Working Guide
docType: contract
scope: repo
status: active
authoritative: true
owner: mcp
language: en
whenToUse:
  - when a task may change MCP transports, auth surfaces, tool registration, OAuth demo pages, or lifecycle-model preprocessing in tiangong-lca-mcp
  - when routing work from the workspace root into tiangong-lca-mcp
  - when deciding whether a change belongs here, in tiangong-lca-edge-functions, in tiangong-lca-next, or in tidas-tools
whenToUpdate:
  - when runtime modes, auth boundaries, or tool registration change
  - when validation or runtime prerequisites change
  - when the repo-local AI bootstrap docs under ai/ change
checkPaths:
  - AGENTS.md
  - README.md
  - README_CN.md
  - DEV_EN.md
  - DEV_CN.md
  - ai/**/*.md
  - ai/**/*.yaml
  - package.json
  - .nvmrc
  - Dockerfile
  - .env.example
  - mcp_config.json
  - src/**
  - public/**
  - test/**
lastReviewedAt: 2026-04-18
lastReviewedCommit: ec9c15dfcbb398b56b5da7e918a3a6c7ae8d1414
related:
  - ai/repo.yaml
  - ai/task-router.md
  - ai/validation.md
  - ai/architecture.md
  - README.md
  - DEV_EN.md
---

## Repo Contract

`tiangong-lca-mcp` owns TianGong LCA MCP transports and tool exposure: STDIO, authenticated Streamable HTTP, local Streamable HTTP, OAuth helpers, tool registration, and lifecycle-model preprocessing that is intentionally part of the MCP surface. Start here when the task may change how MCP clients connect or what this MCP server exposes.

## AI Load Order

Load docs in this order:

1. `AGENTS.md`
2. `ai/repo.yaml`
3. `ai/task-router.md`
4. `ai/validation.md`
5. `ai/architecture.md`
6. `README.md` or `DEV_EN.md` only for human-oriented setup details

Do not start by assuming that remote search behavior or product UI truth lives in this repository.

## Repo Ownership

This repo owns:

- MCP transports under `src/index.ts`, `src/index_server.ts`, and `src/index_server_local.ts`
- auth middleware, config, and OAuth helpers under `src/_shared/**` and `src/auth_app.ts`
- MCP tool registration and tool wrappers under `src/tools/**`
- MCP prompts and resources under `src/prompts/**` and `src/resources/**`
- static OAuth demo pages under `public/**`
- the checked-in client example in `mcp_config.json`

This repo does not own:

- remote search implementation or Edge Function business logic
- Next.js product UI behavior
- standalone TIDAS conversion, export, or batch tooling
- workspace integration state after merge

Route those tasks to:

- `tiangong-lca-edge-functions` for remote hybrid-search or API runtime behavior
- `tiangong-lca-next` for product UI behavior
- `tidas-tools` for standalone conversion, validation, and export tooling
- `lca-workspace` for root integration after merge

## Runtime Facts

- Repo-local AI-doc maintenance is enforced by `.github/workflows/ai-doc-lint.yml` using the vendored `.github/scripts/ai-doc-lint.*` files.
- Published binaries:
  - `tiangong-lca-mcp-stdio`
  - `tiangong-lca-mcp-http`
  - `tiangong-lca-mcp-http-local`
- The checked-in runtime prerequisites are currently inconsistent:
  - `.nvmrc` and `Dockerfile` imply Node 24
  - `DEV_EN.md` still says Node 22
- `npm run lint` is mutating because it runs Prettier with `--write`
- `npm test` is currently a demo/manual script for TIDAS validation examples, not an assertion-heavy test suite

## Hard Boundaries

- Do not treat the MCP repo as the source of truth for remote Edge search semantics
- Do not move product UI or app workflow behavior into this repo
- Do not document `npm test` as a strong automated regression suite; it is currently a manual/demo path
- Do not treat a merged repo PR here as workspace-delivery complete if the root repo still needs a submodule bump

## Workspace Integration

A merged PR in `tiangong-lca-mcp` is repo-complete, not delivery-complete.

If the change must ship through the workspace:

1. merge the child PR into `tiangong-lca-mcp`
2. update the `lca-workspace` submodule pointer deliberately
3. complete any later workspace-level validation that depends on the updated MCP snapshot
