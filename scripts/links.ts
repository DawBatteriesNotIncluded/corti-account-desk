/**
 * Export the full CRM-account -> analytics-customer mapping with method and confidence.
 *   npm run links            writes out/links.csv and prints a summary
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT } from "../src/config.ts";
import { loadBook } from "../src/load.ts";

const { book } = await loadBook(() => {});
const csv = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
const rows = [
  ["account_id", "account_name", "stage", "owner", "crm_domain", "method", "confidence", "linked_customer_ids", "linked_customer_names", "candidate_customer_ids", "note"].join(","),
  ...book.accounts
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((a) => [a.id, a.name, a.stage, a.owner, a.domain, a.match.method, a.match.confidence, a.match.customerIds.join(" "),
      a.tenants.map((t) => t.name).join(" "), a.match.candidateIds.join(" "), a.match.note].map(csv).join(",")),
  ...book.unmatchedCustomers.map((u) => ["", "", "", "", "", "no_crm_account", "", u.id, u.name, "", "Usage tenant with no CRM account"].map(csv).join(",")),
];
const out = resolve(ROOT, "out/links.csv");
mkdirSync(resolve(ROOT, "out"), { recursive: true });
writeFileSync(out, rows.join("\n") + "\n");

const by = (m: string) => book.accounts.filter((a) => a.match.method === m).length;
console.log(`Wrote ${out}`);
console.log(`  domain ${by("domain")} | billing_domain ${by("billing_domain")} | name_only ${by("name_only")} | confirmed by AE ${by("confirmed")} | ambiguous ${by("ambiguous")} | no usage record ${by("none")}`);
console.log(`  usage tenants with no CRM account: ${book.unmatchedCustomers.length}`);
const amb = book.accounts.filter((a) => a.match.method === "ambiguous");
if (amb.length) console.log(`  To resolve an ambiguous account, in the chat: /link <acc_id> <cust_id>  e.g. /link ${amb[0].id} ${amb[0].match.candidateIds[0]}`);
process.exit(0);
