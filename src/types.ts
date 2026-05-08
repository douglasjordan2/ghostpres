export type Expr =
  | string
  | number
  | boolean
  | null
  | Expr[]
  | { [k: string]: Expr };

export type MatchFilter = Record<string, Expr>;
export type Document = Record<string, Expr>;

export type Accumulator =
  | { $sum: Expr }
  | { $avg: Expr }
  | { $min: Expr }
  | { $max: Expr }
  | { $first: Expr }
  | { $last: Expr }
  | { $push: Expr }
  | { $addToSet: Expr }
  | { $count: object }
  | { $stdDevPop: Expr }
  | { $stdDevSamp: Expr }
  | { $mergeObjects: Expr }
  | { $top: { sortBy: SortSpec; output: Expr } }
  | { $bottom: { sortBy: SortSpec; output: Expr } }
  | { $topN: { sortBy: SortSpec; output: Expr; n: number } }
  | { $bottomN: { sortBy: SortSpec; output: Expr; n: number } }
  | { $minN: { input: Expr; n: number } }
  | { $maxN: { input: Expr; n: number } }
  | { $firstN: { input: Expr; n: number; sortBy?: SortSpec } }
  | { $lastN: { input: Expr; n: number; sortBy?: SortSpec } };

export type SortSpec = Record<string, 1 | -1>;

export type MatchStage = { $: "match"; filter: MatchFilter };
export type ProjectStage = { $: "project"; doc: Document; passthrough?: boolean };
export type AddFieldsStage = { $: "addFields"; doc: Document };
export type LookupStage = {
  $: "lookup";
  from: string;
  localField: string;
  foreignField?: string;
  as: string;
  pipeline?: Stage[];
};
export type UnwindStage = {
  $: "unwind";
  path: string;
  preserveNullAndEmptyArrays?: boolean;
  includeArrayIndex?: string;
};
export type GroupStage = {
  $: "group";
  _id: Expr;
  fields: Record<string, Accumulator>;
};
export type SortStage = { $: "sort"; spec: SortSpec };
export type LimitStage = { $: "limit"; n: number };
export type SkipStage = { $: "skip"; n: number };
export type CountStage = { $: "count"; field: string };
export type ReplaceRootStage = { $: "replaceRoot"; newRoot: Expr };

export type Stage =
  | MatchStage
  | ProjectStage
  | AddFieldsStage
  | LookupStage
  | UnwindStage
  | GroupStage
  | SortStage
  | LimitStage
  | SkipStage
  | CountStage
  | ReplaceRootStage;

export const $match = (filter: MatchFilter): MatchStage => ({ $: "match", filter });

export const $project = (doc: Document): ProjectStage => ({ $: "project", doc });

export const $addFields = (doc: Document): AddFieldsStage => ({ $: "addFields", doc });
export const $set = $addFields;

export const $lookup = (opts: Omit<LookupStage, "$">): LookupStage => ({
  $: "lookup",
  ...opts,
});

export const $unwind = (
  path: string,
  opts: Omit<UnwindStage, "$" | "path"> = {},
): UnwindStage => ({ $: "unwind", path, ...opts });

export const $group = (
  _id: Expr,
  fields: Record<string, Accumulator> = {},
): GroupStage => ({ $: "group", _id, fields });

export const $sort = (spec: SortSpec): SortStage => ({ $: "sort", spec });
export const $limit = (n: number): LimitStage => ({ $: "limit", n });
export const $skip = (n: number): SkipStage => ({ $: "skip", n });
export const $count = (field: string): CountStage => ({ $: "count", field });
export const $replaceRoot = (newRoot: Expr): ReplaceRootStage => ({
  $: "replaceRoot",
  newRoot,
});
