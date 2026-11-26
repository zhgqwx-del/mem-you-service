CREATE TABLE grants (
  token_hash text PRIMARY KEY,
  tenant_id text NOT NULL,
  owner_id text NOT NULL,
  grant_id text NOT NULL,
  agent_id text NOT NULL,
  caller_type text NOT NULL CHECK (caller_type IN ('trusted_adapter', 'trusted_importer', 'model_tool')),
  policy_epoch bigint NOT NULL CHECK (policy_epoch >= 0),
  revoked boolean NOT NULL DEFAULT false,
  expires_at timestamptz,
  actions text[] NOT NULL,
  entities text[] NOT NULL,
  domains text[] NOT NULL,
  streams text[] NOT NULL,
  UNIQUE (tenant_id, owner_id, grant_id)
);
CREATE SEQUENCE visibility_generation_seq;
CREATE TABLE operations (
  operation_id text PRIMARY KEY,
  tenant_id text NOT NULL,
  owner_id text NOT NULL,
  grant_id text NOT NULL,
  entity_id text NOT NULL,
  domains text[] NOT NULL,
  stream_id text,
  revision bigint NOT NULL DEFAULT 1,
  result jsonb NOT NULL,
  write_token text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  applied_at timestamptz
);
CREATE TABLE idempotency_keys (
  tenant_id text NOT NULL,
  owner_id text NOT NULL,
  grant_id text NOT NULL,
  request_key text NOT NULL,
  request_hash text NOT NULL,
  operation_id text NOT NULL REFERENCES operations,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, owner_id, grant_id, request_key)
);
CREATE TABLE sources (
  tenant_id text NOT NULL,
  owner_id text NOT NULL,
  source_id text NOT NULL,
  group_id text NOT NULL,
  entity_id text NOT NULL,
  domains text[] NOT NULL,
  kind text NOT NULL CHECK (kind IN ('user_input', 'external_record')),
  head_version bigint NOT NULL CHECK (head_version > 0),
  PRIMARY KEY (tenant_id, owner_id, source_id)
);
CREATE TABLE source_revisions (
  tenant_id text NOT NULL,
  owner_id text NOT NULL,
  source_id text NOT NULL,
  version bigint NOT NULL CHECK (version > 0),
  caller_revision_key text,
  request_hash text NOT NULL,
  operation_id text NOT NULL REFERENCES operations,
  document jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, owner_id, source_id, version),
  UNIQUE (tenant_id, owner_id, source_id, caller_revision_key),
  FOREIGN KEY (tenant_id, owner_id, source_id) REFERENCES sources
);
CREATE TABLE external_streams (
  tenant_id text NOT NULL,
  owner_id text NOT NULL,
  stream_id text NOT NULL,
  system_id text NOT NULL,
  applied_through_seq bigint NOT NULL CHECK (applied_through_seq >= 0),
  highest_received_seq bigint NOT NULL CHECK (highest_received_seq >= applied_through_seq),
  health text NOT NULL DEFAULT 'healthy' CHECK (health IN ('healthy', 'gap', 'quarantined')),
  conflict jsonb,
  PRIMARY KEY (tenant_id, owner_id, stream_id)
);
CREATE TABLE inbox (
  tenant_id text NOT NULL,
  owner_id text NOT NULL,
  stream_id text NOT NULL,
  stream_seq bigint NOT NULL CHECK (stream_seq > 0),
  event_id text NOT NULL,
  request_hash text NOT NULL,
  operation_id text NOT NULL UNIQUE REFERENCES operations,
  grant_id text NOT NULL,
  policy_epoch bigint NOT NULL,
  document jsonb NOT NULL,
  PRIMARY KEY (tenant_id, owner_id, stream_id, stream_seq),
  UNIQUE (tenant_id, owner_id, stream_id, event_id),
  FOREIGN KEY (tenant_id, owner_id, stream_id) REFERENCES external_streams
);
CREATE TABLE external_bindings (
  tenant_id text NOT NULL,
  owner_id text NOT NULL,
  system_id text NOT NULL,
  record_id text NOT NULL,
  stream_id text NOT NULL,
  external_version text NOT NULL,
  snapshot_hash text NOT NULL,
  source_id text NOT NULL,
  source_version bigint NOT NULL,
  PRIMARY KEY (tenant_id, owner_id, system_id, record_id),
  UNIQUE (tenant_id, owner_id, source_id),
  FOREIGN KEY (tenant_id, owner_id, source_id, source_version) REFERENCES source_revisions
);
CREATE TABLE evidence_links (
  tenant_id text NOT NULL,
  owner_id text NOT NULL,
  external_source_id text NOT NULL,
  external_version bigint NOT NULL,
  source_id text NOT NULL,
  source_version bigint NOT NULL,
  selector jsonb NOT NULL,
  state text NOT NULL CHECK (state IN ('pending', 'verified', 'invalid')),
  PRIMARY KEY (tenant_id, owner_id, external_source_id, external_version, source_id, source_version),
  FOREIGN KEY (tenant_id, owner_id, external_source_id, external_version) REFERENCES source_revisions
);
CREATE INDEX evidence_links_pending ON evidence_links (tenant_id, owner_id, source_id, source_version)
  WHERE state = 'pending';
