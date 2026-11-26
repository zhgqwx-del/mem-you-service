import assert from "node:assert/strict";
import { test } from "node:test";
import { accountScope, authorizeObject, createVerifier } from "../src/auth.ts";
import { parseOperation } from "../src/protocol.ts";
import { alice, bob, drink, issuer } from "./issuer.ts";

test("AC-RECORD-801 verifies signed tokens and derives identity from trusted claims only", async () => {
  const { config, token } = issuer();
  const verify = createVerifier(config);
  const bearer = (value: string) => "Bearer " + value;
  assert.deepEqual(await verify(bearer(token(alice.subject, { owner_id: bob.owner_id, tenant_id: "other" }))),
    { issuer: config.issuer, subject: alice.subject });
  const now = Math.floor(Date.now() / 1000);
  for (const value of [
    undefined, "bad token", bearer(token(alice.subject, {}, {}, true)),
    bearer(token(alice.subject, { iss: "https://other.invalid" })), bearer(token(alice.subject, { aud: "memory" })),
    bearer(token(alice.subject, { exp: now - 10 })), bearer(token(alice.subject, { exp: undefined })),
    bearer(token(alice.subject, { nbf: now + 60 })), bearer(token("")),
    bearer(token(alice.subject, {}, { kid: "unknown" })), bearer(token(alice.subject, {}, { alg: "none" })),
    bearer(token(alice.subject, {}, { jku: "https://untrusted.invalid/keys" })),
    bearer(token(alice.subject, {}, { jwk: config.keys[0] })),
  ]) await assert.rejects(verify(value), { status: 401 });

  assert.deepEqual(accountScope([alice]), { tenant_id: alice.tenant_id, owner_id: alice.owner_id, self_subject_id: alice.self_subject_id });
  for (const rows of [[], [{ ...alice, active: false }], [alice, bob]]) {
    assert.throws(() => accountScope(rows), { status: 403 });
  }
});

test("AC-RECORD-802 authorizes only the mapped tenant, owner, subject and hydration domain", () => {
  const scope = accountScope([alice]);
  const own = { tenant_id: alice.tenant_id, owner_id: alice.owner_id, subject_id: alice.self_subject_id, domain: "hydration" };
  assert.equal(authorizeObject(scope, own), own);
  for (const row of [undefined, { ...own, tenant_id: "other" }, { ...own, owner_id: bob.owner_id },
    { ...own, subject_id: bob.self_subject_id }, { ...own, domain: "food" }]) {
    assert.throws(() => authorizeObject(scope, row), { status: 404, code: "NOT_FOUND_OR_NOT_VISIBLE" });
  }
});

test("AC-RECORD-803 rejects untrusted fields and accepts only the two agreed input types", () => {
  assert.deepEqual(parseOperation(drink), drink);
  assert.deepEqual(parseOperation({ kind: "pending_input", raw_input: "喝了水" }), { kind: "pending_input", raw_input: "喝了水" });
  for (const patch of [{ owner_id: bob.owner_id }, { about_entity_id: bob.self_subject_id }, { record_id: "foreign" },
    { grant_id: "foreign-grant" }, { authority_kind: "external_committed" }, { timezone: "+08:00" },
    { amount: "0" }, { amount: "0.0001" }, { amount: "10000001" }, { occurred_at: "2026-02-30T01:00:00Z" }, { unit: "l" }]) {
    assert.throws(() => parseOperation({ ...drink, ...patch }), { status: 400 });
  }
});
