import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import type { Pool, PoolClient } from "pg";

export function connectDatabase(connectionString: string, schema: string): Pool {
  if (typeof connectionString !== "string" || !connectionString || !/^[a-z][a-z0-9_]{0,62}$/.test(schema)) {
    throw new Error("Set a PostgreSQL connection URL and an explicit lowercase database schema");
  }
  return new pg.Pool({ connectionString, options: `-c search_path=${schema},pg_catalog`, connectionTimeoutMillis: 2_000 });
}

export async function transaction<T>(database: Pool, use: (client: PoolClient) => Promise<T>, readOnly = false): Promise<T> {
  const client = await database.connect();
  try {
    await client.query(readOnly ? "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY" : "BEGIN");
    try {
      const result = await use(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    }
  } finally {
    client.release();
  }
}

const migration = new URL("../db/migrations/001_sources.sql", import.meta.url);
const migrationVersion = 1;

async function verifyMajor(database: Pool) {
  const version = await database.query<{ server_version_num: string }>("SHOW server_version_num");
  if (Math.floor(Number(version.rows[0]?.server_version_num) / 10_000) !== 17) {
    throw new Error("This Memory D1 slice requires PostgreSQL 17");
  }
}

export async function migrateDatabase(database: Pool, schema: string): Promise<void> {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) throw new Error("Invalid schema");
  await verifyMajor(database);
  const sql = await readFile(migration, "utf8");
  const checksum = createHash("sha256").update(sql).digest("hex");
  await transaction(database, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`memory-migration:${schema}`]);
    await client.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
    await client.query(`SET LOCAL search_path TO "${schema}", pg_catalog`);
    await client.query("CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, checksum text NOT NULL)");
    const row = (await client.query<{ version: number; checksum: string }>(
      "SELECT version, checksum FROM schema_migrations ORDER BY version DESC LIMIT 1",
    )).rows[0];
    if (row) {
      if (row.version !== migrationVersion || row.checksum !== checksum) throw new Error("Unexpected Memory migration version or checksum");
      return;
    }
    await client.query(sql);
    await client.query("INSERT INTO schema_migrations VALUES ($1,$2)", [migrationVersion, checksum]);
  });
}

export async function verifySchema(database: Pool): Promise<void> {
  await verifyMajor(database);
  const sql = await readFile(migration, "utf8");
  const checksum = createHash("sha256").update(sql).digest("hex");
  const row = (await database.query<{ version: number; checksum: string }>(
    "SELECT version, checksum FROM schema_migrations ORDER BY version DESC LIMIT 1",
  )).rows[0];
  if (row?.version !== migrationVersion || row.checksum !== checksum) throw new Error("Apply the Memory schema migration first");
}

if (import.meta.main) {
  const schema = process.env.MEMORY_DB_SCHEMA ?? "";
  const database = connectDatabase(process.env.MEMORY_DATABASE_URL ?? "", schema);
  try {
    await migrateDatabase(database, schema);
    process.stdout.write("Memory migration 001 verified\n");
  } finally {
    await database.end();
  }
}
