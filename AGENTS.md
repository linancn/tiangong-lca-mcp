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
  - when docpact routing, retained source docs, or repo-local governance rules change
checkPaths:
  - AGENTS.md
  - README.md
  - README_CN.md
  - DEV_EN.md
  - DEV_CN.md
  - .docpact/config.yaml
  - docs/agents/**
  - package.json
  - .nvmrc
  - Dockerfile
  - .env.example
  - mcp_config.json
  - src/**
  - public/**
  - test/**
  - .githooks/**
  - scripts/docpact-gate.sh
  - scripts/install-git-hooks.sh
lastReviewedAt: 2026-05-08
lastReviewedCommit: 0913ea7e5d25d5c038600fe0d4f304b7792e4284
related:
  - .docpact/config.yaml
  - docs/agents/repo-validation.md
  - docs/agents/repo-architecture.md
  - README.md
  - README_CN.md
  - DEV_EN.md
  - DEV_CN.md
---

## Repo Contract

`tiangong-lca-mcp` owns TianGong LCA MCP transports and tool exposure: STDIO, authenticated Streamable HTTP, local Streamable HTTP, OAuth helpers, tool registration, and lifecycle-model preprocessing that is intentionally part of the MCP surface. Start here when the task may change how MCP clients connect or what this MCP server exposes.

## Bootstrap Order

Load docs in this order:

1. `AGENTS.md`
2. `.docpact/config.yaml`
3. `docpact route --root . --intent <intent>` when you need path-specific routing
4. `docs/agents/repo-validation.md` when proof, runtime caveats, or CI behavior matters
5. `docs/agents/repo-architecture.md` when transport, auth, OAuth, or tool ownership is unclear
6. `README.md`, `README_CN.md`, `DEV_EN.md`, or `DEV_CN.md` only when user setup or maintainer runtime details are needed

Do not start by assuming that remote search behavior or product UI truth lives in this repository.

Preferred docpact commands:

- `docpact route --root . --intent transport-auth`
- `docpact route --root . --intent mcp-tools`
- `docpact route --root . --intent remote-search-wrappers`
- `docpact route --root . --intent openlca-tidas`
- `docpact route --root . --intent repo-docs`

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

- Repo-local documentation governance is encoded in `.docpact/config.yaml` and enforced by `.github/workflows/ai-doc-lint.yml` through `docpact`.
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

## Local Docpact Push Gate

Install the versioned local hook once per checkout:

```bash
./scripts/install-git-hooks.sh
```

The `pre-push` hook runs `scripts/docpact-gate.sh`, which performs strict config validation and `docpact lint --mode enforce` before the push leaves the machine. The default comparison base is `origin/main`. Override it for unusual stacks with `DOCPACT_BASE_REF=<ref>` or `scripts/docpact-gate.sh --base <ref>`. The gate writes its detailed report to a temporary file so normal pushes do not create `.docpact/runs/` artifacts.
