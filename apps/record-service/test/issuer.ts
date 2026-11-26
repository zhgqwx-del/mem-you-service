import { generateKeyPairSync, sign } from "node:crypto";

export function issuer() {
  const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const config = {
    issuer: "https://diandi-test-issuer.invalid",
    audience: "diandi-record-service",
    keys: [{ ...keys.publicKey.export({ format: "jwk" }), kid: "local-test-key", alg: "RS256", use: "sig" }],
  };
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  function token(subject: string, claims = {}, header = {}, invalidSignature = false) {
    const now = Math.floor(Date.now() / 1000);
    const input = encode({ alg: "RS256", kid: "local-test-key", ...header }) + "." + encode({
      sub: subject, iss: config.issuer, aud: config.audience, exp: now + 120, ...claims,
    });
    return input + "." + sign("RSA-SHA256", Buffer.from(input), invalidSignature ? other.privateKey : keys.privateKey).toString("base64url");
  }
  return { config, token };
}

export const tenant = "fixture-tenant";
export const alice = { tenant_id: tenant, owner_id: "owner-a", self_subject_id: "person-a", active: true, subject: "login-a", stream: "records-a" };
export const bob = { tenant_id: tenant, owner_id: "owner-b", self_subject_id: "person-b", active: true, subject: "login-b", stream: "records-b" };
export const drink = {
  kind: "confirmed_drink", amount: "300", unit: "ml", occurred_at: "2026-11-24T14:30:00-08:00",
  timezone: "America/Los_Angeles",
};
