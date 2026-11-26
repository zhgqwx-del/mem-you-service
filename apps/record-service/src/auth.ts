import { createPublicKey } from "node:crypto";
import type { KeyObject } from "node:crypto";
import type { PoolClient } from "pg";
import { jwtVerify } from "jose";
import { z } from "zod";
import { keySchema, notFound, RecordError } from "./protocol.ts";

const denied = () => new RecordError(403, "ACCOUNT_NOT_ALLOWED", "This account is not allowed to access records.");
const unauthenticated = () => new RecordError(401, "UNAUTHENTICATED", "A valid user access token is required.");
const trustedConfig = z.object({
  issuer: z.string().min(1), audience: z.string().min(1),
  keys: z.array(z.object({
    kid: keySchema, kty: z.literal("RSA"), n: z.string().regex(/^[A-Za-z0-9_-]+$/),
    e: z.string().regex(/^[A-Za-z0-9_-]+$/), use: z.literal("sig").optional(), alg: z.literal("RS256").optional(),
  }).strict()).min(1),
}).strict();

export type Identity = { issuer: string; subject: string };
export type Scope = { tenant_id: string; owner_id: string; self_subject_id: string };
type Account = Scope & { active: boolean };
type ScopedObject = { tenant_id: string; owner_id: string; subject_id: string; domain: string };

export function createVerifier(input: unknown) {
  const { issuer, audience, keys } = trustedConfig.parse(input);
  const publicKeys = new Map<string, KeyObject>();
  for (const { kid, kty, n, e } of keys) {
    const key = createPublicKey({ format: "jwk", key: { kty, n, e } });
    if (publicKeys.has(kid) || (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) {
      throw new Error("Invalid or duplicate RecordService verification key");
    }
    publicKeys.set(kid, key);
  }
  return async (authorization: string | undefined): Promise<Identity> => {
    const bearer = /^Bearer ([A-Za-z0-9_.-]{1,8192})$/i.exec(authorization ?? "");
    if (!bearer?.[1]) throw unauthenticated();
    try {
      const { payload } = await jwtVerify(bearer[1], header => {
        const key = typeof header.kid === "string" && publicKeys.get(header.kid);
        if (!key || ["jku", "jwk", "x5u", "x5c"].some(name => Object.hasOwn(header, name))) throw unauthenticated();
        return key;
      }, { issuer, audience, algorithms: ["RS256"], requiredClaims: ["iss", "aud", "sub", "exp"] });
      if (typeof payload.sub !== "string" || !payload.sub.trim() || !payload.sub.isWellFormed()
        || payload.sub.includes("\u0000") || Buffer.byteLength(payload.sub) > 512) throw unauthenticated();
      return { issuer, subject: payload.sub };
    } catch { throw unauthenticated(); }
  };
}

export function accountScope(accounts: readonly Account[]): Scope {
  const [account] = accounts;
  if (accounts.length !== 1 || !account?.active) throw denied();
  return { tenant_id: account.tenant_id, owner_id: account.owner_id, self_subject_id: account.self_subject_id };
}

export async function currentScope(client: PoolClient, identity: Identity): Promise<Scope> {
  const { rows } = await client.query<Account>(`SELECT tenant_id, owner_id, self_subject_id, active
    FROM accounts WHERE identity_issuer=$1 AND identity_subject=$2`, [identity.issuer, identity.subject]);
  return accountScope(rows);
}

export function authorizeObject<T extends ScopedObject>(scope: Scope, row: T | undefined): T {
  if (!row || row.tenant_id !== scope.tenant_id || row.owner_id !== scope.owner_id
    || row.subject_id !== scope.self_subject_id || row.domain !== "hydration") throw notFound();
  return row;
}

export const scopeValues = (scope: Scope) => [scope.tenant_id, scope.owner_id, scope.self_subject_id];
