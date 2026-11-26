import { connectDatabase } from "../../src/db.ts";
import { startMemoryServer } from "../../src/main.ts";

const database = connectDatabase(process.env.MEMORY_DATABASE_URL!, process.env.MEMORY_DB_SCHEMA!);
const memory = await startMemoryServer({
  database, port: 0,
  workerIntervalMs: Number(process.env.MEMORY_FIXTURE_INTERVAL ?? "15"),
  fault(point) {
    if (point === process.env.MEMORY_FIXTURE_FAULT) process.kill(process.pid, "SIGKILL");
  },
});
process.on("message", (message) => {
  if (message === "stop") void memory.close().then(() => database.end()).then(() => process.disconnect?.());
});
process.send?.(memory.url);
