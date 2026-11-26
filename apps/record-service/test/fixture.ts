import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createHash, randomBytes } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import type { TestContext } from "node:test";
import pg from "pg";
import type { Pool } from "pg";
import { connectDatabase, migrateDatabase } from "../../../src/db.ts";
import { migrateRecordDatabase } from "../src/db.ts";
import { alice, bob, issuer } from "./issuer.ts";

export async function eventually<T>(read: () => Promise<T>, timeout = 7_000): Promise<NonNullable<T>> {
  const deadline = Date.now() + timeout;
  do {
    const result = await read();
    if (result) return result;
    await delay(35);
  } while (Date.now() < deadline);
  throw new Error("Timed out waiting for a durable integration result");
}

function start(entry: URL, env: NodeJS.ProcessEnv, match: RegExp) {
  const child = spawn(process.execPath, [fileURLToPath(entry)], { env, stdio: ["ignore", "pipe", "pipe"] });
  const exited = once(child, "exit");
  let output = "";
  let failed = "";
  child.stderr.on("data", chunk => { failed = (failed + String(chunk)).slice(-3000); });
  const ready = new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Contract service readiness timed out: " + entry.pathname)), 8_000);
    child.stdout.on("data", chunk => {
      output += String(chunk);
      const line = match.exec(output);
      if (line) { clearTimeout(timer); resolve(line[1] ?? ""); }
    });
    void exited.then(([code]) => {
      clearTimeout(timer);
      reject(new Error(`Contract service exited (${code}): ${entry.pathname}\n${failed}`));
    }, error => { clearTimeout(timer); reject(error); });
  });
  return {
    ready,
    async stop() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill("SIGTERM");
      const hard = setTimeout(() => child.kill("SIGKILL"), 3_000);
      try { await exited; } finally { clearTimeout(hard); }
    },
  };
}

function fixtureTarget() {
  const supplied = process.env.RECORD_TEST_DATABASE_URL;
  assert.ok(supplied, "Set RECORD_TEST_DATABASE_URL to the admin connection of a disposable PostgreSQL 17 instance");
  const base = new URL(supplied);
  const host = base.searchParams.get("host");
  assert.equal(base.protocol, "postgresql:");
  assert.equal(base.pathname, "/postgres");
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(base.hostname));
  assert.ok(!host || host.startsWith("/private/tmp/") || host.startsWith("/tmp/"), "Expected a local isolated PostgreSQL target");
  return base;
}

function quote(name: string) {
  assert.match(name, /^[a-z][a-z0-9_]+$/);
  return '"' + name + '"';
}

export async function environment(t: TestContext) {
  const base = fixtureTarget();
  const admin = new pg.Pool({ connectionString: base.toString(), connectionTimeoutMillis: 2_000 });
  const suffix = randomBytes(6).toString("hex");
  const createdDatabases: string[] = [];
  const createdRoles: string[] = [];
  const pools: Pool[] = [];
  const servers: ReturnType<typeof start>[] = [];
  t.after(async () => {
    try {
      for (const server of servers.reverse()) await server.stop();
      await Promise.all(pools.map(pool => pool.end()));
      for (const name of createdDatabases.reverse()) await admin.query("DROP DATABASE " + quote(name));
      for (const name of createdRoles.reverse()) await admin.query("DROP ROLE " + quote(name));
    } finally { await admin.end(); }
  });
  const version = (await admin.query("SHOW server_version_num")).rows[0].server_version_num;
  assert.equal(Math.floor(Number(version) / 10_000), 17);
  const prodName = "record_test_" + suffix;
  const memoName = "memory_test_" + suffix;

  async function role(label: string, db: string) {
    const name = "ac08_" + label + "_" + suffix;
    const password = randomBytes(24).toString("hex");
    await admin.query(`CREATE ROLE ${quote(name)} LOGIN PASSWORD '${password}' NOINHERIT`);
    createdRoles.push(name);
    const url = new URL(base);
    url.pathname = "/" + db;
    url.username = name;
    url.password = password;
    return { name: quote(name), url: url.toString() };
  }

  const ro = await role("r_owner", prodName);
  const api = await role("api", prodName);
  const worker = await role("worker", prodName);
  const ra = await role("r_audit", prodName);
  const mo = await role("m_owner", memoName);
  const mem = await role("memory", memoName);
  const ma = await role("m_audit", memoName);
  for (const [name, owner, roles] of [[prodName, ro, [api, worker, ra]], [memoName, mo, [mem, ma]]] as const) {
    await admin.query(`CREATE DATABASE ${quote(name)} OWNER ${owner.name}`);
    createdDatabases.push(name);
    await admin.query(`REVOKE ALL ON DATABASE ${quote(name)} FROM PUBLIC`);
    await admin.query(`GRANT CONNECT ON DATABASE ${quote(name)} TO ${roles.map(role => role.name).join(",")}`);
  }
  function database(url: string, schema: string) {
    const pool = connectDatabase(url, schema);
    pools.push(pool);
    return pool;
  }
  const productOwner = database(ro.url, "record_data");
  const memoryOwner = database(mo.url, "memory_data");
  await migrateRecordDatabase(productOwner);
  await migrateDatabase(memoryOwner, "memory_data");
  await productOwner.query(`GRANT USAGE ON SCHEMA record_data TO ${api.name}, ${worker.name}, ${ra.name};
    GRANT SELECT ON ALL TABLES IN SCHEMA record_data TO ${ra.name};
    GRANT SELECT ON schema_migrations, accounts, record_streams, record_operations, records, record_receipts TO ${api.name};
    GRANT INSERT ON record_operations, records, record_receipts, record_outbox TO ${api.name};
    GRANT UPDATE (last_sequence) ON record_streams TO ${api.name};
    GRANT SELECT ON schema_migrations, record_outbox TO ${worker.name};
    GRANT UPDATE (memory_operation_id, applied_at) ON record_outbox TO ${worker.name}`);
  await memoryOwner.query(`GRANT USAGE ON SCHEMA memory_data TO ${mem.name}, ${ma.name};
    GRANT SELECT ON ALL TABLES IN SCHEMA memory_data TO ${mem.name}, ${ma.name};
    GRANT INSERT, UPDATE ON ALL TABLES IN SCHEMA memory_data TO ${mem.name};
    GRANT USAGE ON ALL SEQUENCES IN SCHEMA memory_data TO ${mem.name}`);

  const local = issuer();
  const memoryTokens = Object.fromEntries(["importA", "importB", "readA", "readB", "model"]
    .map(name => [name, randomBytes(24).toString("hex")])) as Record<"importA" | "importB" | "readA" | "readB" | "model", string>;
  for (const [account, importer, reader] of [[alice, memoryTokens.importA, memoryTokens.readA], [bob, memoryTokens.importB, memoryTokens.readB]] as const) {
    await productOwner.query(`INSERT INTO accounts (identity_issuer,identity_subject,tenant_id,owner_id,self_subject_id)
      VALUES ($1,$2,$3,$4,$5)`, [local.config.issuer, account.subject, account.tenant_id, account.owner_id, account.self_subject_id]);
    await productOwner.query("INSERT INTO record_streams (tenant_id,owner_id,stream_id,last_sequence) VALUES ($1,$2,$3,10)",
      [account.tenant_id, account.owner_id, account.stream]);
    await memoryOwner.query(`INSERT INTO external_streams (tenant_id,owner_id,stream_id,system_id,applied_through_seq,highest_received_seq)
      VALUES ($1,$2,$3,'diandi-record-service',10,10)`, [account.tenant_id, account.owner_id, account.stream]);
    const grants = [[importer, "trusted_importer", ["source.write","operation.read"]],
      [reader, "trusted_adapter", ["operation.read","evidence.read"]]] as const;
    for (const [token, caller, actions] of account === alice ? [...grants, [memoryTokens.model, "model_tool", ["source.write"]] as const] : grants) {
      const hash = createHash("sha256").update(token).digest("hex");
      await memoryOwner.query(`INSERT INTO grants (token_hash,tenant_id,owner_id,grant_id,agent_id,caller_type,policy_epoch,actions,entities,domains,streams)
        VALUES ($1,$2,$3,$4,'ac08-agent',$5,1,$6,$7,$8,$9)`, [hash, account.tenant_id, account.owner_id, hash.slice(0,16), caller,
        actions, [account.self_subject_id], ["hydration"], [account.stream]]);
    }
  }

  const productAudit = database(ra.url, "record_data");
  const memoryAudit = database(ma.url, "memory_data");
  const misplacedRole = new URL(api.url);
  misplacedRole.pathname = "/" + memoName;
  await assert.rejects(database(misplacedRole.toString(), "memory_data").query("SELECT 1"), { code: "42501" });
  await assert.rejects(productAudit.query("SELECT * FROM pg_catalog.pg_authid"), { code: "42501" });
  await assert.rejects(productAudit.query("UPDATE accounts SET active=false"), { code: "42501" });
  function startMemory(port: string) {
    const server = start(new URL("../../../src/main.ts", import.meta.url), {
      MEMORY_DATABASE_URL: mem.url, MEMORY_DB_SCHEMA: "memory_data", MEMORY_PORT: port,
    }, /Memory D1 listening at (http:\/\/127\.0\.0\.1:\d+)/);
    servers.push(server);
    return server;
  }
  let memory = startMemory("0");
  const memoryUrl = await memory.ready;
  function startProduct(port: string) {
    const server = start(new URL("../src/main.ts", import.meta.url), {
      RECORD_DATABASE_URL: api.url, RECORD_PORT: port, RECORD_AUTH_CONFIG: JSON.stringify(local.config),
    }, /RecordService listening at (http:\/\/127\.0\.0\.1:\d+)/);
    servers.push(server);
    return server;
  }
  let product = startProduct("0");
  const productUrl = await product.ready;

  const request = (origin: string) => async (path: string, token?: string, body?: object, key?: string, extra?: Record<string,string>) => {
    const response = await fetch(origin + path, {
      method: body === undefined ? "GET" : "POST",
      headers: { ...(token ? { authorization: "Bearer " + token } : {}), ...(body ? { "content-type": "application/json" } : {}),
        ...(key ? { "idempotency-key": key } : {}), ...extra },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(4_000),
    });
    return { status: response.status, body: await response.json() as Record<string, any> };
  };
  const snapshot = async (pool: Pool, tables: string[]) => Object.fromEntries(await Promise.all(tables.map(async name => {
    const { rows } = await pool.query(`SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]') AS rows FROM ${quote(name)} t`);
    return [name, rows[0].rows];
  })));
  return {
    issuer: local, tokens: { a: local.token(alice.subject), b: local.token(bob.subject) },
    memoryTokens, productOwner, productAudit, memoryAudit, record: request(productUrl), memory: request(memoryUrl),
    async restartProduct() {
      await product.stop();
      product = startProduct(new URL(productUrl).port);
      assert.equal(await product.ready, productUrl);
    },
    stopMemory: () => memory.stop(),
    async restartMemory() {
      memory = startMemory(new URL(memoryUrl).port);
      assert.equal(await memory.ready, memoryUrl);
    },
    async startWorker() {
      const delivery = start(new URL("../src/worker.ts", import.meta.url), {
        RECORD_DATABASE_URL: worker.url, RECORD_MEMORY_URL: memoryUrl,
        RECORD_IMPORTERS: JSON.stringify([
          { tenant_id: alice.tenant_id, owner_id: alice.owner_id, stream_id: alice.stream, token: memoryTokens.importA },
          { tenant_id: bob.tenant_id, owner_id: bob.owner_id, stream_id: bob.stream, token: memoryTokens.importB },
        ]),
      }, /RecordService Outbox ready/);
      servers.push(delivery);
      await delivery.ready;
    },
    productSnapshot: () => snapshot(productAudit, ["record_operations","records","record_receipts","record_outbox","record_streams"]),
    memorySnapshot: () => snapshot(memoryAudit, ["sources","inbox","external_streams","operations"]),
    async productCounts() {
      return (await productAudit.query(`SELECT (SELECT count(*)::int FROM record_operations) AS operations,
        (SELECT count(*)::int FROM records) AS records, (SELECT count(*)::int FROM record_receipts) AS receipts,
        (SELECT count(*)::int FROM record_outbox) AS outbox`)).rows[0];
    },
  };
}
