import type { Pool } from "pg";
import { z } from "zod";
import { connectRecordDatabase, verifyRecordDatabase } from "./db.ts";
import { fingerprint, keySchema } from "./protocol.ts";

const config = z.array(z.object({
  tenant_id: keySchema, owner_id: keySchema, stream_id: keySchema,
  token: z.string().min(16).max(2048).regex(/^[^\s,]+$/),
}).strict()).min(1);
type Importer = z.infer<typeof config>[number];
type Event = { event_id: string; document: unknown; payload_hash: string; memory_operation_id: string | null };
const receipt = z.object({ operation_id: keySchema, status: z.enum(["accepted", "applied"]) });

function memoryOrigin(value: string) {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/"
    || (url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)))) {
    throw new Error("Expected a protected Memory service origin");
  }
  return url.origin;
}

async function deliver(database: Pool, origin: string, importer: Importer) {
  const event = (await database.query<Event>(`SELECT event_id,document,payload_hash,memory_operation_id
    FROM record_outbox WHERE tenant_id=$1 AND owner_id=$2 AND stream_id=$3 AND applied_at IS NULL
    ORDER BY stream_sequence LIMIT 1`, [importer.tenant_id, importer.owner_id, importer.stream_id])).rows[0];
  if (!event) return;
  if (fingerprint(event.document) !== event.payload_hash) throw new Error("Outbox payload integrity check failed");

  const headers = { authorization: "Bearer " + importer.token };
  const options = { redirect: "error" as const, signal: AbortSignal.timeout(2_000) };
  const response = event.memory_operation_id
    ? await fetch(origin + "/v1/operations/" + encodeURIComponent(event.memory_operation_id), { headers, ...options })
    : await fetch(origin + "/v1/sources:upsert", {
      method: "POST", headers: { ...headers, "content-type": "application/json", "idempotency-key": event.event_id },
      body: JSON.stringify(event.document), ...options,
    });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error("Memory did not accept or recognize the original event");
  }
  const result = receipt.parse(await response.json());
  if (event.memory_operation_id && result.operation_id !== event.memory_operation_id) throw new Error("Memory operation changed");
  const updated = await database.query(`UPDATE record_outbox SET memory_operation_id=$2,
    applied_at=CASE WHEN $3 THEN COALESCE(applied_at,clock_timestamp()) ELSE applied_at END
    WHERE event_id=$1 AND (memory_operation_id IS NULL OR memory_operation_id=$2)`,
  [event.event_id, result.operation_id, result.status === "applied"]);
  if (updated.rowCount !== 1) throw new Error("Outbox receipt binding changed");
}

if (import.meta.main) {
  let database: Pool | undefined;
  try {
    database = connectRecordDatabase(process.env.RECORD_DATABASE_URL ?? "");
    const pool = database;
    const origin = memoryOrigin(process.env.RECORD_MEMORY_URL ?? "");
    const importers = config.parse(JSON.parse(process.env.RECORD_IMPORTERS ?? ""));
    if (new Set(importers.map(item => item.stream_id)).size !== importers.length) throw new Error("Duplicate importer stream");
    await verifyRecordDatabase(pool);
    let inFlight: Promise<unknown> | undefined;
    const blocked = new Set<string>();
    const interval = setInterval(() => {
      if (inFlight) return;
      inFlight = Promise.all(importers.map(async importer => {
        try {
          await deliver(pool, origin, importer);
          blocked.delete(importer.stream_id);
        } catch {
          if (!blocked.has(importer.stream_id)) process.stderr.write("RecordService Outbox delivery is temporarily blocked\n");
          blocked.add(importer.stream_id);
        }
      })).finally(() => { inFlight = undefined; });
    }, 100);
    process.stdout.write("RecordService Outbox ready\n");
    let stopping = false;
    function stop() {
      if (stopping) return;
      stopping = true;
      clearInterval(interval);
      void Promise.resolve(inFlight).finally(() => pool.end()).catch(() => { process.exitCode = 1; });
    }
    process.once("SIGTERM", stop);
    process.once("SIGINT", stop);
  } catch {
    await database?.end();
    process.stderr.write("RecordService Outbox startup failed. Verify the database, Memory origin, and importer configuration.\n");
    process.exitCode = 1;
  }
}
