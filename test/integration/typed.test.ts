import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { collection } from "../../src/index.ts";
import { connect, reset, seedShopify, executor, type Sql } from "./setup.ts";

let client: Sql;
let exec: ReturnType<typeof executor>;

const skip = process.env.GHOSTPRES_SKIP_PG === "1";
const describeIf = skip ? describe.skip : describe;

type Order = {
  _id: string;
  order_id: string;
  order_name: string;
  first_name: string;
  last_name: string;
  email: string;
  order_total: string;
  merchant_id: string;
  created_at: string;
  order_package_ids: number[];
};

type OrderPackage = {
  _id: number;
  tracking_url: string;
  tracking_number: string;
  shipment_date: string;
  fulfillment_id: string;
  pact_insured_cost: number;
};

describeIf("integration: typed pipeline", () => {
  beforeAll(async () => {
    client = connect();
    await reset(client);
    await seedShopify(client);
    exec = executor(client);
  });

  afterAll(async () => {
    if (client) await client.end({ timeout: 1 });
  });

  test("typed match + sort yields full Order rows", async () => {
    const rows = await collection<Order>("shopify_orders")
      .match({ merchant_id: "m1" })
      .sort({ order_id: 1 })
      .run(exec);

    expect(rows.length).toBe(2);
    expect(rows[0]!.order_id).toBe("1001");
    expect(rows[0]!.first_name).toBe("Ada");
  });

  test("project picks fields, types reflect inclusion", async () => {
    const rows = await collection<Order>("shopify_orders")
      .match({ merchant_id: "m1" })
      .project({ order_id: 1, email: 1 })
      .sort({ order_id: 1 })
      .run(exec);

    expect(Object.keys(rows[0]!).sort()).toEqual(["email", "order_id"]);
    expect(rows[0]!.email).toBe("ada@example.com");
  });

  test("lookup typed with TFrom; result has packages array", async () => {
    const rows = await collection<Order>("shopify_orders")
      .match({ merchant_id: "m1" })
      .lookup<OrderPackage, "packages">({
        from: "order_packages",
        localField: "order_package_ids",
        foreignField: "_id",
        as: "packages",
      })
      .sort({ order_id: 1 })
      .run(exec);

    expect(rows[0]!.packages.length).toBe(3);
    expect(rows[0]!.packages[0]!.tracking_number).toMatch(/T/);
  });

  test("group with $sum produces typed _id and number total", async () => {
    const rows = await collection<Order>("shopify_orders")
      .group("$merchant_id", {
        total: { $sum: { $toDecimal: "$order_total" } },
        n: { $sum: 1 },
      })
      .sort({ _id: 1 })
      .run(exec);

    expect(rows.length).toBe(2);
    const m1 = rows.find((r) => r._id === "m1")!;
    expect(Number(m1.total)).toBe(370);
    expect(Number(m1.n)).toBe(2);
  });

  test("count returns { total: number }", async () => {
    const rows = await collection<Order>("shopify_orders")
      .match({ merchant_id: "m1" })
      .count("total")
      .run(exec);

    expect(rows.length).toBe(1);
    expect(Number(rows[0]!.total)).toBe(2);
  });

  test("unwind narrows lookup array, then group", async () => {
    const rows = await collection<Order>("shopify_orders")
      .match({ merchant_id: "m1" })
      .lookup<OrderPackage, "packages">({
        from: "order_packages",
        localField: "order_package_ids",
        foreignField: "_id",
        as: "packages",
      })
      .unwind("$packages")
      .group("$packages.fulfillment_id", {
        cost: { $sum: { $toDecimal: "$packages.pact_insured_cost" } },
      })
      .sort({ _id: 1 })
      .run(exec);

    expect(rows.length).toBe(3);
    const f1 = rows.find((r) => r._id === "f1")!;
    expect(Number(f1.cost)).toBe(10);
  });

  test("extend escape hatch composes raw stages", async () => {
    const { $match, $limit } = await import("../../src/index.ts");
    const rows = await collection<Order>("shopify_orders")
      .extend([$match({ merchant_id: "m1" }), $limit(1)])
      .cast<Order>()
      .run(exec);
    expect(rows.length).toBe(1);
  });
});
