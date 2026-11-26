import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { authorize, authorizeStored, lockOwner, scopeValues, type Credential, type Scope } from "./auth.ts";
import { transaction } from "./db.ts";
import { ApiError, fingerprint, missing, unsupported, type SourceDocument } from "./protocol.ts";
import {
  appliedReceipt, bindRetry, checkExternalLinks, head, insertOperation, lookupRetry, operation,
  saveExternalLinks, verifySourceGrant, visibleReceipt, writeRevision, type Fault, type Receipt,
} from "./sources.ts";

type Stream = Scope & {
  stream_id: string; system_id: string; health: string; applied_through_seq: string; highest_received_seq: string;
};
type Inbox = {
  stream_seq: string; event_id: string; request_hash: string; operation_id: string; grant_id: string;
  policy_epoch: string; document: SourceDocument;
};
type Binding = {
  external_version: string; snapshot_hash: string; source_id: string; source_version: string; stream_id: string;
};

const streamBlocked = () => new ApiError(503, "IMPORT_STREAM_BLOCKED", "The registered import stream is quarantined.");
const eventConflict = () => new ApiError(409, "IMPORT_EVENT_CONFLICT", "The event conflicts with its registered import identity.");

async function registeredStream(client: PoolClient, scope: Scope, streamId: string): Promise<Stream | undefined> {
  return (await client.query<Stream>(
    "SELECT * FROM external_streams WHERE tenant_id=$1 AND owner_id=$2 AND stream_id=$3",
    [...scopeValues(scope), streamId],
  )).rows[0];
}

async function boundRecord(client: PoolClient, scope: Scope, external: NonNullable<SourceDocument["external_record_ref"]>) {
  return (await client.query<Binding>(`SELECT * FROM external_bindings
    WHERE tenant_id=$1 AND owner_id=$2 AND system_id=$3 AND record_id=$4`,
  [...scopeValues(scope), external.system_id, external.record_id])).rows[0];
}

function snapshotHash(input: SourceDocument): string {
  const { upstream_change: _event, source_attestation: _proof, ...snapshot } = input;
  return fingerprint(snapshot);
}

async function quarantine(client: PoolClient, stream: Stream, event: NonNullable<SourceDocument["upstream_change"]>, code: string, digest: string) {
  await client.query(`UPDATE external_streams SET health='quarantined', conflict=COALESCE(conflict,$4::jsonb)
    WHERE tenant_id=$1 AND owner_id=$2 AND stream_id=$3`,
  [...scopeValues(stream), stream.stream_id, { event_id: event.event_id, stream_seq: event.stream_seq, code, digest }]);
}

export async function receiveExternal(
  database: Pool, auth: Credential, key: string, input: SourceDocument, fault?: Fault,
): Promise<Receipt> {
  const event = input.upstream_change!;
  const external = input.external_record_ref!;
  const requestHash = fingerprint(input);
  let accepted = false;
  const receipt = await transaction(database, async (client) => {
    const grant = await authorize(client, auth, "source.write", true);
    const descriptor = verifySourceGrant(grant, input);
    await lockOwner(client, grant);
    const stream = await registeredStream(client, grant, event.stream_id);
    if (!stream || stream.system_id !== external.system_id) throw missing();

    const prior = await lookupRetry(client, grant, key, requestHash);
    if (prior) return prior;
    const existing = (await client.query<Inbox>(`SELECT * FROM inbox WHERE tenant_id=$1 AND owner_id=$2 AND stream_id=$3
      AND (event_id=$4 OR stream_seq=$5)`,
    [...scopeValues(grant), event.stream_id, event.event_id, event.stream_seq])).rows[0];
    if (existing) {
      if (existing.event_id !== event.event_id || Number(existing.stream_seq) !== event.stream_seq
        || existing.request_hash !== requestHash) {
        await quarantine(client, stream, event, "IMPORT_EVENT_CONFLICT", requestHash);
        return eventConflict();
      }
      const old = await operation(client, grant, existing.operation_id);
      await bindRetry(client, grant, key, requestHash, old.operation_id);
      return visibleReceipt(old, grant);
    }
    if (stream.health === "quarantined") throw streamBlocked();
    if (event.stream_seq <= Number(stream.applied_through_seq)) {
      await quarantine(client, stream, event, "IMPORT_EVENT_CONFLICT", requestHash);
      return eventConflict();
    }
    const binding = await boundRecord(client, grant, external);
    if (binding) {
      if (binding.stream_id !== event.stream_id || binding.source_id !== input.source_id
        || (binding.external_version === external.external_version && binding.snapshot_hash !== snapshotHash(input))) {
        await quarantine(client, stream, event, "IMPORT_EVENT_CONFLICT", requestHash);
        return eventConflict();
      }
      if (binding.external_version !== external.external_version) throw unsupported();
    }
    await checkExternalLinks(client, grant, input);

    const id = randomUUID();
    const result: Receipt = { operation_id: id, status: "accepted",
      retry: { safe_action: "poll", retry_after_ms: 100 },
      ...(event.stream_seq > Number(stream.applied_through_seq) + 1 ? { waiting_for_predecessor: true } : {}),
    };
    await insertOperation(client, grant, descriptor, result);
    const { source_attestation: _proof, ...stored } = input;
    await client.query(`INSERT INTO inbox (tenant_id,owner_id,stream_id,stream_seq,event_id,request_hash,operation_id,grant_id,policy_epoch,document)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [...scopeValues(grant), event.stream_id, event.stream_seq, event.event_id,
      requestHash, id, grant.grant_id, grant.policy_epoch, stored]);
    await bindRetry(client, grant, key, requestHash, id);
    await client.query(`UPDATE external_streams SET highest_received_seq=GREATEST(highest_received_seq,$4),
      health=CASE WHEN $4 > applied_through_seq+1 THEN 'gap' ELSE health END
      WHERE tenant_id=$1 AND owner_id=$2 AND stream_id=$3`, [...scopeValues(grant), event.stream_id, event.stream_seq]);
    accepted = true;
    return result;
  });
  if (receipt instanceof ApiError) throw receipt;
  if (accepted) fault?.("afterReceiveCommit");
  return receipt;
}

async function applySource(client: PoolClient, stream: Stream, entry: Inbox): Promise<Receipt> {
  const input = entry.document;
  const external = input.external_record_ref!;
  const grant = await authorizeStored(client, stream, entry.grant_id, entry.policy_epoch);
  verifySourceGrant(grant, input);
  if (external.system_id !== stream.system_id) throw eventConflict();
  const binding = await boundRecord(client, stream, external);
  if (binding) {
    if (binding.stream_id !== stream.stream_id || binding.source_id !== input.source_id) throw eventConflict();
    if (binding.external_version !== external.external_version) throw unsupported();
    if (binding.snapshot_hash !== snapshotHash(input)) throw eventConflict();
    const prior = (await client.query<{ generation: string }>(
      `SELECT o.result->>'visibility_generation' AS generation FROM source_revisions r
        JOIN operations o ON o.operation_id=r.operation_id
        WHERE r.tenant_id=$1 AND r.owner_id=$2 AND r.source_id=$3 AND r.version=$4`,
      [...scopeValues(stream), binding.source_id, binding.source_version],
    )).rows[0];
    if (!prior) throw new Error("The imported source version lost its operation receipt");
    return appliedReceipt(client, entry.operation_id, binding.source_id, Number(binding.source_version), true, Number(prior.generation));
  }
  if (await head(client, stream, input.source_id)) throw eventConflict();
  const result = await appliedReceipt(client, entry.operation_id, input.source_id, 1, true);
  await writeRevision(client, stream, input, 1, entry.request_hash, entry.operation_id);
  await client.query(`INSERT INTO external_bindings
    (tenant_id,owner_id,system_id,record_id,stream_id,external_version,snapshot_hash,source_id,source_version)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,1)`, [...scopeValues(stream), external.system_id, external.record_id,
    stream.stream_id, external.external_version, snapshotHash(input), input.source_id]);
  await saveExternalLinks(client, stream, input, 1);
  return result;
}

export async function applyNext(database: Pool, fault?: Fault): Promise<boolean> {
  const applied = await transaction(database, async (client) => {
    const next = (await client.query<Stream>(`SELECT s.* FROM external_streams s WHERE health <> 'quarantined'
      AND EXISTS (SELECT 1 FROM inbox i WHERE i.tenant_id=s.tenant_id AND i.owner_id=s.owner_id
        AND i.stream_id=s.stream_id AND i.stream_seq=s.applied_through_seq+1)
      ORDER BY s.tenant_id,s.owner_id,s.stream_id LIMIT 1`)).rows[0];
    if (!next) return false;
    await lockOwner(client, next);
    const stream = await registeredStream(client, next, next.stream_id);
    if (!stream || stream.health === "quarantined") return false;
    const entry = (await client.query<Inbox>(`SELECT * FROM inbox WHERE tenant_id=$1 AND owner_id=$2 AND stream_id=$3
      AND stream_seq=$4::bigint+1`, [...scopeValues(stream), stream.stream_id, stream.applied_through_seq])).rows[0];
    if (!entry) return false;

    await client.query("SAVEPOINT source_apply");
    let receipt: Receipt;
    try {
      receipt = await applySource(client, stream, entry);
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      await client.query("ROLLBACK TO SAVEPOINT source_apply");
      await quarantine(client, stream, entry.document.upstream_change!, error.code, entry.request_hash);
      await client.query("UPDATE operations SET result=$2,revision=revision+1 WHERE operation_id=$1",
        [entry.operation_id, { operation_id: entry.operation_id, status: "failed", error: { code: error.code, retryable: false } }]);
      return false;
    }
    await client.query(`UPDATE operations SET result=$2,revision=revision+1,write_token=$3,applied_at=clock_timestamp()
      WHERE operation_id=$1`, [entry.operation_id, receipt, receipt.write_token]);
    await client.query(`UPDATE external_streams SET applied_through_seq=$4,
      health=CASE WHEN highest_received_seq > $4 AND NOT EXISTS
        (SELECT 1 FROM inbox i WHERE i.tenant_id=$1 AND i.owner_id=$2 AND i.stream_id=$3 AND i.stream_seq=$4::bigint+1)
        THEN 'gap' ELSE 'healthy' END WHERE tenant_id=$1 AND owner_id=$2 AND stream_id=$3`,
    [...scopeValues(stream), stream.stream_id, entry.stream_seq]);
    fault?.("beforeApplyCommit");
    return true;
  });
  if (applied) fault?.("afterApplyCommit");
  return applied;
}
