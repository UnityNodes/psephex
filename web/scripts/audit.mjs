import { spawnSync } from "node:child_process";

/**
 * npm audit fails on GHSA-qr28-fpjm-wq7f in decode-uri-component 0.2.2, pulled in by query-string 7
 * inside @meteorwallet/sdk 1.0.24, the latest release. The SDK's browser build imports only
 * `stringify`, which never decodes, and query-string 9 (the fixed line) drops the named export the
 * SDK imports, so overriding it breaks the build. This one advisory is accepted until Meteor moves
 * off query-string 7; any other high or critical advisory still fails.
 */
const ACCEPTED = new Set(["https://github.com/advisories/GHSA-qr28-fpjm-wq7f"]);
const BLOCKING = new Set(["high", "critical"]);

const run = spawnSync("npm", ["audit", "--omit=dev", "--json"], { encoding: "utf8" });
const report = JSON.parse(run.stdout);
const findings = Object.values(report.vulnerabilities ?? {})
  .flatMap((v) => v.via.filter((via) => typeof via === "object"))
  .filter((via) => BLOCKING.has(via.severity));
const blocking = [...new Map(findings.filter((f) => !ACCEPTED.has(f.url)).map((f) => [f.url, f])).values()];
const accepted = [...new Set(findings.filter((f) => ACCEPTED.has(f.url)).map((f) => f.url))];

for (const url of accepted) console.log(`accepted: ${url}`);
for (const f of blocking) console.error(`${f.severity}: ${f.name} ${f.range} ${f.url}`);
if (blocking.length > 0) process.exit(1);
console.log(`npm audit: no unaccepted high or critical advisories`);
