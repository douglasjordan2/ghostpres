import postgres from "postgres";
import { aggregate } from "../src/index.ts";
import { feedPipeline, topAuthorsPipeline, tagStatsPipeline } from "./blog.ts";
import { feedTyped, topAuthorsTyped, tagStatsTyped } from "./blog-typed.ts";
import { seedBlog } from "./blog-seed.ts";

const url =
  process.env.GHOSTPRES_DATABASE_URL ??
  "postgres://postgres:ghost@localhost:54329/ghostpres_test";

const sql = postgres(url, { max: 4, idle_timeout: 1, connect_timeout: 5 });

const exec = {
  unsafe: async (text: string, values: unknown[]) =>
    (await sql.unsafe(text, values as never[])) as unknown as unknown[],
};

function divider(label: string): void {
  console.log("\n" + "─".repeat(70));
  console.log(label);
  console.log("─".repeat(70));
}

async function main(): Promise<void> {
  divider("seed");
  await seedBlog(sql);
  console.log("seeded users, posts, comments");

  divider("array form: feed pipeline -> SQL");
  const feedStages = feedPipeline({
    since: "2025-01-01T00:00:00Z",
    tag: "essay",
    pageSize: 5,
  });
  const compiled = aggregate(feedStages, { collection: "posts" });
  console.log(`${feedStages.length} stages -> ${compiled.text.length} chars, ${compiled.values.length} params`);

  divider("typed builder: feed");
  const feed = await feedTyped({
    since: "2025-01-01T00:00:00Z",
    tag: "essay",
    pageSize: 5,
  }).run(exec);
  for (const row of feed) {
    console.log(
      `  ${row.published_at.slice(0, 10)}  @${row.author.username.padEnd(8)}  ` +
        `${row.title.slice(0, 40).padEnd(40)}  ` +
        `${row.comment_count}c  ${row.reaction_count}r  ${row.reading_time_min}min`,
    );
  }

  divider("typed builder: top authors");
  const authors = await topAuthorsTyped("2025-01-01T00:00:00Z", 3).run(exec);
  for (const a of authors) {
    console.log(
      `  @${a.username.padEnd(10)}  ${a.post_count} posts  ` +
        `${a.total_views} views  avg ${Number(a.avg_views).toFixed(0)}`,
    );
  }

  divider("typed builder: tag stats");
  const tags = await tagStatsTyped().run(exec);
  for (const t of tags) {
    const titles = t.sample_titles.slice(0, 2).join(", ");
    console.log(
      `  ${("#" + t._id).padEnd(14)}  ${t.post_count} posts  ` +
        `${t.total_views} views  e.g.: ${titles}`,
    );
  }

  divider("composability: same array spliced into a tag-filter view");
  const tagOnly = aggregate(tagStatsPipeline().slice(0, 3), { collection: "posts" });
  console.log(`taking the first 3 stages of tagStats -> ${tagOnly.text.length} chars of SQL`);
  console.log("(useful for debugging: comment out late stages to inspect intermediates)");

  await sql.end({ timeout: 1 });
}

main().catch((e) => {
  console.error(e);
  void sql.end({ timeout: 1 });
  process.exit(1);
});
