import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { authorizeObject, scopeValues, type Scope } from "./auth.ts";
import { fingerprint, RecordError, notFound, type RecordInput } from "./protocol.ts";

type Scoped = { tenant_id: string; owner_id: string; subject_id: string; domain: string };
type Receipt = { status: "committed"; operation_id: string; action_id: string; record_id: string; record_version: number };
type Pending = { status: "pending_input"; operation_id: string; raw_input: string; missing_fields: ["amount"] };
type Operation = Scoped & { operation_id: string; request_hash: string; raw_input: string | null; receipt: Receipt | null };

const scopeFilter = "tenant_id=$1 AND owner_id=$2 AND subject_id=$3 AND domain='hydration'";
const hydration = "hydration";

async function findOperation(client: PoolClient, scope: Scope, selector: "operation_id" | "client_operation_id", key: string) {
  const { rows } = await client.query<Operation>(`SELECT op.*, r.receipt FROM record_operations op
    LEFT JOIN record_receipts r USING (operation_id, tenant_id, owner_id, subject_id, domain)
    WHERE ${scopeFilter} AND op.${selector}=$4`, [...scopeValues(scope), key]);
  return rows[0];
}

function view(operation: Operation): Receipt | Pending {
  if (operation.raw_input !== null) {
    return { status: "pending_input", operation_id: operation.operation_id, raw_input: operation.raw_input, missing_fields: ["amount"] };
  }
  if (!operation.receipt) throw new Error("Committed operation lacks a receipt");
  return operation.receipt;
}

export async function readOperation(client: PoolClient, scope: Scope, selector: "operation_id" | "client_operation_id", key: string) {
  return view(authorizeObject(scope, await findOperation(client, scope, selector, key)));
}

export async function readRecord(client: PoolClient, scope: Scope, id: string) {
  const { rows } = await client.query<Scoped & { document: object }>(`SELECT * FROM records WHERE ${scopeFilter} AND record_id=$4`,
    [...scopeValues(scope), id]);
  return authorizeObject(scope, rows[0]).document;
}

export async function submit(client: PoolClient, scope: Scope, key: string, input: RecordInput) {
  const values = scopeValues(scope);
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
    [JSON.stringify(["record-operation", scope.tenant_id, scope.owner_id, key])]);
  const requestHash = fingerprint(input);
  const previous = await findOperation(client, scope, "client_operation_id", key);
  if (previous) {
    authorizeObject(scope, previous);
    if (previous.request_hash !== requestHash) throw new RecordError(409, "IDEMPOTENCY_CONFLICT", "Operation key is already in use.");
    return { status: 200, body: view(previous) };
  }

  const operationId = randomUUID();
  const raw = input.kind === "pending_input" ? input.raw_input : null;
  const inserted = await client.query(`INSERT INTO record_operations
    (operation_id,tenant_id,owner_id,subject_id,domain,client_operation_id,request_hash,kind,raw_input)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (tenant_id,owner_id,client_operation_id) DO NOTHING`,
  [operationId, ...values, hydration, key, requestHash, input.kind, raw]);
  if (inserted.rowCount !== 1) throw notFound();

  if (input.kind === "pending_input") {
    const body: Pending = { status: "pending_input", operation_id: operationId, raw_input: input.raw_input, missing_fields: ["amount"] };
    return { status: 201, body };
  }

  const recordId = randomUUID();
  const receipt: Receipt = {
    status: "committed", operation_id: operationId, action_id: randomUUID(), record_id: recordId, record_version: 1,
  };
  const record = { record_id: recordId, record_version: 1, amount: input.amount, unit: input.unit, beverage_kind: "water",
    occurred_at: input.occurred_at, timezone: input.timezone };
  await client.query(`INSERT INTO records (record_id,tenant_id,owner_id,subject_id,domain,document)
    VALUES ($1,$2,$3,$4,$5,$6)`, [recordId, ...values, hydration, record]);
  await client.query(`INSERT INTO record_receipts (operation_id,record_id,tenant_id,owner_id,subject_id,domain,receipt)
    VALUES ($1,$2,$3,$4,$5,$6,$7)`, [operationId, recordId, ...values, hydration, receipt]);
  const stream = (await client.query<{ stream_id: string; last_sequence: string }>(`UPDATE record_streams
    SET last_sequence=last_sequence+1 WHERE tenant_id=$1 AND owner_id=$2 RETURNING stream_id,last_sequence`,
  values.slice(0, 2))).rows[0];
  if (!stream) throw new RecordError(503, "RECORD_STREAM_UNAVAILABLE", "Record stream is unavailable.");
  const eventId = randomUUID();
  const sequence = Number(stream.last_sequence);
  const document = {
    source_id: randomUUID(), source_group_id: randomUUID(), about_entity_id: scope.self_subject_id,
    source_kind: "external_record", mode: "ordered_import", authority_kind: "external_committed", lifecycle: "active",
    domains: [hydration], timezone: input.timezone, recorded_at: new Date().toISOString(),
    occurred: { occurred_from: input.occurred_at, time_precision: "second", timezone: input.timezone, basis: "external_record" },
    content: { structured: { schema_id: "hydration.beverage", schema_version: 1,
      data: { value: input.amount, unit: input.unit, beverage_kind: "water" } } },
    external_record_ref: { system_id: "diandi-record-service", record_id: recordId, external_version: "1" },
    upstream_change: { stream_id: stream.stream_id, stream_seq: sequence, event_id: eventId },
  };
  await client.query(`INSERT INTO record_outbox
    (event_id,record_id,tenant_id,owner_id,stream_id,stream_sequence,document,payload_hash)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [eventId, recordId, ...values.slice(0, 2), stream.stream_id, sequence,
    document, fingerprint(document)]);
  return { status: 201, body: receipt };
}
