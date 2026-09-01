---
title: mcp Validation Guide
docType: guide
scope: repo
status: active
authoritative: false
owner: mcp
language: en
whenToUse:
  - when a tiangong-lca-mcp change is ready for local validation
  - when deciding the minimum proof required for transport, auth, tool-wrapper, config, or docs changes
  - when writing PR validation notes for tiangong-lca-mcp work
whenToUpdate:
  - when the repo gains a new canonical test wrapper or safer validation path
  - when change categories require different proof
  - when runtime prerequisites or validation caveats change
checkPaths:
  - docs/agents/repo-validation.md
  - .docpact/config.yaml
  - package.json
  - pnpm-lock.yaml
  - pnpm-workspace.yaml
  - .nvmrc
  - .gitattributes
  - tsconfig.json
  - tsconfig.build.json
  - .oxlintrc.json
  - Dockerfile
  - .env.example
  - mcp_config.json
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
lastReviewedCommit: f2da1fed5fc1d2cdeb7821650b2619874819bd2d
lastReviewedNote: 'Reviewed for Issue #68: broker-only validation rejects removed API-key/Cognito modes, proves no fallback I/O, and retains full OAuth/package/global-bin evidence.'
related:
  - ../../AGENTS.md
  - ../../.docpact/config.yaml
  - ./repo-architecture.md
  - ../../README.md
  - ../../README_CN.md
  - ../../DEV_EN.md
  - ../../DEV_CN.md
---

## Default Baseline

Unless the change is doc-only, the current baseline is:

```bash
pnpm install --frozen-lockfile
pnpm prepush:gate
```

The gate is intentionally non-mutating and includes:

- type-aware Oxlint with warnings denied, Prettier check, and TypeScript 7 typecheck
- offline Node assertions for tool, TIDAS, LifecycleModel, CRUD/search, auth, HTTP, error, and cancellation contracts
- packed runtime-consumer validation in a path containing spaces, including a real global-bin `/health` probe through the package-manager shim
- build, exact toolchain assertion, high-severity dependency audit, and dry-run pack
- a frozen install plus lint/test/build/toolchain/pack rerun in a clean arbitrary-path worktree

## Validation Matrix

| Change type | Minimum local proof | Additional proof when risk is higher | Notes |
| --- | --- | --- | --- |
| `src/index*.ts`, `src/http_app*.ts`, or transport init helpers | `pnpm test`; `pnpm build` | run the relevant built entrypoint through the intended start script when the task explicitly includes an interactive smoke check | Offline tests cover import side effects, health, method guards, JSON-RPC parsing, discovery, cleanup, cancellation, and repeated authenticated/local factory throws with sentinel leak checks. |
| broker verification, config, or OAuth flow | `pnpm test`; `pnpm lint` | run the authorized Dev PKCE/refresh/revoke proof, then record it separately | Broker tests must reject removed `legacy`/`broker_compat` modes and arbitrary legacy bearers before fallback I/O, then cover path-aware metadata, fixed clients/no DCR, exact resource, PKCE, encrypted Redis, one-winner `take()`, token inequality, SDK auth context, Origin, refresh rotation, replay, and revoke. Denials use OAuth-standard 401/403 and never expose provider details. |
| search wrappers, GLAD dataset tools, DB CRUD wrapper, or lifecyclemodel preprocessing | `pnpm test`; `pnpm lint` | run an authorized remote case only when its external owner and safety boundary are explicit | Offline tests mock search transport, reject malformed CRUD input before network access, prove select uses PostgREST, ordinary writes use the three exact dataset-command URLs, and LifecycleModel writes use save/delete bundle URLs with the prepared parent plan (never raw table DML). They run all declared TIDAS types through SDK `validateEnhanced()` and prove a real strict-invalid LifecycleModel with a structurally valid access JWT plus refresh token returns normalized issues with fetch count zero before any auth/session/REST/write action. |
| local OpenLCA helpers | `pnpm build`; `pnpm lint` | run `pnpm exec tsx scripts/openlca-ipc-smoke.ts` only when the task explicitly includes a local OpenLCA smoke check | The active runtime path is `olca-ipc`, not the commented gRPC scaffold. |
| package, dependency, pnpm, Node, TypeScript, lint, Docker, or client config | `pnpm prepush:gate`; `pnpm outdated --format json`; `pnpm peers check` | inspect `pnpm list --depth Infinity` when compiler, peer, or runtime leakage is in scope; after publishing, compare registry version/integrity and packed broker files, then run a no-cache no-provenance Linux ARM64 Docker build, inspect patched OS packages plus OCI architecture/PATH/default bin, push an absent immutable-style tag, verify a single scan-compatible manifest, reuse scan-on-push or start only for `ScanNotFoundException`, and wait for COMPLETE with zero HIGH/CRITICAL | Direct packages must be latest stable for Node 24; retain `@types/node` on its latest 24.x release even when a newer runtime major exists. Inspector 2.4's React peer graph is development-only and must be clean while absent from the packed production tree. Preserve every non-`ScanNotFoundException` probe failure. Require `apk upgrade --no-cache`, `--provenance=false`, and a fail-closed COMPLETE/zero-CRITICAL/zero-HIGH assertion before run; Docker's global package pin must equal `package.json.version`. Packed-consumer proof must contain OAuth broker store/runtime, Supabase broker, and HTTP app, prove removed legacy modules absent, then execute the global HTTP bin through the generated package-manager shim and receive `/health`. |
| release automation under `scripts/ci/**` or `.github/workflows/publish.yml` | inspect the workflow/script diff; `pnpm prepush:gate` | record tag naming, `main` ancestry, and unpublished-version checks | The feature task prepares release-ready artifacts; version/tag/publish remains a separately tracked release action. |
| `public/**` only | `pnpm build`; `pnpm lint` | confirm no authorization code/token display page became reachable | The directory is packaging-compatible only; remote OAuth protocol endpoints are runtime routes and no static demo is served. |
| governed docs only | `scripts/docpact validate-config --root . --strict`; `scripts/docpact lint --root . --staged --mode enforce` | run one focused route check such as `transport-auth`, `mcp-tools`, or `openlca-tidas` when routing changes | Refresh review metadata even when prose-only docs change. |

## Known Caveats

Facts that matter today:

- `.nvmrc`, `Dockerfile`, package engines, pnpm workspace policy, and maintainer docs must stay aligned on Node `24.19.0` and pnpm `11.24.0`
- the only compiler in the direct or recursive graph is TypeScript `7.0.2`; SDK `0.2.0` must not reintroduce `ts-to-zod` or TypeScript 5/6
- local tests do not contact TianGong production, GLAD, Supabase, or OpenLCA; external proof must be separately authorized and recorded
- local OAuth tests use a fake upstream and in-memory raw store; they prove protocol/state behavior but do not prove a Supabase client registration, Upstash account, ALB route, or ECS secret wiring
- the four-platform workflow is the authoritative portability proof after PR submission; local macOS proof alone is not four-platform evidence
- `.gitattributes` enforces LF for tracked text so Windows checkout cannot turn a read-only Prettier check into a whole-repository false failure
- `pnpm/setup` native distributions do not guarantee `COREPACK_ROOT`; nested tests must pass with that variable absent, exact native `pnpm`/`pnpm.exe`, paths containing spaces, and `shell: false`

## Minimum PR Note Quality

A good PR note for this repo should say:

1. which commands ran
2. exact test count and whether packed-consumer and clean-worktree proofs passed
3. whether a manual transport, OAuth, or OpenLCA proof was performed or deferred
4. whether any required remote runtime proof belongs in another repo

## Local Docpact Push Gate

Install the versioned local hook once per checkout:

```bash
./scripts/install-git-hooks.sh
```

The `pre-push` hook runs `scripts/docpact-gate.sh`, which delegates CLI lookup to `scripts/docpact` and performs strict config validation plus enforced lint before the push leaves the machine. The wrapper checks `DOCPACT_BIN`, Cargo install locations, Homebrew install locations, and then `PATH`, so local agent shells should not fail only because bare `docpact` is unavailable. The default comparison base is `origin/main`. Override it for unusual stacks with `DOCPACT_BASE_REF=<ref>` or `scripts/docpact-gate.sh --base <ref>`. The gate writes its detailed report to a temporary file so normal pushes do not create `.docpact/runs/` artifacts.
