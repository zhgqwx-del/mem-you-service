import { fileURLToPath } from "node:url";
import { run } from "node:test";
import { spec } from "node:test/reporters";

type Result = { name: string; passed: boolean };

export function gateFailures(required: readonly string[], results: readonly Result[]) {
  const failures = results.filter(result => !result.passed).map(result => result.name + " did not pass");
  for (const id of required) {
    if (results.filter(result => result.passed && result.name.startsWith(id + " ")).length !== 1) {
      failures.push(id + " must execute and pass exactly once");
    }
  }
  return failures;
}

if (import.meta.main) {
  const common = ["AC-RECORD-801", "AC-RECORD-802", "AC-RECORD-803"];
  const mode = process.argv[2];
  if (mode !== "unit" && mode !== "contract") throw new Error("Expected unit or contract test mode");
  const required = [...common, mode === "unit" ? "AC-RECORD-805" : "AC-RECORD-804"];
  const files = (mode === "unit" ? ["auth.test.ts", "check.test.ts"] : ["contract.test.ts"]).map(name =>
    fileURLToPath(new URL("../apps/record-service/test/" + name, import.meta.url)));
  const results: Result[] = [];
  const stream = run({ files, timeout: 60_000 });
  stream.on("data", event => {
    if (event.type === "test:pass" || event.type === "test:fail") {
      results.push({ name: event.data.name, passed: event.type === "test:pass" && !event.data.skip && !event.data.todo });
    }
  });
  for await (const chunk of stream.compose(spec)) process.stdout.write(chunk);
  const failures = gateFailures(required, results);
  if (failures.length) {
    process.stderr.write(failures.join("\n") + "\n");
    process.exitCode = 1;
  } else {
    process.stdout.write(`RecordService ${mode} gate verified ${required.length} required scenarios\n`);
  }
}
