import assert from "node:assert/strict";
import { test } from "node:test";
import {
  adapter, secondAdapter, environment, importer, model, narrow, otherReader, productOwner, revoked,
  source, streamId, translate, until,
} from "./fixture.ts";

const ref = (id: string, version?: number) => (
  { kind: "source" as const, id, ...(version === undefined ? {} : { version }) }
);
const barrier = { external_barriers: [{ stream_id: streamId, through_seq: 12 }] };
function error(response: { status: number; body: Record<string, any> }, status: number, code: string) {
  assert.equal(response.status, status, JSON.stringify(response.body));
  assert.equal(response.body.error.code, code);
  return response.body.error;
}

test("AC-MEM-001 authenticates writes and keeps operations and evidence scoped", async (t) => {
  const env = await environment(t);
  const service = await env.start();
  const post = (token: string | null, epoch?: string) => service.request("/v1/sources:upsert",
    { token, epoch, key: "first", body: source() });
  error(await post(null), 401, "UNAUTHENTICATED");
  error(await post(adapter, "1"), 409, "POLICY_EPOCH_STALE");
  error(await post(revoked), 403, "GRANT_REVOKED");
  error(await post(model), 403, "ACTION_NOT_ALLOWED");
  error(await service.put({ ...source(), about_entity_id: "unknown" }, "wrong-subject"), 404, "NOT_FOUND_OR_NOT_VISIBLE");
  error(await service.put({ ...source(), domains: ["food"] }, "wrong-domain"), 404, "NOT_FOUND_OR_NOT_VISIBLE");
  error(await service.put({ ...source(), authority_kind: "external_committed" }, "false-authority"), 403, "AUTHORITY_ESCALATION_DENIED");
  const { events } = await env.product();
  const event = translate(events[0]!);
  error(await service.put({ ...event, upstream_change: { ...event.upstream_change, stream_id: "unknown" } },
    "wrong-stream", importer), 404, "NOT_FOUND_OR_NOT_VISIBLE");
  assert.equal(await env.count("operations"), 0);
  assert.equal(await env.count("source_revisions"), 0);

  const written = await post(adapter, "2");
  assert.equal(written.status, 200);
  const unseen = error(await service.get(written.body.operation_id, otherReader), 404, "NOT_FOUND_OR_NOT_VISIBLE");
  assert.deepEqual(unseen, error(await service.get("made-up", otherReader), 404, "NOT_FOUND_OR_NOT_VISIBLE"));
  for (const token of [otherReader, narrow]) {
    const evidence = await service.evidence([ref("input-1", 1), ref("missing")], {}, token);
    assert.equal(evidence.status, 200);
    assert.deepEqual(evidence.body.results, [
      { ref: ref("input-1", 1), status: "NOT_FOUND_OR_NOT_VISIBLE" },
      { ref: ref("missing"), status: "NOT_FOUND_OR_NOT_VISIBLE" },
    ]);
  }
});

test("AC-MEM-002 persists sync idempotency, immutable revisions and one winning CAS", async (t) => {
  const env = await environment(t);
  const service = await env.start();
  const first = await service.put(source(), "same-key");
  assert.equal(first.status, 200);
  assert.equal(first.body.source_version, 1);
  assert.equal(first.body.status, "applied");
  assert.equal(first.body.business_record_status, "not_asserted");
  const replay = await service.put(source(), "same-key");
  assert.equal(replay.body.operation_id, first.body.operation_id);
  assert.equal(replay.body.source_version, 1);
  assert.equal(replay.body.write_token, first.body.write_token);
  const sameRevision = await service.put(source(), "new-key-same-revision");
  assert.equal(sameRevision.body.operation_id, first.body.operation_id);
  const anotherGrant = await service.put(source(), "same-key", secondAdapter);
  assert.equal(anotherGrant.body.operation_id, first.body.operation_id);
  assert.equal(anotherGrant.body.write_token, undefined);
  error(await service.evidence([ref("input-1")], { read_after: { write_token: first.body.write_token } }, secondAdapter),
    404, "NOT_FOUND_OR_NOT_VISIBLE");
  error(await service.put(source("input-1", "group-1", "310"), "same-key"), 409, "IDEMPOTENCY_PAYLOAD_MISMATCH");
  error(await service.put(source("input-1", "group-1", "310"), "new-key-different-revision-body"),
    409, "SOURCE_REVISION_CONFLICT");
  const contenders = await Promise.all(["310", "320"].map((amount) => service.put({
    ...source("input-1", "group-1", amount), expected_source_version: 1, caller_revision_key: "revision-" + amount,
  }, "replace-" + amount)));
  assert.deepEqual(contenders.map(({ status }) => status).sort(), [200, 409]);
  const winner = contenders.find(({ status }) => status === 200)!;
  assert.equal(winner.body.source_version, 2);
  error(contenders.find(({ status }) => status === 409)!, 409, "VERSION_CONFLICT");
  assert.equal(await env.count("source_revisions"), 2);
  const oldOperation = await service.get(first.body.operation_id);
  assert.equal(oldOperation.body.source_version, 1);
  const now = await service.evidence([ref("input-1", 1), ref("input-1", 2)], {
    read_after: { write_token: winner.body.write_token, required_sources: [{ source_id: "input-1", source_version: 2 }] },
  }, adapter);
  assert.equal(now.status, 200);
  assert.equal(now.body.results[0].status, "STALE_REFERENCE");
  assert.equal(now.body.results[1].status, "ok");
});

test("AC-MEM-003 accepts an out-of-order Outbox event and applies only the contiguous prefix", async (t) => {
  const env = await environment(t);
  let service = await env.start();
  const { events, records, receipts } = await env.product();
  const [eleven, twelve] = events.map((event) => translate(event));
  assert.equal(eleven!.upstream_change.stream_seq, 11);
  assert.equal(twelve!.upstream_change.stream_seq, 12);
  const queued = await service.put(twelve, "outbox-12", importer);
  assert.equal(queued.status, 202);
  assert.equal(queued.body.status, "accepted");
  assert.equal(queued.body.write_token, undefined);
  assert.equal(queued.body.source_version, undefined);
  assert.equal(queued.body.import_outcome, undefined);
  const again = await service.put(twelve, "outbox-12", importer);
  assert.equal(again.body.operation_id, queued.body.operation_id);
  const newKey = await service.put(twelve, "outbox-12-receipt-lost", importer);
  assert.equal(newKey.body.operation_id, queued.body.operation_id);
  assert.equal((await service.get(queued.body.operation_id)).body.status, "accepted");
  assert.equal((await env.water()).seq, 10);
  assert.equal(await env.count("source_revisions"), 0);
  assert.equal(await env.count("inbox"), 1);

  await service.stop();
  service = await env.start();
  assert.equal((await service.get(queued.body.operation_id)).body.status, "accepted");
  assert.equal((await env.water()).seq, 10);
  const accepted11 = await service.put(eleven, "outbox-11", importer);
  assert.equal(accepted11.status, 202);
  const applied12 = await until(() => service.get(queued.body.operation_id, importer), (value) => value.body.status === "applied");
  assert.equal(applied12.body.import_outcome, "source_applied");
  assert.equal(applied12.body.source_version, 1);
  assert.ok(applied12.body.write_token);
  const applied11 = await service.get(accepted11.body.operation_id);
  assert.equal(applied11.body.status, "applied");
  assert.equal(applied11.body.source_version, 1);
  assert.equal(applied11.body.import_outcome, "source_applied");
  const replay = await service.put(twelve, "outbox-12", importer);
  assert.equal(replay.body.operation_id, queued.body.operation_id);
  assert.equal(replay.body.source_version, 1);
  assert.equal((await env.water()).seq, 12);
  const proof = await service.evidence([ref(twelve!.source_id, 1)], { read_after: barrier });
  assert.equal(proof.status, 200);
  assert.equal(proof.body.results[0].authority_kind, "external_committed");
  assert.equal(proof.body.results[0].content.structured.data.value, "300");
  assert.deepEqual(proof.body.results[0].occurred, twelve!.occurred);
  assert.equal(proof.body.results[0].recorded_at_basis, "service_received");
  const identical = { ...twelve, upstream_change: { ...twelve!.upstream_change, stream_seq: 13, event_id: "same-snapshot" } };
  const sentAgain = await service.put(identical, "outbox-13", importer);
  assert.equal(sentAgain.status, 202);
  const consumed = await until(() => service.get(sentAgain.body.operation_id), (value) => value.body.status === "applied");
  assert.equal(consumed.body.source_version, 1);
  assert.equal(consumed.body.visibility_generation, applied12.body.visibility_generation);
  assert.equal((await env.water()).seq, 13);
  assert.equal(await env.count("source_revisions"), 2);
  assert.equal(records.counts().records, 2);
  assert.deepEqual(records.lookupReceipt(productOwner, "record-12"), receipts[1]);
});

test("AC-MEM-004 rejects unsatisfied reads and persists event conflict quarantine", async (t) => {
  for (const variant of ["changed content", "changed sequence"] as const) await t.test(variant, async (scope) => {
    const env = await environment(scope);
    const service = await env.start();
    const { events } = await env.product();
    const twelve = translate(events[1]!);
    assert.equal((await service.put(source(), "visible-old")).status, 200);
    await service.put(twelve, "outbox-12", importer);
    const blocked = await service.evidence([ref("input-1")], { read_after: barrier, deadline_ms: 100 });
    assert.ok([503, 504].includes(blocked.status));
    assert.match(blocked.body.error.code, /^FRESHNESS_(UNAVAILABLE|TIMEOUT)$/);
    assert.equal(blocked.body.results, undefined);
    const conflict = variant === "changed sequence"
      ? { ...twelve, upstream_change: { ...twelve.upstream_change, stream_seq: 13 } }
      : { ...twelve, content: source("input-1", "group-1", "301").content };
    error(await service.put(conflict, "outbox-conflict", importer), 409, "IMPORT_EVENT_CONFLICT");
    assert.deepEqual(await env.water(), { seq: 10, health: "quarantined" });
    await service.stop();
    const resumed = await env.start();
    error(await resumed.put(translate(events[0]!), "outbox-11", importer), 503, "IMPORT_STREAM_BLOCKED");
    assert.deepEqual(await env.water(), { seq: 10, health: "quarantined" });
    assert.equal(await env.count("source_revisions"), 1);
  });
});

test("AC-MEM-005 recovers the original receipt across actual process exits", async (t) => {
  for (const fault of ["beforeSyncCommit", "afterSyncCommit", "afterReceiveCommit", "beforeApplyCommit", "afterApplyCommit"]) {
    await t.test(fault, async (scope) => {
      const env = await environment(scope);
      const { events, records, receipts } = await env.product();
      assert.deepEqual(records.lookupReceipt(productOwner, "record-11"), receipts[0]);
      const originalOutbox = records.listOutbox();
      const event = translate(events[0]!);
      const service = await env.start({ fault });
      const sync = fault.endsWith("SyncCommit");
      const send = (target: typeof service) => sync ? target.put(source(), "stable-sync") : target.put(event, "stable-event", importer);
      if (fault.includes("Apply")) assert.equal((await send(service)).status, 202);
      else await assert.rejects(send(service));
      assert.equal((await service.exited).signal, "SIGKILL");
      if (!sync) {
        assert.equal(await env.count("inbox"), 1);
        assert.equal((await env.water()).seq, fault === "afterApplyCommit" ? 11 : 10);
      } else {
        assert.equal(await env.count("source_revisions"), fault === "beforeSyncCommit" ? 0 : 1);
      }

      const resumed = await env.start();
      const replay = await send(resumed);
      const applied = await until(() => resumed.get(replay.body.operation_id), (value) => value.body.status === "applied");
      assert.equal(applied.body.source_version, 1);
      assert.equal((await send(resumed)).body.operation_id, applied.body.operation_id);
      assert.equal(await env.count("operations"), 1);
      assert.equal(await env.count("source_revisions"), 1);
      assert.equal(await env.count("inbox"), sync ? 0 : 1);
      assert.deepEqual(records.listOutbox(), originalOutbox);
      assert.deepEqual(records.lookupReceipt(productOwner, "record-11"), receipts[0]);
    });
  }
});

test("AC-MEM-006 verifies exact input references in either arrival order", async (t) => {
  for (const rawFirst of [true, false]) await t.test(rawFirst ? "input first" : "external first", async (scope) => {
    const env = await environment(scope);
    const service = await env.start();
    const { events } = await env.product();
    const event = translate(events[0]!, [{ source_id: "raw-1", source_version: 1 }]);
    const raw = source("raw-1", event.source_group_id);
    if (rawFirst) assert.equal((await service.put(raw, "raw")).status, 200);
    const stored = await service.put(event, "external", importer);
    await until(() => service.get(stored.body.operation_id), (value) => value.body.status === "applied");
    const readLink = async () => (await env.database.query("SELECT state FROM evidence_links")).rows[0].state;
    assert.equal(await readLink(), rawFirst ? "verified" : "pending");
    if (!rawFirst) {
      const absent = await service.evidence([ref("raw-1", 1)]);
      assert.equal(absent.body.results[0].status, "NOT_FOUND_OR_NOT_VISIBLE");
      assert.equal((await service.put(raw, "raw")).status, 200);
    }
    assert.equal(await readLink(), "verified");
    const evidence = await service.evidence([ref("raw-1", 1), ref(event.source_id, 1)]);
    assert.deepEqual(evidence.body.results.map((item: { authority_kind: string }) => item.authority_kind),
      ["user_reported", "external_committed"]);
    assert.equal(evidence.body.tracking_status, "uncontrolled");
    const wrongGroup = translate(events[1]!, [{ source_id: "raw-1", source_version: 1 }]);
    error(await service.put(wrongGroup, "external-wrong-group", importer), 422, "INVALID_EVIDENCE_RELATION");
    assert.equal(await env.count("source_revisions"), 2);
  });
});

test("AC-MEM-007 validates the HTTP envelope, bytes, shape, schema and enabled routes", async (t) => {
  const env = await environment(t);
  const service = await env.start();
  error(await service.put({ ...source(), owner_subject_id: "spoof" }, "unknown"), 400, "UNKNOWN_FIELD");
  error(await service.request("/v1/sources:upsert", { body: source(), token: adapter }), 400, "IDEMPOTENCY_KEY_REQUIRED");
  error(await service.request("/v1/sources:upsert", { token: adapter, key: "large",
    raw: JSON.stringify({ ...source(), content: { text: "喝".repeat(30_000) } }) }), 413, "PAYLOAD_TOO_LARGE");
  error(await service.put({ ...source(), timezone: "Nowhere/Unknown" }, "tz"), 422, "UNSUPPORTED_TIMEZONE");
  const malformed = source();
  malformed.content.structured.data.unit = "liters";
  error(await service.put(malformed, "units"), 422, "SCHEMA_VALUE_INVALID");
  error(await service.request("/v1/context:prepare", { body: {} }), 422, "UNSUPPORTED_CAPABILITY");
  const capabilities = await service.request("/v1/capabilities");
  assert.equal(capabilities.status, 200);
  assert.deepEqual(capabilities.body.memory_api_versions, ["v1"]);
  assert.deepEqual(capabilities.body.features, ["source_mirror", "evidence_batch_get"]);
  assert.deepEqual(capabilities.body.consumer_profiles, []);
  assert.equal(await env.count("operations"), 0);
  assert.equal(await env.count("source_revisions"), 0);
});
