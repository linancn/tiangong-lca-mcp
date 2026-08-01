---
title: MCP Data API Consumer Contract
docType: contract
scope: repo
status: active
authoritative: true
owner: mcp
language: en
whenToUse:
  - when adding or changing a Supabase Data API relation, view, RPC, schema, or profile consumer
  - when reviewing CRUD identity, retry, pagination, idempotency, error, or audit behavior
whenToUpdate:
  - when the consumer scanner inventory changes
  - when database contract work freezes a replacement capability
checkPaths:
  - src/_shared/data_api_contract.ts
  - src/tools/db_crud.ts
  - src/tools/life_cycle_model_file_tools.ts
  - scripts/ci/scan-data-api-consumers.ts
  - test/data_api_contract.test.ts
  - package.json
  - .env.example
lastReviewedAt: 2026-08-01
lastReviewedCommit: 0ab741e0881c70ce526e936d222939e38f4a4911
related:
  - ../../AGENTS.md
  - ./repo-architecture.md
  - ./repo-validation.md
---

## Provenance And Readiness

The machine-readable MCP inventory is `DATA_API_CONSUMER_MANIFEST` in `src/_shared/data_api_contract.ts`. Its database provenance is the merged `tiangong-lca/database-engine#353` inventory artifact at commit `94bfefe159c949da1b1cc1d25718961050baaa1a`, artifact schema `database.public-object-inventory-closure.v1`, and SHA-256 `d7353b0b3d2dcd3bcc64ffaf41ff2015729142789e0b3a39818acc12ebf35c16`. The manifest also pins the artifact's complete eight-field `source` block (`baseline`, all four database SHAs, the previous artifact hash, and both workspace SHAs), plus its 393-object and 1,119-dependency counts. That artifact says `contractReady: false`; database Issues #354 through #358 are not treated as final contracts.

## Exact Consumer Inventory

All nine allowed core relations are explicit. Core reads remain in `public` under both profiles; legacy writes remain in `public` only for compatibility. Empty consumer lists are intentional, machine-verifiable zeroes.

| Public core relation | MCP consumers | Operations today |
| --- | --- | --- |
| `contacts` | `src/tools/db_crud.ts` | select, insert, update, delete |
| `flowproperties` | none | none |
| `flows` | `src/tools/db_crud.ts` | select, insert, update, delete |
| `ilcd` | none | none |
| `lciamethods` | none | none |
| `lifecyclemodels` | `src/tools/db_crud.ts` | select, insert, update, delete |
| `processes` | `src/tools/db_crud.ts`; `src/tools/life_cycle_model_file_tools.ts` | CRUD plus referenced-process reads |
| `sources` | `src/tools/db_crud.ts` | select, insert, update, delete |
| `unitgroups` | none | none |

Current views: zero. Current PostgREST RPC calls: zero. Current raw `/rest/v1` calls: zero. Supabase Auth clients and Edge Function search requests are outside this Data API inventory.

## Profiles And Forward Boundary

`TIANGONG_LCA_DATA_API_PROFILE` accepts `legacy-public-v1` (default) or `api-contract-v1`. The legacy profile preserves current direct `public` writes. The new profile keeps core SELECT on explicit `public`, but fails closed before insert/update/delete because database #358 has not frozen the required versioned `api` command adapter. Unknown profiles and non-core relations also fail closed.

Do not invent an `api` command name, argument list, return shape, grant, non-core relation, view, or RPC. The exact blockers are database #358 and hosted old/new schema-profile E2E. When #358 freezes the command contract, replace the guarded mutation path and update the manifest and behavior tests together.

## Behavioral Audit

| Concern | Current MCP behavior | Boundary |
| --- | --- | --- |
| Identity | Publishable-key anonymous reads remain possible; bearer/session identity is forwarded when provided. `update` explicitly requires an access token; `insert` and `delete` continue to rely on database grants/RLS. | This schema inventory does not silently tighten the public tool contract. Any new mutation identity gate needs separate scoped review and behavior proof. |
| Errors | Zod validates tool input; validation and Supabase failures surface as MCP tool errors. Zero-row update/delete gets an explicit diagnostic. | There is no stable cross-repo error envelope yet. Do not translate unknown database failures into guessed codes. |
| Pagination | Select supports an optional positive `limit`; referenced-process lookups batch by IDs. | There is no offset/cursor, total count, or page-completeness contract. Callers must not infer completeness from an unbounded or limited result. |
| Retry | MCP contains no retry loop. Its mutation wrapper invokes the Supabase request builder once; tests cover a failed single attempt. | This is not a claim about every internal behavior of `supabase-js` or the network. Token refresh settings are unchanged. Mutations must never gain MCP-level automatic replay without an idempotency contract. |
| Idempotency | Direct insert/update/delete currently have no MCP idempotency key or deduplication ledger. | Callers must resolve uncertain mutation outcomes by reading state; blind replay is unsafe. |
| Audit | Existing console diagnostics and database-side identity/RLS remain the available evidence. | There is no MCP request ID or durable mutation audit envelope. Treat that as an open contract gap, not as implemented behavior. |

Run `npm run scan:data-api-consumers` after every Data API change. The scanner fails for an unknown/non-core relation, undeclared dynamic relation expression, unmanifested RPC, raw REST path, stale manifest entry, or missing consumer declaration.
