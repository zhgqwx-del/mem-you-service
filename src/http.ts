import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import type { Pool } from "pg";
import { authorize, credential } from "./auth.ts";
import { transaction } from "./db.ts";
import { readEvidence } from "./evidence.ts";
import { receiveExternal } from "./import.ts";
import { ApiError, id, idempotencyKey, invalid, missing, parseEvidence, parseSource, tooLarge, unsupported } from "./protocol.ts";
import { observeOperation, writeSync, type Fault } from "./sources.ts";

const disabledPosts = new Set([
  "/v1/context:prepare", "/v1/memories:remember", "/v1/forget", "/v1/bundles:validate",
  "/v1/search", "/v1/facts:query", "/v1/access:apply", "/v1/history:run", "/v1/consumers:register",
]);
const disabledOperation = /^\/v1\/(memories\/[^/]+:revise|history-runs\/[^/]+:cancel|consumers\/[^/]+:(ack|reset|heartbeat))$/;
const capabilities = {
  memory_api_versions: ["v1"],
  mcp: { transports: [], endpoint: null, protocol_revisions: [], stdio_bridge_supported: false },
  features: ["source_mirror", "evidence_batch_get"],
  history: { supported_modes: [], repair_kinds: [], automatic_discovery: false, context_repair: false,
    pre_registration_bootstrap: false, mutable_origins: false },
  limits: { source_content_bytes: 16384, batch_items: 32, batch_body_bytes: 262144 },
  tokenizers: [], consumer_profiles: [],
};

async function jsonBody(request: IncomingMessage, limit: number): Promise<unknown> {
  const chunks: Buffer[] = [];
  if (Number(request.headers["content-length"]) > limit) { request.resume(); throw tooLarge(); }
  let bytes = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > limit) { request.resume(); throw tooLarge(); }
    chunks.push(buffer);
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
  } catch {
    throw invalid("Expected a valid JSON request body.");
  }
}

function emptyBody(request: IncomingMessage) {
  if (Number(request.headers["content-length"]) > 0 || request.headers["transfer-encoding"]) {
    request.resume();
    throw invalid("This endpoint does not accept a request body.");
  }
}

function emptyQuery(url: URL) {
  if (url.searchParams.size > 0) throw new ApiError(400, "UNKNOWN_FIELD", "This endpoint does not accept query parameters.");
}

function getPoll(url: URL) {
  for (const key of url.searchParams.keys()) {
    if (key !== "wait_ms" && key !== "after_revision") throw new ApiError(400, "UNKNOWN_FIELD", "Unknown query parameter.");
    if (url.searchParams.getAll(key).length !== 1) throw invalid("Duplicate query parameter.");
  }
  const integer = (key: string, min: number, max: number) => {
    const value = url.searchParams.get(key);
    if (value === null) return undefined;
    const n = Number(value);
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(n) || n < min || n > max) throw invalid("Invalid query integer.");
    return n;
  };
  return { wait: integer("wait_ms", 0, 10_000) ?? 0, after: integer("after_revision", 1, Number.MAX_SAFE_INTEGER) };
}

function json(response: ServerResponse, status: number, requestId: string, body: object) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify({ api_version: "v1", request_id: requestId, server_time: new Date().toISOString(), ...body }));
}

export async function handleMemoryRequest(database: Pool, request: IncomingMessage, response: ServerResponse, fault?: Fault) {
  const requestId = randomUUID();
  try {
    const url = new URL(request.url ?? "/", "http://localhost");
    const auth = credential(request.headers);
    const path = url.pathname;
    if (request.method === "POST" && path === "/v1/sources:upsert") {
      emptyQuery(url);
      const key = idempotencyKey(typeof request.headers["idempotency-key"] === "string" ? request.headers["idempotency-key"] : undefined);
      const input = parseSource(await jsonBody(request, 65_536));
      const result = input.mode === "sync" ? await writeSync(database, auth, key, input, fault)
        : await receiveExternal(database, auth, key, input, fault);
      json(response, result.status === "accepted" ? 202 : 200, requestId, result);
      return;
    }
    if (request.method === "POST" && path === "/v1/evidence:batchGet") {
      emptyQuery(url);
      const payload = parseEvidence(await jsonBody(request, 262_144));
      json(response, 200, requestId, await readEvidence(database, auth, payload));
      return;
    }
    const target = /^\/v1\/operations\/([^/]+)$/.exec(path);
    if (request.method === "GET" && target) {
      emptyBody(request);
      const operationId = id.safeParse(target[1]);
      if (!operationId.success) throw invalid("Invalid operation identifier.");
      const { wait, after } = getPoll(url);
      const deadline = performance.now() + wait;
      let state = await observeOperation(database, auth, operationId.data);
      while (!response.destroyed && wait > 0 && performance.now() < deadline
        && (after === undefined ? state.status === "accepted" : state.revision <= after)) {
        await delay(Math.min(25, Math.max(0, deadline - performance.now())));
        state = await observeOperation(database, auth, operationId.data);
      }
      if (!response.destroyed) json(response, 200, requestId, state);
      return;
    }
    if (request.method === "GET" && path === "/v1/capabilities") {
      emptyBody(request);
      emptyQuery(url);
      await transaction(database, (client) => authorize(client, auth, "service.discover"), true);
      json(response, 200, requestId, capabilities);
      return;
    }
    if ((request.method === "POST" && (disabledPosts.has(path) || disabledOperation.test(path)))
      || (request.method === "GET" && path === "/v1/changes")) {
      await transaction(database, (client) => authorize(client, auth, "service.discover"), true);
      request.resume();
      throw unsupported();
    }
    request.resume();
    throw missing();
  } catch (error) {
    if (response.destroyed) return;
    request.resume();
    const failure = error instanceof ApiError ? error
      : new ApiError(503, "SERVICE_UNAVAILABLE", "Memory service is temporarily unavailable.", true);
    json(response, failure.status, requestId, {
      error: { code: failure.code, message: failure.message, retryable: failure.retryable,
        ...(failure.details ? { details: failure.details } : {}) },
    });
  }
}
