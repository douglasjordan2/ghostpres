import {
  ghost,
  $match,
  $lookup,
  $addFields,
  $project,
  $sort,
  $limit,
  $skip,
} from "../src/index.ts";

type Filter = "request" | "claim" | null;

type ListArgs = {
  merchantId: string;
  since: string;
  filter?: Filter;
  search?: string;
  page?: number;
  pageSize?: number;
};

export function listOrdersPipeline(args: ListArgs) {
  const { merchantId, since, filter = null, search = null, page = 0, pageSize = 25 } = args;

  const filterStage = filter
    ? [
        $lookup({
          from: filter === "request" ? "pact_requests" : "pact_claims",
          localField: filter === "request" ? "request_ids" : "claim_ids",
          foreignField: "_id",
          as: "_filter_join",
        }),
        $match({
          $expr: {
            $gt: [
              {
                $size: {
                  $filter: {
                    input: "$_filter_join",
                    as: "x",
                    cond: { $lt: [{ $toInt: "$$x.status_code" }, 3] },
                  },
                },
              },
              0,
            ],
          },
        }),
      ]
    : [];

  const searchTerms = (search ?? "").trim().split(/\s+/).filter(Boolean);
  const searchStage = searchTerms.length
    ? [
        $match({
          $expr: {
            $and: searchTerms.map((term) => ({
              $or: [
                { $regexMatch: { input: { $toString: "$order_id" }, regex: term } },
                { $regexMatch: { input: { $toString: "$order_name" }, regex: term } },
                { $regexMatch: { input: { $toString: "$first_name" }, regex: term } },
                { $regexMatch: { input: { $toString: "$last_name" }, regex: term } },
                { $regexMatch: { input: { $toString: "$email" }, regex: term } },
                { $regexMatch: { input: { $toString: "$order_total" }, regex: term } },
              ],
            })),
          },
        }),
      ]
    : [];

  return [
    $match({
      merchant_id: merchantId,
      $expr: { $gte: [{ $toDate: "$created_at" }, { $toDate: since }] },
    }),
    ...filterStage,
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
      tracking: {
        $reduce: {
          input: "$packages",
          initialValue: "",
          in: { $concat: ["$$value", " ", { $toString: "$$this.tracking_number" }] },
        },
      },
      ship_dates: {
        $reduce: {
          input: "$packages",
          initialValue: "",
          in: { $concat: ["$$value", " ", { $toString: "$$this.shipment_date" }] },
        },
      },
    }),
    ...searchStage,
    $sort({ order_id: -1 }),
    $skip(page * pageSize),
    $limit(pageSize),
    $project({
      _id: "$_id",
      local_id: "$order_id",
      order_number: "$order_name",
      customer: { $concat: [{ $toString: "$first_name" }, " ", { $toString: "$last_name" }] },
      order_value: "$order_total",
      tracking: 1,
      ship_dates: 1,
      protection_cost: 1,
    }),
  ];
}

if (import.meta.main) {
  const { aggregate } = await import("../src/index.ts");
  const pipeline = listOrdersPipeline({
    merchantId: "m1",
    since: "2025-01-01T00:00:00Z",
    filter: "request",
    search: "ada",
  });
  const { text, values } = aggregate(pipeline, { collection: "shopify_orders" });
  console.log(text);
  console.log("---");
  console.log(values);
  void ghost;
}
