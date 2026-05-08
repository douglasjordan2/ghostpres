# ghostpres — agent guide

A MongoDB-style aggregation pipeline DSL that compiles to chained-CTE Postgres queries. Targets `jsonb` columns. Coexists with Drizzle / `postgres.js` / `pg` / `Bun.sql`.

## Layout

```
src/sql.ts        Sql template tag, parameterized compile()
src/types.ts      Stage AST + helper functions ($match, $project, ...)
src/expr.ts       Expression compiler (field refs, system vars, operators)
src/stages.ts     Per-stage CTE body emitters + accumulator compiler
src/pipeline.ts   Walks the stage array and chains CTEs (s0 .. sN)
src/typed.ts      Pipeline<T> chainable builder + result-type inference
src/index.ts      Public API surface

examples/         Public example: users / posts / comments / reactions
test/             Unit tests (bun:test)
test/integration/ Integration tests against a real postgres
```

## Commands

```bash
bun install
bun test                            # full suite
bun test test/sql.test.ts           # unit only
bun test test/integration           # integration (requires postgres up)
bunx tsc --noEmit -p tsconfig.json  # typecheck
bun examples/run.ts                 # blog demo, prints feed/authors/tags
```

## Postgres for tests / demo

```bash
docker run -d --name ghostpres-pg \
  -e POSTGRES_PASSWORD=ghost \
  -e POSTGRES_DB=ghostpres_test \
  -p 54329:5432 \
  postgres:16-alpine
```

- Default URL: `postgres://postgres:ghost@localhost:54329/ghostpres_test`
- Override with `GHOSTPRES_TEST_DB`
- Skip integration with `GHOSTPRES_SKIP_PG=1`

## Conventions

- TypeScript strict mode + `noUncheckedIndexedAccess`. Don't relax.
- No code comments unless the WHY is non-obvious. Names carry the WHAT.
- Prefer `Edit` over `Write` on existing files.
- Each pipeline stage compiles to its own CTE — preserve that. It's load-bearing for `EXPLAIN`-by-prefix debuggability.
- Every value the user supplies is parameterized through the `sql` template tag. Never string-concat user input into emitted SQL.
- `jsonb_build_object` keys must be cast `::text` at the call site — Postgres can't infer the parameter type otherwise.
- Tests pass on every commit. Both `bun test` and `bunx tsc --noEmit` clean.

## Adding a new stage

1. `src/types.ts` — add `XStage` to `Stage` union, export an `$x()` helper.
2. `src/stages.ts` — add `compileX` and a case in `compileStage`. Output shape: a Sql fragment selecting `id, doc` columns from the previous CTE.
3. `src/typed.ts` — add a method to `Pipeline<TIn>`. Pick a result type or default to `unknown`.
4. `test/pipeline.test.ts` — assert SQL shape (params + key strings).
5. `test/integration/blog.test.ts` (or new file) — assert correct rows back from real postgres.
6. README — add to the supported-stages list.

## Adding a new expression operator

1. `src/expr.ts` — add to the `ops` record. Implement as `(arg, ctx) => Compiled`. Use `coerce(...)` to get a Sql fragment of the right kind (`jsonb` / `text` / `numeric` / `bool` / `int` / `timestamptz` / `unknown`).
2. Add a unit or integration test exercising it.
3. README — extend the expression list.

## Adding a new accumulator

1. `src/types.ts` — extend the `Accumulator` union.
2. `src/stages.ts` — `compileAccumulator` switch.
3. `src/typed.ts` — `AccumulatorResult` mapping (so `group<TFields>` returns the right output type).
4. Integration test in `test/integration/group.test.ts`.

## Type-inference quirks worth knowing

- `Pipeline.lookup<TFrom, TAs>(...)` requires **both** type params to get the typed result. With only `<TFrom>`, TypeScript leaves `TAs` as the default `string` and the lookup result widens — an unavoidable TS limitation around partial generic argument inference. Document this in user-facing places.
- `const TSpec extends Document` on `project` / `addFields` preserves literal `1`/`true` so inclusion vs. expression branches resolve correctly.
- `MatchFilter<TDoc>` is intentionally permissive (allows arbitrary string keys for nested paths). Don't tighten without checking that `tags: "x"`-style scalar-against-array usage still typechecks.

## What's intentionally not implemented

`$lookup` with a sub-pipeline. `$facet`, `$bucket`, `$bucketAuto`, `$graphLookup`, `$merge`, `$out`. Geospatial. Don't add stubs that throw — add the real thing or leave it out.

## Library philosophy

GhostPress trades MongoDB's wire-protocol fidelity for SQL guarantees. The whole library exists because pipeline-as-data composition is genuinely fun and the lateral-aggregate compile of `$lookup` is genuinely fast. Don't add features that compromise either of those — features that hide the SQL, features that introduce hidden round-trips, features that break the "stages are plain serializable objects" model. If a feature can't be expressed as a stage that compiles to one CTE, think twice.
