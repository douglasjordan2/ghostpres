import { collection, type Pipeline, type Stage } from "../src/index.ts";
import { $match, $lookup, $addFields, type Expr } from "../src/types.ts";
import type { Post, User, Comment, FeedArgs } from "./blog.ts";

export type FeedRow = {
  _id: number;
  title: string;
  tags: string[];
  published_at: string;
  views: number;
  author: User;
  comment_count: number;
  reaction_count: number;
  reading_time_min: number;
};

export type AuthorStats = {
  username: string;
  post_count: number;
  total_views: number;
  avg_views: number;
  latest_post_at: string;
};

export type TagStats = {
  _id: string;
  post_count: number;
  total_views: number;
  sample_titles: string[];
};

export function feedTyped(args: FeedArgs): Pipeline<FeedRow> {
  const { since, tag, search, page = 0, pageSize = 20 } = args;

  const tagStages: Stage[] = tag ? [$match({ tags: tag })] : [];
  const searchStages: Stage[] = search
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

  const recent = collection<Post>("posts").match({
    $expr: { $gte: [{ $toDate: "$published_at" }, { $toDate: since }] },
  });

  return recent
    .extend(tagStages)
    .extend(searchStages)
    .cast<Post>()
    .lookup<User, "author">({
      from: "users",
      localField: "author_id",
      foreignField: "_id",
      as: "author",
    })
    .addFields({ author: { $arrayElemAt: ["$author", 0] } })
    .lookup<Comment, "comments">({
      from: "comments",
      localField: "_id",
      foreignField: "post_id",
      as: "comments",
    })
    .addFields({
      comment_count: { $size: "$comments" } as Expr,
      reaction_count: {
        $sum: {
          $map: { input: "$comments", in: { $size: "$$this.reactions" } },
        },
      } as Expr,
      reading_time_min: {
        $ceil: { $divide: [{ $strLenCP: { $toString: "$body" } }, 1000] },
      } as Expr,
    })
    .sort({ published_at: -1 })
    .skip(page * pageSize)
    .limit(pageSize)
    .project({
      _id: 1,
      title: 1,
      tags: 1,
      published_at: 1,
      views: 1,
      author: 1,
      comment_count: 1,
      reaction_count: 1,
      reading_time_min: 1,
    })
    .cast<FeedRow>();
}

export function topAuthorsTyped(since: string, limit = 10): Pipeline<AuthorStats> {
  return collection<Post>("posts")
    .match({
      $expr: { $gte: [{ $toDate: "$published_at" }, { $toDate: since }] },
    })
    .group("$author_id", {
      post_count: { $sum: 1 },
      total_views: { $sum: "$views" },
      avg_views: { $avg: "$views" },
      latest_post_at: { $max: "$published_at" },
    })
    .sort({ post_count: -1 })
    .limit(limit)
    .lookup<User, "user">({
      from: "users",
      localField: "_id",
      foreignField: "_id",
      as: "user",
    })
    .addFields({ user: { $arrayElemAt: ["$user", 0] } })
    .project({
      _id: 0,
      username: "$user.username",
      post_count: 1,
      total_views: 1,
      avg_views: 1,
      latest_post_at: 1,
    })
    .cast<AuthorStats>();
}

export function tagStatsTyped(): Pipeline<TagStats> {
  return collection<Post>("posts")
    .unwind("$tags")
    .group("$tags", {
      post_count: { $sum: 1 },
      total_views: { $sum: "$views" },
      sample_titles: { $firstN: { input: "$title", n: 3 } },
    })
    .sort({ post_count: -1, total_views: -1 })
    .cast<TagStats>();
}
