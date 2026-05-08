import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import postgres from "postgres";
import { feedTyped, topAuthorsTyped, tagStatsTyped } from "../../examples/blog-typed.ts";
import { feedPipeline } from "../../examples/blog.ts";
import { aggregate } from "../../src/index.ts";
import { seedBlog } from "../../examples/blog-seed.ts";

const url =
  process.env.GHOSTPRES_TEST_DB ?? "postgres://postgres:ghost@localhost:54329/ghostpres_test";

let sql: ReturnType<typeof postgres>;

const skip = process.env.GHOSTPRES_SKIP_PG === "1";
const describeIf = skip ? describe.skip : describe;

describeIf("integration: blog example", () => {
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

  test("feed embeds author and counts comments + reactions", async () => {
    const rows = await feedTyped({ since: "2025-01-01T00:00:00Z" }).run(exec);
    expect(rows.length).toBe(6);

    const quake = rows.find((r) => r.title.includes("Quake"))!;
    expect(quake.author.username).toBe("carmack");
    expect(quake.comment_count).toBe(2);
    expect(quake.reaction_count).toBe(2);
    expect(quake.reading_time_min).toBeGreaterThanOrEqual(1);
  });

  test("feed tag filter narrows to a single tag", async () => {
    const rows = await feedTyped({
      since: "2025-01-01T00:00:00Z",
      tag: "essay",
    }).run(exec);
    expect(rows.length).toBe(4);
    for (const r of rows) expect(r.tags).toContain("essay");
  });

  test("feed search is case-insensitive across title and body", async () => {
    const rows = await feedTyped({
      since: "2025-01-01T00:00:00Z",
      search: "BSP",
    }).run(exec);
    expect(rows.length).toBe(1);
    expect(rows[0]!.title).toContain("BSP");
  });

  test("feed pagination", async () => {
    const a = await feedTyped({
      since: "2025-01-01T00:00:00Z",
      page: 0,
      pageSize: 2,
    }).run(exec);
    const b = await feedTyped({
      since: "2025-01-01T00:00:00Z",
      page: 1,
      pageSize: 2,
    }).run(exec);
    expect(a.length).toBe(2);
    expect(b.length).toBe(2);
    expect(a[0]!._id).not.toBe(b[0]!._id);
  });

  test("top authors aggregates posts and views", async () => {
    const rows = await topAuthorsTyped("2025-01-01T00:00:00Z", 3).run(exec);
    const grace = rows.find((r) => r.username === "grace")!;
    expect(Number(grace.post_count)).toBe(2);
    expect(Number(grace.total_views)).toBe(2110 + 880);
  });

  test("tag stats unwinds and groups", async () => {
    const rows = await tagStatsTyped().run(exec);
    const essay = rows.find((r) => r._id === "essay")!;
    expect(Number(essay.post_count)).toBe(4);
    expect(essay.sample_titles.length).toBeGreaterThan(0);
  });

  test("array form compiles to a single CTE-chained query", () => {
    const stages = feedPipeline({ since: "2025-01-01T00:00:00Z" });
    const { text, values } = aggregate(stages, { collection: "posts" });
    expect(text).toMatch(/with .*as \(/);
    expect(text).toContain('"posts"');
    expect(text).toContain('"users"');
    expect(text).toContain('"comments"');
    expect(values.length).toBeGreaterThan(0);
  });

  test("dynamic stage splicing: tag filter is conditional", () => {
    const without = feedPipeline({ since: "2025-01-01T00:00:00Z" });
    const withTag = feedPipeline({ since: "2025-01-01T00:00:00Z", tag: "essay" });
    expect(withTag.length).toBe(without.length + 1);
  });

  test("$match scalar against array field uses jsonb containment (Mongo polymorphic semantics)", async () => {
    const rows = await feedTyped({ since: "2025-01-01T00:00:00Z", tag: "history" }).run(exec);
    expect(rows.length).toBe(2);
    for (const r of rows) expect(r.tags).toContain("history");
  });
});
