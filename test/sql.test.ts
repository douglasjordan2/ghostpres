import { describe, expect, test } from "bun:test";
import { sql, compile } from "../src/sql.ts";

describe("sql template tag", () => {
  test("renders text", () => {
    expect(compile(sql`select 1`)).toEqual({ text: "select 1", values: [] });
  });

  test("parameterizes values", () => {
    expect(compile(sql`select ${42}`)).toEqual({ text: "select $1", values: [42] });
  });

  test("renders identifiers with quoting", () => {
    expect(compile(sql.id("users"))).toEqual({ text: '"users"', values: [] });
    expect(compile(sql.id('weird"name'))).toEqual({ text: '"weird""name"', values: [] });
  });

  test("composes nested fragments", () => {
    const where = sql`status = ${"active"}`;
    const q = sql`select * from t where ${where}`;
    expect(compile(q)).toEqual({
      text: "select * from t where status = $1",
      values: ["active"],
    });
  });

  test("joins fragments", () => {
    const items = [sql`${1}`, sql`${2}`, sql`${3}`];
    expect(compile(sql.join(items, ", "))).toEqual({
      text: "$1, $2, $3",
      values: [1, 2, 3],
    });
  });

  test("preserves param ordering across nested concats", () => {
    const a = sql`${"a"}`;
    const b = sql`${"b"}`;
    const both = sql`${a}/${b}/${"c"}`;
    expect(compile(both)).toEqual({ text: "$1/$2/$3", values: ["a", "b", "c"] });
  });
});
