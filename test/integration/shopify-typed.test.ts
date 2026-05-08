import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { connect, reset, seedShopify, executor, type Sql } from "./setup.ts";
import { listOrdersTyped } from "../../examples/shopify-typed.ts";

let client: Sql;

const skip = process.env.GHOSTPRES_SKIP_PG === "1";
const describeIf = skip ? describe.skip : describe;

describeIf("integration: typed magnum-opus pipeline", () => {
  beforeAll(async () => {
    client = connect();
    await reset(client);
    await seedShopify(client);
    await client`create table pact_requests (id bigserial primary key, data jsonb not null)`;
    await client`create table pact_claims (id bigserial primary key, data jsonb not null)`;
  });

  afterAll(async () => {
    if (client) await client.end({ timeout: 1 });
  });

  test("typed builder returns OrderRow[] with HTML wrapping and dedup", async () => {
    const exec = executor(client);
    const rows = await listOrdersTyped({
      merchantId: "m1",
      since: "2025-01-01T00:00:00Z",
    }).run(exec);

    expect(rows.length).toBe(2);
    expect(rows[0]!.local_id).toBe("1002");
    expect(rows[1]!.local_id).toBe("1001");

    expect(rows[1]!.customer).toBe("Ada Lovelace");
    expect(Number(rows[1]!.protection_cost)).toBe(10);

    expect(rows[1]!.tracking).toMatch(/<span>T1<\/span>/);
    expect(rows[1]!.tracking).toMatch(/<span>T2<\/span>/);
    expect(rows[1]!.tracking).not.toContain("T4");

    expect(rows[1]!.ship_dates).toMatch(/<span>2025-04-01<\/span>|<span>2025-04-02<\/span>/);
  });

  test("conditional request filter splices in", async () => {
    await client`
      insert into pact_requests (data) values
        (${client.json({ _id: 200, status_code: 1, order_id: "1001" })})
    `;
    await client`
      update shopify_orders
      set data = jsonb_set(data, '{request_ids}', '[200]'::jsonb)
      where (data->>'order_id') = '1001'
    `;

    const exec = executor(client);
    const rows = await listOrdersTyped({
      merchantId: "m1",
      since: "2025-01-01T00:00:00Z",
      filter: "request",
    }).run(exec);

    expect(rows.length).toBe(1);
    expect(rows[0]!.local_id).toBe("1001");
  });

  test("search across many fields", async () => {
    const exec = executor(client);
    const rows = await listOrdersTyped({
      merchantId: "m1",
      since: "2025-01-01T00:00:00Z",
      search: "lovelace",
    }).run(exec);

    expect(rows.length).toBe(1);
    expect(rows[0]!.customer).toBe("Ada Lovelace");
  });

  test("compile returns runnable SQL parameters", () => {
    const q = listOrdersTyped({
      merchantId: "m1",
      since: "2025-01-01T00:00:00Z",
      filter: "request",
      search: "ada",
    });
    const { text, values } = q.compile();
    expect(text).toContain("with");
    expect(text).toContain("jsonb_build_object");
    expect(text).toContain("with recursive __r");
    expect(values).toContain("m1");
  });
});
