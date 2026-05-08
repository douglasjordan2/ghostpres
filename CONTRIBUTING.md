# Contributing to ghostpres

Thanks for considering a contribution. ghostpres is small and the codebase is structured so a single PR can reasonably touch one feature end-to-end (types, compiler, tests, docs). The notes below should get you from clone to first PR in under 15 minutes.

## Quick start

```bash
git clone https://github.com/<you>/ghostpres
cd ghostpres
bun install

# spin up postgres for the integration tests
docker run -d --name ghostpres-pg \
  -e POSTGRES_PASSWORD=ghost \
  -e POSTGRES_DB=ghostpres_test \
  -p 54329:5432 \
  postgres:16-alpine

bun test          # ~80 tests
bun examples/run.ts  # see the blog demo
```

If you can't run docker, set `GHOSTPRES_SKIP_PG=1` and the integration tests will skip cleanly. Unit tests still cover the compile step.

## What's likely to need contribution

The MVP surface is documented in the README. Common useful additions:

- **More expression operators** — substring/`$substr`, date arithmetic, array slicing. Most are 5–15 lines in `src/expr.ts` plus a test.
- **More accumulators** — `$accumulator` user-defined, percentile aggregates.
- **Optimization passes** — predicate pushdown into `$lookup`, fusion of adjacent `$addFields`, routing field matches to extracted/generated columns when the schema declares them. These don't change semantics but cut SQL size and improve plans.
- **`$lookup` with a sub-pipeline** — Mongo's full `$lookup` form takes a pipeline that runs inside the join. We compile to a lateral aggregate today; extending to a full sub-pipeline is real work but doable.

If you're not sure whether something fits, open an issue first.

## Code structure

See [CLAUDE.md](./CLAUDE.md) for a tour of the source tree and the conventions. The same file works as an agent guide and as a developer onboarding doc — it's terser than this one but more concrete about where each kind of change goes.

## House style

- TypeScript strict mode is on, including `noUncheckedIndexedAccess`. Don't suppress with broad `as any` — narrow types or cast at the smallest scope.
- No code comments unless the *why* would surprise the next reader. Names should carry the *what*.
- Each pipeline stage emits exactly one CTE. Preserve that — it's how you debug pipelines by commenting out tail stages and inspecting the prefix.
- Every value flowing from JS into SQL goes through the `sql` template tag (`sql\`...\` or `sql.param(...)`), never via string concatenation. The library is parameterized end-to-end and that property has to hold.
- New API surface that takes user expressions should typecheck cleanly against the existing examples in `examples/blog.ts` — if a sensible call requires `as any` somewhere, the type is too tight.

## Tests

- Unit tests (`test/*.test.ts`) cover SQL shape — substrings, parameter ordering, stage count.
- Integration tests (`test/integration/*.test.ts`) seed a real Postgres and assert returned rows. New stages, operators, and accumulators need an integration test.
- Type-level tests (`test/typed.test.ts`) use the `Expect<Equal<X, Y>>` pattern. They're compile-time checks; the `expect(x).toBe(true)` part just confirms the test ran.

A change isn't done until both `bun test` and `bunx tsc --noEmit -p tsconfig.json` are clean.

## Pull requests

- One feature or fix per PR. If you find something else along the way, open a separate PR.
- The PR description should say *why*, not just *what* — the diff already shows the what. A reproduction (failing pipeline + expected output) is the fastest way to land a bug fix.
- Reference the issue you're closing.
- CI runs `bun test` + typecheck against a real Postgres on every PR. Green CI is a precondition for review.

## Bug reports

The most useful bug reports include:

1. The pipeline (the JS array of stages, or the typed builder chain).
2. The expected behavior or output.
3. The actual output, or the SQL ghostpres emitted (`aggregate(stages, opts).text`).
4. Postgres version (`select version()`).

If the bug is in the emitted SQL, paste the SQL and the row that broke.

## Licensing

ghostpres is MIT-licensed. By submitting a contribution you agree it can be released under the same license. We don't require a CLA.

## Getting in touch

GitHub issues and discussions are the right place for bugs, design questions, and feature proposals. For private things (security disclosures), email the addresses listed in [SECURITY.md](./SECURITY.md) when that file exists — until then, open a private security advisory on the repo.
