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
lastReviewedAt: 2026-08-25
lastReviewedCommit: f50772e9c6165cc88c0ca3d4af681784bc4f14c9
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
- packed runtime-consumer validation in a path containing spaces
- build, exact toolchain assertion, high-severity dependency audit, and dry-run pack
- a frozen install plus lint/test/build/toolchain/pack rerun in a clean arbitrary-path worktree

## Validation Matrix

| Change type | Minimum local proof | Additional proof when risk is higher | Notes |
| --- | --- | --- | --- |
| `src/index*.ts`, `src/http_app*.ts`, or transport init helpers | `pnpm test`; `pnpm build` | run the relevant built entrypoint through the intended start script when the task explicitly includes an interactive smoke check | Offline tests cover import side effects, health, method guards, JSON-RPC parsing, discovery, cleanup, and cancellation. |
| auth middleware, config, or OAuth flow | `pnpm test`; `pnpm lint` | record any live-token proof separately and only when the task authorizes it | Authenticator exceptions must remain a generic JSON-RPC 500 envelope; bearer denial remains 401/403. |
| search wrappers, GLAD dataset tools, DB CRUD wrapper, or lifecyclemodel preprocessing | `pnpm test`; `pnpm lint` | run an authorized remote case only when its external owner and safety boundary are explicit | Offline tests mock search transport, reject malformed CRUD input before network access, cover exact select/insert/update/delete success URLs, methods, headers, bodies and envelopes, cover all declared TIDAS types, and preserve LifecycleModel `validationIssues`. |
| local OpenLCA helpers | `pnpm build`; `pnpm lint` | run `pnpm exec tsx scripts/openlca-ipc-smoke.ts` only when the task explicitly includes a local OpenLCA smoke check | The active runtime path is `olca-ipc`, not the commented gRPC scaffold. |
| package, pnpm, Node, TypeScript, lint, Docker, or client config | `pnpm prepush:gate` | inspect `pnpm list --depth Infinity` when compiler or runtime leakage is in scope | Recheck `DEV_EN.md` and `DEV_CN.md` whenever the exact baseline or startup path changes. |
| release automation under `scripts/ci/**` or `.github/workflows/publish.yml` | inspect the workflow/script diff; `pnpm prepush:gate` | record tag naming, `main` ancestry, and unpublished-version checks | The feature task prepares release-ready artifacts; version/tag/publish remains a separately tracked release action. |
| `public/**` only | `pnpm build`; `pnpm lint` | inspect the served page path if the task changes OAuth demo or index behavior | Static pages are part of the transport surface here. |
| governed docs only | `scripts/docpact validate-config --root . --strict`; `scripts/docpact lint --root . --staged --mode enforce` | run one focused route check such as `transport-auth`, `mcp-tools`, or `openlca-tidas` when routing changes | Refresh review metadata even when prose-only docs change. |

## Known Caveats

Facts that matter today:

- `.nvmrc`, `Dockerfile`, package engines, pnpm workspace policy, and maintainer docs must stay aligned on Node `24.19.0` and pnpm `11.23.0`
- the only compiler in the direct or recursive graph is TypeScript `7.0.2`; SDK `0.2.0` must not reintroduce `ts-to-zod` or TypeScript 5/6
- local tests do not contact TianGong production, GLAD, Supabase, or OpenLCA; external proof must be separately authorized and recorded
- the four-platform workflow is the authoritative portability proof after PR submission; local macOS proof alone is not four-platform evidence

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
