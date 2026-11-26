import assert from "node:assert/strict";
import { test } from "node:test";
import { environment, eventually } from "./fixture.ts";
import { alice, bob, drink } from "./issuer.ts";

const pending = { kind: "pending_input", raw_input: "喝了水" };

test("AC-RECORD-801 HTTP uses the live signed identity and current account mapping", async (t) => {
  const env = await environment(t);
  const endpoint = "/v1/record-operations";
  for (const token of [undefined, env.issuer.token(alice.subject, {}, {}, true), env.issuer.token(alice.subject, { aud: "memory" }),
    env.issuer.token(alice.subject, { iss: "https://other.invalid" }), env.issuer.token(alice.subject, { exp: 1 }),
    env.issuer.token(alice.subject, { nbf: Math.floor(Date.now() / 1000) + 120 })]) {
    assert.equal((await env.record(endpoint, token, pending, "no-auth")).status, 401);
  }
  assert.equal((await env.record(endpoint, env.issuer.token("not-mapped"), pending, "bad-account")).status, 403);
  assert.deepEqual(await env.productCounts(), { operations: 0, records: 0, receipts: 0, outbox: 0 });
  const saved = await env.record(endpoint, env.tokens.a, pending, "active");
  assert.equal(saved.status, 201);
  await env.productOwner.query("UPDATE accounts SET active=false WHERE identity_subject=$1", [alice.subject]);
  assert.equal((await env.record(endpoint + "/" + saved.body.operation_id, env.tokens.a)).status, 403);
  assert.equal((await env.record(endpoint, env.tokens.a, drink, "disabled")).status, 403);
  assert.equal((await env.record(endpoint, env.tokens.b, pending, "active")).status, 201);
  assert.deepEqual(await env.productCounts(), { operations: 2, records: 0, receipts: 0, outbox: 0 });
});

test("AC-RECORD-802 dual-user HTTP protects operations, raw inputs, receipts and records", async (t) => {
  const env = await environment(t);
  const endpoint = "/v1/record-operations";
  const create = async (token: string, label: string, key: string) => {
    const draft = await env.record(endpoint, token, { ...pending, raw_input: label }, "draft-" + key);
    const saved = await env.record(endpoint, token, drink, "saved-" + key);
    assert.equal(draft.status, 201);
    assert.equal(draft.body.status, "pending_input");
    assert.equal(draft.body.raw_input, label);
    assert.equal(draft.body.record_id, undefined);
    assert.equal(saved.status, 201);
    assert.equal(saved.body.status, "committed");
    return { draft: draft.body, saved: saved.body };
  };
  const own = await create(env.tokens.a, "喝了水", "a");
  const other = await create(env.tokens.b, "喝了点水", "b");
  await env.restartProduct();
  for (const [rows, authorized, denied, key] of [[own, env.tokens.a, env.tokens.b, "a"],
    [other, env.tokens.b, env.tokens.a, "b"]] as const) {
    for (const [url, absent] of [
      [endpoint + "/" + rows.draft.operation_id, endpoint + "/absent"],
      [endpoint + "/" + rows.saved.operation_id, endpoint + "/absent"],
      [endpoint + "?client_operation_id=" + encodeURIComponent("draft-" + key), endpoint + "?client_operation_id=absent"],
      ["/v1/records/" + rows.saved.record_id, "/v1/records/absent"],
    ]) {
      assert.equal((await env.record(url!, authorized)).status, 200);
      const wrong = await env.record(url!, denied);
      assert.equal(wrong.status, 404);
      assert.deepEqual(wrong.body.error, (await env.record(absent!, denied)).body.error);
      assert.deepEqual(Object.keys(wrong.body).sort(), ["error", "request_id"]);
    }
  }
});

test("AC-RECORD-803 forged scope has zero side effects and exact own replays remain idempotent", async (t) => {
  const env = await environment(t);
  const endpoint = "/v1/record-operations";
  const a = await env.record(endpoint, env.tokens.a, drink, "same-key");
  assert.equal(a.status, 201);
  const before = await env.productSnapshot();
  for (const claim of [{ owner_id: alice.owner_id }, { tenant_id: alice.tenant_id }, { about_entity_id: alice.self_subject_id },
    { record_id: a.body.record_id }, { grant_id: "foreign" }, { authority_kind: "external_committed" }]) {
    for (const body of [drink, pending]) assert.equal((await env.record(endpoint, env.tokens.b, { ...body, ...claim }, "same-key")).status, 400);
  }
  assert.equal((await env.record(endpoint, env.tokens.b, drink, "same-key", { "x-owner-id": alice.owner_id })).status, 400);
  assert.equal((await env.record(endpoint, env.tokens.b, { ...drink, amount: "0.0001" }, "out-of-range")).status, 400);
  assert.deepEqual(await env.productSnapshot(), before);
  await env.productOwner.query("DELETE FROM record_streams WHERE owner_id=$1", [bob.owner_id]);
  const noStream = await env.productSnapshot();
  assert.equal((await env.record(endpoint, env.tokens.b, drink, "same-key")).status, 503);
  assert.deepEqual(await env.productSnapshot(), noStream);
  await env.productOwner.query("INSERT INTO record_streams VALUES ($1,$2,$3,10)", [bob.tenant_id, bob.owner_id, bob.stream]);
  const signedMisleading = env.issuer.token(bob.subject, { owner_id: alice.owner_id, tenant_id: "other" });
  const [one, two] = await Promise.all([env.record(endpoint, signedMisleading, drink, "same-key"),
    env.record(endpoint, env.tokens.b, drink, "same-key")]);
  assert.deepEqual([one.status, two.status].sort(), [200, 201]);
  assert.deepEqual(one.body, two.body);
  assert.notEqual(one.body.record_id, a.body.record_id);
  assert.deepEqual((await env.record(endpoint, env.tokens.a, drink, "same-key")).body, a.body);
  assert.equal((await env.record(endpoint, env.tokens.a, { ...drink, amount: "305" }, "same-key")).status, 409);
  assert.deepEqual(await env.productCounts(), { operations: 2, records: 2, receipts: 2, outbox: 2 });
  const streams = (await env.productAudit.query("SELECT owner_id, last_sequence FROM record_streams ORDER BY owner_id")).rows;
  assert.deepEqual(streams, [{ owner_id: alice.owner_id, last_sequence: "11" }, { owner_id: bob.owner_id, last_sequence: "11" }]);
});

test("AC-RECORD-804 actual RecordService Outbox and Memory enforce independent authorization", async (t) => {
  const env = await environment(t);
  const saved = await env.record("/v1/record-operations", env.tokens.a, drink, "to-memory");
  assert.equal(saved.status, 201);
  const event = (await env.productAudit.query("SELECT event_id, document, memory_operation_id FROM record_outbox")).rows[0];
  assert.ok(event);
  assert.equal(event.memory_operation_id, null);
  assert.equal(event.document.external_record_ref.record_id, saved.body.record_id);
  assert.equal((await env.record("/v1/record-operations/" + saved.body.operation_id, env.tokens.a)).body.record_id, saved.body.record_id);
  const before = await env.memorySnapshot();
  const write = (token: string) => env.memory("/v1/sources:upsert", token, event.document, event.event_id);
  assert.equal((await write(env.tokens.a)).status, 401);
  assert.equal((await write(env.memoryTokens.model)).status, 403);
  assert.equal((await write(env.memoryTokens.importB)).status, 404);
  assert.deepEqual(await env.memorySnapshot(), before);

  await env.startWorker();
  const applied = await eventually(async () => (await env.productAudit.query(
    "SELECT memory_operation_id FROM record_outbox WHERE applied_at IS NOT NULL",
  )).rows[0]);
  const operationPath = "/v1/operations/" + applied.memory_operation_id;
  assert.equal((await env.memory(operationPath, env.memoryTokens.readA)).body.status, "applied");
  const hiddenOperation = await env.memory(operationPath, env.memoryTokens.readB);
  assert.equal(hiddenOperation.status, 404);
  assert.deepEqual(hiddenOperation.body.error, (await env.memory("/v1/operations/absent", env.memoryTokens.readB)).body.error);
  const evidence = (source_id: string, token: string) =>
    env.memory("/v1/evidence:batchGet", token, { refs: [{ kind: "source", id: source_id, version: 1 }], projection: "structured" });
  const visible = await evidence(event.document.source_id, env.memoryTokens.readA);
  assert.equal(visible.body.results[0].status, "ok");
  assert.equal(visible.body.results[0].authority_kind, "external_committed");
  const hidden = await evidence(event.document.source_id, env.memoryTokens.readB);
  assert.deepEqual({ ...hidden.body.results[0], ref: undefined },
    { ...(await evidence("absent", env.memoryTokens.readB)).body.results[0], ref: undefined });
  assert.equal(hidden.body.results[0].status, "NOT_FOUND_OR_NOT_VISIBLE");
  assert.deepEqual(await env.productCounts(), { operations: 1, records: 1, receipts: 1, outbox: 1 });
  await env.stopMemory();
  const second = await env.record("/v1/record-operations", env.tokens.b, drink, "to-memory");
  assert.equal(second.status, 201);
  assert.deepEqual((await env.record("/v1/record-operations/" + second.body.operation_id, env.tokens.b)).body, second.body);
  assert.equal((await env.productAudit.query("SELECT applied_at FROM record_outbox WHERE record_id=$1", [second.body.record_id])).rows[0].applied_at, null);
  await env.restartMemory();
  await eventually(async () => Number((await env.productAudit.query(
    "SELECT count(*) FROM record_outbox WHERE applied_at IS NOT NULL",
  )).rows[0].count) === 2);
  assert.equal((await env.memoryAudit.query("SELECT count(*) FROM sources")).rows[0].count, "2");
});
