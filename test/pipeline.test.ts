import { describe, expect, test } from "bun:test";
import {
  aggregate,
  $match,
  $project,
  $addFields,
  $sort,
  $limit,
  $skip,
  $lookup,
  $unwind,
  $group,
  $count,
  $replaceRoot,
} from "../src/index.ts";

const opts = { collection: "orders" };

describe("$match", () => {
  test("equality on string", () => {
    const { text, values } = aggregate([$match({ status: "paid" })], opts);
    expect(text).toContain('"orders"');
    expect(text).toMatch(/where.*=/);
    expect(values).toContain("paid");
  });

  test("comparison operator coerces numerics", () => {
    const { text, values } = aggregate([$match({ total: { $gt: 100 } })], opts);
    expect(text).toContain("::numeric");
    expect(values).toContain(100);
  });

  test("$and / $or composition", () => {
    const { text } = aggregate([
      $match({ $or: [{ status: "paid" }, { status: "fulfilled" }] }),
    ], opts);
    expect(text).toMatch(/or/);
  });

  test("$expr passes through to expression compiler", () => {
    const { text } = aggregate([
      $match({ $expr: { $eq: ["$shipping_cost", "$tax"] } }),
    ], opts);
    expect(text).toContain("=");
  });

  test("$in builds list", () => {
    const { text, values } = aggregate([$match({ id: { $in: [1, 2, 3] } })], opts);
    expect(text).toContain("in (");
    for (const n of [1, 2, 3]) expect(values).toContain(n);
  });

  test("nested path", () => {
    const { text } = aggregate([$match({ "customer.email": "x@y.com" })], opts);
    expect(text).toMatch(/#>/);
  });
});

describe("$project", () => {
  test("includes inclusion fields", () => {
    const { text, values } = aggregate([$project({ name: 1, email: 1 })], opts);
    expect(text).toContain("jsonb_build_object");
    expect(values).toContain("name");
    expect(values).toContain("email");
  });

  test("computes expression fields", () => {
    const { text } = aggregate([
      $project({ full_name: { $concat: ["$first", " ", "$last"] } }),
    ], opts);
    expect(text).toContain("concat(");
  });
});

describe("$addFields", () => {
  test("merges with existing doc", () => {
    const { text } = aggregate([$addFields({ tag: "new" })], opts);
    expect(text).toContain("||");
  });
});

describe("$sort / $limit / $skip", () => {
  test("sort emits order by with direction", () => {
    const { text } = aggregate([$sort({ created_at: -1 })], opts);
    expect(text).toContain("order by");
    expect(text).toContain("desc");
  });

  test("limit", () => {
    const { text, values } = aggregate([$limit(10)], opts);
    expect(text).toContain("limit");
    expect(values).toContain(10);
  });

  test("skip", () => {
    const { text, values } = aggregate([$skip(5)], opts);
    expect(text).toContain("offset");
    expect(values).toContain(5);
  });
});

describe("$lookup", () => {
  test("emits lateral join", () => {
    const { text } = aggregate([
      $lookup({
        from: "order_packages",
        localField: "order_package_ids",
        foreignField: "_id",
        as: "packages",
      }),
    ], opts);
    expect(text).toContain("left join lateral (");
    expect(text).toContain(") __lk on true");
    expect(text).toContain("jsonb_agg");
    expect(text).toContain('"order_packages"');
    expect(text).not.toContain('"lk0"');
  });

  test("sub-pipeline compiles to a nested WITH chain inside the lateral", () => {
    const { text } = aggregate([
      $lookup({
        from: "order_packages",
        let: { oid: "$_id" },
        pipeline: [
          $match({ $expr: { $eq: ["$order_id", "$$oid"] } }),
          $sort({ shipped_at: -1 }),
          $limit(2),
        ],
        as: "packages",
      }),
    ], opts);
    expect(text).toContain("left join lateral (");
    expect(text).toContain(") __sub");
    expect(text).toContain('"lk0" as (');
    expect(text).toContain('"lk1" as (');
    expect(text).toContain('"lk2" as (');
    expect(text).toContain('"lk3" as (');
    expect(text).toContain('select doc from "lk3"');
    expect(text).toContain('"s0".doc #>');
  });

  test("localField is ANDed onto the sub-pipeline's final select", () => {
    const { text } = aggregate([
      $lookup({
        from: "order_packages",
        localField: "order_package_ids",
        foreignField: "_id",
        pipeline: [$sort({ shipped_at: -1 })],
        as: "packages",
      }),
    ], opts);
    expect(text).toContain('"lk1" as (');
    expect(text).toContain('select doc from "lk1" where');
  });
});

describe("$unwind", () => {
  test("explodes array", () => {
    const { text } = aggregate([$unwind("$items")], opts);
    expect(text).toContain("jsonb_array_elements");
  });

  test("preserveNullAndEmptyArrays uses left join", () => {
    const { text } = aggregate([
      $unwind("$items", { preserveNullAndEmptyArrays: true }),
    ], opts);
    expect(text).toContain("left join lateral");
  });
});

describe("$group", () => {
  test("simple sum", () => {
    const { text } = aggregate([
      $group("$customer_id", { total: { $sum: "$amount" } }),
    ], opts);
    expect(text).toContain("group by");
    expect(text).toContain("sum(");
  });

  test("count uses count(*)", () => {
    const { text } = aggregate([$group("$status", { n: { $sum: 1 } })], opts);
    expect(text).toContain("count(*)");
  });

  test("$push uses jsonb_agg", () => {
    const { text } = aggregate([
      $group("$customer_id", { orders: { $push: "$$ROOT" } }),
    ], opts);
    expect(text).toContain("jsonb_agg(");
  });

  test("$addToSet uses distinct", () => {
    const { text } = aggregate([
      $group("$customer_id", { skus: { $addToSet: "$sku" } }),
    ], opts);
    expect(text).toContain("distinct");
  });
});

describe("$count / $replaceRoot", () => {
  test("$count emits count(*)", () => {
    const { text } = aggregate([$count("total")], opts);
    expect(text).toContain("count(*)");
  });

  test("$replaceRoot swaps doc", () => {
    const { text } = aggregate([$replaceRoot("$customer")], opts);
    expect(text).toContain("doc");
  });
});

describe("end-to-end pipeline", () => {
  test("multi-stage compiles without error and chains CTEs", () => {
    const { text } = aggregate([
      $match({ merchant_id: "m1" }),
      $lookup({
        from: "order_packages",
        localField: "order_package_ids",
        foreignField: "_id",
        as: "packages",
      }),
      $match({ "packages.0": { $exists: true } }),
      $addFields({
        protection_cost: { $sum: { $map: { input: "$packages", in: "$$this.pact_insured_cost" } } },
      }),
      $sort({ order_id: -1 }),
      $project({
        order_number: 1,
        protection_cost: 1,
      }),
      $limit(10),
    ], opts);

    expect(text).toContain('"s0"');
    expect(text).toContain('"s7"');
    expect(text).toMatch(/with .* as \(/);
  });

  test("conditional stage splicing", () => {
    const filter: "request" | "claim" | null = "request";
    const requestLookup = filter === "request"
      ? [
          $lookup({
            from: "pact_requests",
            localField: "request_ids",
            foreignField: "_id",
            as: "request",
          }),
          $match({ "request.0.status_code": { $lt: 3 } }),
        ]
      : [];

    const { text } = aggregate([
      $match({ merchant_id: "m1" }),
      ...requestLookup,
      $limit(5),
    ], opts);

    expect(text).toContain('"pact_requests"');
  });
});
