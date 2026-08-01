---
title: MCP Supabase Consumer Contract
docType: contract
scope: repo
status: active
authoritative: true
owner: mcp
language: en
whenToUse:
  - when adding or changing any Supabase consumer or MCP tool/capability wrapper
  - when reviewing Data API, Auth, Edge Function, Storage, Realtime, SQL, PGMQ, Cron, HTTP, or CLI surfaces
whenToUpdate:
  - when the v3 candidate manifest, canonical Schema, scanner, or capability mapping changes
  - when database or hosted work freezes a replacement capability
checkPaths:
  - contracts/supabase-consumer-manifest.v3.json
  - contracts/supabase-consumer-manifest.v3.schema.json
  - scripts/ci/scan-data-api-consumers.ts
  - test/supabase_consumer_manifest.test.ts
  - test/data_api_contract.test.ts
  - src/_shared/data_api_contract.ts
  - src/_shared/auth_middleware.ts
  - src/_shared/init_server*.ts
  - src/tools/**
  - package.json
  - .github/workflows/supabase-consumer-manifest.yml
lastReviewedAt: 2026-08-02
lastReviewedCommit: 31e74fb431b7ac6745673e33454911400f34e1cc
related:
  - ../../AGENTS.md
  - ./repo-architecture.md
  - ./repo-validation.md
---

## Authority Boundary

`contracts/supabase-consumer-manifest.v3.json` is permanently a `candidate` artifact. Its canonical Schema fixes every authorization boolean to `false`: it cannot authorize database freeze or migration, hosted mutation, merge, or deploy. A green local/PR verifier is proof of this repository's static source closure only.

External gates remain:

- `tiangong-lca/database-engine#357`: consume and verify the exact manifest and Schema bytes, source commit, canonical GitHub origin, and filtered governed-tree digest;
- `tiangong-lca/database-engine#358`: freeze the versioned mutation commands, signatures, ACL, audit, idempotency, and stable error contract;
- Edge, CLI, and hosted old/new-profile MCP tool lifecycle proof, including denial, retry, and duplicate-call behavior;
- `tiangong-lca/workspace#484`: merge/deploy/production and exact-SHA integration closure.

## Immutable Derivation

Run `npm run generate:supabase-consumer-manifest` only from an immutable source commit. The audit tool reads regular Git blobs through `git ls-tree`/`git show`, parses TypeScript/JavaScript with the TypeScript compiler AST and `package.json` with a JSON parser, and writes canonical pretty JSON plus LF. Each occurrence carries its exact byte/line span and SHA-256.

`sourceTreeCommit` is the audited application source. Verification separately resolves and reports the actual delivery `HEAD`, proves ancestry, and compares `sha256(mode\0path\0blobOid\0)` over all governed blobs; the manifest does not pretend a self-referential delivery commit can be embedded in its own bytes. The only exact digest exemption is `scripts/ci/scan-data-api-consumers.ts`. Manifest and Schema must themselves be canonical no-follow regular files, regular Git blobs at delivery HEAD, and byte-identical to the worktree.

Declared and independently derived occurrence rows are compared bidirectionally and globally exactly once. Missing, duplicate, swapped-capability, span/hash-tampered, schema/origin/commit drift, dynamic `.from/.rpc/.schema` targets, raw REST, direct PG/SQL, PGMQ/Cron, and Supabase subprocess/CLI bypasses fail closed.

## Capability Closure

Every occurrence maps to exactly one independently verified capability:

| Capability | Runtime transport | Supabase surface |
| --- | --- | --- |
| `Database_CRUD_Tool` | authenticated Streamable HTTP | public core relations plus SDK session setup |
| `Search_Flows_Tool` | STDIO and authenticated Streamable HTTP | `flow_hybrid_search` Edge Function HTTP wrapper |
| `Search_Processes_Tool` | STDIO and authenticated Streamable HTTP | `process_hybrid_search` Edge Function HTTP wrapper |
| `Search_Life_Cycle_Models_Tool` | STDIO and authenticated Streamable HTTP | `lifecyclemodel_hybrid_search` Edge Function HTTP wrapper |
| authenticated `POST /mcp` lifecycle | Streamable HTTP | Supabase password/bearer authentication |

The scanner verifies the literal `server.tool` registrations, registration functions in the correct server initializers, the lifecycle helper call edge into `Database_CRUD_Tool`, and the HTTP auth middleware edge. A tool name without the corresponding runtime path is not accepted.

## Public Residue And Explicit Zeroes

The only currently consumed public relations are `contacts`, `flows`, `lifecyclemodels`, `processes`, and `sources`. `flowproperties`, `ilcd`, `lciamethods`, and `unitgroups` remain explicit consumer-zero core relations in the runtime profile contract. Public RPC and view residue is zero.

The candidate also records zero Storage, Realtime, direct PostgreSQL/SQL, PGMQ/Cron, raw `/rest/v1`, service-role credential, and Supabase subprocess/CLI consumers. The three hybrid-search wrappers use raw `/functions/v1` HTTP intentionally and are mapped to their exact MCP tools and Edge upstream.

## Profiles And Mutation Semantics

`TIANGONG_LCA_DATA_API_PROFILE` accepts `legacy-public-v1` (default) or `api-contract-v1`. Legacy retains direct public writes. The new profile keeps core reads public but fails closed before insert/update/delete until database #358 freezes exact versioned command signatures. Do not guess command names or payloads.

MCP performs one SDK mutation attempt and has no automatic replay or idempotency key. Reads may use filters and a positive limit but expose no cursor, total, or completeness guarantee. SDK session refresh behavior is retained; it is not evidence for hosted ACL/RLS or retry semantics.

## Required Verification

```bash
npm run build
npm run test:data-api-contract
npm run test:supabase-consumer-manifest
npm run scan:data-api-consumers
```

The PR workflow repeats these checks from a full-history checkout. `npm run lint` is additionally required by the repository gate and is mutating because it invokes Prettier with `--write`.
