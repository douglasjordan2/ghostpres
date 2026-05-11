import { sql, compile, type Sql, type CompiledSql } from "./sql.ts";
import { chainCtes } from "./stages.ts";
import type { Stage } from "./types.ts";

export type AggregateOptions = {
  collection: string;
  idColumn?: string;
  dataColumn?: string;
  baseFilter?: Sql;
};

export type AggregateResult = {
  sql: Sql;
  text: string;
  values: unknown[];
};

export function aggregate(pipeline: Stage[], opts: AggregateOptions): AggregateResult {
  const sqlNode = buildPipelineSql(pipeline, opts);
  const compiled = compile(sqlNode);
  return { sql: sqlNode, text: compiled.text, values: compiled.values };
}

export function buildPipelineSql(pipeline: Stage[], opts: AggregateOptions): Sql {
  const { ctes, last } = chainCtes(pipeline, opts)
  return sql`with ${sql.join(ctes, ", ")} select doc from ${sql.id(last)}`;
}

export function explainPipeline(pipeline: Stage[], opts: AggregateOptions): CompiledSql {
  const node = buildPipelineSql(pipeline, opts);
  return compile(sql`explain (analyze, costs, verbose, buffers, format json) ${node}`);
}
