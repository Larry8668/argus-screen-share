// Read diagnostics reports sent from the app's "Report a problem" button.
//   npm run reports              → list the latest 20
//   npm run reports -- R-ABC123  → print one report in full
// Token: REPORTS_TOKEN env var, or REPORTS_TOKEN in web/.dev.vars.
import { readFileSync } from "node:fs";

const HOST = process.env.ARGUS_HOST ?? "https://argus.arry8668.workers.dev";
const token = process.env.REPORTS_TOKEN ?? readDevVar("REPORTS_TOKEN");
if (!token) {
  console.error("No REPORTS_TOKEN (env or web/.dev.vars).");
  process.exit(1);
}

const id = process.argv[2];
const res = await fetch(`${HOST}/api/reports${id ? `/${id}` : "?limit=20"}`, { headers: { Authorization: `Bearer ${token}` } });
const data = await res.json();
if (!res.ok) {
  console.error(`HTTP ${res.status}: ${data.error ?? ""}`);
  process.exit(1);
}

if (!id) {
  for (const r of data) console.log(`${r.id}  ${new Date(r.created_at).toISOString()}  ${r.country}  ${r.summary}`);
  if (!data.length) console.log("No reports.");
} else {
  const report = JSON.parse(data.body);
  console.log(`${data.id}  ${new Date(data.created_at).toISOString()}  ${data.country}`);
  console.log(`page ${report.page}  room ${report.room || "-"}  loaded ${report.pageLoadedAt}`);
  if (report.note) console.log(`note: ${report.note}`);
  console.log("\n-- environment\n" + JSON.stringify(report.environment, null, 2));
  console.log("\n-- stats\n" + JSON.stringify(report.stats, null, 2));
  if (report.errors.length) console.log("\n-- errors\n" + report.errors.join("\n"));
  console.log("\n-- log\n" + report.log.join("\n"));
}

function readDevVar(name) {
  try {
    const line = readFileSync(new URL("../.dev.vars", import.meta.url), "utf8").split("\n").find((l) => l.startsWith(`${name}=`));
    return line?.slice(name.length + 1).replace(/^"|"$/g, "");
  } catch {
    return undefined;
  }
}
