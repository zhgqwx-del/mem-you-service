import assert from "node:assert/strict";
import { test } from "node:test";
import { gateFailures } from "../../../scripts/run-record-check.ts";

test("AC-RECORD-805 fails the test gate on missing, duplicate or non-passing results", () => {
  const first = { name: "AC-RECORD-801 signed accounts", passed: true };
  const second = { name: "AC-RECORD-802 own scope", passed: true };
  const required = ["AC-RECORD-801", "AC-RECORD-802"];
  assert.deepEqual(gateFailures(required, [first, second]), []);
  assert.notEqual(gateFailures(required, []).length, 0);
  assert.notEqual(gateFailures(required, [first]).length, 0);
  assert.notEqual(gateFailures(required, [first, first, second]).length, 0);
  assert.notEqual(gateFailures(required, [first, { ...second, passed: false }]).length, 0);
  assert.notEqual(gateFailures(required, [first, second, { name: "unrelated skipped", passed: false }]).length, 0);
});
