---
title: mcp Architecture Notes
docType: guide
scope: repo
status: active
authoritative: false
owner: mcp
language: en
whenToUse:
  - when you need a compact mental model of the repo before editing transports, auth, or tool wrappers
  - when deciding which runtime mode or tool family owns a behavior change
  - when auth, OAuth, search-wrapper, or OpenLCA hotspots are mentioned without exact paths
whenToUpdate:
  - when major runtime modes or tool families change
  - when auth flow or external dependency boundaries move
  - when the current map becomes misleading
checkPaths:
  - docs/agents/repo-architecture.md
  - .docpact/config.yaml
  - package.json
  - src/**
  - public/**
  - test/**
lastReviewedAt: 2026-04-24
lastReviewedCommit: 465ee14740515a308d5d31b5dd9879281b2f3260
related:
  - ../../AGENTS.md
  - ../../.docpact/config.yaml
  - ./repo-validation.md
  - ../../README.md
  - ../../README_CN.md
  - ../../DEV_EN.md
  - ../../DEV_CN.md
---

## Runtime Mode Matrix

| Mode | Entry file | Main surface | Tool families exposed |
| --- | --- | --- | --- |
| STDIO | `src/index.ts` | `StdioServerTransport` | search wrappers, OpenLCA tools, prompts, resources, guidance |
| HTTP | `src/index_server.ts` | authenticated Streamable HTTP on `POST /mcp` plus `/health` and `/oauth` | search wrappers and `Database_CRUD_Tool` |
| HTTP local | `src/index_server_local.ts` | local Streamable HTTP on `POST /mcp` plus `/health` | OpenLCA tools, TIDAS validation, prompts, resources |

## Auth Decision Tree

The authenticated HTTP path classifies bearer tokens inside `src/_shared/auth_middleware.ts`.

Accepted shapes today:

1. Cognito access token
2. base64 JSON API key payload with `{ email, password }`
3. Supabase access token

Important supporting files:

- `src/_shared/cognito_auth.ts`
- `src/_shared/decode_api_key.ts`
- `src/_shared/supabase_session.ts`
- `src/_shared/config.ts`

API-key auth signs into Supabase and can reuse cached sessions through Upstash Redis.

## OAuth Surface

The MCP OAuth router lives in `src/auth_app.ts`.

The authenticated HTTP server mounts:

- `/oauth`
- `/oauth/index`
- `/oauth/demo`

Static assets for that flow live in `public/**`.

## Tool Families

### Remote search wrappers

These wrappers forward bearer auth and region headers to remote Edge Functions:

- `src/tools/flow_hybrid_search.ts`
- `src/tools/process_hybrid_search.ts`
- `src/tools/life_cycle_model_hybrid_search.ts`

They are wrappers, not the underlying search implementation.

### CRUD and lifecyclemodel preprocessing

The MCP-side write and preprocessing logic clusters around:

- `src/tools/db_crud.ts`
- `src/tools/life_cycle_model_file_tools.ts`

This path derives `json_tg` and `rule_verification` for lifecycle model writes.

### Local OpenLCA and TIDAS validation

This cluster lives in:

- `src/tools/openlca_ipc_lcia.ts`
- `src/tools/openlca_ipc_lcia_methods_list.ts`
- `src/tools/openlca_ipc_system_processes_list.ts`
- `src/tools/tidas_data_validation.ts`

The active local OpenLCA integration uses `olca-ipc`. The `openlca_grpc.ts` file is scaffold only.

## External Dependency Boundaries

- `edge-functions` owns remote hybrid-search and API runtime behavior
- `next` owns product UI behavior
- `tidas-tools` owns standalone conversion, export, and batch validation tooling
- this repo owns MCP transports, auth classification, and tool exposure

## Common Misreads

- this repo is not the source of truth for remote search algorithms
- the OAuth demo pages here are not the product app
- `npm test` is not a strong automated regression suite
- a merged child PR does not finish workspace delivery
