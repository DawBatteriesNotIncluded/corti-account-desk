/** Load both sources and build the book. Starts the mock CRM if it isn't running. */
import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import { ROOT } from "./config.ts";
import { CrmClient, loadCrm } from "./crm/client.ts";
import { loadAnalytics } from "./analytics/usage.ts";
import { buildBook, type Book } from "./book.ts";
import { loadLinks } from "./join/links.ts";

let crmChild: ChildProcess | null = null;

async function ensureCrm(client: CrmClient, log: (s: string) => void) {
  if (await client.health()) return;
  log(`CRM API not reachable at ${client.base}; starting the mock CRM (npm run dev)...`);
  crmChild = spawn(process.execPath, ["--env-file-if-exists=.env.local", "--import", "tsx", resolve(ROOT, "mock-crm/server.ts")], { cwd: ROOT, stdio: "ignore" });
  process.on("exit", () => crmChild?.kill());
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 250));
    if (await client.health()) return;
  }
  throw new Error(`Could not reach the CRM API at ${client.base}. Start it with: npm run dev`);
}

export async function loadBook(log: (s: string) => void = () => {}): Promise<{ book: Book; crm: CrmClient; rebuild: () => Book }> {
  const crm = new CrmClient();
  await ensureCrm(crm, log);
  const t0 = Date.now();
  const [bundles, analytics] = await Promise.all([loadCrm(crm), Promise.resolve().then(() => loadAnalytics(log))]);
  const links = loadLinks();
  const book = buildBook(bundles, analytics, links);
  log(`Loaded ${bundles.length} CRM accounts via the API and ${analytics.customers.length} usage tenants in ${((Date.now() - t0) / 1000).toFixed(1)}s${links.size ? `; ${links.size} AE-confirmed links from data/links.json` : ""}.`);
  // re-run the join + signals after the AE confirms or removes a link (no reload needed)
  return { book, crm, rebuild: () => buildBook(bundles, analytics, loadLinks()) };
}
