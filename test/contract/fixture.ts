import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { TestContext } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { connectDatabase, migrateDatabase } from "../../src/db.ts";

// Structural boundary of the sibling fixture. Its implementation is loaded from the Mono checkout at runtime.
type RecordEvent = { streamId: string; sequence: number; eventId: string; payloadHash: string; payload: {
  sourceId: string; sourceGroupId: string;
  externalRecordRef: { systemId: string; recordId: string; externalVersion: string };
  record: { value: string; occurredAt: string; timeZone: string };
} };
type Drink = { clientOperationId: string; occurredAt: string; timeZone: string; value: string; unit: "ml"; beverageKind: "water" };
type ProductFixture = {
  commit(owner: typeof productOwner, input: Drink): unknown;
  lookupReceipt(owner: typeof productOwner, clientOperationId: string): unknown;
  listOutbox(): Array<{ event: RecordEvent }>;
  counts(): { records: number };
  close(): void;
};

export const adapter = "fixture-adapter";
export const secondAdapter = "fixture-second-adapter";
export const importer = "fixture-importer";
export const reader = "fixture-reader";
export const otherReader = "fixture-other-reader";
export const narrow = "fixture-narrow";
export const model = "fixture-model";
export const revoked = "fixture-revoked";
export const streamId = "fixture-records";
export const productOwner = { tenantId: "fixture-tenant", ownerId: "fixture-owner" };
export const self = "fixture-self";
export const timezone = "America/Los_Angeles";
export const instant = "2026-11-24T14:30:00-08:00";
export const digest = (text: string) => createHash("sha256").update(text).digest("hex");

export function source(id = "input-1", group = "group-1", amount = "300") {
  return {
    source_id: id, source_group_id: group, about_entity_id: self, source_kind: "user_input",
    mode: "sync", expected_source_version: 0, caller_revision_key: "user-revision-1",
    authority_kind: "user_reported", lifecycle: "active", domains: ["hydration"],
    timezone, recorded_at: instant,
    content: { structured: { schema_id: "hydration.beverage", schema_version: 1,
      data: { value: amount, unit: "ml", beverage_kind: "water" } } },
  };
}

async function seed(database: ReturnType<typeof connectDatabase>) {
  const credentials = [
    { token: adapter, caller: "trusted_adapter", actions: ["source.write", "operation.read", "evidence.read"] },
    { token: secondAdapter, caller: "trusted_adapter", actions: ["source.write", "operation.read", "evidence.read"] },
    { token: importer, caller: "trusted_importer", actions: ["source.write", "operation.read"], importStream: true },
    { token: reader, caller: "trusted_adapter", actions: ["operation.read", "evidence.read", "service.discover"], importStream: true },
    { token: otherReader, caller: "trusted_adapter", actions: ["operation.read", "evidence.read"], other: true },
    { token: narrow, caller: "trusted_adapter", actions: ["operation.read", "evidence.read"], domain: "food" },
    { token: model, caller: "model_tool", actions: ["source.write"] },
    { token: revoked, caller: "trusted_adapter", actions: ["source.write"], revoked: true },
  ];
  for (const grant of credentials) {
    await database.query(`INSERT INTO grants (token_hash, tenant_id, owner_id, grant_id, agent_id, caller_type,
      policy_epoch, revoked, actions, entities, domains, streams) VALUES ($1,$2,$3,$4,$5,$6,2,$7,$8,$9,$10,$11)`,
    [digest(grant.token), productOwner.tenantId, grant.other ? "another-owner" : productOwner.ownerId, grant.token,
      "fixture-agent", grant.caller, grant.revoked ?? false, grant.actions, [self],
      [grant.domain ?? "hydration"], grant.importStream ? [streamId] : []]);
  }
  await database.query(`INSERT INTO external_streams
    (tenant_id, owner_id, stream_id, system_id, applied_through_seq, highest_received_seq)
    VALUES ($1,$2,$3,'record-service-fixture',10,10)`, [productOwner.tenantId, productOwner.ownerId, streamId]);
}

export function translate(event: RecordEvent, refs?: Array<{ source_id: string; source_version: number }>) {
  assert.equal(digest(JSON.stringify(event.payload)), event.payloadHash, "original Outbox bytes changed");
  const body = {
    ...source(event.payload.sourceId, event.payload.sourceGroupId, event.payload.record.value),
    source_kind: "external_record", mode: "ordered_import", authority_kind: "external_committed",
    timezone: event.payload.record.timeZone,
    upstream_change: { stream_id: event.streamId, stream_seq: event.sequence, event_id: event.eventId },
    external_record_ref: { system_id: event.payload.externalRecordRef.systemId,
      record_id: event.payload.externalRecordRef.recordId, external_version: event.payload.externalRecordRef.externalVersion },
    occurred: { occurred_from: event.payload.record.occurredAt, time_precision: "minute",
      timezone: event.payload.record.timeZone, basis: "external_record" },
    ...(refs ? { input_evidence_refs: refs } : {}),
  };
  const { caller_revision_key: _, expected_source_version: __, recorded_at: _upstreamRecordedAt, ...request } = body;
  return request;
}

export async function environment(t: TestContext) {
  const url = process.env.MEMORY_TEST_DATABASE_URL;
  assert.ok(url, "Set MEMORY_TEST_DATABASE_URL to an isolated PostgreSQL 17 database");
  const schema = "d1_" + randomUUID().replace(/-/g, "");
  const path = mkdtempSync(join(tmpdir(), "memory-d1-"));
  const database = connectDatabase(url, schema);
  const servers: Array<{ stop(): Promise<void> }> = [];
  let records: ProductFixture | undefined;
  t.after(async () => {
    try {
      for (const server of servers.reverse()) await server.stop();
      records?.close();
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    } finally {
      await database.end();
      rmSync(path, { recursive: true, force: true });
    }
  });
  const version = (await database.query("SHOW server_version_num")).rows[0].server_version_num;
  assert.equal(Math.floor(Number(version) / 10_000), 17);
  await migrateDatabase(database, schema);
  await seed(database);

  async function product() {
    if (!records) {
      const implementation = process.env.MEMORY_RECORD_FIXTURE
        ? pathToFileURL(resolve(process.env.MEMORY_RECORD_FIXTURE))
        : new URL("../../../agent-service/examples/record-assistant/fixtures/record-fixtures.ts", import.meta.url);
      const module = await import(implementation.href) as {
        FakeRecordService: new (path: string, stream: { streamId: string; initialSequence: number }) => ProductFixture;
      };
      records = new module.FakeRecordService(join(path, "records.sqlite"), { streamId, initialSequence: 10 });
    }
    const receipts = ["record-11", "record-12"].map((clientOperationId) => records!.commit(productOwner, {
      clientOperationId, occurredAt: instant, timeZone: timezone, value: "300", unit: "ml", beverageKind: "water",
    }));
    return { receipts, events: records.listOutbox().map(({ event }) => event), records };
  }

  async function start(options: { fault?: string; interval?: number } = {}) {
    const child = spawn(process.execPath, [fileURLToPath(new URL("./server-child.ts", import.meta.url))], {
      env: { ...process.env, MEMORY_DATABASE_URL: url, MEMORY_DB_SCHEMA: schema,
        MEMORY_FIXTURE_FAULT: options.fault ?? "", MEMORY_FIXTURE_INTERVAL: String(options.interval ?? 15) },
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    });
    let stderr = "";
    child.stderr!.setEncoding("utf8").on("data", (value) => { stderr += value; });
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (done) => child.once("close", (code, signal) => done({ code, signal })),
    );
    const ready = new Promise<string>((done, reject) => {
      child.once("message", (message) => done(String(message)));
      child.once("error", reject);
      child.once("close", () => reject(new Error("Memory exited before startup: " + stderr)));
    });
    const stop = async () => {
      if (child.connected) child.send("stop");
      const timer = setTimeout(() => child.kill("SIGKILL"), 3_000);
      try { await exited; } finally { clearTimeout(timer); }
    };
    servers.push({ stop });
    const origin = await ready;
    async function request(route: string, options: { token?: string | null; key?: string; body?: unknown; epoch?: string; raw?: string } = {}) {
      const headers: Record<string, string> = {};
      const token = options.token === undefined ? reader : options.token;
      if (token) headers.authorization = "Bearer " + token;
      if (options.key) headers["Idempotency-Key"] = options.key;
      if (options.epoch !== undefined) headers["X-Expected-Policy-Epoch"] = options.epoch;
      const body = options.raw ?? (options.body === undefined ? undefined : JSON.stringify(options.body));
      if (body !== undefined) headers["content-type"] = "application/json";
      const response = await fetch(origin + route, {
        method: body === undefined ? "GET" : "POST", headers, body, signal: AbortSignal.timeout(3_000),
      });
      const result = await response.json() as Record<string, any>;
      assert.equal(result.api_version, "v1");
      assert.ok(result.request_id);
      return { status: response.status, body: result };
    }
    const put = (body: unknown, key: string, token = adapter) => request("/v1/sources:upsert", { token, key, body });
    const get = (operation: string, token = reader) => request("/v1/operations/" + operation, { token });
    const evidence = (refs: Array<{kind: "source"; id: string; version?: number}>, options: object = {}, token = reader) =>
      request("/v1/evidence:batchGet", { token, body: { refs, projection: "structured", ...options } });
    return { origin, request, put, get, evidence, exited, stop };
  }

  async function count(table: "operations" | "source_revisions" | "inbox") {
    return Number((await database.query(`SELECT count(*) AS count FROM "${table}"`)).rows[0].count);
  }
  async function water() {
    const { applied_through_seq, health } = (await database.query("SELECT applied_through_seq,health FROM external_streams")).rows[0];
    return { seq: Number(applied_through_seq), health };
  }
  return { start, product, database, count, water };
}

export async function until<T>(read: () => Promise<T>, predicate: (value: T) => boolean) {
  const deadline = Date.now() + 3_000;
  do {
    const value = await read();
    if (predicate(value)) return value;
    await delay(20);
  } while (Date.now() < deadline);
  assert.fail("Expected state did not settle");
}
