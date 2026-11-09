/** Load both sources and build the book. Starts the mock CRM if it isn't running. */
import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import { ROOT } from "./config.ts";
import { CrmClient, loadCrm } from "./crm/client.ts";
import { loadAnalytics } from "./analytics/usage.ts";
import { buildBook, type Book } from "./book.ts";

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

export async function loadBook(log: (s: string) => void = () => {}): Promise<{ book: Book; crm: CrmClient }> {
  const crm = new CrmClient();
  await ensureCrm(crm, log);
  const t0 = Date.now();
  const [bundles, analytics] = await Promise.all([loadCrm(crm), Promise.resolve().then(() => loadAnalytics(log))]);
  const book = buildBook(bundles, analytics);
  log(`Loaded ${bundles.length} CRM accounts via the API and ${analytics.customers.length} usage tenants in ${((Date.now() - t0) / 1000).toFixed(1)}s.`);
  return { book, crm };
}
