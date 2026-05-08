import {
  $match,
  $lookup,
  $addFields,
  $project,
  $sort,
  $limit,
  $skip,
  $unwind,
  $group,
  type Stage,
  type Expr,
} from "../src/index.ts";

export type User = {
  _id: number;
  username: string;
  email: string;
  joined_at: string;
};

export type Post = {
  _id: number;
  author_id: number;
  title: string;
  body: string;
  tags: string[];
  published_at: string;
  views: number;
};

export type Reaction = { user_id: number; kind: "like" | "love" | "fire" };

export type Comment = {
  _id: number;
  post_id: number;
  author_id: number;
  body: string;
  created_at: string;
  reactions: Reaction[];
};

export type FeedArgs = {
  since: string;
  tag?: string;
  search?: string;
  page?: number;
  pageSize?: number;
};

export function feedPipeline(args: FeedArgs): Stage[] {
  const { since, tag, search, page = 0, pageSize = 20 } = args;

  const tagStage: Stage[] = tag ? [$match({ tags: tag })] : [];
  const searchStage: Stage[] = search
    ? [
        $match({
          $expr: {
            $or: [
              {
                $regexMatch: {
                  input: { $toString: "$title" },
                  regex: search,
                  options: "i",
                },
              },
              {
                $regexMatch: {
                  input: { $toString: "$body" },
                  regex: search,
                  options: "i",
                },
              },
            ],
          },
        }),
      ]
    : [];

  return [
    $match({
      $expr: { $gte: [{ $toDate: "$published_at" }, { $toDate: since }] },
    }),
    ...tagStage,
    ...searchStage,
    $lookup({
      from: "users",
      localField: "author_id",
      foreignField: "_id",
      as: "author",
    }),
    $addFields({ author: { $arrayElemAt: ["$author", 0] } }),
    $lookup({
      from: "comments",
      localField: "_id",
      foreignField: "post_id",
      as: "comments",
    }),
    $addFields({
      comment_count: { $size: "$comments" },
      reaction_count: {
        $sum: {
          $map: { input: "$comments", in: { $size: "$$this.reactions" } },
        },
      },
      reading_time_min: {
        $ceil: { $divide: [{ $strLenCP: { $toString: "$body" } }, 1000] },
      },
    }),
    $sort({ published_at: -1 }),
    $skip(page * pageSize),
    $limit(pageSize),
    $project({
      _id: 1,
      title: 1,
      tags: 1,
      published_at: 1,
      views: 1,
      author: 1,
      comment_count: 1,
      reaction_count: 1,
      reading_time_min: 1,
    }),
  ];
}

export function topAuthorsPipeline(since: string, limit = 10): Stage[] {
  return [
    $match({
      $expr: { $gte: [{ $toDate: "$published_at" }, { $toDate: since }] },
    }),
    $group("$author_id", {
      post_count: { $sum: 1 },
      total_views: { $sum: "$views" },
      avg_views: { $avg: "$views" },
      latest_post_at: { $max: "$published_at" },
    }),
    $sort({ post_count: -1 }),
    $limit(limit),
    $lookup({
      from: "users",
      localField: "_id",
      foreignField: "_id",
      as: "user",
    }),
    $addFields({ user: { $arrayElemAt: ["$user", 0] } }),
    $project({
      _id: 0,
      username: "$user.username",
      post_count: 1,
      total_views: 1,
      avg_views: 1,
      latest_post_at: 1,
    }),
  ];
}

export function tagStatsPipeline(): Stage[] {
  return [
    $unwind("$tags"),
    $group("$tags", {
      post_count: { $sum: 1 },
      total_views: { $sum: "$views" },
      sample_titles: { $firstN: { input: "$title", n: 3 } },
    }),
    $sort({ post_count: -1, total_views: -1 }),
  ];
}

const compactReactions: Expr = {
  $reduce: {
    input: "$reactions",
    initialValue: { like: 0, love: 0, fire: 0 },
    in: {
      $mergeObjects: [
        "$$value",
        {
          $cond: [
            { $eq: ["$$this.kind", "like"] },
            { like: { $add: [{ $ifNull: ["$$value.like", 0] }, 1] } },
            {
              $cond: [
                { $eq: ["$$this.kind", "love"] },
                { love: { $add: [{ $ifNull: ["$$value.love", 0] }, 1] } },
                { fire: { $add: [{ $ifNull: ["$$value.fire", 0] }, 1] } },
              ],
            },
          ],
        },
      ],
    },
  },
};

export function commentReactionsPipeline(postId: number): Stage[] {
  return [
    $match({ post_id: postId }),
    $addFields({ reaction_breakdown: compactReactions }),
    $sort({ created_at: 1 }),
    $project({
      _id: 1,
      body: 1,
      author_id: 1,
      created_at: 1,
      reaction_breakdown: 1,
    }),
  ];
}
