import { sql, compile, type Sql, type CompiledSql } from "./sql.ts";
import { compileStage } from "./stages.ts";
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
  const idCol = opts.idColumn ?? "id";
  const dataCol = opts.dataColumn ?? "data";

  const ctes: Sql[] = [];
  const baseName = "s0";
  const baseSelect = opts.baseFilter
    ? sql`select ${sql.id(idCol)} as id, ${sql.id(dataCol)} as doc from ${sql.id(opts.collection)} where ${opts.baseFilter}`
    : sql`select ${sql.id(idCol)} as id, ${sql.id(dataCol)} as doc from ${sql.id(opts.collection)}`;

  ctes.push(sql`${sql.id(baseName)} as (${baseSelect})`);

  let prev = baseName;
  for (let i = 0; i < pipeline.length; i++) {
    const stage = pipeline[i]!;
    const name = `s${i + 1}`;
    const { body } = compileStage(stage, { prev, collection: opts.collection });
    ctes.push(sql`${sql.id(name)} as (${body})`);
    prev = name;
  }

  return sql`with ${sql.join(ctes, ", ")} select doc from ${sql.id(prev)}`;
}

export function explainPipeline(pipeline: Stage[], opts: AggregateOptions): CompiledSql {
  const node = buildPipelineSql(pipeline, opts);
  return compile(sql`explain (analyze, costs, verbose, buffers, format json) ${node}`);
}
