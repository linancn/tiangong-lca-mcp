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
lastReviewedAt: 2026-09-01
lastReviewedCommit: a0ef9c9389726734730282488c952cda80e6a0ca
lastReviewedNote: 'Reviewed for Issue #68: remote HTTP is broker-only and all legacy API-key/Cognito classifiers are removed without changing token isolation, tools, or transport ownership.'
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
| HTTP | `src/index_server.ts` | OAuth-protected Streamable HTTP on `POST /mcp`, `/health`, root discovery, and broker endpoints | search wrappers, GLAD dataset tools, and `Database_CRUD_Tool` |
| HTTP local | `src/index_server_local.ts` | local Streamable HTTP on `POST /mcp` plus `/health` | OpenLCA tools, TIDAS validation, prompts, resources |

The executable HTTP entries delegate app construction to `src/http_app.ts` and `src/http_app_local.ts`. Importing an entry does not bind a port; each stateless request receives a request-scoped MCP server and transport, and response closure triggers bounded cleanup. Server construction itself is inside the common JSON-RPC error boundary, so both authenticated and local factory throws return a generic JSON 500 without leaking the exception or Express stack HTML. Authenticator, factory, and transport logs expose only stable redacted code/category fields, never the caught message or stack. This split is the offline test seam for health, method guards, auth errors, JSON-RPC errors, discovery, cancellation, and factory cleanup.

## Auth Decision Tree

The authenticated HTTP path has one mode: `broker`. It accepts only audience-bound MCP access tokens issued by this service. `src/_shared/oauth_runtime.ts` verifies an opaque MCP access token through `SupabaseOAuthBrokerProvider`, attaches the SDK `AuthInfo` to the request, and gives tool wrappers only the separate upstream Supabase access token from encrypted server-side state. Direct Supabase/Cognito bearer tokens and password-encoded user API keys are rejected without fallback I/O.

Broker access/refresh tokens, authorization codes, and states are random handles. Redis keys contain SHA-256 handle digests under `auth:mcp-oauth:v1:*`; values are AES-256-GCM envelopes whose additional authenticated data binds each value to its logical key. Refresh handles are consumed atomically, so one request wins a rotation race and replay fails closed. Upstash uses `GETDEL`; the in-memory qualification store performs map read/delete synchronously before returning its Promise, so it cannot yield between observation and consumption. No legacy API-key cache namespace is part of the runtime.

## OAuth Surface

The MCP OAuth router lives in `src/auth_app.ts`, backed by `src/_shared/supabase_oauth_broker.ts` and `src/_shared/oauth_broker_store.ts`.

The authenticated HTTP server publishes:

- `/.well-known/oauth-protected-resource/mcp` for the canonical MCP resource;
- `/.well-known/oauth-authorization-server` for authorization-server discovery;
- `/authorize`, `/token`, and `/revoke` for the fixed MCP host clients;
- `/oauth/callback` as the exact confidential Supabase broker callback;
- `POST /mcp` with a `WWW-Authenticate` challenge that points to protected-resource metadata.

The broker starts a second PKCE transaction against Supabase. It consumes the Supabase code itself, encrypts the upstream refresh session, then returns a new broker authorization code to the MCP host. The host never receives a Supabase token. Dynamic client registration and the previous code-display/demo pages are absent from the first release.

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

This path calls SDK `validateEnhanced()` once before graph construction or Supabase process lookup. Select remains an actor-bound PostgREST read. Ordinary insert/update computes the prepared payload once, then calls `app_dataset_create` or `app_dataset_save_draft`; ordinary delete calls `app_dataset_delete`. LifecycleModel insert/update instead sends the prepared `jsonOrdered`/`jsonTg` parent through `save_lifecycle_model_bundle`, and delete uses `delete_lifecycle_model_bundle`, preserving the existing atomic bundle contract. These Edge commands preserve the downstream Supabase actor/client token and invoke the existing command-cutover RPCs: the MCP client receives `DB-CORE-WRITE-01` for ordinary dataset commands and `EDGE-BUNDLE-01` for LifecycleModels, so raw core-table DML never reopens. Strict-invalid LifecycleModels throw a stable `TIDAS_VALIDATION_FAILED` envelope with normalized code/path/severity, make zero auth/REST/process-lookup requests, and never reach a write. A strict-success result alone may derive `json_tg` and `rule_verification`; insert/update responses echo the exact SDK `validationIssueCount` and `validationIssues` (normally zero/empty in strict success), and those response-evidence fields are not added to the database row.

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

The Docker runtime installs that same exact package version. Packed-consumer proof must import all three entrypoints without side effects, assert that the production archive contains the OAuth broker store/runtime, Supabase broker, and HTTP app while removed legacy modules are absent, then execute the globally installed HTTP bin through the generated package-manager shim and receive `/health`. A registry tarball published before those modules or executable proof existed is not an eligible image input even when the repository Dockerfile itself comes from a newer commit.

On Node Alpine, Corepack activation and pnpm global installation are separate boundaries: `corepack enable pnpm` creates the executable shim, exact global install activates `11.24.0`, and `/pnpm/bin` must remain in the final OCI `PATH` so the packaged MCP bins are the default container command. A real no-cache Linux ARM64 build is the required proof for this path.

The build upgrades Alpine packages before package-manager setup and records the installed OpenSSL version. The ECR qualification command disables provenance so the tag resolves to one scan-compatible ARM64 image manifest instead of an OCI index. The tag is commit-bearing and must be absent before push. Qualification reuses scan-on-push, starts only for `ScanNotFoundException`, preserves every other probe error, and exits before run unless the result is COMPLETE with exactly zero CRITICAL and HIGH findings. A vulnerable or unscannable image remains evidence only and is never an ECS task input.

The MCP `0.1.4` package graph is single-track Node `24.19.0`, pnpm `11.24.0`, TypeScript `7.0.2`, TIDAS SDK `0.2.0`, Upstash Redis `1.38.3`, and Zod `4.5.4`. Inspector `2.4.0`, React DOM `19.2.8`, and tsx `4.23.13` are development-only; React DOM supplies Inspector's React 19 peer without entering the production archive. The packed-consumer proof imports all three packaged entry modules from an arbitrary path, verifies that compiler, lint, test, and Inspector/React tooling is absent from the production install, and proves that canonical realpath comparison still treats the generated global shim target as the executable entrypoint.

Nested consumer and clean-worktree commands cannot assume Corepack environment variables: they scan `PATH` for the official native `pnpm` or `pnpm.exe`, verify exact version `11.24.0`, and execute with argv plus `shell: false`. A verified `COREPACK_ROOT/dist/pnpm.js` invocation remains a fallback for local Corepack shells.

## Common Misreads

- this repo is not the source of truth for remote search algorithms
- the broker callback is not a consent UI; Next owns Supabase login and consent at `/oauth/consent`
- `pnpm test` is an offline assertion suite; it does not imply live OpenLCA, GLAD, Supabase, or production proof
- a merged child PR does not finish workspace delivery

## Local Docpact Push Gate

This repository has a versioned local `pre-push` hook under `.githooks/pre-push` that delegates to `scripts/docpact-gate.sh`. The gate resolves the CLI through `scripts/docpact`, so local agent shells do not need bare `docpact` on `PATH`. The hook is a local developer guard for docpact config validation and enforced doc-governance linting; ordinary PRs and pushes rely on the local gate; `.github/workflows/ai-doc-lint.yml` is manual-dispatch fallback for remote reproduction.
