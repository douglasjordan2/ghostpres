import postgres from "postgres";

const url = process.env.GHOSTPRES_TEST_DB ?? "postgres://postgres:ghost@localhost:54329/ghostpres_test";

export type Sql = ReturnType<typeof postgres>;

export function connect(): Sql {
  return postgres(url, { max: 4, idle_timeout: 1, connect_timeout: 5 });
}

export async function reset(sql: Sql): Promise<void> {
  await sql`drop schema public cascade`;
  await sql`create schema public`;
}

export async function seedShopify(sql: Sql): Promise<void> {
  await sql`
    create table shopify_orders (
      id bigserial primary key,
      data jsonb not null
    )
  `;
  await sql`
    create table order_packages (
      id bigserial primary key,
      data jsonb not null
    )
  `;

  await sql`
    insert into shopify_orders (data) values
      (${sql.json({
        order_id: "1001",
        order_name: "#1001",
        first_name: "Ada",
        last_name: "Lovelace",
        email: "ada@example.com",
        order_total: "120.00",
        merchant_id: "m1",
        created_at: "2025-04-01T00:00:00Z",
        order_package_ids: [1, 2],
        request_ids: [],
        claim_ids: [],
      })}),
      (${sql.json({
        order_id: "1002",
        order_name: "#1002",
        first_name: "Grace",
        last_name: "Hopper",
        email: "grace@example.com",
        order_total: "250.00",
        merchant_id: "m1",
        created_at: "2025-04-02T00:00:00Z",
        order_package_ids: [3],
        request_ids: [],
        claim_ids: [],
      })}),
      (${sql.json({
        order_id: "2001",
        order_name: "#2001",
        first_name: "Other",
        last_name: "Merchant",
        email: "other@example.com",
        order_total: "50.00",
        merchant_id: "m2",
        created_at: "2025-04-03T00:00:00Z",
        order_package_ids: [],
        request_ids: [],
        claim_ids: [],
      })})
  `;

  await sql`
    insert into order_packages (data) values
      (${sql.json({
        _id: 1,
        tracking_url: "https://t/1",
        tracking_number: "T1",
        shipment_date: "2025-04-02",
        fulfillment_id: "f1",
        pact_insured_cost: 5.0,
      })}),
      (${sql.json({
        _id: 2,
        tracking_url: "https://t/2",
        tracking_number: "T2",
        shipment_date: "2025-04-03",
        fulfillment_id: "f1",
        pact_insured_cost: 5.0,
      })}),
      (${sql.json({
        _id: 3,
        tracking_url: "https://t/3",
        tracking_number: "T3",
        shipment_date: "2025-04-04",
        fulfillment_id: "f2",
        pact_insured_cost: 7.5,
      })})
  `;
}

export function executor(client: Sql) {
  return {
    unsafe: async (text: string, values: unknown[]) => {
      return (await client.unsafe(text, values as never[])) as unknown as unknown[];
    },
  };
}
