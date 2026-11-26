import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import {
  authorize, checkScope, lockOwner, scopeValues,
  type Credential, type Descriptor, type Grant, type Scope,
} from "./auth.ts";
import { transaction } from "./db.ts";
import { ApiError, fingerprint, missing, unsupported, type InputSelector, type SourceDocument } from "./protocol.ts";

export type FaultPoint = "beforeSyncCommit" | "afterSyncCommit" | "afterReceiveCommit" | "beforeApplyCommit" | "afterApplyCommit";
export type Fault = (point: FaultPoint) => void;
export type Receipt = Record<string, unknown> & {
  operation_id: string;
  status: "accepted" | "applied" | "failed";
};
export type Operation = Descriptor & {
  operation_id: string; grant_id: string; revision: string; result: Receipt; created_at: Date; applied_at: Date | null;
};
export type StoredSource = SourceDocument & { recorded_at_basis?: "service_received" };
type SourceHead = Descriptor & { kind: "user_input" | "external_record"; head_version: string; group_id: string };
type Revision = { operation_id: string; request_hash: string; document: SourceDocument };

export function sourceDescriptor(input: SourceDocument): Descriptor {
  if (!input.about_entity_id) throw new ApiError(422, "SCHEMA_VALUE_INVALID", "This slice requires a confirmed subject.");
  return { entity_id: input.about_entity_id, domains: input.domains, stream_id: input.upstream_change?.stream_id };
}

export function verifySourceGrant(grant: Grant, input: SourceDocument): Descriptor {
  const descriptor = sourceDescriptor(input);
  checkScope(grant, descriptor);
  const allowed = input.mode === "sync"
    ? grant.caller_type === "trusted_adapter" && input.authority_kind === "user_reported"
    : grant.caller_type === "trusted_importer" && input.authority_kind === "external_committed";
  if (!allowed) throw new ApiError(403, "AUTHORITY_ESCALATION_DENIED", "The registered caller cannot assert this authority.");
  if (input.domains.length !== 1 || input.domains[0] !== "hydration") throw unsupported();
  return descriptor;
}

export async function operation(client: PoolClient, scope: Scope, id: string): Promise<Operation> {
  const row = (await client.query<Operation>(
    "SELECT * FROM operations WHERE tenant_id=$1 AND owner_id=$2 AND operation_id=$3", [...scopeValues(scope), id],
  )).rows[0];
  if (!row) throw missing();
  return row;
}

export function visibleReceipt(row: Operation, grant: Grant): Receipt {
  checkScope(grant, row);
  if (row.grant_id === grant.grant_id) return row.result;
  const { write_token: _token, ...result } = row.result;
  return result;
}

export async function lookupRetry(client: PoolClient, grant: Grant, key: string, requestHash: string): Promise<Receipt | undefined> {
  const existing = (await client.query<{ request_hash: string; operation_id: string; expired: boolean }>(
    `SELECT request_hash, operation_id, created_at + interval '30 days' <= clock_timestamp() AS expired
      FROM idempotency_keys WHERE tenant_id=$1 AND owner_id=$2 AND grant_id=$3 AND request_key=$4`,
    [...scopeValues(grant), grant.grant_id, key],
  )).rows[0];
  if (!existing) return undefined;
  if (existing.expired) throw new ApiError(410, "IDEMPOTENCY_WINDOW_EXPIRED", "Look up the original operation before retrying.");
  if (existing.request_hash !== requestHash) {
    throw new ApiError(409, "IDEMPOTENCY_PAYLOAD_MISMATCH", "The key is already bound to a different request.");
  }
  const old = await operation(client, grant, existing.operation_id);
  return visibleReceipt(old, grant);
}

export async function bindRetry(client: PoolClient, grant: Grant, key: string, requestHash: string, id: string): Promise<void> {
  await client.query(`INSERT INTO idempotency_keys (tenant_id,owner_id,grant_id,request_key,request_hash,operation_id)
    VALUES ($1,$2,$3,$4,$5,$6)`, [...scopeValues(grant), grant.grant_id, key, requestHash, id]);
}

export async function insertOperation(client: PoolClient, grant: Grant, descriptor: Descriptor, receipt: Receipt): Promise<void> {
  await client.query(`INSERT INTO operations
    (operation_id,tenant_id,owner_id,grant_id,entity_id,domains,stream_id,result,write_token,applied_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,CASE WHEN $9::text IS NULL THEN NULL ELSE clock_timestamp() END)`,
  [receipt.operation_id, ...scopeValues(grant), grant.grant_id,
    descriptor.entity_id, descriptor.domains, descriptor.stream_id ?? null, receipt, receipt.write_token ?? null]);
}

export async function appliedReceipt(
  client: PoolClient, operationId: string, sourceId: string, version: number, imported: boolean, previousGeneration?: number,
): Promise<Receipt> {
  const generation = previousGeneration ?? Number((await client.query<{ generation: string }>(
    "SELECT nextval('visibility_generation_seq') AS generation",
  )).rows[0]!.generation);
  return {
    operation_id: operationId, status: "applied", source_id: sourceId, source_version: version,
    memory_id: null, memory_version: null, write_token: randomUUID(),
    visibility_generation: generation,
    business_record_status: "not_asserted", ...(imported ? { import_outcome: "source_applied" } : {}),
  };
}

export async function head(client: PoolClient, scope: Scope, sourceId: string): Promise<SourceHead | undefined> {
  return (await client.query<SourceHead>(
    "SELECT * FROM sources WHERE tenant_id=$1 AND owner_id=$2 AND source_id=$3",
    [...scopeValues(scope), sourceId],
  )).rows[0];
}

async function revision(client: PoolClient, scope: Scope, sourceId: string, version: number): Promise<Revision | undefined> {
  return (await client.query<Revision>(`SELECT operation_id, request_hash, document FROM source_revisions
    WHERE tenant_id=$1 AND owner_id=$2 AND source_id=$3 AND version=$4`, [...scopeValues(scope), sourceId, version])).rows[0];
}

function normalizeStored(input: SourceDocument): StoredSource {
  // The registered connection is the authority in this slice. Its opaque proof is never copied into evidence.
  const { source_attestation: _proof, ...rest } = input;
  if (input.recorded_at !== undefined) return rest;
  return { ...rest, recorded_at: new Date().toISOString(), recorded_at_basis: "service_received" };
}

export async function writeRevision(
  client: PoolClient, scope: Scope, input: SourceDocument, version: number, requestHash: string, operationId: string,
): Promise<void> {
  const descriptor = sourceDescriptor(input);
  if (version === 1) {
    await client.query(`INSERT INTO sources (tenant_id,owner_id,source_id,group_id,entity_id,domains,kind,head_version)
      VALUES ($1,$2,$3,$4,$5,$6,$7,1)`,
    [...scopeValues(scope), input.source_id, input.source_group_id, descriptor.entity_id, input.domains, input.source_kind]);
  } else {
    await client.query("UPDATE sources SET head_version=$4 WHERE tenant_id=$1 AND owner_id=$2 AND source_id=$3",
      [...scopeValues(scope), input.source_id, version]);
  }
  await client.query(`INSERT INTO source_revisions
    (tenant_id,owner_id,source_id,version,caller_revision_key,request_hash,operation_id,document)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
  [...scopeValues(scope), input.source_id, version, input.caller_revision_key ?? null, requestHash, operationId, normalizeStored(input)]);
}

function validSelector(ref: InputSelector, input: SourceDocument): boolean {
  if (ref.span) return ref.span.end <= Array.from(input.content?.text ?? "").length;
  if (!ref.field_paths) return true;
  const fields = input.content?.structured?.data;
  return !!fields && ref.field_paths.every((path) => Object.hasOwn(fields, path));
}

export async function linkState(client: PoolClient, scope: Scope, external: SourceDocument, ref: InputSelector) {
  const known = await head(client, scope, ref.source_id);
  if (!known) return "pending";
  if (known.kind !== "user_input" || known.group_id !== external.source_group_id
    || known.entity_id !== external.about_entity_id || !known.domains.every((domain) => external.domains.includes(domain))) return "invalid";
  const exact = await revision(client, scope, ref.source_id, ref.source_version);
  if (!exact) return Number(known.head_version) < ref.source_version ? "pending" : "invalid";
  return validSelector(ref, exact.document) ? "verified" : "invalid";
}

export async function checkExternalLinks(client: PoolClient, scope: Scope, input: SourceDocument): Promise<void> {
  for (const link of input.input_evidence_refs ?? []) {
    if (await linkState(client, scope, input, link) === "invalid") {
      throw new ApiError(422, "INVALID_EVIDENCE_RELATION", "Input evidence is outside the source relationship.");
    }
  }
}

export async function saveExternalLinks(client: PoolClient, scope: Scope, input: SourceDocument, version: number): Promise<void> {
  for (const link of input.input_evidence_refs ?? []) {
    const state = await linkState(client, scope, input, link);
    await client.query("INSERT INTO evidence_links VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
      [...scopeValues(scope), input.source_id, version, link.source_id, link.source_version, link, state]);
  }
}

async function resolvePendingLinks(client: PoolClient, scope: Scope, input: SourceDocument, version: number): Promise<void> {
  const pending = await client.query<{ external_source_id: string; external_version: string; selector: InputSelector; document: SourceDocument }>(
    `SELECT l.external_source_id,l.external_version,l.selector,r.document FROM evidence_links l
     JOIN source_revisions r ON r.tenant_id=l.tenant_id AND r.owner_id=l.owner_id
       AND r.source_id=l.external_source_id AND r.version=l.external_version
     WHERE l.tenant_id=$1 AND l.owner_id=$2 AND l.source_id=$3 AND l.source_version=$4 AND l.state='pending'`,
    [...scopeValues(scope), input.source_id, version],
  );
  for (const link of pending.rows) {
    const state = await linkState(client, scope, link.document, link.selector);
    await client.query(`UPDATE evidence_links SET state=$7 WHERE tenant_id=$1 AND owner_id=$2
      AND external_source_id=$3 AND external_version=$4 AND source_id=$5 AND source_version=$6`,
    [...scopeValues(scope), link.external_source_id, link.external_version, input.source_id, version, state]);
  }
}

export async function writeSync(
  database: Pool, auth: Credential, key: string, input: SourceDocument, fault?: Fault,
): Promise<Receipt> {
  const requestHash = fingerprint(input);
  let committed = false;
  const receipt = await transaction(database, async (client) => {
    const grant = await authorize(client, auth, "source.write", true);
    const descriptor = verifySourceGrant(grant, input);
    await lockOwner(client, grant);
    const prior = await lookupRetry(client, grant, key, requestHash);
    if (prior) return prior;
    const current = await head(client, grant, input.source_id);
    if (current) {
      checkScope(grant, current);
      if (current.group_id !== input.source_group_id || current.kind !== "user_input" || current.entity_id !== descriptor.entity_id) {
        throw new ApiError(409, "SOURCE_REVISION_CONFLICT", "The source identity is already bound.");
      }
      const old = (await client.query<Revision>(`SELECT operation_id, request_hash, document FROM source_revisions
        WHERE tenant_id=$1 AND owner_id=$2 AND source_id=$3 AND caller_revision_key=$4`,
      [...scopeValues(grant), input.source_id, input.caller_revision_key])).rows[0];
      if (old) {
        if (old.request_hash !== requestHash) throw new ApiError(409, "SOURCE_REVISION_CONFLICT", "The caller revision is already bound.");
        const result = await operation(client, grant, old.operation_id);
        await bindRetry(client, grant, key, requestHash, old.operation_id);
        return visibleReceipt(result, grant);
      }
    }

    const previous = Number(current?.head_version ?? 0);
    if (input.expected_source_version !== previous) {
      throw new ApiError(409, "VERSION_CONFLICT", "The source version has changed.", false,
        current ? { current_version: previous } : undefined);
    }
    const version = previous + 1;
    const id = randomUUID();
    const applied = await appliedReceipt(client, id, input.source_id, version, false);
    await insertOperation(client, grant, descriptor, applied);
    await writeRevision(client, grant, input, version, requestHash, id);
    await bindRetry(client, grant, key, requestHash, id);
    await resolvePendingLinks(client, grant, input, version);
    fault?.("beforeSyncCommit");
    committed = true;
    return applied;
  });
  if (committed) fault?.("afterSyncCommit");
  return receipt;
}

export async function observeOperation(database: Pool, auth: Credential, id: string) {
  return transaction(database, async (client) => {
    const grant = await authorize(client, auth, "operation.read");
    const row = await operation(client, grant, id);
    const result = visibleReceipt(row, grant);
    const expiresAt = new Date(row.created_at.getTime() + 30 * 24 * 60 * 60 * 1_000);
    if (expiresAt.getTime() <= Date.now()) throw new ApiError(410, "OPERATION_EXPIRED", "The operation is no longer retained for query.");
    return {
      ...result,
      revision: Number(row.revision), operation_kind: row.stream_id ? "ordered_import" : "source_upsert",
      stages: { canonical: row.result.status }, expires_at: expiresAt.toISOString(),
    };
  }, true);
}
