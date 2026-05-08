import { sql, type Sql } from "./sql.ts";
import type { Expr } from "./types.ts";

export type Kind = "jsonb" | "text" | "numeric" | "bool" | "int" | "timestamptz" | "unknown";

export type Compiled = { sql: Sql; kind: Kind };

export type Ctx = {
  doc: Sql;
  vars: Record<string, Compiled>;
};

export function rootCtx(docExpr: Sql): Ctx {
  return { doc: docExpr, vars: { ROOT: { sql: docExpr, kind: "jsonb" }, CURRENT: { sql: docExpr, kind: "jsonb" } } };
}

export function bindVar(ctx: Ctx, name: string, value: Compiled): Ctx {
  return { ...ctx, vars: { ...ctx.vars, [name]: value } };
}

export function compileExpr(expr: Expr, ctx: Ctx): Compiled {
  if (expr === null) return { sql: sql`null::jsonb`, kind: "jsonb" };
  if (typeof expr === "boolean") return { sql: sql`${expr}::bool`, kind: "bool" };
  if (typeof expr === "number") return { sql: sql`${expr}::numeric`, kind: "numeric" };
  if (typeof expr === "string") return compileString(expr, ctx);
  if (Array.isArray(expr)) {
    const items = expr.map((e) => coerce(compileExpr(e, ctx), "jsonb").sql);
    return { sql: sql`jsonb_build_array(${sql.join(items)})`, kind: "jsonb" };
  }
  if (typeof expr === "object") {
    const keys = Object.keys(expr);
    if (keys.length === 1 && keys[0]!.startsWith("$")) {
      return compileOp(keys[0]!, (expr as Record<string, Expr>)[keys[0]!]!, ctx);
    }
    return compileDocLiteral(expr as Record<string, Expr>, ctx);
  }
  throw new Error(`unsupported expression: ${JSON.stringify(expr)}`);
}

function compileString(s: string, ctx: Ctx): Compiled {
  if (s.startsWith("$$")) {
    const rest = s.slice(2);
    const [name, ...path] = rest.split(".");
    const v = ctx.vars[name!];
    if (!v) throw new Error(`unknown system variable $$${name}`);
    if (path.length === 0) return v;
    return { sql: jsonbPath(v.sql, path), kind: "jsonb" };
  }
  if (s.startsWith("$")) {
    const path = s.slice(1).split(".");
    return { sql: jsonbPath(ctx.doc, path), kind: "jsonb" };
  }
  return { sql: sql`${s}::text`, kind: "text" };
}

function compileDocLiteral(obj: Record<string, Expr>, ctx: Ctx): Compiled {
  const pairs: Sql[] = [];
  for (const [k, v] of Object.entries(obj)) {
    pairs.push(sql`${k}::text, ${coerce(compileExpr(v, ctx), "jsonb").sql}`);
  }
  return { sql: sql`jsonb_build_object(${sql.join(pairs)})`, kind: "jsonb" };
}

export function jsonbPath(base: Sql, path: string[]): Sql {
  if (path.length === 0) return base;
  const arr = sql`array[${sql.join(path.map((p) => sql`${p}::text`))}]`;
  return sql`(${base} #> ${arr})`;
}

export function jsonbPathText(base: Sql, path: string[]): Sql {
  if (path.length === 0) return sql`(${base})::text`;
  const arr = sql`array[${sql.join(path.map((p) => sql`${p}::text`))}]`;
  return sql`(${base} #>> ${arr})`;
}

export function coerce(c: Compiled, want: Kind): Compiled {
  if (want === c.kind) return c;
  if (want === "unknown") return c;
  if (c.kind === "unknown") return { sql: castFromJsonb(c.sql, want), kind: want };
  if (c.kind === "jsonb") return { sql: castFromJsonb(c.sql, want), kind: want };
  if (want === "jsonb") return { sql: sql`to_jsonb(${c.sql})`, kind: "jsonb" };
  if (want === "text") return { sql: sql`(${c.sql})::text`, kind: "text" };
  if (want === "numeric") return { sql: sql`(${c.sql})::numeric`, kind: "numeric" };
  if (want === "int") return { sql: sql`(${c.sql})::int`, kind: "int" };
  if (want === "bool") return { sql: sql`(${c.sql})::bool`, kind: "bool" };
  if (want === "timestamptz") return { sql: sql`(${c.sql})::timestamptz`, kind: "timestamptz" };
  return c;
}

function castFromJsonb(s: Sql, want: Kind): Sql {
  switch (want) {
    case "text":
      return sql`(case jsonb_typeof(${s}) when 'string' then ${s}#>>'{}' else (${s})::text end)`;
    case "numeric":
      return sql`((${s})#>>'{}')::numeric`;
    case "int":
      return sql`((${s})#>>'{}')::int`;
    case "bool":
      return sql`((${s})#>>'{}')::bool`;
    case "timestamptz":
      return sql`((${s})#>>'{}')::timestamptz`;
    case "jsonb":
      return s;
    case "unknown":
      return s;
  }
}

type OpCompiler = (arg: Expr, ctx: Ctx) => Compiled;

const binaryCmp = (op: string): OpCompiler => (arg, ctx) => {
  const args = arg as Expr[];
  if (!Array.isArray(args) || args.length !== 2) {
    throw new Error(`${op} expects [a, b]`);
  }
  const a = coerce(compileExpr(args[0]!, ctx), "jsonb").sql;
  const b = coerce(compileExpr(args[1]!, ctx), "jsonb").sql;
  return { sql: sql`(${a} ${sql.raw(op)} ${b})`, kind: "bool" };
};

const arithmetic = (op: string): OpCompiler => (arg, ctx) => {
  const args = arg as Expr[];
  if (!Array.isArray(args)) throw new Error(`${op} expects array`);
  const operands = args.map((a) => coerce(compileExpr(a, ctx), "numeric").sql);
  return {
    sql: sql`(${sql.join(operands, ` ${op} `)})`,
    kind: "numeric",
  };
};

const ops: Record<string, OpCompiler> = {
  $literal: (arg) => {
    if (arg === null) return { sql: sql`null::jsonb`, kind: "jsonb" };
    if (typeof arg === "boolean") return { sql: sql`${arg}::bool`, kind: "bool" };
    if (typeof arg === "number") return { sql: sql`${arg}::numeric`, kind: "numeric" };
    if (typeof arg === "string") return { sql: sql`${arg}::text`, kind: "text" };
    return { sql: sql`${JSON.stringify(arg)}::jsonb`, kind: "jsonb" };
  },

  $eq: binaryCmp("="),
  $ne: binaryCmp("<>"),
  $gt: binaryCmp(">"),
  $gte: binaryCmp(">="),
  $lt: binaryCmp("<"),
  $lte: binaryCmp("<="),

  $and: (arg, ctx) => {
    const args = arg as Expr[];
    if (!Array.isArray(args)) throw new Error("$and expects array");
    if (args.length === 0) return { sql: sql`true`, kind: "bool" };
    const parts = args.map((a) => coerce(compileExpr(a, ctx), "bool").sql);
    return { sql: sql`(${sql.join(parts, " and ")})`, kind: "bool" };
  },
  $or: (arg, ctx) => {
    const args = arg as Expr[];
    if (!Array.isArray(args)) throw new Error("$or expects array");
    if (args.length === 0) return { sql: sql`false`, kind: "bool" };
    const parts = args.map((a) => coerce(compileExpr(a, ctx), "bool").sql);
    return { sql: sql`(${sql.join(parts, " or ")})`, kind: "bool" };
  },
  $not: (arg, ctx) => {
    const operand = Array.isArray(arg) ? arg[0]! : arg;
    const c = coerce(compileExpr(operand, ctx), "bool").sql;
    return { sql: sql`(not ${c})`, kind: "bool" };
  },

  $add: arithmetic("+"),
  $subtract: arithmetic("-"),
  $multiply: arithmetic("*"),
  $divide: arithmetic("/"),
  $mod: arithmetic("%"),
  $abs: (arg, ctx) => {
    const operand = Array.isArray(arg) ? arg[0]! : arg;
    const c = coerce(compileExpr(operand, ctx), "numeric").sql;
    return { sql: sql`abs(${c})`, kind: "numeric" };
  },
  $ceil: (arg, ctx) => {
    const operand = Array.isArray(arg) ? arg[0]! : arg;
    return { sql: sql`ceil(${coerce(compileExpr(operand, ctx), "numeric").sql})`, kind: "numeric" };
  },
  $floor: (arg, ctx) => {
    const operand = Array.isArray(arg) ? arg[0]! : arg;
    return { sql: sql`floor(${coerce(compileExpr(operand, ctx), "numeric").sql})`, kind: "numeric" };
  },
  $round: (arg, ctx) => {
    const args = Array.isArray(arg) ? arg : [arg];
    const value = coerce(compileExpr(args[0]!, ctx), "numeric").sql;
    const places = args[1] !== undefined ? coerce(compileExpr(args[1]!, ctx), "int").sql : sql`0`;
    return { sql: sql`round(${value}, ${places})`, kind: "numeric" };
  },

  $concat: (arg, ctx) => {
    const args = arg as Expr[];
    if (!Array.isArray(args)) throw new Error("$concat expects array");
    const parts = args.map((a) => coerce(compileExpr(a, ctx), "text").sql);
    return { sql: sql`concat(${sql.join(parts)})`, kind: "text" };
  },
  $toLower: (arg, ctx) => ({
    sql: sql`lower(${coerce(compileExpr(arg, ctx), "text").sql})`,
    kind: "text",
  }),
  $toUpper: (arg, ctx) => ({
    sql: sql`upper(${coerce(compileExpr(arg, ctx), "text").sql})`,
    kind: "text",
  }),
  $trim: (arg, ctx) => {
    if (arg && typeof arg === "object" && !Array.isArray(arg) && "input" in arg) {
      const obj = arg as { input: Expr; chars?: Expr };
      const input = coerce(compileExpr(obj.input, ctx), "text").sql;
      if (obj.chars) {
        const chars = coerce(compileExpr(obj.chars, ctx), "text").sql;
        return { sql: sql`trim(both ${chars} from ${input})`, kind: "text" };
      }
      return { sql: sql`trim(${input})`, kind: "text" };
    }
    return { sql: sql`trim(${coerce(compileExpr(arg, ctx), "text").sql})`, kind: "text" };
  },
  $strLenCP: (arg, ctx) => ({
    sql: sql`char_length(${coerce(compileExpr(arg, ctx), "text").sql})`,
    kind: "int",
  }),
  $split: (arg, ctx) => {
    const args = arg as Expr[];
    const input = coerce(compileExpr(args[0]!, ctx), "text").sql;
    const delim = coerce(compileExpr(args[1]!, ctx), "text").sql;
    return {
      sql: sql`(select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) from unnest(string_to_array(${input}, ${delim})) s)`,
      kind: "jsonb",
    };
  },
  $regexMatch: (arg, ctx) => {
    const obj = arg as { input: Expr; regex: Expr; options?: Expr };
    const input = coerce(compileExpr(obj.input, ctx), "text").sql;
    const regex = coerce(compileExpr(obj.regex, ctx), "text").sql;
    const flags = typeof obj.options === "string" ? obj.options : "";
    const op = flags.includes("i") ? "~*" : "~";
    return { sql: sql`(${input} ${sql.raw(op)} ${regex})`, kind: "bool" };
  },

  $cond: (arg, ctx) => {
    let ifE: Expr, thenE: Expr, elseE: Expr;
    if (Array.isArray(arg)) {
      [ifE, thenE, elseE] = arg as [Expr, Expr, Expr];
    } else {
      const obj = arg as { if: Expr; then: Expr; else: Expr };
      ifE = obj.if;
      thenE = obj.then;
      elseE = obj.else;
    }
    const cond = coerce(compileExpr(ifE, ctx), "bool").sql;
    const t = coerce(compileExpr(thenE, ctx), "jsonb").sql;
    const e = coerce(compileExpr(elseE, ctx), "jsonb").sql;
    return { sql: sql`(case when ${cond} then ${t} else ${e} end)`, kind: "jsonb" };
  },
  $ifNull: (arg, ctx) => {
    const args = arg as Expr[];
    const parts = args.map((a) => coerce(compileExpr(a, ctx), "jsonb").sql);
    return { sql: sql`coalesce(${sql.join(parts)})`, kind: "jsonb" };
  },
  $switch: (arg, ctx) => {
    const obj = arg as { branches: { case: Expr; then: Expr }[]; default?: Expr };
    const branches = obj.branches.map((b) => {
      const cond = coerce(compileExpr(b.case, ctx), "bool").sql;
      const then = coerce(compileExpr(b.then, ctx), "jsonb").sql;
      return sql`when ${cond} then ${then}`;
    });
    const def = obj.default !== undefined ? coerce(compileExpr(obj.default, ctx), "jsonb").sql : sql`null::jsonb`;
    return {
      sql: sql`(case ${sql.join(branches, " ")} else ${def} end)`,
      kind: "jsonb",
    };
  },

  $size: (arg, ctx) => {
    const c = coerce(compileExpr(arg, ctx), "jsonb").sql;
    return { sql: sql`jsonb_array_length(${c})`, kind: "int" };
  },
  $arrayElemAt: (arg, ctx) => {
    const args = arg as Expr[];
    const arr = coerce(compileExpr(args[0]!, ctx), "jsonb").sql;
    const idx = coerce(compileExpr(args[1]!, ctx), "int").sql;
    return { sql: sql`(${arr} -> ${idx})`, kind: "jsonb" };
  },
  $first: (arg, ctx) => ({
    sql: sql`(${coerce(compileExpr(arg, ctx), "jsonb").sql} -> 0)`,
    kind: "jsonb",
  }),
  $last: (arg, ctx) => {
    const c = coerce(compileExpr(arg, ctx), "jsonb").sql;
    return { sql: sql`(${c} -> (jsonb_array_length(${c}) - 1))`, kind: "jsonb" };
  },
  $in: (arg, ctx) => {
    const args = arg as Expr[];
    const needle = coerce(compileExpr(args[0]!, ctx), "jsonb").sql;
    const haystack = coerce(compileExpr(args[1]!, ctx), "jsonb").sql;
    return {
      sql: sql`exists (select 1 from jsonb_array_elements(${haystack}) e where e = ${needle})`,
      kind: "bool",
    };
  },
  $isArray: (arg, ctx) => ({
    sql: sql`(jsonb_typeof(${coerce(compileExpr(arg, ctx), "jsonb").sql}) = 'array')`,
    kind: "bool",
  }),
  $concatArrays: (arg, ctx) => {
    const args = arg as Expr[];
    const parts = args.map((a) => coerce(compileExpr(a, ctx), "jsonb").sql);
    return { sql: sql`(${sql.join(parts, " || ")})`, kind: "jsonb" };
  },
  $reverseArray: (arg, ctx) => {
    const c = coerce(compileExpr(arg, ctx), "jsonb").sql;
    return {
      sql: sql`(select coalesce(jsonb_agg(e order by ord desc), '[]'::jsonb) from jsonb_array_elements(${c}) with ordinality as t(e, ord))`,
      kind: "jsonb",
    };
  },

  $sum: (arg, ctx) => {
    const c = coerce(compileExpr(arg, ctx), "jsonb").sql;
    return {
      sql: sql`(select coalesce(sum((e#>>'{}')::numeric), 0) from jsonb_array_elements(${c}) e)`,
      kind: "numeric",
    };
  },
  $avg: (arg, ctx) => {
    const c = coerce(compileExpr(arg, ctx), "jsonb").sql;
    return {
      sql: sql`(select avg((e#>>'{}')::numeric) from jsonb_array_elements(${c}) e)`,
      kind: "numeric",
    };
  },

  $map: (arg, ctx) => {
    const obj = arg as { input: Expr; as?: string; in: Expr };
    const input = coerce(compileExpr(obj.input, ctx), "jsonb").sql;
    const varName = obj.as ?? "this";
    const inner = compileExpr(obj.in, bindVar(ctx, varName, { sql: sql`__elem`, kind: "jsonb" }));
    const innerSql = coerce(inner, "jsonb").sql;
    return {
      sql: sql`(select coalesce(jsonb_agg(${innerSql}), '[]'::jsonb) from jsonb_array_elements(${input}) as __elem)`,
      kind: "jsonb",
    };
  },
  $filter: (arg, ctx) => {
    const obj = arg as { input: Expr; as?: string; cond: Expr };
    const input = coerce(compileExpr(obj.input, ctx), "jsonb").sql;
    const varName = obj.as ?? "this";
    const inner = bindVar(ctx, varName, { sql: sql`__elem`, kind: "jsonb" });
    const cond = coerce(compileExpr(obj.cond, inner), "bool").sql;
    return {
      sql: sql`(select coalesce(jsonb_agg(__elem), '[]'::jsonb) from jsonb_array_elements(${input}) as __elem where ${cond})`,
      kind: "jsonb",
    };
  },
  $reduce: (arg, ctx) => {
    const obj = arg as { input: Expr; initialValue: Expr; in: Expr };
    const input = coerce(compileExpr(obj.input, ctx), "jsonb").sql;
    const init = coerce(compileExpr(obj.initialValue, ctx), "jsonb").sql;
    return {
      sql: sql`(
        with recursive __r(idx, val) as (
          select 0::int, ${init}
          union all
          select __r.idx + 1,
                 ${reduceStepSql(obj.in, sql`__r.val`, sql`(${input} -> __r.idx)`)}
          from __r
          where __r.idx < jsonb_array_length(${input})
        )
        select val from __r order by idx desc limit 1
      )`,
      kind: "jsonb",
    };
  },

  $mergeObjects: (arg, ctx) => {
    const args = (Array.isArray(arg) ? arg : [arg]) as Expr[];
    const parts = args.map((a) => coerce(compileExpr(a, ctx), "jsonb").sql);
    return { sql: sql`(${sql.join(parts, " || ")})`, kind: "jsonb" };
  },

  $type: (arg, ctx) => ({
    sql: sql`jsonb_typeof(${coerce(compileExpr(arg, ctx), "jsonb").sql})`,
    kind: "text",
  }),
  $toString: (arg, ctx) => ({ sql: coerce(compileExpr(arg, ctx), "text").sql, kind: "text" }),
  $toInt: (arg, ctx) => ({ sql: coerce(compileExpr(arg, ctx), "int").sql, kind: "int" }),
  $toLong: (arg, ctx) => ({ sql: coerce(compileExpr(arg, ctx), "int").sql, kind: "int" }),
  $toDouble: (arg, ctx) => ({ sql: coerce(compileExpr(arg, ctx), "numeric").sql, kind: "numeric" }),
  $toDecimal: (arg, ctx) => ({ sql: coerce(compileExpr(arg, ctx), "numeric").sql, kind: "numeric" }),
  $toBool: (arg, ctx) => ({ sql: coerce(compileExpr(arg, ctx), "bool").sql, kind: "bool" }),
  $toDate: (arg, ctx) => ({
    sql: coerce(compileExpr(arg, ctx), "timestamptz").sql,
    kind: "timestamptz",
  }),
};

function reduceStepSql(inExpr: Expr, valueSql: Sql, thisSql: Sql): Sql {
  const ctx: Ctx = {
    doc: sql`null::jsonb`,
    vars: {
      ROOT: { sql: sql`null::jsonb`, kind: "jsonb" },
      CURRENT: { sql: sql`null::jsonb`, kind: "jsonb" },
      this: { sql: thisSql, kind: "jsonb" },
      value: { sql: valueSql, kind: "jsonb" },
    },
  };
  return coerce(compileExpr(inExpr, ctx), "jsonb").sql;
}

function compileOp(op: string, arg: Expr, ctx: Ctx): Compiled {
  const fn = ops[op];
  if (!fn) throw new Error(`unsupported operator: ${op}`);
  return fn(arg, ctx);
}

export function compileMatchFilter(filter: Record<string, Expr>, ctx: Ctx): Sql {
  const parts: Sql[] = [];
  for (const [key, value] of Object.entries(filter)) {
    parts.push(compileMatchClause(key, value, ctx));
  }
  if (parts.length === 0) return sql`true`;
  return sql.join(parts, " and ");
}

function compileMatchClause(key: string, value: Expr, ctx: Ctx): Sql {
  if (key === "$and") {
    const parts = (value as Record<string, Expr>[]).map((v) => sql`(${compileMatchFilter(v, ctx)})`);
    if (parts.length === 0) return sql`true`;
    return sql.join(parts, " and ");
  }
  if (key === "$or") {
    const parts = (value as Record<string, Expr>[]).map((v) => sql`(${compileMatchFilter(v, ctx)})`);
    if (parts.length === 0) return sql`false`;
    return sql`(${sql.join(parts, " or ")})`;
  }
  if (key === "$nor") {
    const parts = (value as Record<string, Expr>[]).map((v) => sql`(${compileMatchFilter(v, ctx)})`);
    if (parts.length === 0) return sql`true`;
    return sql`not (${sql.join(parts, " or ")})`;
  }
  if (key === "$expr") {
    return coerce(compileExpr(value, ctx), "bool").sql;
  }
  const path = key.split(".");
  const fieldJsonb = jsonbPath(ctx.doc, path);
  return compileMatchValue(fieldJsonb, value, ctx, path);
}

function compileMatchValue(field: Sql, value: Expr, ctx: Ctx, path: string[]): Sql {
  if (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).some((k) => k.startsWith("$"))
  ) {
    const obj = value as Record<string, Expr>;
    const parts: Sql[] = [];
    for (const [op, opArg] of Object.entries(obj)) {
      parts.push(compileMatchOp(field, op, opArg, ctx, path));
    }
    return parts.length === 1 ? parts[0]! : sql`(${sql.join(parts, " and ")})`;
  }
  return sql`(${field} = ${literalToJsonb(value)})`;
}

function compileMatchOp(field: Sql, op: string, arg: Expr, ctx: Ctx, path: string[]): Sql {
  switch (op) {
    case "$eq":
      return sql`(${field} = ${literalToJsonb(arg)})`;
    case "$ne":
      return sql`(${field} is distinct from ${literalToJsonb(arg)})`;
    case "$gt":
      return cmpAsTyped(field, ">", arg);
    case "$gte":
      return cmpAsTyped(field, ">=", arg);
    case "$lt":
      return cmpAsTyped(field, "<", arg);
    case "$lte":
      return cmpAsTyped(field, "<=", arg);
    case "$in": {
      const arr = arg as Expr[];
      const items = arr.map((v) => literalToJsonb(v));
      return sql`(${field} in (${sql.join(items)}))`;
    }
    case "$nin": {
      const arr = arg as Expr[];
      const items = arr.map((v) => literalToJsonb(v));
      return sql`(${field} not in (${sql.join(items)}))`;
    }
    case "$exists": {
      const exists = !!arg;
      return exists ? sql`(${field} is not null)` : sql`(${field} is null)`;
    }
    case "$regex": {
      const text = sql`(${field}#>>'{}')`;
      return sql`(${text} ~ ${arg as string})`;
    }
    case "$not": {
      const inner = compileMatchValue(field, arg, ctx, path);
      return sql`(not ${inner})`;
    }
    case "$all": {
      const arr = arg as Expr[];
      const checks = arr.map((v) => sql`(${field} @> ${asJsonbContainment(v)})`);
      return sql`(${sql.join(checks, " and ")})`;
    }
    case "$size":
      return sql`(jsonb_array_length(${field}) = ${arg as number})`;
    case "$elemMatch": {
      const elemCtx = { ...ctx, doc: sql`__elem` };
      const inner = compileMatchFilter(arg as Record<string, Expr>, elemCtx);
      return sql`exists (select 1 from jsonb_array_elements(${field}) as __elem where ${inner})`;
    }
    case "$type": {
      const t = arg as string;
      return sql`(jsonb_typeof(${field}) = ${t})`;
    }
    default:
      throw new Error(`unsupported match operator: ${op}`);
  }
}

function cmpAsTyped(field: Sql, op: string, arg: Expr): Sql {
  if (typeof arg === "number") {
    return sql`((${field}#>>'{}')::numeric ${sql.raw(op)} ${arg})`;
  }
  if (typeof arg === "string") {
    return sql`((${field}#>>'{}') ${sql.raw(op)} ${arg})`;
  }
  if (typeof arg === "boolean") {
    return sql`((${field}#>>'{}')::bool ${sql.raw(op)} ${arg})`;
  }
  return sql`(${field} ${sql.raw(op)} ${literalToJsonb(arg)})`;
}

export function literalToJsonb(value: Expr): Sql {
  if (value === null) return sql`null::jsonb`;
  if (typeof value === "string") return sql`to_jsonb(${value}::text)`;
  if (typeof value === "number") return sql`to_jsonb(${value}::numeric)`;
  if (typeof value === "boolean") return sql`to_jsonb(${value}::bool)`;
  return sql`${JSON.stringify(value)}::jsonb`;
}

function asJsonbContainment(value: Expr): Sql {
  return sql`jsonb_build_array(${literalToJsonb(value)})`;
}
