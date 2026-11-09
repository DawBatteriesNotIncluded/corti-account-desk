/**
 * Terminal rendering: the brief, the account card, and the model's answers.
 * Goals: scannable at a glance, wrapped to the window, sources and inferences
 * visually distinct (sources dim, inferences yellow, suggestions cyan).
 */
import { alsoNeedsAttention, briefItems, money, pct, sourceTag, type AccountView, type Book, type Kind } from "./book.ts";

const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code: string) => (s: string) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
export const bold = c("1"), dim = c("2"), red = c("31"), green = c("32"), yellow = c("33"), blue = c("34"), magenta = c("35"), cyan = c("36");
const inverse = (f: (s: string) => string) => (s: string) => (tty ? f(`\x1b[7m ${s} \x1b[27m`) : `[${s}]`);

const KIND_COLOR: Record<Kind, (s: string) => string> = { risk: red, grow: green, renewal: yellow, watch: blue, hygiene: magenta };
const LABEL: Record<Kind, string> = { risk: "AT RISK", grow: "GROW", renewal: "RENEWAL", watch: "WATCH", hygiene: "CRM HYGIENE" };
export const tag = (k: Kind | null) => (k ? inverse(KIND_COLOR[k])(LABEL[k]) : "");
const conf = (cf: string) => (cf === "high" ? green("● high") : cf === "medium" ? yellow("◐ medium") : red("○ low"));

const ANSI = /\x1b\[[0-9;]*m/g;
const vlen = (s: string) => s.replace(ANSI, "").length;
export const width = () => Math.max(60, Math.min(process.stdout.columns || 100, 110));
const rule = (label = "") => dim(label ? `── ${label} ${"─".repeat(Math.max(0, width() - vlen(label) - 4))}` : "─".repeat(width()));

/** Word-wrap plain text to the window, indenting continuation lines. */
export function wrap(text: string, indent = 0, first = indent): string {
  const max = width() - 1;
  const out: string[] = [];
  let line = " ".repeat(first);
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (vlen(line) + vlen(word) + 1 > max && line.trim()) {
      out.push(line.trimEnd());
      line = " ".repeat(indent);
    }
    line += (line.trim() ? " " : "") + word;
  }
  out.push(line.trimEnd());
  return out.join("\n");
}

/** A fixed-width (coloured) label followed by wrapped text that stays aligned under itself. */
export function labelled(plainLabel: string, colouredLabel: string, text: string, col: number, lead = 2): string {
  const pad = " ".repeat(Math.max(1, col - lead - plainLabel.length));
  const body = wrap(text, col, col);
  return " ".repeat(lead) + colouredLabel + pad + highlight(body.slice(col));
}

/** Colour source tags, inference labels, suggestions and confidence inside any text. */
export function highlight(s: string): string {
  return s
    .replace(/\*\*(.+?)\*\*/g, (_, x) => bold(x))
    .replace(/\[(?:CRM|Usage|Billing|Derived|Match)[^\]]*\]/g, (m) => dim(m))
    .replace(/\((?:[^()]*\b(?:inferred|INFERRED|estimate|ESTIMATE|suggestion)\b[^()]*)\)/g, (m) => yellow(m))
    .replace(/\bINFERRED\b|\bESTIMATE\b/g, (m) => yellow(m))
    .replace(/^(\s*)(Suggested:)/, (_, sp, x) => sp + cyan(bold(x)))
    .replace(/\bConfidence:\s*(high|medium|low)\b/gi, (_, x) => `Confidence: ${conf(x.toLowerCase())}`);
}

/** Format the model's markdown-ish answer: headings, bullets, wrapping, highlighting. */
export function formatAnswer(text: string): string {
  const out: string[] = [];
  for (const raw of text.replace(/\r/g, "").split("\n")) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) { if (out[out.length - 1] !== "") out.push(""); continue; }
    const h = line.match(/^\s*#{1,4}\s*(.+)$/) ?? (line.match(/^\s*\*\*([^*]+)\*\*:?\s*$/) || null);
    if (h) { out.push(bold(cyan(h[1].replace(/\*\*/g, "")))); continue; }
    const bullet = line.match(/^(\s*)[-*•]\s+(.*)$/);
    if (bullet) { const ind = Math.min(bullet[1].length, 4) + 2; out.push(highlight(wrap(`• ${bullet[2]}`, ind + 2, ind))); continue; }
    const num = line.match(/^(\s*)(\d+[.)])\s+(.*)$/);
    if (num) { const ind = Math.min(num[1].length, 4) + 2; out.push(highlight(wrap(`${num[2]} ${num[3]}`, ind + num[2].length + 1, ind))); continue; }
    out.push(highlight(wrap(line.trim(), 2, 2)));
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n");
}

export function renderBrief(book: Book, owner?: string | null): string {
  const items = briefItems(book, owner);
  const scope = owner ? `${owner}'s book (${book.accounts.filter((a) => a.owner === owner).length} accounts)` : `whole book (${book.accounts.length} accounts)`;
  const L = [
    "",
    bold(`TODAY  ${book.asOf}`) + dim(`   ${scope} · ${items.length} need attention`),
    dim(wrap("Data as of 2025-03-14, the last day in both CRM and analytics. Ranked by signal strength, value at stake and match confidence.", 0)),
    "",
  ];
  items.forEach((a, i) => {
    L.push(rule());
    L.push(`${bold(`${i + 1}. ${a.name}`)}  ${tag(a.kind)}  ${conf(a.confidence)}`);
    L.push(dim(`   ${a.id} · ${a.stage} · owner ${a.owner} · priority ${a.priority}`));
    for (const f of a.findings.filter((x) => x.kind !== "hygiene").slice(0, 3)) L.push(highlight(wrap(`• ${f.text} ${sourceTag(f.source)}`, 5, 3)));
    L.push(highlight(wrap(`Suggested: ${a.nextStep_suggested}`, 14, 3)));
    L.push(dim(wrap(`Why this confidence: ${a.confidenceWhy.replace(/^\w+: /, "")}`, 5, 3)));
  });
  L.push(rule());
  const more = alsoNeedsAttention(book, owner);
  if (more.length) {
    const top = more.slice(0, 5).map((a) => `${a.name} (${a.id}, ${LABEL[a.kind ?? "watch"].toLowerCase()}, priority ${a.priority})`);
    L.push(wrap(`${bold(`Also needs attention (${more.length} more above the cut-off):`)} ${top.join("; ")}${more.length > 5 ? `; and ${more.length - 5} more` : ""}. Ask "What's at risk?" or "Who is ready to grow?" for the full list.`, 2, 0));
    L.push(rule());
  }
  const amb = book.accounts.filter((a) => a.match.method === "ambiguous").length;
  L.push(dim(wrap(`Data caveats: ${amb} accounts have ambiguous usage matches (duplicate CRM accounts: see /links); ${book.unmatchedCustomers.length} usage tenants have no CRM account; the analytics alert table is ignored (only 1 of 35 alerts matches its own threshold).`, 0)));
  return L.join("\n");
}

export function renderAccount(a: AccountView): string {
  const L: string[] = [""];
  const kv = (k: string, v: string) => L.push(labelled(k, dim(k), v, 14));
  L.push(`${bold(a.name)}  ${tag(a.kind)}  ${conf(a.confidence)}`);
  L.push(dim(`  ${a.id} · ${a.stage} · owner ${a.owner} · ${a.industry ?? "?"} · ${a.employees ?? "?"} employees · ICP ${a.icpTier ?? "?"}`));
  L.push(dim(wrap(`Why this confidence: ${a.confidenceWhy.replace(/^\w+: /, "")}`, 4, 2)));
  L.push(rule("Commercial"));
  kv("Match", `${a.match.method} (${a.match.confidence}): ${a.match.note}`);
  if (a.openOpp) kv("Open deal", `${a.openOpp.name} ${money(a.openOpp.value)}, ${a.openOpp.stage}, closes ${a.openOpp.closeDate} (${a.openOpp.daysToClose} days). Next: ${a.openOpp.nextStep ?? "none recorded"} [CRM]`);
  if (a.renewal) kv("Renewal", `${money(a.renewal.value)} on ${a.renewal.closeDate} (${a.renewal.daysToRenewal} days) [CRM]`);
  for (const k of a.contracts) kv("Contract", `${k.type} ${money(k.amount)}, ${k.balancePct}% left${k.low ? red(" LOW") : ""}, ends ${k.ending_before.slice(0, 10)} (${k.daysToEnd} days) [Billing]`);
  L.push(rule("Usage, last 28 days vs prior 28"));
  if (a.match.method === "ambiguous") {
    kv("Usage", "not attributed: the match is ambiguous. Candidates:");
    for (const t of a.candidates) L.push(`    ${t.customerId} ${t.name}: production ${pct(t.trendPct)} (${t.prodReqL28} requests) ${dim("[Usage]")}`);
    L.push(dim(`    Confirm the right one with: /link ${a.id} <cust_id>`));
  } else {
    kv("Production", `${a.usage.trendClass} ${pct(a.usage.trendPct)}: ${a.usage.prodL28} vs ${a.usage.prodP28} requests; tokens ${pct(a.usage.tokensTrend)}, transcription ${pct(a.usage.transcribeTrend)} [Usage]`);
    if (a.usage.sandboxL28 || a.usage.sandboxP28) kv("Trial", `${a.usage.sandboxL28} vs ${a.usage.sandboxP28} sandbox requests [Usage]`);
    if (a.tenants.length > 1) for (const t of a.tenants) kv("Tenant", `${t.name}${t.region ? ` (${t.region})` : ""}: ${pct(t.trendPct)} [Usage]`);
    const w = a.tenants.reduce((s, t) => t.weekly.map((v, i) => (s[i] ?? 0) + v), [] as number[]);
    if (w.length && Math.max(...w) > 0) kv("12 weeks", `${spark(w)}  ${dim(`${w[0]} → ${w[w.length - 1]} requests/week`)}`);
  }
  L.push(rule("Signals"));
  for (const f of a.findings) {
    L.push(highlight(wrap(`${tag(f.kind)} ${f.text} ${sourceTag(f.source)}`, 4, 2)));
    const meta = [`confidence ${f.confidence}`, f.caveat].filter(Boolean).join("; ");
    L.push(dim(wrap(meta, 4, 4)));
  }
  L.push(rule("MEDDPICC"));
  const sym = { evidence: green("✓"), concern: red("!"), unknown: dim("?") };
  for (const m of a.meddpicc) {
    const plain = `${m.status === "evidence" ? "✓" : m.status === "concern" ? "!" : "?"} ${m.letter.padEnd(2)} ${m.name}`;
    const col = `${sym[m.status]} ${bold(m.letter.padEnd(2))} ${m.name}`;
    L.push(labelled(plain, col, `${m.detail} [${m.source}]${m.basis === "inferred" ? " INFERRED" : ""}`, 26));
  }
  L.push(dim("  ✓ evidence   ! concern   ? unknown (not captured in the CRM)   INFERRED = our interpretation, not a recorded fact"));
  L.push(rule("Contacts [CRM] (role inferred from job title)"));
  for (const ct of a.contacts) {
    const last = ct.lastEmail ? `last ${ct.lastEmailDirection} email ${ct.lastEmail}` : "no recorded email exchange";
    L.push(wrap(`${ct.name}, ${ct.title}  ${yellow(`(${ct.role})`)}  ${ct.email ?? dim("no real address")}  ${dim(last)}`, 4, 2));
  }
  if (a.notes.length) { L.push(rule("Notes [CRM]")); for (const n of a.notes) L.push(wrap(`${dim(n.date)}  "${n.text}"`, 14, 2)); }
  L.push(rule("Recent activity [CRM]"));
  for (const r of a.recent) L.push(wrap(`${dim(r.date)}  ${r.what}`, 14, 2));
  if (a.openTasks.length) { L.push(rule("Open tasks [CRM]")); for (const t of a.openTasks) L.push(`  ${t.title}  ${dim(`due ${t.due}`)}${t.overdue ? red(" overdue") : ""}`); }
  L.push(rule());
  L.push(highlight(wrap(`Suggested: ${a.nextStep_suggested}`, 13, 2)));
  L.push(dim(wrap(`Priority ${a.priority}: ${a.priorityWhy.join("; ")} (computed score, not a CRM field)`, 4, 2)));
  return L.join("\n");
}

const BARS = "▁▂▃▄▅▆▇█";
function spark(v: number[]): string {
  const max = Math.max(...v), min = Math.min(...v);
  return v.map((x) => BARS[max === min ? 3 : Math.round(((x - min) / (max - min)) * 7)]).join("");
}
