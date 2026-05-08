import { collection, type Pipeline, type Stage } from "../src/index.ts";
import {
  $lookup,
  $match,
  $addFields,
  type Expr,
} from "../src/types.ts";

export type Filter = "request" | "claim" | null;

export type ListArgs = {
  merchantId: string;
  since: string;
  filter?: Filter;
  search?: string;
  page?: number;
  pageSize?: number;
};

export type ShopifyOrder = {
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
  request_ids: number[];
  claim_ids: number[];
};

export type OrderPackage = {
  _id: number;
  tracking_url: string;
  tracking_number: string;
  shipment_date: string;
  fulfillment_id: string;
  pact_insured_cost: number;
};

export type OrderRow = {
  _id: string;
  local_id: string;
  order_number: string;
  customer: string;
  order_value: string;
  tracking: string;
  ship_dates: string;
  protection_cost: number;
};

const dedupByFulfillment: Expr = {
  $reduce: {
    input: "$packages",
    initialValue: [],
    in: {
      $cond: [
        {
          $in: [
            "$$this.fulfillment_id",
            { $map: { input: "$$value", as: "v", in: "$$v.fulfillment_id" } },
          ],
        },
        "$$value",
        { $concatArrays: ["$$value", ["$$this"]] },
      ],
    },
  },
};

const html = (input: string, field: string): Expr => ({
  $reduce: {
    input,
    initialValue: "",
    in: {
      $concat: ["$$value", "<span>", { $toString: `$$this.${field}` }, "</span> "],
    },
  },
});

export function listOrdersTyped(args: ListArgs): Pipeline<OrderRow> {
  const { merchantId, since, filter = null, search = null, page = 0, pageSize = 25 } = args;

  const filterStages: Stage[] = filter
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
  const searchStages: Stage[] = searchTerms.length
    ? [
        $match({
          $expr: {
            $and: searchTerms.map((term) => ({
              $or: [
                { $regexMatch: { input: { $toString: "$order_id" }, regex: term, options: "i" } },
                { $regexMatch: { input: { $toString: "$order_name" }, regex: term, options: "i" } },
                { $regexMatch: { input: { $toString: "$first_name" }, regex: term, options: "i" } },
                { $regexMatch: { input: { $toString: "$last_name" }, regex: term, options: "i" } },
                { $regexMatch: { input: { $toString: "$email" }, regex: term, options: "i" } },
                { $regexMatch: { input: { $toString: "$order_total" }, regex: term, options: "i" } },
              ],
            })),
          },
        }),
      ]
    : [];

  const recentForMerchant = collection<ShopifyOrder>("shopify_orders").match({
    merchant_id: merchantId,
    $expr: { $gte: [{ $toDate: "$created_at" }, { $toDate: since }] },
  });

  return recentForMerchant
    .extend(filterStages)
    .cast<ShopifyOrder>()
    .lookup<OrderPackage, "packages">({
      from: "order_packages",
      localField: "order_package_ids",
      foreignField: "_id",
      as: "packages",
    })
    .match({ "packages.0": { $exists: true } })
    .addFields({ packages_unique: dedupByFulfillment })
    .addFields({
      protection_cost: {
        $sum: {
          $map: { input: "$packages_unique", in: "$$this.pact_insured_cost" },
        },
      },
      tracking: html("$packages_unique", "tracking_number"),
      ship_dates: html("$packages_unique", "shipment_date"),
    })
    .extend(searchStages)
    .sort({ order_id: -1 })
    .skip(page * pageSize)
    .limit(pageSize)
    .project({
      _id: "$_id",
      local_id: "$order_id",
      order_number: "$order_name",
      customer: {
        $concat: [{ $toString: "$first_name" }, " ", { $toString: "$last_name" }],
      },
      order_value: "$order_total",
      tracking: 1,
      ship_dates: 1,
      protection_cost: 1,
    })
    .cast<OrderRow>();
}

if (import.meta.main) {
  const q = listOrdersTyped({
    merchantId: "m1",
    since: "2025-01-01T00:00:00Z",
    filter: "request",
    search: "ada",
  });
  const { text, values } = q.compile();
  console.log(text);
  console.log("---");
  console.log(values);
}
