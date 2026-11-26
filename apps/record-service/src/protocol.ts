import { createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { z } from "zod";

export class RecordError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const invalid = () => new RecordError(400, "INVALID_ARGUMENT", "Invalid record request.");
export const notFound = () => new RecordError(404, "NOT_FOUND_OR_NOT_VISIBLE", "Record or operation not found.");
export const keySchema = z.string().max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

const occurredAt = z.string().refine(value => {
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(value) || !Number.isFinite(Date.parse(value))) return false;
  const localDay = value.slice(0, 10);
  const date = new Date(localDay + "T00:00:00Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === localDay
    && Number(value.slice(11, 13)) < 24;
});
const timezone = z.string().max(64).refine(value => {
  if (!value || /^[+-]/.test(value)) return false;
  try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; }
});
const operation = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("pending_input"), raw_input: z.string().max(16_384)
    .refine(text => !!text.trim() && text.isWellFormed() && !text.includes("\u0000")) }).strict(),
  z.object({ kind: z.literal("confirmed_drink"), amount: z.string().max(32)
    .regex(/^(?:0|[1-9]\d*)(?:\.\d{1,3})?$/).refine(value => Number(value) > 0 && Number(value) <= 10_000_000),
  unit: z.literal("ml"), occurred_at: occurredAt, timezone }).strict(),
]);
export type RecordInput = z.infer<typeof operation>;

export function parseOperation(input: unknown): RecordInput {
  const result = operation.safeParse(input);
  if (!result.success) throw invalid();
  return result.data;
}

export function parseKey(value: unknown): string {
  const result = keySchema.safeParse(value);
  if (!result.success) throw invalid();
  return result.data;
}

export function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value, (_name, node: unknown) => {
    if (!node || typeof node !== "object" || Array.isArray(node)) return node;
    const fields = node as Record<string, unknown>;
    return Object.fromEntries(Object.keys(fields).sort().map(key => [key, fields[key]]));
  })).digest("hex");
}

export async function readJson(request: IncomingMessage): Promise<unknown> {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers["content-type"] ?? "")) throw invalid();
  const limit = 65_536;
  const chunks: Buffer[] = [];
  let length = 0;
  // Do not close the socket before the HTTP layer can send the error and drain the request.
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += bytes.length;
    if (length > limit) throw new RecordError(413, "PAYLOAD_TOO_LARGE", "Record request exceeds the byte limit.");
    chunks.push(bytes);
  }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { throw invalid(); }
}
