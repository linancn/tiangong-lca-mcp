---
title: mcp Task Router
docType: router
scope: repo
status: active
authoritative: false
owner: mcp
language: en
whenToUse:
  - when you already know the task belongs in tiangong-lca-mcp but need the right next file or next doc
  - when deciding whether a change belongs in one transport mode, auth wiring, one tool wrapper, or another repo
  - when routing between MCP wrapper work and handoffs to edge-functions, next, or tidas-tools
whenToUpdate:
  - when new transport modes or major tool families appear
  - when cross-repo boundaries change
  - when validation routing becomes misleading
checkPaths:
  - AGENTS.md
  - ai/repo.yaml
  - ai/task-router.md
  - ai/validation.md
  - ai/architecture.md
  - package.json
  - src/**
  - public/**
  - test/**
lastReviewedAt: 2026-04-18
lastReviewedCommit: ec9c15dfcbb398b56b5da7e918a3a6c7ae8d1414
related:
  - ../AGENTS.md
  - ./repo.yaml
  - ./validation.md
  - ./architecture.md
  - ../README.md
  - ../DEV_EN.md
---

## Repo Load Order

When working inside `tiangong-lca-mcp`, load docs in this order:

1. `AGENTS.md`
2. `ai/repo.yaml`
3. this file
4. `ai/validation.md` or `ai/architecture.md`
5. `README.md` or `DEV_EN.md` only for setup details

## High-Frequency Task Routing

| Task intent | First code paths to inspect | Next docs to load | Notes |
| --- | --- | --- | --- |
| Change STDIO transport behavior | `src/index.ts`, `src/_shared/init_server.ts` | `ai/validation.md`, `ai/architecture.md` | STDIO registers search tools, OpenLCA tools, prompts, resources, and guidance. |
| Change authenticated Streamable HTTP behavior | `src/index_server.ts`, `src/_shared/init_server_http.ts`, `src/auth_app.ts` | `ai/validation.md`, `ai/architecture.md` | This path owns `/mcp`, `/health`, `/oauth`, and the static OAuth pages. |
| Change local Streamable HTTP behavior | `src/index_server_local.ts`, `src/_shared/init_server_http_local.ts` | `ai/validation.md`, `ai/architecture.md` | This mode is intentionally local-only and auth-free. |
| Change bearer auth classification or session reuse | `src/_shared/auth_middleware.ts`, `src/_shared/cognito_auth.ts`, `src/_shared/decode_api_key.ts`, `src/_shared/supabase_session.ts`, `src/_shared/config.ts` | `ai/validation.md`, `ai/architecture.md` | JWT, base64 JSON API key, and Supabase token handling all live here. |
| Change static OAuth demo or index pages | `public/**`, then `src/index_server.ts` and `src/auth_app.ts` | `ai/validation.md`, `ai/architecture.md` | This repo owns only the MCP-side OAuth pages, not the product UI. |
| Change hybrid-search MCP wrappers | `src/tools/flow_hybrid_search.ts`, `src/tools/process_hybrid_search.ts`, `src/tools/life_cycle_model_hybrid_search.ts` | `ai/architecture.md`, `ai/validation.md` | Wrapper behavior lives here, but the remote search implementation lives in `edge-functions`. |
| Change DB CRUD MCP behavior or lifecyclemodel write preprocessing | `src/tools/db_crud.ts`, `src/tools/life_cycle_model_file_tools.ts` | `ai/validation.md`, `ai/architecture.md` | This repo owns the MCP wrapper and preprocessing path, not the entire product UI workflow. |
| Change TIDAS validation exposed through MCP | `src/tools/tidas_data_validation.ts` | `ai/validation.md`, `ai/architecture.md` | This repo uses `@tiangong-lca/tidas-sdk`, not `tidas-tools`, for its in-process validation surface. |
| Change local OpenLCA helpers | `src/tools/openlca_ipc_*.ts` | `ai/validation.md`, `ai/architecture.md` | The gRPC file is scaffold only; the active runtime path is `olca-ipc`. |
| Change actual remote search semantics or Edge response behavior | `tiangong-lca-edge-functions`, not this repo | root `ai/task-router.md` | This repo wraps those routes; it does not own their business logic. |
| Change standalone TIDAS conversion/export/CLI tooling | `tidas-tools`, not this repo | root `ai/task-router.md` | Keep batch tooling out of the MCP repo. |
| Change repo-local AI-doc maintenance only | `AGENTS.md`, `ai/**`, `.github/workflows/ai-doc-lint.yml`, `.github/scripts/ai-doc-lint.*` | `ai/validation.md` when present, otherwise `ai/repo.yaml` | Keep the repo-local maintenance gate aligned with root `ai/ci-lint-spec.md` and `ai/review-matrix.md`. |
| Decide whether work is delivery-complete after merge | root workspace docs, not repo code paths | root `AGENTS.md`, `_docs/workspace-branch-policy-contract.md` | Root integration remains a separate phase. |

## Wrong Turns To Avoid

### Fixing remote search truth only in the MCP wrapper

If the actual search algorithm or Edge response changed, route the runtime fix to `tiangong-lca-edge-functions`.

### Treating public OAuth demo pages as product UI ownership

`public/**` here belongs to the MCP server. Product UI still belongs elsewhere.

### Assuming npm test is a strong automated gate

`npm test` currently runs a demo-style TIDAS validation script. Do not treat it as comprehensive regression proof.

## Cross-Repo Handoffs

Use these handoffs when work crosses boundaries:

1. search wrapper needs remote behavior change
   - start here for wrapper changes
   - then coordinate with `tiangong-lca-edge-functions`
2. lifecyclemodel or UI workflow change actually belongs to the product app
   - route to `tiangong-lca-next`
3. standalone TIDAS tooling change
   - route to `tidas-tools`
4. merged repo PR still needs to ship through the workspace
   - return to `lca-workspace`
   - do the submodule pointer bump there
