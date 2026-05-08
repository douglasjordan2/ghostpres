import postgres from "postgres";
import { listOrdersPipeline } from "./shopify.ts";
import { listOrdersTyped } from "./shopify-typed.ts";
import { aggregate } from "../src/index.ts";
import { reset, seedShopify, executor } from "../test/integration/setup.ts";

const url =
  process.env.GHOSTPRES_TEST_DB ??
  "postgres://postgres:ghost@localhost:54329/ghostpres_test";

const sql = postgres(url, { max: 4, idle_timeout: 1, connect_timeout: 5 });

async function main(): Promise<void> {
  console.log("\n=== seeding ===");
  await reset(sql);
  await seedShopify(sql);
  await sql`create table pact_requests (id bigserial primary key, data jsonb not null)`;
  await sql`create table pact_claims (id bigserial primary key, data jsonb not null)`;
  await sql`
    insert into pact_requests (data) values
      (${sql.json({ _id: 200, status_code: 1, order_id: "1001" })})
  `;
  await sql`
    update shopify_orders
    set data = jsonb_set(data, '{request_ids}', '[200]'::jsonb)
    where (data->>'order_id') = '1001'
  `;

  const args = {
    merchantId: "m1",
    since: "2025-01-01T00:00:00Z",
    filter: "request" as const,
    search: "ada",
    page: 0,
    pageSize: 25,
  };

  console.log("\n=== array form (composable, splicable) ===");
  const stages = listOrdersPipeline(args);
  console.log(`stages: ${stages.length}`);
  for (let i = 0; i < stages.length; i++) {
    const s = stages[i] as { $: string };
    console.log(`  ${String(i).padStart(2, "0")}  $${s.$}`);
  }

  const compiled = aggregate(stages, { collection: "shopify_orders" });
  console.log(`\nemitted SQL (${compiled.text.length} chars, ${compiled.values.length} params)`);
  console.log("first 600 chars:");
  console.log(compiled.text.slice(0, 600) + "...");

  console.log("\n=== typed builder ===");
  const typed = listOrdersTyped(args);
  console.log(`stages: ${typed.stages.length}`);
  console.log("inferred return type: Pipeline<OrderRow>");

  console.log("\n=== running typed pipeline against postgres ===");
  const exec = executor(sql);
  const rows = await typed.run(exec);

  console.log(`got ${rows.length} row(s)`);
  for (const r of rows) {
    console.log(`\n  order ${r.order_number} (id=${r.local_id})`);
    console.log(`    customer:        ${r.customer}`);
    console.log(`    order_value:     ${r.order_value}`);
    console.log(`    protection_cost: ${r.protection_cost}`);
    console.log(`    tracking:        ${r.tracking.trim()}`);
    console.log(`    ship_dates:      ${r.ship_dates.trim()}`);
  }

  console.log("\n=== dedup verification ===");
  console.log("order 1001 has package_ids [1,2,4] with fulfillment_ids [f1,f2,f1].");
  console.log("dedup-by-fulfillment_id keeps the first occurrence per fid.");
  console.log("expect: tracking includes T1+T2 but NOT T4, protection_cost = 5+5 = 10.");
  const ada = rows.find((r) => r.local_id === "1001");
  if (ada) {
    console.log(
      `  T1 in tracking: ${ada.tracking.includes("T1")}, T2: ${ada.tracking.includes(
        "T2",
      )}, T4: ${ada.tracking.includes("T4")}`,
    );
    console.log(`  protection_cost: ${ada.protection_cost}`);
  }

  await sql.end({ timeout: 1 });
}

main().catch((e) => {
  console.error(e);
  void sql.end({ timeout: 1 });
  process.exit(1);
});
