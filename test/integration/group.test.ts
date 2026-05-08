import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { ghost, $group, $sort, $match, $project } from "../../src/index.ts";
import { connect, executor, type Sql } from "./setup.ts";

let client: Sql;

const skip = process.env.GHOSTPRES_SKIP_PG === "1";
const describeIf = skip ? describe.skip : describe;

describeIf("integration: $group accumulators", () => {
  beforeAll(async () => {
    client = connect();
    await client`drop table if exists scores cascade`;
    await client`create table scores (id bigserial primary key, data jsonb not null)`;
    const rows = [
      { team: "a", player: "p1", score: 10 },
      { team: "a", player: "p2", score: 20 },
      { team: "a", player: "p3", score: 30 },
      { team: "a", player: "p4", score: 40 },
      { team: "b", player: "p5", score: 5 },
      { team: "b", player: "p6", score: 15 },
      { team: "b", player: "p7", score: 25 },
    ];
    for (const r of rows) {
      await client`insert into scores (data) values (${client.json(r)})`;
    }
  });

  afterAll(async () => {
    if (client) await client.end({ timeout: 1 });
  });

  test("$stdDevPop and $stdDevSamp", async () => {
    const g = ghost(executor(client));
    const out = await g.collection("scores").run<{
      _id: string;
      sd_pop: string | null;
      sd_samp: string | null;
    }>([
      $group("$team", {
        sd_pop: { $stdDevPop: { $toDecimal: "$score" } },
        sd_samp: { $stdDevSamp: { $toDecimal: "$score" } },
      }),
      $sort({ _id: 1 }),
    ]);
    expect(out.length).toBe(2);
    expect(Number(out[0]!.sd_pop)).toBeCloseTo(11.18, 1);
    expect(Number(out[1]!.sd_pop)).toBeCloseTo(8.16, 1);
  });

  test("$top picks the row with max score", async () => {
    const g = ghost(executor(client));
    const out = await g.collection("scores").run<{ _id: string; top_player: string }>([
      $group("$team", {
        top_player: { $top: { sortBy: { score: -1 }, output: "$player" } },
      }),
      $sort({ _id: 1 }),
    ]);
    expect(out.find((r) => r._id === "a")!.top_player).toBe("p4");
    expect(out.find((r) => r._id === "b")!.top_player).toBe("p7");
  });

  test("$bottom picks the row with min score", async () => {
    const g = ghost(executor(client));
    const out = await g.collection("scores").run<{ _id: string; bot_player: string }>([
      $group("$team", {
        bot_player: { $bottom: { sortBy: { score: -1 }, output: "$player" } },
      }),
      $sort({ _id: 1 }),
    ]);
    expect(out.find((r) => r._id === "a")!.bot_player).toBe("p1");
    expect(out.find((r) => r._id === "b")!.bot_player).toBe("p5");
  });

  test("$topN returns top n by sortBy", async () => {
    const g = ghost(executor(client));
    const out = await g.collection("scores").run<{ _id: string; top: string[] }>([
      $group("$team", {
        top: { $topN: { sortBy: { score: -1 }, output: "$player", n: 2 } },
      }),
      $sort({ _id: 1 }),
    ]);
    expect(out.find((r) => r._id === "a")!.top).toEqual(["p4", "p3"]);
    expect(out.find((r) => r._id === "b")!.top).toEqual(["p7", "p6"]);
  });

  test("$minN returns smallest n inputs", async () => {
    const g = ghost(executor(client));
    const out = await g.collection("scores").run<{ _id: string; lows: number[] }>([
      $group("$team", {
        lows: { $minN: { input: { $toDecimal: "$score" }, n: 2 } },
      }),
      $sort({ _id: 1 }),
    ]);
    expect(out.find((r) => r._id === "a")!.lows.map(Number)).toEqual([10, 20]);
    expect(out.find((r) => r._id === "b")!.lows.map(Number)).toEqual([5, 15]);
  });

  test("$maxN returns largest n inputs", async () => {
    const g = ghost(executor(client));
    const out = await g.collection("scores").run<{ _id: string; highs: number[] }>([
      $group("$team", {
        highs: { $maxN: { input: { $toDecimal: "$score" }, n: 2 } },
      }),
      $sort({ _id: 1 }),
    ]);
    expect(out.find((r) => r._id === "a")!.highs.map(Number)).toEqual([40, 30]);
  });

  test("$mergeObjects folds objects per group", async () => {
    const g = ghost(executor(client));
    await client`drop table if exists settings_rows cascade`;
    await client`create table settings_rows (id bigserial primary key, data jsonb not null)`;
    await client`insert into settings_rows (data) values (${client.json({ env: "prod", patch: { a: 1, b: 2 } })})`;
    await client`insert into settings_rows (data) values (${client.json({ env: "prod", patch: { b: 99, c: 3 } })})`;
    await client`insert into settings_rows (data) values (${client.json({ env: "dev", patch: { x: 7 } })})`;

    const out = await g.collection("settings_rows").run<{ _id: string; merged: Record<string, number> }>([
      $group("$env", { merged: { $mergeObjects: "$patch" } }),
      $sort({ _id: 1 }),
    ]);
    const prod = out.find((r) => r._id === "prod")!;
    expect(prod.merged.a).toBe(1);
    expect(prod.merged.c).toBe(3);
    expect([2, 99]).toContain(prod.merged.b);
  });

  test("$firstN with sortBy returns first n by sort", async () => {
    const g = ghost(executor(client));
    const out = await g.collection("scores").run<{ _id: string; first2: string[] }>([
      $group("$team", {
        first2: {
          $firstN: { input: "$player", n: 2, sortBy: { score: 1 } },
        },
      }),
      $sort({ _id: 1 }),
    ]);
    expect(out.find((r) => r._id === "a")!.first2).toEqual(["p1", "p2"]);
  });
});
