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
  - .nvmrc
  - Dockerfile
  - .env.example
  - mcp_config.json
  - src/**
  - public/**
  - test/**
lastReviewedAt: 2026-04-24
lastReviewedCommit: 465ee14740515a308d5d31b5dd9879281b2f3260
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
npm run build
npm run lint
npm test
```

Interpret the baseline carefully:

- `npm run lint` rewrites files because it runs Prettier with `--write`
- `npm test` runs a demo/manual validation script and is not a strong assertion suite

## Validation Matrix

| Change type | Minimum local proof | Additional proof when risk is higher | Notes |
| --- | --- | --- | --- |
| `src/index*.ts` or transport init helpers | `npm run build`; `npm run lint` | run the relevant built entrypoint directly or through the intended start script when the dependency set supports it | `start:server*` currently depends on undeclared `concurrently`; record if you used a manual alternative. |
| auth middleware, config, or OAuth flow | `npm run build`; `npm run lint` | manually inspect or run the affected built HTTP entrypoint; record any live-token proof separately | Bearer parsing, Cognito verification, and session reuse live here. |
| search wrappers, DB CRUD wrapper, or lifecyclemodel preprocessing | `npm run build`; `npm run lint`; `npm test` | manually inspect one representative payload path or run the relevant wrapper under an MCP client if the task explicitly includes it | If the actual remote behavior changes, record the companion repo proof separately. |
| local OpenLCA helpers | `npm run build`; `npm run lint` | run `npx tsx src/tools/openlca_ipc_test.ts` only when the task explicitly includes a local OpenLCA smoke check | The active runtime path is `olca-ipc`, not the commented gRPC scaffold. |
| `package.json`, `.nvmrc`, `Dockerfile`, `.env.example`, or `mcp_config.json` | `npm run build`; `npm run lint` | record the runtime prerequisite or config drift that was checked | Recheck `DEV_EN.md` and `DEV_CN.md` whenever the Node baseline or maintainer startup path changes. |
| `public/**` only | `npm run build`; `npm run lint` | inspect the served page path if the task changes OAuth demo or index behavior | Static pages are part of the transport surface here. |
| governed docs only | `docpact validate-config --root . --strict`; `docpact lint --root . --staged --mode enforce` | run one focused route check such as `transport-auth`, `mcp-tools`, or `openlca-tidas` when routing changes | Refresh review metadata even when prose-only docs change. |

## Known Caveats

Facts that matter today:

- `.nvmrc`, `Dockerfile`, `DEV_EN.md`, and `DEV_CN.md` should stay aligned on the Node 24 baseline
- `start:server` and `start:server-local` use `concurrently`, but `concurrently` is not declared in `package.json`

If you rely on a manual workaround, record it in the PR note instead of pretending the scripted path is clean.

## Minimum PR Note Quality

A good PR note for this repo should say:

1. which commands ran
2. whether any validation path was mutating or demo-only
3. whether a manual transport, OAuth, or OpenLCA proof was performed or deferred
4. whether any required remote runtime proof belongs in another repo
