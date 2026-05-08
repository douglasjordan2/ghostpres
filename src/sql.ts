export type SqlNode =
  | { kind: "text"; text: string }
  | { kind: "param"; value: unknown }
  | { kind: "id"; name: string }
  | { kind: "concat"; parts: Sql[] };

export type Sql = SqlNode;

export type CompiledSql = { text: string; values: unknown[] };

export function sql(strings: TemplateStringsArray, ...values: unknown[]): Sql {
  const parts: Sql[] = [];
  for (let i = 0; i < strings.length; i++) {
    parts.push({ kind: "text", text: strings[i]! });
    if (i < values.length) {
      parts.push(toSql(values[i]));
    }
  }
  return { kind: "concat", parts };
}

sql.raw = (text: string): Sql => ({ kind: "text", text });
sql.id = (name: string): Sql => ({ kind: "id", name });
sql.param = (value: unknown): Sql => ({ kind: "param", value });
sql.empty = (): Sql => ({ kind: "text", text: "" });

sql.join = (items: Sql[], separator = ", "): Sql => {
  if (items.length === 0) return sql.empty();
  const parts: Sql[] = [];
  for (let i = 0; i < items.length; i++) {
    if (i > 0) parts.push({ kind: "text", text: separator });
    parts.push(items[i]!);
  }
  return { kind: "concat", parts };
};

sql.concat = (...items: Sql[]): Sql => ({ kind: "concat", parts: items });

export function isSql(value: unknown): value is Sql {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    typeof (value as { kind: unknown }).kind === "string"
  );
}

function toSql(value: unknown): Sql {
  if (isSql(value)) return value;
  return { kind: "param", value };
}

function quoteIdent(name: string): string {
  return '"' + name.replace(/"/g, '""') + '"';
}

export function compile(node: Sql): CompiledSql {
  const out: string[] = [];
  const values: unknown[] = [];
  walk(node, out, values);
  return { text: out.join(""), values };
}

function walk(node: Sql, out: string[], values: unknown[]): void {
  switch (node.kind) {
    case "text":
      out.push(node.text);
      return;
    case "id":
      out.push(quoteIdent(node.name));
      return;
    case "param":
      values.push(node.value);
      out.push("$" + values.length);
      return;
    case "concat":
      for (const part of node.parts) walk(part, out, values);
      return;
  }
}
