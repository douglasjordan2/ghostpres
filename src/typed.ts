import {
  $match,
  $project,
  $addFields,
  $lookup,
  $unwind,
  $group,
  $sort,
  $limit,
  $skip,
  $count,
  $replaceRoot,
  type Stage,
  type Expr,
  type Document,
  type SortSpec,
  type Accumulator,
  type LookupStage,
  type UnwindStage,
} from "./types.ts";
import { aggregate, type AggregateOptions, type AggregateResult } from "./pipeline.ts";

export type Executor = {
  unsafe: (text: string, values: unknown[]) => Promise<unknown[]>;
};

type Cmp<V> = {
  $eq?: V;
  $ne?: V;
  $gt?: V;
  $gte?: V;
  $lt?: V;
  $lte?: V;
  $in?: V[];
  $nin?: V[];
  $exists?: boolean;
  $regex?: string;
  $not?: Cmp<V>;
  $type?: string;
  $size?: number;
  $all?: V[];
  $elemMatch?: Record<string, unknown>;
};

type FieldFilter<V> = V | Cmp<V>;

type LogicalKeys<TDoc> = {
  $and?: MatchFilter<TDoc>[];
  $or?: MatchFilter<TDoc>[];
  $nor?: MatchFilter<TDoc>[];
  $expr?: Expr;
};

export type MatchFilter<TDoc> =
  | LogicalKeys<TDoc>
  | ({ [K in keyof TDoc & string]?: FieldFilter<TDoc[K]> } & LogicalKeys<TDoc>)
  | Record<string, unknown>;

type Inclusion = 1 | true;
type Exclusion = 0 | false;

export type ProjectResult<TIn, TSpec> = {
  [K in keyof TSpec as TSpec[K] extends Exclusion ? never : K]:
    TSpec[K] extends Inclusion
      ? K extends keyof TIn
        ? TIn[K]
        : unknown
      : unknown;
};

export type AddFieldsResult<TIn, TSpec> = {
  [K in keyof TIn | keyof TSpec]: K extends keyof TSpec
    ? unknown
    : K extends keyof TIn
    ? TIn[K]
    : never;
};

export type LookupResult<TIn, TFrom, TAs extends string> = string extends TAs
  ? TIn & { [key: string]: TFrom[] | unknown }
  : TIn & { [K in TAs]: TFrom[] };

export type UnwindResult<TIn, TPath extends string> = TPath extends `$${infer K}`
  ? K extends keyof TIn
    ? TIn[K] extends Array<infer U>
      ? Omit<TIn, K> & { [P in K]: U }
      : TIn
    : TIn
  : TIn;

export type AccumulatorResult<A> = A extends { $sum: unknown }
  ? number
  : A extends { $avg: unknown }
  ? number
  : A extends { $count: unknown }
  ? number
  : A extends { $stdDevPop: unknown }
  ? number
  : A extends { $stdDevSamp: unknown }
  ? number
  : A extends { $min: unknown }
  ? unknown
  : A extends { $max: unknown }
  ? unknown
  : A extends { $first: unknown }
  ? unknown
  : A extends { $last: unknown }
  ? unknown
  : A extends { $top: { output: unknown } }
  ? unknown
  : A extends { $bottom: { output: unknown } }
  ? unknown
  : A extends { $push: unknown }
  ? unknown[]
  : A extends { $addToSet: unknown }
  ? unknown[]
  : A extends { $topN: unknown }
  ? unknown[]
  : A extends { $bottomN: unknown }
  ? unknown[]
  : A extends { $minN: unknown }
  ? unknown[]
  : A extends { $maxN: unknown }
  ? unknown[]
  : A extends { $firstN: unknown }
  ? unknown[]
  : A extends { $lastN: unknown }
  ? unknown[]
  : A extends { $mergeObjects: unknown }
  ? Record<string, unknown>
  : unknown;

export type GroupResult<TFields extends Record<string, Accumulator>> = {
  _id: unknown;
} & {
  [K in keyof TFields]: AccumulatorResult<TFields[K]>;
};

export type CountResult<TField extends string> = { [K in TField]: number };

export class Pipeline<TIn> {
  readonly collection: string;
  readonly stages: ReadonlyArray<Stage>;
  readonly options: Omit<AggregateOptions, "collection">;

  constructor(
    collection: string,
    stages: ReadonlyArray<Stage> = [],
    options: Omit<AggregateOptions, "collection"> = {},
  ) {
    this.collection = collection;
    this.stages = stages;
    this.options = options;
  }

  private next<TOut>(stage: Stage): Pipeline<TOut> {
    return new Pipeline<TOut>(this.collection, [...this.stages, stage], this.options);
  }

  match(filter: MatchFilter<TIn>): Pipeline<TIn> {
    return this.next($match(filter as Record<string, Expr>));
  }

  project<const TSpec extends Document>(spec: TSpec): Pipeline<ProjectResult<TIn, TSpec>> {
    return this.next($project(spec));
  }

  addFields<TSpec extends Document>(spec: TSpec): Pipeline<AddFieldsResult<TIn, TSpec>> {
    return this.next($addFields(spec));
  }

  set<TSpec extends Document>(spec: TSpec): Pipeline<AddFieldsResult<TIn, TSpec>> {
    return this.addFields(spec);
  }

  lookup<TFrom = unknown, const TAs extends string = string>(opts: {
    from: string;
    localField: string;
    foreignField?: string;
    as: TAs;
  }): Pipeline<LookupResult<TIn, TFrom, TAs>> {
    return this.next($lookup({ ...opts, as: opts.as as string }));
  }

  unwind<const TPath extends string>(
    path: TPath,
    opts: Omit<UnwindStage, "$" | "path"> = {},
  ): Pipeline<UnwindResult<TIn, TPath>> {
    return this.next($unwind(path, opts));
  }

  group<const TFields extends Record<string, Accumulator>>(
    _id: Expr,
    fields: TFields = {} as TFields,
  ): Pipeline<GroupResult<TFields>> {
    return this.next($group(_id, fields));
  }

  sort(spec: SortSpec): Pipeline<TIn> {
    return this.next($sort(spec));
  }

  limit(n: number): Pipeline<TIn> {
    return this.next($limit(n));
  }

  skip(n: number): Pipeline<TIn> {
    return this.next($skip(n));
  }

  count<TField extends string>(field: TField): Pipeline<CountResult<TField>> {
    return this.next($count(field));
  }

  replaceRoot<TNew = unknown>(newRoot: Expr): Pipeline<TNew> {
    return this.next($replaceRoot(newRoot));
  }

  extend(stages: ReadonlyArray<Stage>): Pipeline<unknown> {
    return new Pipeline<unknown>(this.collection, [...this.stages, ...stages], this.options);
  }

  cast<TOut>(): Pipeline<TOut> {
    return new Pipeline<TOut>(this.collection, this.stages, this.options);
  }

  toArray(): Stage[] {
    return [...this.stages];
  }

  compile(overrides: Partial<Omit<AggregateOptions, "collection">> = {}): AggregateResult {
    return aggregate([...this.stages], {
      ...this.options,
      ...overrides,
      collection: this.collection,
    });
  }

  async run(executor: Executor, overrides?: Partial<Omit<AggregateOptions, "collection">>): Promise<TIn[]> {
    const { text, values } = this.compile(overrides);
    const rows = await executor.unsafe(text, values);
    return rows.map((r) => (r as { doc: TIn }).doc);
  }
}

export function collection<TDoc = unknown>(
  name: string,
  options: Omit<AggregateOptions, "collection"> = {},
): Pipeline<TDoc> {
  return new Pipeline<TDoc>(name, [], options);
}
