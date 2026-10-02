import { mkdirSync } from "node:fs";
import { join } from "node:path";
export async function createStore(dir) {
  if (process.env.VERCEL || process.env.STORAGE_DRIVER === "blob") {
    if (!process.env.BLOB_READ_WRITE_TOKEN)
      throw new Error("Private Blob storage is not configured.");
    const { put, get, list, del } = await import("@vercel/blob");
    return {
      async put(type, item) {
        await put(`${type}/${item.id}.json`, JSON.stringify(item), {
          access: "private",
          addRandomSuffix: false,
          allowOverwrite: true,
          contentType: "application/json",
          cacheControlMaxAge: 0,
        });
        return item;
      },
      async get(id, type = "settings") {
        const r = await get(`${type}/${id}.json`, {
          access: "private",
          useCache: false,
        });
        return r?.statusCode === 200
          ? await new Response(r.stream).json()
          : null;
      },
      async list(type) {
        const result = await list({ prefix: `${type}/`, limit: 500 });
        const data = await Promise.all(
          result.blobs.map(async (b) => {
            const r = await get(b.pathname, {
              access: "private",
              useCache: false,
            });
            return r?.statusCode === 200
              ? await new Response(r.stream).json()
              : null;
          }),
        );
        return data
          .filter(Boolean)
          .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
      },
      async delete(id, type) {
        await del(`${type}/${id}.json`);
      },
      close() {},
    };
  }
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(join(dir, "workspace.sqlite"));
  db.exec(
    "PRAGMA journal_mode = WAL; CREATE TABLE IF NOT EXISTS items (id TEXT PRIMARY KEY, type TEXT NOT NULL, data TEXT NOT NULL);",
  );
  return {
    async put(type, item) {
      db.prepare("INSERT OR REPLACE INTO items VALUES (?,?,?)").run(
        item.id,
        type,
        JSON.stringify(item),
      );
      return item;
    },
    async get(id, type = "settings") {
      const row = db.prepare("SELECT data FROM items WHERE id=? AND type=?").get(id, type);
      return row ? JSON.parse(row.data) : null;
    },
    async list(type) {
      return db
        .prepare("SELECT data FROM items WHERE type=? ORDER BY rowid DESC")
        .all(type)
        .map((r) => JSON.parse(r.data));
    },
    async delete(id, type) {
      db.prepare("DELETE FROM items WHERE id=?").run(id);
    },
    close() {
      db.close();
    },
  };
}
