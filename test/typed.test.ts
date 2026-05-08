import { describe, expect, test } from "bun:test";
import { collection, type Pipeline } from "../src/index.ts";

type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2
  ? true
  : false;
type Expect<T extends true> = T;
type Extends<X, Y> = X extends Y ? true : false;

type Order = {
  _id: string;
  merchant_id: string;
  order_total: number;
  order_package_ids: number[];
  customer: { first: string; last: string; email: string };
  created_at: string;
};

type OrderPackage = {
  _id: number;
  tracking_number: string;
  pact_insured_cost: number;
  fulfillment_id: string;
};

describe("typed pipeline: type-level inference", () => {
  test("collection<T>(name) yields Pipeline<T>", () => {
    const orders = collection<Order>("orders");
    type OrdersT = typeof orders extends Pipeline<infer R> ? R : never;
    const _t1: Expect<Equal<OrdersT, Order>> = true;
    expect(_t1).toBe(true);
  });

  test("match preserves type", () => {
    const q = collection<Order>("orders").match({ merchant_id: "m1" });
    type T = typeof q extends Pipeline<infer R> ? R : never;
    const _t: Expect<Equal<T, Order>> = true;
    expect(_t).toBe(true);
  });

  test("project picks inclusion fields and adds expression fields", () => {
    const q = collection<Order>("orders").project({
      merchant_id: 1,
      order_total: 1,
      tag: { $literal: "ok" },
    });
    type T = typeof q extends Pipeline<infer R> ? R : never;
    const _t1: Expect<Equal<T["merchant_id"], string>> = true;
    const _t2: Expect<Equal<T["order_total"], number>> = true;
    const _t3: Expect<Extends<T, { tag: unknown }>> = true;
    expect([_t1, _t2, _t3]).toEqual([true, true, true]);
  });

  test("project drops fields with 0/false", () => {
    const q = collection<Order>("orders").project({
      merchant_id: 1,
      _id: 0,
    });
    type T = typeof q extends Pipeline<infer R> ? R : never;
    const _t1: Expect<Extends<T, { merchant_id: string }>> = true;
    const _t2: Expect<Equal<keyof T, "merchant_id">> = true;
    expect([_t1, _t2]).toEqual([true, true]);
  });

  test("addFields extends shape", () => {
    const q = collection<Order>("orders").addFields({
      protection: 5,
      label: "x",
    });
    type T = typeof q extends Pipeline<infer R> ? R : never;
    const _t1: Expect<Equal<T["merchant_id"], string>> = true;
    const _t2: Expect<Extends<T, { protection: unknown; label: unknown }>> = true;
    expect([_t1, _t2]).toEqual([true, true]);
  });

  test("lookup adds [as]: TFrom[]", () => {
    const q = collection<Order>("orders").lookup<OrderPackage, "packages">({
      from: "order_packages",
      localField: "order_package_ids",
      foreignField: "_id",
      as: "packages",
    });
    type T = typeof q extends Pipeline<infer R> ? R : never;
    const _t1: Expect<Equal<T["packages"], OrderPackage[]>> = true;
    const _t2: Expect<Equal<T["merchant_id"], string>> = true;
    expect([_t1, _t2]).toEqual([true, true]);
  });

  test("unwind narrows array field to element", () => {
    type WithItems = { id: string; items: { sku: string; qty: number }[] };
    const q = collection<WithItems>("t").unwind("$items");
    type T = typeof q extends Pipeline<infer R> ? R : never;
    const _t1: Expect<Equal<T["items"], { sku: string; qty: number }>> = true;
    const _t2: Expect<Equal<T["id"], string>> = true;
    expect([_t1, _t2]).toEqual([true, true]);
  });

  test("count returns { field: number }", () => {
    const q = collection<Order>("orders").count("total");
    type T = typeof q extends Pipeline<infer R> ? R : never;
    const _t: Expect<Equal<T, { total: number }>> = true;
    expect(_t).toBe(true);
  });

  test("group infers accumulator output shape", () => {
    const q = collection<Order>("orders").group("$merchant_id", {
      total: { $sum: "$order_total" },
      avg: { $avg: "$order_total" },
      orders: { $push: "$$ROOT" },
      first_email: { $first: "$customer.email" },
    });
    type T = typeof q extends Pipeline<infer R> ? R : never;
    const _t1: Expect<Equal<T["total"], number>> = true;
    const _t2: Expect<Equal<T["avg"], number>> = true;
    const _t3: Expect<Equal<T["orders"], unknown[]>> = true;
    const _t4: Expect<Equal<T["first_email"], unknown>> = true;
    expect([_t1, _t2, _t3, _t4]).toEqual([true, true, true, true]);
  });

  test("sort/limit/skip preserve type", () => {
    const q = collection<Order>("orders").sort({ order_total: -1 }).limit(10).skip(2);
    type T = typeof q extends Pipeline<infer R> ? R : never;
    const _t: Expect<Equal<T, Order>> = true;
    expect(_t).toBe(true);
  });

  test("end-to-end chain accumulates types correctly", () => {
    const q = collection<Order>("orders")
      .match({ merchant_id: "m1" })
      .lookup<OrderPackage, "packages">({
        from: "order_packages",
        localField: "order_package_ids",
        foreignField: "_id",
        as: "packages",
      })
      .addFields({ protection: 5 })
      .project({ merchant_id: 1, packages: 1, protection: 1 });

    type T = typeof q extends Pipeline<infer R> ? R : never;
    const _t1: Expect<Equal<T["merchant_id"], string>> = true;
    const _t2: Expect<Equal<T["packages"], OrderPackage[]>> = true;
    const _t3: Expect<Extends<T, { protection: unknown }>> = true;
    expect([_t1, _t2, _t3]).toEqual([true, true, true]);
  });

  test("cast<T>() reshapes type without changing stages", () => {
    const q = collection<Order>("orders")
      .project({ x: { $literal: 1 } })
      .cast<{ x: number }>();
    type T = typeof q extends Pipeline<infer R> ? R : never;
    const _t: Expect<Equal<T, { x: number }>> = true;
    expect(_t).toBe(true);
  });

  test("extend(stages) returns Pipeline<unknown>", () => {
    const q = collection<Order>("orders").extend([]);
    type T = typeof q extends Pipeline<infer R> ? R : never;
    const _t: Expect<Equal<T, unknown>> = true;
    expect(_t).toBe(true);
  });

  test("match with comparison operator", () => {
    const q = collection<Order>("orders").match({ order_total: { $gt: 100 } });
    type T = typeof q extends Pipeline<infer R> ? R : never;
    const _t: Expect<Equal<T, Order>> = true;
    expect(_t).toBe(true);
  });
});

describe("typed pipeline: runtime behavior", () => {
  test("toArray returns the stage list", () => {
    const stages = collection<Order>("orders").match({ merchant_id: "m1" }).limit(5).toArray();
    expect(stages.length).toBe(2);
    expect((stages[0] as { $: string }).$).toBe("match");
    expect((stages[1] as { $: string }).$).toBe("limit");
  });

  test("compile produces text + values", () => {
    const { text, values } = collection<Order>("orders")
      .match({ merchant_id: "m1" })
      .limit(5)
      .compile();
    expect(text).toContain("with");
    expect(text).toContain('"orders"');
    expect(values).toContain("m1");
    expect(values).toContain(5);
  });

  test("each stage call returns a fresh Pipeline (immutability)", () => {
    const a = collection<Order>("orders");
    const b = a.match({ merchant_id: "m1" });
    expect(a.stages.length).toBe(0);
    expect(b.stages.length).toBe(1);
  });

  test("collection options pass through", () => {
    const { text } = collection<Order>("orders", { idColumn: "uuid", dataColumn: "payload" })
      .limit(1)
      .compile();
    expect(text).toContain('"uuid"');
    expect(text).toContain('"payload"');
  });
});
