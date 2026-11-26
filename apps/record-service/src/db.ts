import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Pool } from "pg";
import { connectDatabase, transaction } from "../../../src/db.ts";

const schema = "record_data";
const migration = new URL("../db/migrations/001_records.sql", import.meta.url);
export const connectRecordDatabase = (url: string) => connectDatabase(url, schema);

async function migrationBytes(database: Pool) {
  const { rows } = await database.query("SHOW server_version_num");
  if (Math.floor(Number(rows[0]?.server_version_num) / 10_000) !== 17) throw new Error("RecordService requires PostgreSQL 17");
  const sql = await readFile(migration, "utf8");
  return { sql, checksum: createHash("sha256").update(sql).digest("hex") };
}

export async function migrateRecordDatabase(database: Pool) {
  const { sql, checksum } = await migrationBytes(database);
  await transaction(database, async client => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('record-service-migration', 0))");
    await client.query("CREATE SCHEMA IF NOT EXISTS record_data");
    await client.query("CREATE TABLE IF NOT EXISTS schema_migrations (version int PRIMARY KEY, checksum text NOT NULL)");
    const { rows } = await client.query("SELECT version, checksum FROM schema_migrations");
    if (rows.length) {
      if (rows.length !== 1 || rows[0].version !== 1 || rows[0].checksum !== checksum) throw new Error("Unexpected RecordService migration");
      return;
    }
    await client.query(sql);
    await client.query("INSERT INTO schema_migrations VALUES (1,$1)", [checksum]);
  });
}

export async function verifyRecordDatabase(database: Pool) {
  const { checksum } = await migrationBytes(database);
  const { rows } = await database.query("SELECT version, checksum FROM schema_migrations");
  if (rows.length !== 1 || rows[0].version !== 1 || rows[0].checksum !== checksum) throw new Error("Apply the RecordService migration first");
}

if (import.meta.main) {
  let database: Pool | undefined;
  try {
    database = connectRecordDatabase(process.env.RECORD_DATABASE_URL ?? "");
    await migrateRecordDatabase(database);
    process.stdout.write("RecordService migration 001 verified\n");
  } catch {
    process.stderr.write("RecordService migration failed. Verify the PostgreSQL 17 database and migration role.\n");
    process.exitCode = 1;
  } finally { await database?.end(); }
}
