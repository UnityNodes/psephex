import { parseArgs } from "node:util";
import { mergeDatabases } from "./merge.js";

const { values } = parseArgs({
  options: { primary: { type: "string" }, secondary: { type: "string" }, out: { type: "string" } },
  strict: true,
});

if (!values.primary || !values.secondary || !values.out) {
  process.stderr.write("usage: node dist/merge-cli.js --primary <later run db> --secondary <earlier run db> --out <new db>\n");
  process.exit(2);
}

try {
  process.stdout.write(`${JSON.stringify(mergeDatabases({ primary: values.primary, secondary: values.secondary, out: values.out }))}\n`);
} catch (err) {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
}
