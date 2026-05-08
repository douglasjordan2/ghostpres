import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  ghost,
  $match,
  $lookup,
  $addFields,
  $project,
  $sort,
  $limit,
  $group,
  $unwind,
  $count,
  $skip,
} from "../../src/index.ts";
import { connect, reset, seedShopify, executor, type Sql } from "./setup.ts";

let client: Sql;
let g: ReturnType<typeof ghost>;

const skip = process.env.GHOSTPRES_SKIP_PG === "1";
const describeIf = skip ? describe.skip : describe;

describeIf("integration: pipeline against real postgres", () => {
  beforeAll(async () => {
    client = connect();
    try {
      await client`select 1`;
    } catch (e) {
      console.warn("[ghostpres] could not reach postgres, skipping integration tests:", String(e));
      throw e;
    }
    await reset(client);
    await seedShopify(client);
    g = ghost(executor(client));
  });

  afterAll(async () => {
    if (client) await client.end({ timeout: 1 });
  });

  test("filter by merchant", async () => {
    const orders = await g.collection("shopify_orders").run([
      $match({ "merchant_id": "m1" }),
      $sort({ "order_id": 1 }),
    ]);
    expect(orders.length).toBe(2);
    expect((orders[0] as { order_id: string }).order_id).toBe("1001");
  });

  test("lookup + project + dedupe-ish via $addToSet", async () => {
    const orders = await g.collection("shopify_orders").run<{
      order_number: string;
      protection_cost: number;
      packages: { tracking_number: string }[];
    }>([
      $match({ merchant_id: "m1" }),
      $lookup({
        from: "order_packages",
        localField: "order_package_ids",
        foreignField: "_id",
        as: "packages",
      }),
      $match({ "packages.0": { $exists: true } }),
      $addFields({
        protection_cost: {
          $sum: { $map: { input: "$packages", in: "$$this.pact_insured_cost" } },
        },
      }),
      $sort({ order_id: 1 }),
      $project({
        order_number: 1,
        protection_cost: 1,
        packages: 1,
      }),
    ]);

    expect(orders.length).toBe(2);
    expect(Number(orders[0]!.protection_cost)).toBe(10);
    expect(Number(orders[1]!.protection_cost)).toBe(7.5);
    expect(orders[0]!.packages.length).toBe(2);
  });

  test("$group with $sum and $push", async () => {
    const groups = await g.collection("shopify_orders").run<{
      _id: string;
      total: number;
      orders: number;
    }>([
      $group("$merchant_id", {
        total: { $sum: { $toDecimal: "$order_total" } },
        orders: { $sum: 1 },
      }),
      $sort({ _id: 1 }),
    ]);
    expect(groups.length).toBe(2);
    const m1 = groups.find((g) => g._id === "m1")!;
    expect(Number(m1.total)).toBe(370);
    expect(Number(m1.orders)).toBe(2);
  });

  test("$unwind + $group: per-package totals", async () => {
    const result = await g.collection("shopify_orders").run<{
      _id: string;
      total: number;
    }>([
      $match({ merchant_id: "m1" }),
      $lookup({
        from: "order_packages",
        localField: "order_package_ids",
        foreignField: "_id",
        as: "packages",
      }),
      $unwind("$packages"),
      $group("$packages.fulfillment_id", {
        total: { $sum: { $toDecimal: "$packages.pact_insured_cost" } },
        count: { $sum: 1 },
      }),
      $sort({ _id: 1 }),
    ]);
    expect(result.length).toBe(2);
    const f1 = result.find((g) => g._id === "f1")!;
    expect(Number(f1.total)).toBe(10);
  });

  test("$count returns single row with count", async () => {
    const result = await g.collection("shopify_orders").run<{ total: number }>([
      $match({ merchant_id: "m1" }),
      $count("total"),
    ]);
    expect(result.length).toBe(1);
    expect(Number(result[0]!.total)).toBe(2);
  });

  test("$or in $match", async () => {
    const orders = await g.collection("shopify_orders").run([
      $match({ $or: [{ merchant_id: "m1" }, { merchant_id: "m2" }] }),
    ]);
    expect(orders.length).toBe(3);
  });

  test("$expr cross-field comparison", async () => {
    const orders = await g.collection("shopify_orders").run([
      $match({
        $expr: {
          $eq: [{ $size: "$order_package_ids" }, 2],
        },
      }),
    ]);
    expect(orders.length).toBe(1);
  });

  test("$limit + $skip", async () => {
    const orders = await g.collection("shopify_orders").run([
      $sort({ order_id: 1 }),
      $skip(1),
      $limit(1),
    ]);
    expect(orders.length).toBe(1);
    expect((orders[0] as { order_id: string }).order_id).toBe("1002");
  });
});
