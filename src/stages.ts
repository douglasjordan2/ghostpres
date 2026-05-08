import { sql, type Sql } from "./sql.ts";
import {
  compileExpr,
  compileMatchFilter,
  coerce,
  rootCtx,
  bindVar,
  jsonbPath,
  literalToJsonb,
  type Ctx,
} from "./expr.ts";
import type {
  Stage,
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
  Document,
  Accumulator,
  SortSpec,
} from "./types.ts";

export type StageInput = {
  prev: string;
  collection: string;
};

export type StageOutput = {
  body: Sql;
};

export function compileStage(stage: Stage, input: StageInput): StageOutput {
  switch (stage.$) {
    case "match":
      return compileMatch(stage, input);
    case "project":
      return compileProject(stage, input);
    case "addFields":
      return compileAddFields(stage, input);
    case "lookup":
      return compileLookup(stage, input);
    case "unwind":
      return compileUnwind(stage, input);
    case "group":
      return compileGroup(stage, input);
    case "sort":
      return compileSort(stage, input);
    case "limit":
      return compileLimit(stage, input);
    case "skip":
      return compileSkip(stage, input);
    case "count":
      return compileCount(stage, input);
    case "replaceRoot":
      return compileReplaceRoot(stage, input);
  }
}

function prevCtx(prev: string): Ctx {
  return rootCtx(sql`${sql.id(prev)}.doc`);
}

function compileMatch(stage: MatchStage, { prev }: StageInput): StageOutput {
  const ctx = prevCtx(prev);
  const where = compileMatchFilter(stage.filter, ctx);
  return {
    body: sql`select ${sql.id(prev)}.id, ${sql.id(prev)}.doc from ${sql.id(prev)} where ${where}`,
  };
}

function compileProject(stage: ProjectStage, { prev }: StageInput): StageOutput {
  const ctx = prevCtx(prev);
  const newDoc = buildDoc(stage.doc, ctx);
  return {
    body: sql`select ${sql.id(prev)}.id, ${newDoc} as doc from ${sql.id(prev)}`,
  };
}

function compileAddFields(stage: AddFieldsStage, { prev }: StageInput): StageOutput {
  const ctx = prevCtx(prev);
  const additions = buildDoc(stage.doc, ctx);
  return {
    body: sql`select ${sql.id(prev)}.id, (${sql.id(prev)}.doc || ${additions}) as doc from ${sql.id(prev)}`,
  };
}

function buildDoc(doc: Document, ctx: Ctx): Sql {
  const pairs: Sql[] = [];
  for (const [k, v] of Object.entries(doc)) {
    if (v === false || v === 0) continue;
    if (v === true || v === 1) {
      const fromPath = jsonbPath(ctx.doc, k.split("."));
      pairs.push(sql`${k}::text, ${fromPath}`);
      continue;
    }
    const compiled = coerce(compileExpr(v, ctx), "jsonb").sql;
    pairs.push(sql`${k}::text, ${compiled}`);
  }
  if (pairs.length === 0) return sql`'{}'::jsonb`;
  return sql`jsonb_build_object(${sql.join(pairs)})`;
}

function compileLookup(stage: LookupStage, { prev }: StageInput): StageOutput {
  const localPath = stage.localField.split(".");
  const foreignField = stage.foreignField ?? "_id";
  const localExpr = jsonbPath(sql`${sql.id(prev)}.doc`, localPath);
  const foreignExpr = jsonbPath(sql`__t.data`, foreignField.split("."));

  const matchCondition = sql`(
    case
      when jsonb_typeof(${localExpr}) = 'array'
        then ${foreignExpr} in (select jsonb_array_elements(${localExpr}))
      else ${foreignExpr} = ${localExpr}
    end
  )`;

  const lateral = sql`(
    select coalesce(jsonb_agg(__t.data), '[]'::jsonb) as joined
    from ${sql.id(stage.from)} __t
    where ${matchCondition}
  ) __lk`;

  return {
    body: sql`select ${sql.id(prev)}.id,
      (${sql.id(prev)}.doc || jsonb_build_object(${stage.as}::text, __lk.joined)) as doc
    from ${sql.id(prev)}
    left join lateral ${lateral} on true`,
  };
}

function compileUnwind(stage: UnwindStage, { prev }: StageInput): StageOutput {
  const path = stage.path.startsWith("$") ? stage.path.slice(1) : stage.path;
  const segments = path.split(".");
  const arrayExpr = jsonbPath(sql`${sql.id(prev)}.doc`, segments);
  const idxField = stage.includeArrayIndex ?? null;

  const setPath = sql`array[${sql.join(segments.map((s) => sql`${s}::text`))}]`;
  const docWithElem = sql`jsonb_set(${sql.id(prev)}.doc, ${setPath}, __elem.value)`;
  const docWithIdx = idxField
    ? sql`(${docWithElem} || jsonb_build_object(${idxField}::text, to_jsonb((__elem.ord - 1)::int)))`
    : docWithElem;

  if (stage.preserveNullAndEmptyArrays) {
    return {
      body: sql`select ${sql.id(prev)}.id,
        case
          when ${arrayExpr} is null or jsonb_typeof(${arrayExpr}) <> 'array' or jsonb_array_length(${arrayExpr}) = 0
            then ${sql.id(prev)}.doc
          else ${docWithIdx}
        end as doc
      from ${sql.id(prev)}
      left join lateral jsonb_array_elements(${arrayExpr}) with ordinality as __elem(value, ord) on
        jsonb_typeof(${arrayExpr}) = 'array' and jsonb_array_length(${arrayExpr}) > 0`,
    };
  }

  return {
    body: sql`select ${sql.id(prev)}.id, ${docWithIdx} as doc
      from ${sql.id(prev)},
      jsonb_array_elements(${arrayExpr}) with ordinality as __elem(value, ord)
      where jsonb_typeof(${arrayExpr}) = 'array'`,
  };
}

function compileGroup(stage: GroupStage, { prev }: StageInput): StageOutput {
  const ctx = prevCtx(prev);
  const idCompiled = coerce(compileExpr(stage._id, ctx), "jsonb").sql;
  const idAlias = sql`__id`;
  const fieldPairs: Sql[] = [sql`'_id'::text, ${idAlias}`];

  for (const [name, acc] of Object.entries(stage.fields)) {
    const accSql = compileAccumulator(acc, ctx);
    fieldPairs.push(sql`${name}::text, ${accSql}`);
  }

  const docExpr = sql`jsonb_build_object(${sql.join(fieldPairs)})`;

  return {
    body: sql`select md5(${idAlias}::text)::text as id, ${docExpr} as doc
      from (
        select ${idCompiled} as __id, ${sql.id(prev)}.doc, ${sql.id(prev)}.id from ${sql.id(prev)}
      ) ${sql.id(prev)}
      group by __id`,
  };
}

function compileAccumulator(acc: Accumulator, ctx: Ctx): Sql {
  if ("$sum" in acc) {
    if (acc.$sum === 1) return sql`to_jsonb(count(*))`;
    const c = coerce(compileExpr(acc.$sum, ctx), "numeric").sql;
    return sql`to_jsonb(coalesce(sum(${c}), 0))`;
  }
  if ("$avg" in acc) {
    const c = coerce(compileExpr(acc.$avg, ctx), "numeric").sql;
    return sql`to_jsonb(avg(${c}))`;
  }
  if ("$min" in acc) {
    const c = coerce(compileExpr(acc.$min, ctx), "jsonb").sql;
    return sql`min(${c})`;
  }
  if ("$max" in acc) {
    const c = coerce(compileExpr(acc.$max, ctx), "jsonb").sql;
    return sql`max(${c})`;
  }
  if ("$first" in acc) {
    const c = coerce(compileExpr(acc.$first, ctx), "jsonb").sql;
    return sql`(array_agg(${c}))[1]`;
  }
  if ("$last" in acc) {
    const c = coerce(compileExpr(acc.$last, ctx), "jsonb").sql;
    return sql`(array_agg(${c}))[count(*)::int]`;
  }
  if ("$push" in acc) {
    const c = coerce(compileExpr(acc.$push, ctx), "jsonb").sql;
    return sql`coalesce(jsonb_agg(${c}), '[]'::jsonb)`;
  }
  if ("$addToSet" in acc) {
    const c = coerce(compileExpr(acc.$addToSet, ctx), "jsonb").sql;
    return sql`coalesce(jsonb_agg(distinct ${c}), '[]'::jsonb)`;
  }
  if ("$count" in acc) {
    return sql`to_jsonb(count(*))`;
  }
  if ("$stdDevPop" in acc) {
    const c = coerce(compileExpr(acc.$stdDevPop, ctx), "numeric").sql;
    return sql`to_jsonb(stddev_pop(${c}))`;
  }
  if ("$stdDevSamp" in acc) {
    const c = coerce(compileExpr(acc.$stdDevSamp, ctx), "numeric").sql;
    return sql`to_jsonb(stddev_samp(${c}))`;
  }
  if ("$mergeObjects" in acc) {
    const c = coerce(compileExpr(acc.$mergeObjects, ctx), "jsonb").sql;
    return sql`coalesce(
      (select jsonb_object_agg(__k, __v)
       from jsonb_array_elements(jsonb_agg(${c})) as __o,
            jsonb_each(__o) as __e(__k, __v)),
      '{}'::jsonb
    )`;
  }
  if ("$top" in acc) {
    const out = coerce(compileExpr(acc.$top.output, ctx), "jsonb").sql;
    const order = compileSortByOrder(acc.$top.sortBy, ctx, false);
    return sql`(array_agg(${out} order by ${order}))[1]`;
  }
  if ("$bottom" in acc) {
    const out = coerce(compileExpr(acc.$bottom.output, ctx), "jsonb").sql;
    const order = compileSortByOrder(acc.$bottom.sortBy, ctx, true);
    return sql`(array_agg(${out} order by ${order}))[1]`;
  }
  if ("$topN" in acc) {
    const out = coerce(compileExpr(acc.$topN.output, ctx), "jsonb").sql;
    const order = compileSortByOrder(acc.$topN.sortBy, ctx, false);
    const n = acc.$topN.n;
    return sql`to_jsonb((array_agg(${out} order by ${order}))[1:${n}])`;
  }
  if ("$bottomN" in acc) {
    const out = coerce(compileExpr(acc.$bottomN.output, ctx), "jsonb").sql;
    const order = compileSortByOrder(acc.$bottomN.sortBy, ctx, true);
    const n = acc.$bottomN.n;
    return sql`to_jsonb((array_agg(${out} order by ${order}))[1:${n}])`;
  }
  if ("$minN" in acc) {
    const c = coerce(compileExpr(acc.$minN.input, ctx), "jsonb").sql;
    const n = acc.$minN.n;
    return sql`to_jsonb((array_agg(${c} order by ${c} asc nulls last))[1:${n}])`;
  }
  if ("$maxN" in acc) {
    const c = coerce(compileExpr(acc.$maxN.input, ctx), "jsonb").sql;
    const n = acc.$maxN.n;
    return sql`to_jsonb((array_agg(${c} order by ${c} desc nulls last))[1:${n}])`;
  }
  if ("$firstN" in acc) {
    const c = coerce(compileExpr(acc.$firstN.input, ctx), "jsonb").sql;
    const n = acc.$firstN.n;
    if (acc.$firstN.sortBy) {
      const order = compileSortByOrder(acc.$firstN.sortBy, ctx, false);
      return sql`to_jsonb((array_agg(${c} order by ${order}))[1:${n}])`;
    }
    return sql`to_jsonb((array_agg(${c}))[1:${n}])`;
  }
  if ("$lastN" in acc) {
    const c = coerce(compileExpr(acc.$lastN.input, ctx), "jsonb").sql;
    const n = acc.$lastN.n;
    if (acc.$lastN.sortBy) {
      const order = compileSortByOrder(acc.$lastN.sortBy, ctx, true);
      return sql`to_jsonb((array_agg(${c} order by ${order}))[1:${n}])`;
    }
    return sql`to_jsonb((array_agg(${c}))[greatest(count(*) - ${n} + 1, 1)::int : count(*)::int])`;
  }
  throw new Error(`unsupported accumulator: ${JSON.stringify(acc)}`);
}

function compileSortByOrder(spec: SortSpec, ctx: Ctx, reverse: boolean): Sql {
  const parts: Sql[] = [];
  for (const [field, dir] of Object.entries(spec)) {
    const path = field.split(".");
    const fieldExpr = jsonbPath(ctx.doc, path);
    const effective = reverse ? -dir : dir;
    parts.push(
      sql`${fieldExpr} ${sql.raw(effective === 1 ? "asc" : "desc")} nulls ${sql.raw(effective === 1 ? "first" : "last")}`,
    );
  }
  return sql.join(parts);
}

function compileSort(stage: SortStage, { prev }: StageInput): StageOutput {
  const orders: Sql[] = [];
  for (const [field, dir] of Object.entries(stage.spec)) {
    const path = field.split(".");
    const fieldExpr = jsonbPath(sql`${sql.id(prev)}.doc`, path);
    orders.push(sql`${fieldExpr} ${sql.raw(dir === 1 ? "asc" : "desc")} nulls ${sql.raw(dir === 1 ? "first" : "last")}`);
  }
  return {
    body: sql`select ${sql.id(prev)}.id, ${sql.id(prev)}.doc from ${sql.id(prev)} order by ${sql.join(orders)}`,
  };
}

function compileLimit(stage: LimitStage, { prev }: StageInput): StageOutput {
  return {
    body: sql`select ${sql.id(prev)}.id, ${sql.id(prev)}.doc from ${sql.id(prev)} limit ${stage.n}`,
  };
}

function compileSkip(stage: SkipStage, { prev }: StageInput): StageOutput {
  return {
    body: sql`select ${sql.id(prev)}.id, ${sql.id(prev)}.doc from ${sql.id(prev)} offset ${stage.n}`,
  };
}

function compileCount(stage: CountStage, { prev }: StageInput): StageOutput {
  return {
    body: sql`select '_count'::text as id, jsonb_build_object(${stage.field}::text, count(*)) as doc from ${sql.id(prev)}`,
  };
}

function compileReplaceRoot(stage: ReplaceRootStage, { prev }: StageInput): StageOutput {
  const ctx = prevCtx(prev);
  const newRoot = coerce(compileExpr(stage.newRoot, ctx), "jsonb").sql;
  return {
    body: sql`select ${sql.id(prev)}.id, ${newRoot} as doc from ${sql.id(prev)}`,
  };
}
