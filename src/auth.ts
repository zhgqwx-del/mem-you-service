import type { IncomingHttpHeaders } from "node:http";
import type { PoolClient } from "pg";
import { ApiError, hash, invalid, missing } from "./protocol.ts";

export type Credential = { tokenHash: string; epoch?: number };
export type Grant = {
  tenant_id: string;
  owner_id: string;
  grant_id: string;
  agent_id: string;
  caller_type: "trusted_adapter" | "trusted_importer" | "model_tool";
  policy_epoch: string;
  revoked: boolean;
  expired: boolean;
  actions: string[];
  entities: string[];
  domains: string[];
  streams: string[];
};
export type Scope = { tenant_id: string; owner_id: string };
export type Descriptor = { entity_id: string; domains: string[]; stream_id?: string | null };

export function credential(headers: IncomingHttpHeaders): Credential {
  const bearer = typeof headers.authorization === "string" && /^Bearer ([^\s,]{1,2048})$/i.exec(headers.authorization);
  if (!bearer) throw new ApiError(401, "UNAUTHENTICATED", "A valid service credential is required.");
  const expected = headers["x-expected-policy-epoch"];
  if (expected !== undefined && (typeof expected !== "string" || !/^\d+$/.test(expected)
    || !Number.isSafeInteger(Number(expected)))) throw invalid("Invalid expected policy epoch.");
  return { tokenHash: hash(bearer[1]!), ...(expected === undefined ? {} : { epoch: Number(expected) }) };
}

export const scopeValues = (scope: Scope): [string, string] => [scope.tenant_id, scope.owner_id];
const grantQuery = "SELECT *, COALESCE(expires_at <= clock_timestamp(), false) AS expired FROM grants";

export function assertGrant(grant: Grant | undefined, epoch: number | undefined, action: string): Grant {
  if (!grant || grant.expired) throw new ApiError(401, "UNAUTHENTICATED", "A valid service credential is required.");
  if (grant.revoked) throw new ApiError(403, "GRANT_REVOKED", "The grant was revoked.");
  if (epoch !== undefined && Number(grant.policy_epoch) !== epoch) {
    throw new ApiError(409, "POLICY_EPOCH_STALE", "The authorization policy has changed.");
  }
  if (!grant.actions.includes(action) || grant.caller_type === "model_tool") {
    throw new ApiError(403, "ACTION_NOT_ALLOWED", "This caller is not allowed to perform the action.");
  }
  return grant;
}

export async function authorize(client: PoolClient, auth: Credential, action: string, lock = false): Promise<Grant> {
  const { rows } = await client.query<Grant>(grantQuery + " WHERE token_hash = $1" + (lock ? " FOR SHARE" : ""), [auth.tokenHash]);
  return assertGrant(rows[0], auth.epoch, action);
}

export async function authorizeStored(client: PoolClient, scope: Scope, grantId: string, epoch: string): Promise<Grant> {
  const { rows } = await client.query<Grant>(grantQuery + " WHERE tenant_id=$1 AND owner_id=$2 AND grant_id=$3 FOR SHARE",
    [...scopeValues(scope), grantId]);
  return assertGrant(rows[0], Number(epoch), "source.write");
}

export function canSee(grant: Grant, descriptor: Descriptor): boolean {
  return grant.entities.includes(descriptor.entity_id)
    && descriptor.domains.every((domain) => grant.domains.includes(domain))
    && (!descriptor.stream_id || grant.streams.includes(descriptor.stream_id));
}

export function checkScope(grant: Grant, descriptor: Descriptor): void {
  if (!canSee(grant, descriptor)) throw missing();
}

export async function lockOwner(client: PoolClient, scope: Scope): Promise<void> {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [JSON.stringify(scopeValues(scope))]);
}
