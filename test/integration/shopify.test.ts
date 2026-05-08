import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { ghost } from "../../src/index.ts";
import { connect, reset, seedShopify, executor, type Sql } from "./setup.ts";
import { listOrdersPipeline } from "../../examples/shopify.ts";

let client: Sql;

const skip = process.env.GHOSTPRES_SKIP_PG === "1";
const describeIf = skip ? describe.skip : describe;

describeIf("integration: shopify magnum-opus pipeline", () => {
  beforeAll(async () => {
    client = connect();
    await reset(client);
    await seedShopify(client);
    await client`
      create table pact_requests (id bigserial primary key, data jsonb not null)
    `;
    await client`
      create table pact_claims (id bigserial primary key, data jsonb not null)
    `;
  });

  afterAll(async () => {
    if (client) await client.end({ timeout: 1 });
  });

  test("renders without filter or search", async () => {
    const g = ghost(executor(client));
    const rows = await g.collection("shopify_orders").run<{
      local_id: string;
      order_number: string;
      customer: string;
      order_value: string;
      protection_cost: number;
      tracking: string;
      ship_dates: string;
    }>(
      listOrdersPipeline({
        merchantId: "m1",
        since: "2025-01-01T00:00:00Z",
      }),
    );

    expect(rows.length).toBe(2);
    expect(rows[0]!.local_id).toBe("1002");
    expect(rows[1]!.local_id).toBe("1001");
    expect(rows[1]!.customer).toBe("Ada Lovelace");
    expect(Number(rows[1]!.protection_cost)).toBe(10);
    expect(rows[1]!.tracking).toContain("T1");
    expect(rows[1]!.tracking).toContain("T2");
    expect(rows[1]!.tracking).not.toContain("T4");
    expect(rows[1]!.tracking).toContain("<span>");
  });

  test("search narrows results", async () => {
    const g = ghost(executor(client));
    const rows = await g.collection("shopify_orders").run(
      listOrdersPipeline({
        merchantId: "m1",
        since: "2025-01-01T00:00:00Z",
        search: "ada",
      }),
    );
    expect(rows.length).toBe(1);
    expect((rows[0] as { customer: string }).customer).toBe("Ada Lovelace");
  });

  test("pagination", async () => {
    const g = ghost(executor(client));
    const page0 = await g.collection("shopify_orders").run(
      listOrdersPipeline({
        merchantId: "m1",
        since: "2025-01-01T00:00:00Z",
        page: 0,
        pageSize: 1,
      }),
    );
    const page1 = await g.collection("shopify_orders").run(
      listOrdersPipeline({
        merchantId: "m1",
        since: "2025-01-01T00:00:00Z",
        page: 1,
        pageSize: 1,
      }),
    );
    expect(page0.length).toBe(1);
    expect(page1.length).toBe(1);
    expect((page0[0] as { local_id: string }).local_id).not.toBe(
      (page1[0] as { local_id: string }).local_id,
    );
  });

  test("filter by request", async () => {
    await client`
      insert into pact_requests (data) values
        (${client.json({ _id: 100, status_code: 1, order_id: "1001" })})
    `;
    await client`
      update shopify_orders
      set data = jsonb_set(data, '{request_ids}', '[100]'::jsonb)
      where (data->>'order_id') = '1001'
    `;

    const g = ghost(executor(client));
    const rows = await g.collection("shopify_orders").run(
      listOrdersPipeline({
        merchantId: "m1",
        since: "2025-01-01T00:00:00Z",
        filter: "request",
      }),
    );
    expect(rows.length).toBe(1);
    expect((rows[0] as { local_id: string }).local_id).toBe("1001");
  });
});
