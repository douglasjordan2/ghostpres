import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import postgres from "postgres";
import { collection } from "../../src/index.ts";
import { seedBlog } from "../../examples/blog-seed.ts";
import type { Post, Comment } from "../../examples/blog.ts";

const url =
  process.env.GHOSTPRES_TEST_DB ?? "postgres://postgres:ghost@localhost:54329/ghostpres_test";

let sql: ReturnType<typeof postgres>;

const skip = process.env.GHOSTPRES_SKIP_PG === "1";
const describeIf = skip ? describe.skip : describe;

describeIf("integration: $lookup with sub-pipeline", () => {
  beforeAll(async () => {
    sql = postgres(url, { max: 4, idle_timeout: 1, connect_timeout: 5 });
    await seedBlog(sql);
  });

  afterAll(async () => {
    if (sql) await sql.end({ timeout: 1 });
  });

  const exec = {
    unsafe: async (text: string, values: unknown[]) =>
      (await sql.unsafe(text, values as never[])) as unknown as unknown[],
  };

  test("correlated sub-pipeline via let + $expr (latest comment per post)", async () => {
    const rows = await collection<Post>("posts")
      .lookup<Comment, Comment, "latestComment">({
        from: "comments",
        let: { pid: "$_id" },
        pipeline: (q) =>
          q
            .match({ $expr: { $eq: ["$post_id", "$$pid"] } })
            .sort({ created_at: -1 })
            .limit(1),
        as: "latestComment",
      })
      .sort({ _id: 1 })
      .run(exec);

    const byId = new Map(rows.map((r) => [r._id, r]));

    expect(byId.get(1)!.latestComment.map((c) => c._id)).toEqual([2]);
    expect(byId.get(3)!.latestComment.map((c) => c._id)).toEqual([3]);
    expect(byId.get(6)!.latestComment.map((c) => c._id)).toEqual([5]);
    expect(byId.get(2)!.latestComment).toEqual([]);
  });

  test("localField/foreignField AND-ed with a sub-pipeline (sorted comments per post)", async () => {
    const rows = await collection<Post>("posts")
      .lookup<Comment, Comment, "comments">({
        from: "comments",
        localField: "_id",
        foreignField: "post_id",
        pipeline: (q) => q.sort({ created_at: 1 }),
        as: "comments",
      })
      .sort({ _id: 1 })
      .run(exec);

    const byId = new Map(rows.map((r) => [r._id, r]));

    expect(byId.get(1)!.comments.map((c) => c._id)).toEqual([1, 2]);
    expect(byId.get(6)!.comments.map((c) => c._id)).toEqual([4, 5]);
    expect(byId.get(2)!.comments).toEqual([]);
  });

  test("classic equality $lookup still works (no pipeline)", async () => {
    const rows = await collection<Post>("posts")
      .lookup<Comment, "comments">({
        from: "comments",
        localField: "_id",
        foreignField: "post_id",
        as: "comments",
      })
      .sort({ _id: 1 })
      .run(exec);

    const byId = new Map(rows.map((r) => [r._id, r]));
    expect(new Set(byId.get(1)!.comments.map((c) => c._id))).toEqual(new Set([1, 2]));
    expect(byId.get(2)!.comments).toEqual([]);
  });
});
