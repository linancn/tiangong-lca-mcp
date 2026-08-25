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
  - pnpm-lock.yaml
  - pnpm-workspace.yaml
  - tsconfig.json
  - tsconfig.build.json
  - .gitattributes
  - scripts/ci/**
  - .github/workflows/publish.yml
  - .github/workflows/quality-gate.yml
  - src/**
  - public/**
  - test/**
  - .githooks/pre-push
  - scripts/docpact
  - scripts/docpact-gate.sh
  - scripts/install-git-hooks.sh
lastReviewedAt: 2026-08-25
lastReviewedCommit: 0f6a09e70778af307f49c80a75e7b93af1522d36
lastReviewedNote: 'Reviewed for Issue #46 after Windows CI: repository-wide LF normalization is a validation boundary and does not alter MCP transport or tool ownership.'
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
| STDIO | `src/index.ts` | `StdioServerTransport` | search wrappers, GLAD dataset tools, OpenLCA tools, prompts, resources, guidance |
| HTTP | `src/index_server.ts` | authenticated Streamable HTTP on `POST /mcp` plus `/health` and `/oauth` | search wrappers, GLAD dataset tools, and `Database_CRUD_Tool` |
| HTTP local | `src/index_server_local.ts` | local Streamable HTTP on `POST /mcp` plus `/health` | OpenLCA tools, TIDAS validation, prompts, resources |

The executable HTTP entries delegate app construction to `src/http_app.ts` and `src/http_app_local.ts`. Importing an entry does not bind a port; each stateless request receives a request-scoped MCP server and transport, and response closure triggers bounded cleanup. Server construction itself is inside the common JSON-RPC error boundary, so both authenticated and local factory throws return a generic JSON 500 without leaking the exception or Express stack HTML. Authenticator, factory, and transport logs expose only stable redacted code/category fields, never the caught message or stack. This split is the offline test seam for health, method guards, auth errors, JSON-RPC errors, discovery, cancellation, and factory cleanup.

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

All credential denials at the authenticated HTTP boundary are generic `Forbidden`. Provider-specific strings are internal-only, and Cognito verification failures emit only the stable redacted `MCP_AUTHENTICATION_FAILED`/`cognito` log category.

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

### GLAD dataset lookup

The GLAD tools call the public Global LCA Data Access API directly and require `GLAD_API_KEY` in the MCP server environment:

- `src/tools/glad_dataset_search.ts`

These tools are read-only API wrappers for dataset descriptor search and single dataset descriptor retrieval.

### CRUD and lifecyclemodel preprocessing

The MCP-side write and preprocessing logic clusters around:

- `src/tools/db_crud.ts`
- `src/tools/life_cycle_model_file_tools.ts`

This path calls SDK `validateEnhanced()` once before graph construction or Supabase process lookup. Database insert/update computes that prepared payload once before constructing the CRUD Supabase client or applying a refresh-token session, then passes it into the operation handler without repeating validation. Strict-invalid LifecycleModels throw a stable `TIDAS_VALIDATION_FAILED` envelope with normalized code/path/severity, make zero auth/REST/process-lookup requests, and never reach a write. A strict-success result alone may derive `json_tg` and `rule_verification`; insert/update responses echo the exact SDK `validationIssueCount` and `validationIssues` (normally zero/empty in strict success), and those response-evidence fields are not added to the database row.

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

## Release Architecture

`main` pushes whose `package.json` version changes create the matching `v<version>` tag, install with pnpm's frozen lock, run the canonical pre-push gate, and publish `@tiangong-lca/mcp-server` through pnpm. Manual `v*` tag pushes and workflow-dispatch runs for existing tags remain recovery/backfill paths.

The package graph is single-track Node `24.19.0`, pnpm `11.23.0`, TypeScript `7.0.2`, and TIDAS SDK `0.2.0`. The packed-consumer proof imports all three packaged entry modules from an arbitrary path and verifies that compiler/lint/test tooling is absent from the production install.

Nested consumer and clean-worktree commands cannot assume Corepack environment variables: they scan `PATH` for the official native `pnpm` or `pnpm.exe`, verify exact version `11.23.0`, and execute with argv plus `shell: false`. A verified `COREPACK_ROOT/dist/pnpm.js` invocation remains a fallback for local Corepack shells.

## Common Misreads

- this repo is not the source of truth for remote search algorithms
- the OAuth demo pages here are not the product app
- `pnpm test` is an offline assertion suite; it does not imply live OpenLCA, GLAD, Supabase, or production proof
- a merged child PR does not finish workspace delivery

## Local Docpact Push Gate

This repository has a versioned local `pre-push` hook under `.githooks/pre-push` that delegates to `scripts/docpact-gate.sh`. The gate resolves the CLI through `scripts/docpact`, so local agent shells do not need bare `docpact` on `PATH`. The hook is a local developer guard for docpact config validation and enforced doc-governance linting; ordinary PRs and pushes rely on the local gate; `.github/workflows/ai-doc-lint.yml` is manual-dispatch fallback for remote reproduction.
