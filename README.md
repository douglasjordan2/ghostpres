<div align="center">

<img src="./assets/mascot.png" alt="GhostPress mascot — a ghost benching weights with Postgres-green plates" width="640">

# ghostpres

**MongoDB-shaped aggregation pipelines for Postgres jsonb.**
*The inversion of Postgres.*

[![CI](https://github.com/douglasjordan2/ghostpres/actions/workflows/ci.yml/badge.svg)](https://github.com/douglasjordan2/ghostpres/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

</div>

---

GhostPress lets you write Mongo-style aggregation pipelines — `$match`, `$lookup`, `$unwind`, `$group`, the works — and compiles them down to a single chained-CTE query against Postgres. You keep ACID, foreign keys, real indexes, and the rest of the relational toolkit. You get the pipeline-as-data composability that makes Mongo fun.

It's not a port of MongoDB and it's not a wire-protocol shim. It's a query DSL that targets Postgres directly, designed to coexist with Drizzle (or `pg`, or `postgres.js`, or `Bun.sql`) rather than replace them.

## Install

```bash
bun add ghostpres
# or
pnpm add ghostpres
# or
npm install ghostpres
```

Postgres 14+ recommended (uses `jsonb`, `jsonb_path_query`, `with recursive` for `$reduce`).

## 30-second example

```ts
import { collection } from "ghostpres";

type Post = { _id: number; author_id: number; title: string; tags: string[]; published_at: string; views: number };
type User = { _id: number; username: string };
type Comment = { _id: number; post_id: number; reactions: { kind: string }[] };

const feed = await collection<Post>("posts")
  .match({ tags: "essay" })
  .lookup<User, "author">({ from: "users", localField: "author_id", foreignField: "_id", as: "author" })
  .addFields({ author: { $arrayElemAt: ["$author", 0] } })
  .lookup<Comment, "comments">({ from: "comments", localField: "_id", foreignField: "post_id", as: "comments" })
  .addFields({
    comment_count: { $size: "$comments" },
    reaction_count: { $sum: { $map: { input: "$comments", in: { $size: "$$this.reactions" } } } },
  })
  .sort({ published_at: -1 })
  .limit(10)
  .project({ title: 1, tags: 1, author: 1, comment_count: 1, reaction_count: 1 })
  .run(executor);
```

The chain accumulates types: `feed` is a typed array of `{ title; tags; author: User; comment_count: number; reaction_count: number }`. `executor` is anything with `.unsafe(text, values) => Promise<rows>` — `postgres.js`, `pg`, Drizzle's `sql` tag, or a small wrapper around `Bun.sql`.

## Two ways to write a pipeline

GhostPress preserves the part of MongoDB that's actually fun: stages are plain data you can splice, conditionally include, and optimize.

```ts
import { $match, $lookup, $unwind, $group, $sort, aggregate } from "ghostpres";

const stages = [
  $match({ tags: "essay" }),
  ...(includeAuthor ? [$lookup({ from: "users", localField: "author_id", foreignField: "_id", as: "author" })] : []),
  $unwind("$tags"),
  $group("$tags", { post_count: { $sum: 1 }, total_views: { $sum: "$views" } }),
  $sort({ post_count: -1 }),
];

const { text, values } = aggregate(stages, { collection: "posts" });
```

Use the array form when you want raw composability. Use the typed builder (`collection<T>().match(...)...`) when you want output type inference. They're the same engine underneath; pick whichever fits.

## What's supported

**Stages:** `$match`, `$project`, `$addFields` / `$set`, `$lookup`, `$unwind`, `$group`, `$sort`, `$limit`, `$skip`, `$count`, `$replaceRoot`.

**Expression operators:** field references (`"$foo.bar"`), system variables (`$$ROOT`, `$$this`, `$$value`), comparisons (`$eq`/`$ne`/`$gt`/`$gte`/`$lt`/`$lte`), logical (`$and`/`$or`/`$not`), arithmetic (`$add`/`$subtract`/`$multiply`/`$divide`/`$mod`/`$abs`/`$ceil`/`$floor`/`$round`), strings (`$concat`/`$toLower`/`$toUpper`/`$trim`/`$strLenCP`/`$split`/`$regexMatch`), conditionals (`$cond`/`$ifNull`/`$switch`), arrays (`$size`/`$arrayElemAt`/`$first`/`$last`/`$in`/`$isArray`/`$concatArrays`/`$reverseArray`), aggregations in expressions (`$sum`/`$avg`), higher-order (`$map`/`$filter`/`$reduce`), `$mergeObjects`, type conversions (`$type`/`$toString`/`$toInt`/`$toLong`/`$toDouble`/`$toDecimal`/`$toBool`/`$toDate`).

**Accumulators:** `$sum`, `$avg`, `$min`, `$max`, `$first`, `$last`, `$push`, `$addToSet`, `$count`, `$stdDevPop`, `$stdDevSamp`, `$mergeObjects`, `$top`, `$bottom`, `$topN`, `$bottomN`, `$minN`, `$maxN`, `$firstN`, `$lastN`.

## How `$lookup` compiles

In Mongo, `$lookup` exposes the join as an array on each input doc, which means downstream stages often `$unwind` and re-`$group` to undo the explosion. GhostPress compiles `$lookup` to a lateral aggregate — the joined rows are aggregated *inside* the subquery, never exploded across the parent. You write `$lookup` because it's the API you want; you get a SQL plan that doesn't pay the unwind/regroup tax.

```sql
-- A $lookup stage, compiled
left join lateral (
  select coalesce(jsonb_agg(t.data), '[]'::jsonb) as joined
  from order_packages t
  where t.data->>'_id' in (select jsonb_array_elements_text(prev.doc->'order_package_ids'))
) lk on true
```

Each stage becomes its own CTE, so you can comment out a tail stage and the prefix is independently inspectable with `EXPLAIN` — useful for debugging in a way Mongo's pipeline never was.

## Examples

`examples/blog.ts` and `examples/blog-typed.ts` build three pipelines over a small users / posts / comments schema:

- `feedPipeline` — recent posts with author embedded, comment count, reaction count, reading time. Optional tag and search filters spliced conditionally.
- `topAuthorsPipeline` — `$group` by author with `$sum`, `$avg`, `$max`, then a `$lookup` back to users for the username.
- `tagStatsPipeline` — `$unwind` tags, `$group` by tag, `$firstN` for sample titles.

`examples/run.ts` seeds the schema and prints all three pipelines side by side. With the test database running:

```bash
bun examples/run.ts
```

```
typed builder: feed
  2025-04-22  @grace     COBOL was not a mistake             0c  0r  1min
  2025-04-15  @ada       On loops and the imagination        0c  0r  1min
  2025-04-12  @carmack   Quake's BSP and what made it fast   2c  2r  1min

typed builder: top authors
  @grace      2 posts  2990 views  avg 1495
  @ada        2 posts  1560 views  avg 780

typed builder: tag stats
  #essay      4 posts  7100 views  e.g.: On loops and the imagination, COBOL was not a mistake
  #history    2 posts  3350 views  e.g.: Notes on the Analytical Engine, Compiler design: bottom-up
```

## Coexistence with Drizzle

GhostPress is not a fork of Drizzle and not a replacement. Drizzle's value — the schema, type inference, migrations, dialect-spanning query builder — is exactly what you want under a GhostPress collection. The intended pattern is:

```ts
// schema.ts — your Drizzle table
export const posts = pgTable("posts", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  data: jsonb("data").notNull().$type<Post>(),
});

// query — GhostPress pipeline targeting that table
const feed = await collection<Post>("posts").match({ tags: "essay" }).run(drizzleExecutor);
```

The `executor` interface is intentionally minimal (`{ unsafe(text, values) => Promise<rows[]> }`). Wrap your existing `postgres.js`, `pg`, or Drizzle client in a few lines and you're done. Transactions stay in your existing client; GhostPress just produces the SQL.

## What's not (yet) supported

- `$lookup` with a `pipeline` sub-stage. Plain local/foreign-field lookup only.
- `$facet`, `$bucket`, `$bucketAuto`, `$graphLookup`, `$merge`, `$out`. (`$count` is supported.)
- Geospatial (`$geoNear` and friends).
- `$expr` is supported, but the JSONPath subset Mongo uses for `$expr` arguments is mapped opportunistically — if you hit something missing, file an issue with the expression and we'll wire it up.
- Schema-aware optimization passes (predicate pushdown into `$lookup`, fusion of adjacent `$addFields`, routing typed-column matches to extracted/generated columns) — planned but not yet built.

## Status

Pre-1.0. The library is correct for the surface area listed above, with a passing integration suite. APIs may move before 1.0 — pin the version. Issues and PRs welcome.

## License

MIT. See [LICENSE](./LICENSE).
