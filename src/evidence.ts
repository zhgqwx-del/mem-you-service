import { setTimeout as delay } from "node:timers/promises";
import type { Pool, PoolClient } from "pg";
import { authorize, canSee, scopeValues, type Credential, type Descriptor, type Grant } from "./auth.ts";
import { transaction } from "./db.ts";
import { ApiError, missing, type EvidenceRequest } from "./protocol.ts";
import type { StoredSource } from "./sources.ts";

type Current = Descriptor & { head_version: string; document: StoredSource };

async function visibleSource(client: PoolClient, grant: Grant, sourceId: string): Promise<Current | undefined> {
  const row = (await client.query<Current>(
    `SELECT s.entity_id,s.domains,s.head_version,b.stream_id,r.document FROM sources s
      JOIN source_revisions r ON r.tenant_id=s.tenant_id AND r.owner_id=s.owner_id AND r.source_id=s.source_id AND r.version=s.head_version
      LEFT JOIN external_bindings b ON b.tenant_id=s.tenant_id AND b.owner_id=s.owner_id AND b.source_id=s.source_id
      WHERE s.tenant_id=$1 AND s.owner_id=$2 AND s.source_id=$3`,
    [...scopeValues(grant), sourceId],
  )).rows[0];
  return row && canSee(grant, row) ? row : undefined;
}

async function ready(client: PoolClient, grant: Grant, request: EvidenceRequest): Promise<boolean> {
  const after = request.read_after;
  if (!after) return true;
  if (after.write_token) {
    const receipt = (await client.query<Descriptor & { expired: boolean; grant_id: string }>(
      `SELECT entity_id,domains,stream_id,grant_id,applied_at + interval '30 days' <= clock_timestamp() AS expired
        FROM operations WHERE tenant_id=$1 AND owner_id=$2 AND write_token=$3`,
      [...scopeValues(grant), after.write_token],
    )).rows[0];
    if (!receipt || receipt.grant_id !== grant.grant_id || !canSee(grant, receipt)) throw missing();
    if (receipt.expired) throw new ApiError(410, "WRITE_TOKEN_EXPIRED", "The write token is expired.");
  }
  let satisfied = true;
  for (const barrier of after.external_barriers ?? []) {
    if (!grant.streams.includes(barrier.stream_id)) throw missing();
    const stream = (await client.query<{ applied_through_seq: string; health: string }>(
      "SELECT applied_through_seq,health FROM external_streams WHERE tenant_id=$1 AND owner_id=$2 AND stream_id=$3",
      [...scopeValues(grant), barrier.stream_id],
    )).rows[0];
    if (!stream) throw missing();
    if (Number(stream.applied_through_seq) < barrier.through_seq) {
      if (stream.health === "quarantined") {
        throw new ApiError(503, "FRESHNESS_UNAVAILABLE", "The required source stream is unavailable.");
      }
      satisfied = false;
    }
  }
  for (const required of after.required_sources ?? []) {
    const source = await visibleSource(client, grant, required.source_id);
    if (!source || Number(source.head_version) < required.source_version) satisfied = false;
  }
  return satisfied;
}

async function project(client: PoolClient, grant: Grant, request: EvidenceRequest) {
  const results: Array<Record<string, unknown>> = [];
  for (const ref of request.refs) {
    const current = await visibleSource(client, grant, ref.id);
    if (!current) {
      results.push({ ref, status: "NOT_FOUND_OR_NOT_VISIBLE" });
      continue;
    }
    const version = Number(current.head_version);
    if (ref.version !== undefined && ref.version !== version) {
      results.push({ ref, status: "STALE_REFERENCE", current_ref: { kind: "source", id: ref.id, version } });
      continue;
    }
    // This slice only exposes projections from fields registered and confirmed for this domain.
    const structured = current.document.content?.structured;
    if (request.projection === "raw" || !structured) {
      results.push({ ref, status: "PROJECTION_NOT_ALLOWED" });
      continue;
    }
    const content = request.projection === "structured" ? { structured }
      : { text: `${structured.data.value} ml (${structured.data.beverage_kind})` };
    results.push({
      ref: { kind: "source", id: ref.id, version }, status: "ok", content,
      authority_kind: current.document.authority_kind, truncated: false,
      ...(current.document.occurred ? { occurred: current.document.occurred } : {}),
      recorded_at: current.document.recorded_at, recorded_at_basis: current.document.recorded_at_basis,
    });
  }
  return { results, tracking_status: "uncontrolled", freshness: { read_after_satisfied: true } };
}

export async function readEvidence(database: Pool, auth: Credential, request: EvidenceRequest) {
  const deadline = performance.now() + request.deadline_ms;
  do {
    const result = await transaction(database, async (client) => {
      const grant = await authorize(client, auth, "evidence.read");
      if (!(await ready(client, grant, request))) return undefined;
      return project(client, grant, request);
    }, true);
    if (result) return result;
    const remaining = deadline - performance.now();
    if (remaining <= 0) break;
    await delay(Math.min(remaining, 20));
  } while (performance.now() < deadline);
  throw new ApiError(504, "FRESHNESS_TIMEOUT", "The requested source state did not become available before the deadline.", true);
}
