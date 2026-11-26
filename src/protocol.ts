import { createHash } from "node:crypto";
import { z } from "zod";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryable: boolean;
  readonly details?: Record<string, unknown>;

  constructor(status: number, code: string, message: string, retryable = false, details?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryable = retryable;
    this.details = details;
  }
}

export const missing = () => new ApiError(404, "NOT_FOUND_OR_NOT_VISIBLE", "Resource not found or not visible.");
export const unsupported = () => new ApiError(422, "UNSUPPORTED_CAPABILITY", "This capability is disabled in this deployment.");
export const invalid = (message: string) => new ApiError(400, "INVALID_ARGUMENT", message);
export const tooLarge = () => new ApiError(413, "PAYLOAD_TOO_LARGE", "The request exceeds its byte limit.");
const invalidValue = () => new ApiError(422, "SCHEMA_VALUE_INVALID", "Source values do not match the registered schema.");

export function hash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function fingerprint(value: unknown): string {
  return hash(JSON.stringify(value, (_key, item: unknown) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return item;
    const fields = item as Record<string, unknown>;
    return Object.fromEntries(Object.keys(fields).sort().map((key) => [key, fields[key]]));
  }));
}

export const id = z.string().max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const positive = z.number().int().safe().positive();
const cas = z.number().int().safe().nonnegative();
const isoDay = /^\d{4}-\d{2}-\d{2}$/;
const instant = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
const offsetTimestamp = (value: string) => instant.test(value) && validDay(value.slice(0, 10)) && Number.isFinite(Date.parse(value));

function validDay(value: string): boolean {
  if (!isoDay.test(value)) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

function validateTimezone(zone: string) {
  if (Buffer.byteLength(zone) > 64) throw invalidValue();
  try {
    // A bare numeric offset is not an IANA zone.
    if (/^[+-]/.test(zone)) throw new RangeError();
    new Intl.DateTimeFormat("en", { timeZone: zone });
  } catch {
    throw new ApiError(422, "UNSUPPORTED_TIMEZONE", "Expected an IANA timezone.");
  }
}

const sourceRef = z.object({ source_id: id, source_version: positive }).strict();
const selector = sourceRef.extend({
  span: z.object({ start: cas, end: positive }).strict().optional(),
  field_paths: z.array(z.string().min(1).max(128)).min(1).max(16).optional(),
}).strict();
const origin = z.object({
  source_system_id: id, conversation_id: id, item_id: id, origin_revision: positive,
}).strict();
const occurred = z.object({
  occurred_from: z.string().optional(), occurred_to: z.string().optional(),
  time_precision: z.enum(["unknown", "day", "minute", "second", "interval"]),
  timezone: z.string().min(1), original_expression: z.string().optional(),
  anchor_at: z.string().optional(),
  basis: z.enum(["user_explicit", "client_selected", "external_record", "relative_resolved", "inferred"]).optional(),
}).strict();
const structured = z.object({
  schema_id: id, schema_version: positive,
  data: z.object({ value: z.string(), unit: z.string(), beverage_kind: z.string() }).strict(),
}).strict();
const document = z.object({
  source_id: id, source_group_id: id, about_entity_id: id.nullable(),
  source_kind: z.enum(["user_input", "external_record", "agent_note"]),
  mode: z.enum(["sync", "ordered_import"]).default("sync"),
  expected_source_version: cas.optional(), caller_revision_key: id.optional(),
  origin_ref: origin.optional(),
  lifecycle: z.enum(["active", "retracted"]).default("active"),
  revision_intent: z.enum(["replace", "authoritative_reconcile"]).optional(),
  authority_kind: z.enum(["user_reported", "external_committed", "agent_inferred"]),
  domains: z.array(id).min(1).max(8),
  content: z.object({ text: z.string().min(1).optional(), structured: structured.optional() }).strict().optional(),
  recorded_at: z.string().optional(), timezone: z.string().min(1), occurred: occurred.optional(),
  external_record_ref: z.object({ system_id: id, record_id: id, external_version: z.string().min(1) }).strict().optional(),
  upstream_change: z.object({ stream_id: id, stream_seq: positive, event_id: id }).strict().optional(),
  input_evidence_refs: z.array(selector).max(8).optional(),
  input_origin_binding: z.object({ origin_ref: origin, source_id: id }).strict().optional(),
  source_attestation: z.string().min(1).optional(),
}).strict();
export type SourceDocument = z.infer<typeof document>;
export type InputSelector = z.infer<typeof selector>;

function decode<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, payload: unknown): T {
  const result = schema.safeParse(payload);
  if (result.success) return result.data;
  if (result.error.issues.some((issue) => issue.code === "unrecognized_keys")) {
    throw new ApiError(400, "UNKNOWN_FIELD", "The request contains an unknown field.");
  }
  throw invalid("The request does not match the HTTP contract.");
}

function unique(values: string[]) {
  if (new Set(values).size !== values.length) throw invalid("Duplicate identifiers are not allowed.");
}

function validateOccurred(value: NonNullable<SourceDocument["occurred"]>) {
  validateTimezone(value.timezone);
  const from = value.occurred_from, to = value.occurred_to;
  if (value.original_expression && Buffer.byteLength(value.original_expression) > 512) throw invalidValue();
  if (value.anchor_at !== undefined && !offsetTimestamp(value.anchor_at)) throw invalidValue();
  if (value.time_precision === "unknown") {
    if (from !== undefined || to !== undefined) throw invalidValue();
    return;
  }
  if (value.time_precision === "day") {
    if (!from || !validDay(from) || to) throw invalidValue();
    return;
  }
  if (value.time_precision !== "interval" && (!from || to)) throw invalidValue();
  if (!from && !to) throw invalidValue();
  if ((from !== undefined && !offsetTimestamp(from)) || (to !== undefined && !offsetTimestamp(to))) throw invalidValue();
  if (from && to && Date.parse(from) >= Date.parse(to)) throw invalidValue();
}

export function idempotencyKey(value: string | undefined): string {
  if (value === undefined) throw new ApiError(400, "IDEMPOTENCY_KEY_REQUIRED", "Supply Idempotency-Key.");
  return decode(id, value);
}

export function parseSource(payload: unknown): SourceDocument {
  const input: SourceDocument = decode(document, payload);
  unique(input.domains);
  validateTimezone(input.timezone);
  if (input.recorded_at !== undefined && !offsetTimestamp(input.recorded_at)) throw invalidValue();
  if (input.occurred) validateOccurred(input.occurred);
  if (input.external_record_ref && Buffer.byteLength(input.external_record_ref.external_version) > 128) throw invalidValue();
  if (input.source_attestation && Buffer.byteLength(input.source_attestation) > 2_048) throw invalidValue();
  const refs = input.input_evidence_refs ?? [];
  unique(refs.map((ref) => JSON.stringify([ref.source_id, ref.source_version])));
  for (const ref of refs) {
    if ((ref.span && ref.field_paths) || (ref.span && ref.span.start >= ref.span.end)) {
      throw new ApiError(422, "INVALID_EVIDENCE_RELATION", "Invalid input evidence selector.");
    }
    if (ref.field_paths) unique(ref.field_paths);
  }
  if (input.mode === "sync") {
    if (input.source_kind === "external_record") throw unsupported();
    if (input.expected_source_version === undefined || !input.caller_revision_key
      || input.upstream_change || input.external_record_ref || input.input_evidence_refs) {
      throw invalid("Sync requires a source CAS and caller revision key.");
    }
  } else if (input.source_kind !== "external_record" || !input.upstream_change || !input.external_record_ref
    || input.expected_source_version !== undefined || input.caller_revision_key) {
    throw invalid("Ordered import requires an external record and registered event identity.");
  }
  if (input.source_kind === "agent_note" || input.origin_ref || input.input_origin_binding
    || input.lifecycle !== "active" || input.revision_intent === "authoritative_reconcile") throw unsupported();

  const content = input.content;
  if (!content || (!content.text && !content.structured)) throw invalidValue();
  const size = Buffer.byteLength(content.text ?? "") + (content.structured ? Buffer.byteLength(JSON.stringify(content.structured)) : 0);
  if (size > 16_384) throw tooLarge();
  if (content.structured) {
    const schema = content.structured;
    const { value, unit, beverage_kind } = schema.data;
    if (schema.schema_id !== "hydration.beverage" || schema.schema_version !== 1
      || !/^\d+(?:\.\d{1,3})?$/.test(value) || value.length > 32 || Number(value) <= 0
      || Number(value) > 10_000_000 || unit !== "ml" || !["water", "coffee", "tea", "milk", "other"].includes(beverage_kind)) {
      throw invalidValue();
    }
  }
  return input;
}

const evidence = z.object({
  refs: z.array(z.object({ kind: z.enum(["source", "memory"]), id, version: positive.optional() }).strict()).min(1).max(32),
  projection: z.enum(["structured", "safe_excerpt", "raw"]).default("safe_excerpt"),
  purpose: z.enum(["respond_to_record", "answer_history", "resolve_reference", "assist_correction"]).default("respond_to_record"),
  include_historical_assertions: z.boolean().optional(),
  consumer_context: z.object({ consumer_id: id, session_id: id, turn_id: id }).strict().optional(),
  read_after: z.object({
    write_token: z.string().min(1).max(2048).optional(),
    external_barriers: z.array(z.object({ stream_id: id, through_seq: positive }).strict()).max(8).optional(),
    required_sources: z.array(sourceRef).max(32).optional(),
  }).strict().optional(),
  deadline_ms: z.number().int().min(100).max(3000).default(1800),
}).strict();
export type EvidenceRequest = z.infer<typeof evidence>;

export function parseEvidence(payload: unknown): EvidenceRequest {
  const value: EvidenceRequest = decode(evidence, payload);
  unique(value.refs.map((ref) => JSON.stringify([ref.kind, ref.id, ref.version])));
  unique((value.read_after?.external_barriers ?? []).map(({ stream_id }) => stream_id));
  unique((value.read_after?.required_sources ?? []).map(({ source_id }) => source_id));
  if (value.refs.some((ref) => ref.kind !== "source") || value.include_historical_assertions || value.consumer_context) throw unsupported();
  return value;
}
