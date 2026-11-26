CREATE TABLE accounts (
  identity_issuer text NOT NULL,
  identity_subject text NOT NULL,
  tenant_id text NOT NULL,
  owner_id text NOT NULL,
  self_subject_id text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  PRIMARY KEY (identity_issuer, identity_subject)
);

CREATE TABLE record_streams (
  tenant_id text NOT NULL,
  owner_id text NOT NULL,
  stream_id text NOT NULL UNIQUE,
  last_sequence bigint NOT NULL CHECK (last_sequence BETWEEN 0 AND 9007199254740991),
  PRIMARY KEY (tenant_id, owner_id),
  UNIQUE (stream_id, tenant_id, owner_id)
);

CREATE TABLE record_operations (
  operation_id text PRIMARY KEY,
  tenant_id text NOT NULL,
  owner_id text NOT NULL,
  subject_id text NOT NULL,
  domain text NOT NULL CHECK (domain = 'hydration'),
  client_operation_id text NOT NULL,
  request_hash text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('pending_input', 'confirmed_drink')),
  raw_input text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, owner_id, client_operation_id),
  UNIQUE (operation_id, tenant_id, owner_id, subject_id, domain),
  CHECK ((kind = 'pending_input') = (raw_input IS NOT NULL))
);

CREATE TABLE records (
  record_id text PRIMARY KEY,
  tenant_id text NOT NULL,
  owner_id text NOT NULL,
  subject_id text NOT NULL,
  domain text NOT NULL CHECK (domain = 'hydration'),
  document jsonb NOT NULL,
  UNIQUE (record_id, tenant_id, owner_id, subject_id, domain)
);

CREATE TABLE record_receipts (
  operation_id text PRIMARY KEY,
  record_id text UNIQUE NOT NULL,
  tenant_id text NOT NULL,
  owner_id text NOT NULL,
  subject_id text NOT NULL,
  domain text NOT NULL CHECK (domain = 'hydration'),
  receipt jsonb NOT NULL,
  UNIQUE (record_id, tenant_id, owner_id),
  FOREIGN KEY (operation_id, tenant_id, owner_id, subject_id, domain) REFERENCES record_operations
    (operation_id, tenant_id, owner_id, subject_id, domain),
  FOREIGN KEY (record_id, tenant_id, owner_id, subject_id, domain) REFERENCES records
    (record_id, tenant_id, owner_id, subject_id, domain)
);

CREATE TABLE record_outbox (
  event_id text PRIMARY KEY,
  record_id text NOT NULL,
  tenant_id text NOT NULL,
  owner_id text NOT NULL,
  stream_id text NOT NULL,
  stream_sequence bigint NOT NULL CHECK (stream_sequence BETWEEN 1 AND 9007199254740991),
  document jsonb NOT NULL,
  payload_hash text NOT NULL,
  memory_operation_id text,
  applied_at timestamptz,
  UNIQUE (stream_id, stream_sequence),
  FOREIGN KEY (record_id, tenant_id, owner_id) REFERENCES record_receipts (record_id, tenant_id, owner_id),
  FOREIGN KEY (stream_id, tenant_id, owner_id) REFERENCES record_streams (stream_id, tenant_id, owner_id),
  CHECK (applied_at IS NULL OR memory_operation_id IS NOT NULL)
);
CREATE INDEX record_outbox_pending ON record_outbox (stream_id, stream_sequence) WHERE applied_at IS NULL;
