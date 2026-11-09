/** Terminal rendering for the deterministic views (brief, account card). */
import { briefItems, money, pct, sourceTag, type AccountView, type Book, type Kind } from "./book.ts";

const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code: string) => (s: string) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
export const bold = c("1"), dim = c("2"), red = c("31"), green = c("32"), yellow = c("33"), cyan = c("36"), magenta = c("35");

const TAG: Record<Kind, (s: string) => string> = { risk: red, grow: green, renewal: yellow, watch: cyan, hygiene: magenta };
const LABEL: Record<Kind, string> = { risk: "AT RISK", grow: "GROW", renewal: "RENEWAL / CLOSE", watch: "WATCH", hygiene: "CRM HYGIENE" };
export const tag = (k: Kind | null) => (k ? TAG[k](`[${LABEL[k]}]`) : "");
const confTag = (cf: string) => (cf === "high" ? green(cf) : cf === "medium" ? yellow(cf) : red(cf));

/** Render markdown-ish LLM output for the terminal. */
export function md(s: string): string {
  return s.replace(/\*\*(.+?)\*\*/g, (_, x) => bold(x)).replace(/^#{1,4}\s*(.+)$/gm, (_, x) => bold(x));
}

export function renderBrief(book: Book, owner?: string | null): string {
  const items = briefItems(book, owner);
  const scope = owner ? `${owner}'s book (${book.accounts.filter((a) => a.owner === owner).length} accounts)` : `whole book (${book.accounts.length} accounts, 10 owners)`;
  const lines = [bold(`Today, ${book.asOf} - ${scope} - ${items.length} accounts need attention`), dim("Data as of 2025-03-14 (last day in both CRM and analytics). Ranked by signal strength x value x match confidence."), ""];
  items.forEach((a, i) => {
    lines.push(`${bold(`${i + 1}. ${a.name}`)} ${dim(`(${a.id}, ${a.stage}, owner ${a.owner})`)} ${tag(a.kind)}  ${dim(`priority ${a.priority}`)}`);
    for (const f of a.findings.filter((x) => x.kind !== "hygiene").slice(0, 3)) lines.push(`   - ${f.text} ${dim(sourceTag(f.source))}`);
    lines.push(`   ${cyan("Suggested:")} ${a.nextStep_suggested}`);
    lines.push(`   ${dim("Confidence:")} ${confTag(a.confidence)}${a.caveats.length ? dim(` - ${a.caveats[0]}`) : ""}`);
    lines.push("");
  });
  const amb = book.accounts.filter((a) => a.match.method === "ambiguous").length;
  lines.push(dim(`Data caveats: ${amb} accounts have ambiguous usage matches (duplicate CRM accounts); ${book.unmatchedCustomers.length} usage tenants have no CRM account; the analytics alert table is ignored (only 1 of 35 alerts matches its threshold).`));
  return lines.join("\n");
}

export function renderAccount(a: AccountView): string {
  const L: string[] = [];
  L.push(`${bold(a.name)} ${dim(`${a.id} - ${a.stage} - owner ${a.owner} - ${a.industry}, ${a.employees} employees, ICP ${a.icpTier}`)} ${tag(a.kind)}`);
  L.push(`${dim("Match:")} ${a.match.method} (${a.match.confidence}) - ${a.match.note}`);
  if (a.openOpp) L.push(`${dim("Open deal:")} ${a.openOpp.name} ${money(a.openOpp.value)} ${a.openOpp.stage}, closes ${a.openOpp.closeDate} (${a.openOpp.daysToClose}d), next: ${a.openOpp.nextStep ?? "-"}`);
  if (a.renewal) L.push(`${dim("Renewal:")} ${money(a.renewal.value)} on ${a.renewal.closeDate} (${a.renewal.daysToRenewal}d)`);
  for (const k of a.contracts) L.push(`${dim("Contract:")} ${k.type} ${money(k.amount)}, ${k.balancePct}% left, ends ${k.ending_before.slice(0, 10)} (${k.daysToEnd}d)`);
  L.push(`${dim("Usage:")} prod ${a.usage.trendClass} ${pct(a.usage.trendPct)} (${a.usage.prodL28} vs ${a.usage.prodP28} req, 28d); tokens ${pct(a.usage.tokensTrend)}, transcribe ${pct(a.usage.transcribeTrend)}${a.usage.sandboxL28 ? `; sandbox ${a.usage.sandboxL28} vs ${a.usage.sandboxP28}` : ""}`);
  for (const t of a.tenants.length > 1 ? a.tenants : []) L.push(`   tenant ${t.name} (${t.region ?? "?"}): ${pct(t.trendPct)}`);
  for (const t of a.candidates) L.push(`   candidate ${t.customerId} ${t.name}: prod ${pct(t.trendPct)} (${t.prodReqL28} req, 28d)`);
  L.push("", bold("Findings"));
  for (const f of a.findings) L.push(`  ${tag(f.kind)} ${f.text} ${dim(`${sourceTag(f.source)} ${f.source}; confidence ${f.confidence}${f.caveat ? `; ${f.caveat}` : ""}`)}`);
  L.push("", bold("MEDDPICC"));
  const sym = { evidence: green("ok"), concern: red("!!"), unknown: dim("??") };
  for (const m of a.meddpicc) L.push(`  ${sym[m.status]} ${m.letter.padEnd(2)} ${m.name.padEnd(18)} ${m.detail} ${dim(`[${m.source}${m.basis === "inferred" ? ", INFERRED" : ""}]`)}`);
  L.push(dim("  ok = evidence, !! = concern, ?? = unknown (not captured in the CRM). INFERRED = our interpretation, not a recorded fact."));
  L.push("", `${bold("Contacts")} ${dim("[CRM; role in brackets is inferred from job title]")}`);
  for (const ct of a.contacts) L.push(`  ${ct.name} - ${ct.title} ${dim(`[${ct.role}]`)}${ct.email ? ` ${ct.email}` : dim(" (no real email)")}${ct.lastEmail ? dim(` last ${ct.lastEmailDirection} email ${ct.lastEmail}`) : ""}`);
  if (a.notes.length) { L.push("", bold("Notes")); for (const n of a.notes) L.push(`  ${n.date} "${n.text}"`); }
  L.push("", bold("Recent activity"));
  for (const r of a.recent) L.push(`  ${r.date} ${r.what}`);
  if (a.openTasks.length) { L.push("", bold("Open tasks")); for (const t of a.openTasks) L.push(`  ${t.title} due ${t.due}${t.overdue ? red(" overdue") : ""}`); }
  L.push("", `${cyan("Suggested:")} ${a.nextStep_suggested}   ${dim(`priority ${a.priority}: ${a.priorityWhy.join("; ")}`)}`);
  return L.join("\n");
}
