export {
  $match,
  $project,
  $addFields,
  $set,
  $lookup,
  $unwind,
  $group,
  $sort,
  $limit,
  $skip,
  $count,
  $replaceRoot,
} from "./types.ts";

export type {
  Stage,
  Expr,
  Document,
  Accumulator,
  SortSpec,
  MatchStage,
  ProjectStage,
  AddFieldsStage,
  LookupStage,
  UnwindStage,
  GroupStage,
  SortStage,
  LimitStage,
  SkipStage,
  CountStage,
  ReplaceRootStage,
} from "./types.ts";

export type { MatchFilter as RawMatchFilter } from "./types.ts";

export { aggregate, buildPipelineSql, explainPipeline } from "./pipeline.ts";
export type { AggregateOptions, AggregateResult } from "./pipeline.ts";

export { sql, compile } from "./sql.ts";
export type { Sql, CompiledSql } from "./sql.ts";

export { Pipeline, collection } from "./typed.ts";
export type {
  Executor as TypedExecutor,
  MatchFilter,
  ProjectResult,
  AddFieldsResult,
  LookupResult,
  UnwindResult,
  GroupResult,
  CountResult,
  AccumulatorResult,
} from "./typed.ts";

import { aggregate, type AggregateOptions, type AggregateResult } from "./pipeline.ts";
import type { Stage } from "./types.ts";

export type Executor = {
  unsafe: (text: string, values: unknown[]) => Promise<unknown[]>;
};

export type Collection = {
  name: string;
  aggregate(pipeline: Stage[]): AggregateResult;
  run<T = Record<string, unknown>>(pipeline: Stage[]): Promise<T[]>;
};

export function ghost(executor?: Executor) {
  return {
    collection(name: string, opts: Partial<Omit<AggregateOptions, "collection">> = {}): Collection {
      const fullOpts: AggregateOptions = { ...opts, collection: name };
      return {
        name,
        aggregate(pipeline: Stage[]) {
          return aggregate(pipeline, fullOpts);
        },
        async run<T = Record<string, unknown>>(pipeline: Stage[]): Promise<T[]> {
          if (!executor) {
            throw new Error("ghost() called without an executor; pass a postgres-like client");
          }
          const { text, values } = aggregate(pipeline, fullOpts);
          const rows = await executor.unsafe(text, values);
          return rows.map((r) => (r as { doc: T }).doc);
        },
      };
    },
  };
}
