// Execute the real SQL against SQLite, rather than reproducing policy in mocks.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";

export function createTestD1(t) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  sqlite.exec(readFileSync(new URL("../../schema/0000_base.sql", import.meta.url), "utf8"));
  const migrations = new URL("../../../modules/cfmail-worker/migrations/", import.meta.url);
  for (const file of readdirSync(migrations).filter((f) => f.endsWith(".sql")).sort()) {
    sqlite.exec(readFileSync(new URL(file, migrations), "utf8"));
  }
  return {
    sqlite,
    prepare(sql) {
      let args = [];
      return {
        bind(...values) { args = values; return this; },
        async first() { return sqlite.prepare(sql).get(...args) ?? null; },
        async all() { return { results: sqlite.prepare(sql).all(...args) }; },
        async run() {
          const result = sqlite.prepare(sql).run(...args);
          return { success: true, meta: { changes: Number(result.changes) } };
        },
      };
    },
  };
}
