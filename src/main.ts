import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { Pool } from "pg";
import { connectDatabase, verifySchema } from "./db.ts";
import { handleMemoryRequest } from "./http.ts";
import { applyNext } from "./import.ts";
import type { Fault } from "./sources.ts";

export async function startMemoryServer(options: { database: Pool; port: number; workerIntervalMs?: number; fault?: Fault }) {
  await verifySchema(options.database);
  const server = createServer((request, response) => {
    void handleMemoryRequest(options.database, request, response, options.fault).catch(() => response.destroy());
  });
  const listening = once(server, "listening");
  server.listen(options.port, "127.0.0.1");
  await listening;
  let applying: Promise<unknown> | undefined;
  let unavailable = false;
  const interval = options.workerIntervalMs ?? 25;
  const worker = interval > 0 ? setInterval(() => {
    if (applying) return;
    applying = applyNext(options.database, options.fault)
      .then(() => { unavailable = false; })
      .catch(() => {
        if (!unavailable) process.stderr.write("Memory import worker is temporarily unavailable\n");
        unavailable = true;
      }).finally(() => { applying = undefined; });
  }, interval) : undefined;
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    url,
    async close() {
      clearInterval(worker);
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await applying;
    },
  };
}

if (import.meta.main) {
  const database = connectDatabase(process.env.MEMORY_DATABASE_URL ?? "", process.env.MEMORY_DB_SCHEMA ?? "");
  try {
    const port = Number(process.env.MEMORY_PORT ?? 8083);
    if (!Number.isInteger(port) || port < 0 || port > 65_535) throw new Error("Invalid Memory listen port");
    const memory = await startMemoryServer({ database, port });
    process.stdout.write(`Memory D1 listening at ${memory.url}\n`);
    let stopped = false;
    function close() {
      if (stopped) return;
      stopped = true;
      void memory.close().finally(() => database.end()).catch(() => { process.exitCode = 1; });
    }
    process.once("SIGTERM", close);
    process.once("SIGINT", close);
  } catch {
    await database.end();
    process.stderr.write("Memory startup failed. Verify PostgreSQL 17, the listen port, and the explicit schema migration.\n");
    process.exitCode = 1;
  }
}
