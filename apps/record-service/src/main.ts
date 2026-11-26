import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Pool } from "pg";
import { transaction } from "../../../src/db.ts";
import { createVerifier, currentScope } from "./auth.ts";
import { connectRecordDatabase, verifyRecordDatabase } from "./db.ts";
import { invalid, notFound, parseKey, parseOperation, readJson, RecordError } from "./protocol.ts";
import { readOperation, readRecord, submit } from "./records.ts";

const overrideHeaders = ["x-user-id", "x-owner-id", "x-tenant-id", "x-subject-id", "x-about-entity-id", "x-grant-id", "x-authority-kind"];
const operationsPath = "/v1/record-operations";

function json(response: ServerResponse, status: number, body: object) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
}

async function handle(database: Pool, verify: ReturnType<typeof createVerifier>, request: IncomingMessage, response: ServerResponse) {
  const requestId = randomUUID();
  try {
    const identity = await verify(request.headersDistinct.authorization?.length === 1 ? request.headers.authorization : undefined);
    if (overrideHeaders.some(name => Object.hasOwn(request.headers, name))) throw invalid();
    const url = new URL(request.url ?? "/", "http://localhost");
    if (request.method === "POST" && url.pathname === operationsPath && !url.search) {
      if (request.headersDistinct["idempotency-key"]?.length !== 1) throw invalid();
      const key = parseKey(request.headers["idempotency-key"]);
      const input = parseOperation(await readJson(request));
      const result = await transaction(database, async client => submit(client, await currentScope(client, identity), key, input));
      json(response, result.status, result.body);
      return;
    }
    if (request.method !== "GET") throw notFound();
    if (request.headers["transfer-encoding"] || (request.headers["content-length"] && request.headers["content-length"] !== "0")) throw invalid();
    const path = /^\/v1\/(record-operations|records)\/([^/]+)$/.exec(url.pathname);
    const selectors = [...url.searchParams];
    if (url.pathname === operationsPath && selectors.length === 1 && selectors[0]?.[0] === "client_operation_id") {
      const key = parseKey(selectors[0][1]);
      const body = await transaction(database, async client => readOperation(client, await currentScope(client, identity),
        "client_operation_id", key), true);
      json(response, 200, body);
      return;
    }
    if (!path || url.search) throw notFound();
    const id = parseKey(path[2]);
    const body = await transaction(database, async client => {
      const scope = await currentScope(client, identity);
      return path[1] === "records" ? readRecord(client, scope, id) : readOperation(client, scope, "operation_id", id);
    }, true);
    json(response, 200, body);
  } catch (error) {
    request.resume();
    const safe = error instanceof RecordError ? error : new RecordError(503, "SERVICE_UNAVAILABLE", "Record service is unavailable.");
    if (response.destroyed) return;
    if (safe.status === 401) response.setHeader("www-authenticate", "Bearer");
    json(response, safe.status, { request_id: requestId, error: { code: safe.code, message: safe.message } });
  }
}

if (import.meta.main) {
  let database: Pool | undefined;
  try {
    database = connectRecordDatabase(process.env.RECORD_DATABASE_URL ?? "");
    const port = Number(process.env.RECORD_PORT ?? 8084);
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("Invalid RecordService port");
    const verify = createVerifier(JSON.parse(process.env.RECORD_AUTH_CONFIG ?? ""));
    await verifyRecordDatabase(database);
    const pool = database;
    const server = createServer({ requestTimeout: 10_000, headersTimeout: 5_000 }, (request, response) => {
      void handle(pool, verify, request, response).catch(() => response.destroy());
    });
    const ready = once(server, "listening");
    server.listen(port, "127.0.0.1");
    await ready;
    process.stdout.write(`RecordService listening at http://127.0.0.1:${(server.address() as AddressInfo).port}\n`);
    let stopping = false;
    function stop() {
      if (stopping) return;
      stopping = true;
      server.close(() => { void pool.end().catch(() => { process.exitCode = 1; }); });
    }
    process.once("SIGTERM", stop);
    process.once("SIGINT", stop);
  } catch {
    await database?.end();
    process.stderr.write("RecordService startup failed. Verify the database, migration, and trusted identity configuration.\n");
    process.exitCode = 1;
  }
}
