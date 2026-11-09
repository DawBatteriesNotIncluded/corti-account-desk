/**
 * Tools the LLM can call. Each returns compact, pre-formatted FACTS computed by
 * code (book.ts), with sources, confidence and caveats. Adding a capability =
 * adding one entry to TOOLS.
 */
import type { ToolDef } from "../lib/corti.ts";
import { TODAY, addDays, daysAgo } from "./config.ts";
import { alsoNeedsAttention, briefItems, fmtDate, money, pct, sourceTag, type AccountView, type Book, type Kind } from "./book.ts";
import type { CrmClient } from "./crm/client.ts";
import { DIMENSIONS, loadDimensions } from "./analytics/usage.ts";

const norm = (s: string) => s.toLowerCase().replace(/\b(group|llc|ltd|inc|healthcare)\b/g, "").replace(/[^a-z0-9]/g, "");

export function findAccount(book: Book, query: string): { account: AccountView | null; candidates: AccountView[] } {
  const q = query.trim();
  const byId = book.byId.get(q.toLowerCase());
  if (byId) return { account: byId, candidates: [] };
  const nq = norm(q);
  if (!nq) return { account: null, candidates: [] };
  const exact = book.accounts.filter((a) => norm(a.name) === nq);
  if (exact.length === 1) return { account: exact[0], candidates: [] };
  const partial = exact.length ? exact : book.accounts.filter((a) => norm(a.name).includes(nq) || nq.includes(norm(a.name)));
  if (partial.length === 1) return { account: partial[0], candidates: [] };
  return { account: null, candidates: partial.slice(0, 8) };
}

/** Short line used in lists. */
function summary(a: AccountView) {
  return {
    id: a.id, name: a.name, stage: a.stage, owner: a.owner, tag: a.kind, priority: a.priority,
    headline: a.findings[0] ? `${a.headline} ${sourceTag(a.findings[0].source)}` : a.headline,
    other_signals: a.findings.slice(1, 3).map((f) => `${f.text} ${sourceTag(f.source)}`),
    suggested_next_step: `${a.nextStep_suggested} (suggestion, not from the CRM)`,
    confidence: a.confidence,
    confidence_reason: a.confidenceWhy,
    caveats: a.caveats.slice(0, 2),
  };
}

/** Full fact card for one account. */
export function accountFacts(a: AccountView) {
  return {
    id: a.id, name: a.name, stage: a.stage, owner: a.owner, industry: a.industry, employees: a.employees, icp_tier: a.icpTier,
    match: { method: a.match.method, confidence: a.match.confidence, note: a.match.note },
    open_deal: a.openOpp ? { name: a.openOpp.name, value: money(a.openOpp.value), stage: a.openOpp.stage, close_date: fmtDate(a.openOpp.closeDate), days_to_close: a.openOpp.daysToClose, next_step: a.openOpp.nextStep } : null,
    renewal: a.renewal ? { value: money(a.renewal.value), date: fmtDate(a.renewal.closeDate), days_to_renewal: a.renewal.daysToRenewal } : null,
    contracts: a.contracts.map((k) => ({ source: "[Billing]", type: k.type, amount: money(k.amount), balance_left: `${k.balancePct}% (${money(k.balance)})`, starts: fmtDate(k.starting_at), ends: fmtDate(k.ending_before), days_to_end: k.daysToEnd, low_balance: k.low,
      runway_estimate: k.runwayDays != null ? `~${k.runwayDays} days (ESTIMATE: average spend since ${fmtDate(k.starting_at)}, assumes linear burn; balances don't track usage in this data)` : "cannot be estimated (no spend recorded)" })),
    usage: a.match.method === "ambiguous" ? { note: "not attributed - ambiguous match", candidates: a.candidates.map((t) => ({ tenant: t.name, prod_trend: pct(t.trendPct), prod_requests_last_28d: t.prodReqL28 })) } : {
      prod_trend_28d: pct(a.usage.trendPct), trend_class: a.usage.trendClass, prod_requests_last_28d: a.usage.prodL28, prod_requests_prior_28d: a.usage.prodP28,
      tokens_trend: pct(a.usage.tokensTrend), transcribe_trend: pct(a.usage.transcribeTrend), signals_agree: a.usage.agreement,
      sandbox_requests_last_28d: a.usage.sandboxL28, sandbox_requests_prior_28d: a.usage.sandboxP28,
      tenants: a.tenants.map((t) => ({ tenant: t.name, region: t.region, prod_trend: pct(t.trendPct), weekly_prod_requests_oldest_first: t.weekly })),
    },
    findings: a.findings.map((f) => ({ tag: f.kind, signal: f.text, source: `${sourceTag(f.source)} ${f.source}`, confidence: f.confidence, caveat: f.caveat, meddpicc: f.meddpicc, suggested_action: `${f.action} (suggestion, not from the CRM)` })),
    meddpicc: a.meddpicc.map((m) => ({ element: `${m.letter} ${m.name}`, status: m.status, detail: m.detail, basis: m.basis, source: `[${m.source}]`, how_determined: m.how })),
    contacts: a.contacts.map((c) => ({ name: c.name, title: `${c.title} [CRM]`, role: `${c.role} (INFERRED from job title)`, email: c.email ?? "no real address (placeholder)", last_email: c.lastEmail ? `${c.lastEmailDirection} ${c.lastEmail} [CRM]` : "no recorded email exchange [CRM]" })),
    notes: a.notes,
    meetings: a.meetings,
    recent_activity: a.recent,
    open_tasks: a.openTasks,
    crm_next_step: a.nextStep,
    last_crm_contact: a.lastContactAt ? `${a.lastContactAt} (${a.daysSinceContact} days ago)` : null,
    suggested_next_step: `${a.nextStep_suggested} (suggestion, not from the CRM)`,
    priority: { score: a.priority, why: a.priorityWhy, note: "computed ranking score, not a CRM field" },
    overall_confidence: a.confidence,
    confidence_reason: a.confidenceWhy,
    caveats: a.caveats,
  };
}

const FILTERS: Record<string, (a: AccountView) => boolean> = {
  risk: (a) => a.findings.some((f) => f.kind === "risk"),
  grow: (a) => a.findings.some((f) => f.kind === "grow"),
  renewals: (a) => a.findings.some((f) => f.id === "renewal_soon"),
  closing_deals: (a) => a.findings.some((f) => f.id === "deal_closing"),
  pipeline: (a) => !!a.openOpp,
  watch: (a) => a.findings.some((f) => f.kind === "watch"),
  hygiene: (a) => a.findings.some((f) => f.kind === "hygiene"),
  all: () => true,
};

type Ctx = { book: Book; crm: CrmClient; confirm: (q: string) => Promise<boolean> };
type Tool = { def: ToolDef; run: (args: Record<string, unknown>, ctx: Ctx) => Promise<unknown> | unknown };

const fn = (name: string, description: string, properties: Record<string, unknown>, required: string[] = []): ToolDef => ({
  type: "function", function: { name, description, parameters: { type: "object", properties, required } },
});
const owner = { type: "string", description: "CRM owner id, e.g. jordan.lee. Omit for the whole book." };

export const TOOLS: Record<string, Tool> = {
  today_brief: {
    def: fn("today_brief", "Ranked list of accounts that need attention today, with the reason, next step and confidence for each.", { owner, limit: { type: "number" } }),
    run: (a, { book }) => {
      const o = a.owner as string | undefined, n = Number(a.limit ?? 8);
      const more = alsoNeedsAttention(book, o, n);
      return { as_of: TODAY, scope: o ?? "whole book", items: briefItems(book, o, n).map(summary),
        also_needs_attention: { count: more.length, note: "above the priority cut-off but not in today's top list; mention them", accounts: more.slice(0, 8).map((x) => ({ id: x.id, name: x.name, tag: x.kind, priority: x.priority, headline: `${x.headline} ${x.findings[0] ? sourceTag(x.findings[0].source) : ""}`.trim() })) } };
    },
  },
  get_account: {
    def: fn("get_account", "Everything known about one account: deal, renewal, contract, usage, findings, MEDDPICC assessment, contacts (roles inferred from titles), notes, meetings, recent activity, open tasks. Accepts an account id (acc_022) or a name.", { query: { type: "string" } }, ["query"]),
    run: (a, { book }) => {
      const r = findAccount(book, String(a.query ?? ""));
      if (r.account) return accountFacts(r.account);
      return { error: r.candidates.length ? "ambiguous name" : "no account found", candidates: r.candidates.map((c) => ({ id: c.id, name: c.name, stage: c.stage })) };
    },
  },
  find_accounts: {
    def: fn("find_accounts", "List accounts matching a filter, ranked by priority. Filters: risk, grow, renewals (renewing within 90 days), closing_deals (open deals closing within 45 days), pipeline (all open deals), watch, hygiene (CRM data problems), all.", {
      filter: { type: "string", enum: Object.keys(FILTERS) }, owner, stage: { type: "string", enum: ["prospect", "evaluation", "mvp", "customer", "closed_lost"] }, limit: { type: "number" } }, ["filter"]),
    run: (a, { book }) => {
      const f = FILTERS[String(a.filter)] ?? FILTERS.all;
      const rows = book.accounts.filter((x) => f(x) && (!a.owner || x.owner === a.owner) && (!a.stage || x.stage === a.stage));
      return { filter: a.filter, total_matching: rows.length, items: rows.slice(0, Number(a.limit ?? 10)).map(summary) };
    },
  },
  book_summary: {
    def: fn("book_summary", "Totals for the book (or one owner): counts by stage and tag, open pipeline, renewals due, data-quality caveats.", { owner }),
    run: (a, { book }) => {
      const rows = book.accounts.filter((x) => !a.owner || x.owner === a.owner);
      const count = (k: Kind) => rows.filter((x) => x.findings.some((f) => f.kind === k)).length;
      const open = rows.filter((x) => x.openOpp);
      const renew = rows.filter((x) => x.findings.some((f) => f.id === "renewal_soon"));
      const atRisk = rows.filter((x) => x.findings.some((f) => f.id === "declining_near_renewal"));
      return {
        as_of: TODAY, scope: a.owner ?? "whole book", accounts: rows.length,
        by_stage: Object.fromEntries(["customer", "evaluation", "mvp", "prospect", "closed_lost"].map((s) => [s, rows.filter((x) => x.stage === s).length])),
        accounts_with_risk_signal: count("risk"), accounts_with_growth_signal: count("grow"), needing_attention_today: briefItems(book, a.owner as string | undefined, 100).length,
        open_pipeline: { deals: open.length, value: money(open.reduce((s, x) => s + (x.openOpp?.value ?? 0), 0)) },
        renewals_within_90_days: { accounts: renew.length },
        renewal_value_at_risk: { accounts: atRisk.map((x) => x.id), value: money(atRisk.reduce((s, x) => s + (x.renewal?.value ?? x.contracts[0]?.amount ?? 0), 0)) },
        data_caveats: [
          `${rows.filter((x) => x.match.method === "ambiguous").length} accounts have ambiguous usage matches (duplicate CRM accounts) - usage not attributed`,
          `${rows.filter((x) => x.match.method === "name_only").length} accounts matched to usage by name only`,
          `${book.unmatchedCustomers.length} usage tenants have no CRM account: ${book.unmatchedCustomers.map((u) => u.name).join(", ")}`,
          "analytics alert history ignored: only 1 of 35 alerts matches its own threshold; low balances are recomputed from contracts",
          "about half of PRODUCTION-labelled usage comes from staging/qa/internal-named projects; only prod-named projects count as production",
        ],
      };
    },
  },
  whats_changed: {
    def: fn("whats_changed", "What happened recently: CRM activity (emails, meetings, notes, stage changes) in the last N days plus the biggest week-over-week production usage moves.", { days: { type: "number" }, owner }),
    run: (a, { book }) => {
      const days = Number(a.days ?? 7);
      const since = addDays(TODAY, -days + 1);
      const rows = book.accounts.filter((x) => !a.owner || x.owner === a.owner);
      const activity = rows.flatMap((x) => x.recent.filter((r) => r.date >= since).map((r) => ({ account: `${x.name} (${x.id})`, date: r.date, what: r.what }))).sort((p, q) => q.date.localeCompare(p.date));
      const movers = rows.filter((x) => x.match.method !== "ambiguous" && x.tenants.length).map((x) => {
        const w = x.tenants.reduce((acc, t) => t.weekly.map((v, i) => (acc[i] ?? 0) + v), [] as number[]);
        const last = w[w.length - 1] ?? 0, prev = w[w.length - 2] ?? 0;
        return { account: `${x.name} (${x.id})`, last_7d: last, prior_7d: prev, change: prev >= 100 ? pct(((last - prev) / prev) * 100) : "n/a" };
      }).filter((m) => m.change !== "n/a").sort((p, q) => Math.abs(parseFloat(q.change)) - Math.abs(parseFloat(p.change))).slice(0, 5);
      return { window: `${since}..${TODAY}`, crm_activity: activity.slice(0, 25), crm_activity_total: activity.length, biggest_weekly_usage_moves: movers,
        caveat: "CRM activity is sparse (1-3 records per account) and week-over-week usage moves are mostly noise; 28-day trends are the reliable usage signal." };
    },
  },
  get_usage: {
    def: fn("get_usage", "Product usage drill-down for one account from the analytics database: requests, tokens and transcription per metric (last 28 days vs prior 28), each project with its environment (production / non-production / sandbox), product mix (agents, models, API routes, languages, sources) and the weekly series. Use for 'what are they using', 'how many transcription minutes', 'which projects'.", { query: { type: "string", description: "account id or name" } }, ["query"]),
    run: (a, { book }) => {
      const r = findAccount(book, String(a.query ?? ""));
      if (!r.account) return { error: r.candidates.length ? "ambiguous name" : "no account found", candidates: r.candidates.map((c) => ({ id: c.id, name: c.name })) };
      const acc = r.account;
      if (acc.match.method === "ambiguous") return { account: `${acc.name} (${acc.id})`, error: "usage not attributed: ambiguous match", note: acc.match.note, candidates: acc.candidates.map((t) => ({ tenant: t.name, prod_trend: pct(t.trendPct), prod_requests_last_28d: t.prodReqL28 })) };
      const an = book.analytics;
      const projs = an.projects.filter((p) => acc.match.customerIds.includes(p.customer_id));
      const prodIds = new Set(projs.filter((p) => p.cls === "prod").map((p) => p.id));
      const sum = (ids: Set<string>, m: "requests" | "tokens" | "transcribe", w: "l28" | "p28") => [...ids].reduce((s, id) => s + (an.projectUsage.get(id)?.[m][w] ?? 0), 0);
      const metric = (m: "requests" | "tokens" | "transcribe", unit: string) => {
        const l = sum(prodIds, m, "l28"), p = sum(prodIds, m, "p28");
        return { last_28d: `${Math.round(l)} ${unit}`, prior_28d: `${Math.round(p)} ${unit}`, change: pct(p ? ((l - p) / p) * 100 : null) };
      };
      const dims = loadDimensions();
      const mix: Record<string, Array<{ value: string; share_of_requests: string }>> = {};
      for (const d of DIMENSIONS) {
        const rows = dims.filter((x) => prodIds.has(x[0]) && x[1] === "requests" && x[2] === d);
        const tot = rows.reduce((s, x) => s + x[4], 0);
        const by = new Map<string, number>();
        for (const x of rows) by.set(x[3], (by.get(x[3]) ?? 0) + x[4]);
        mix[d] = [...by].sort((p, q) => q[1] - p[1]).map(([value, q]) => ({ value, share_of_requests: tot ? `${Math.round((q / tot) * 100)}%` : "0%" }));
      }
      return {
        account: `${acc.name} (${acc.id})`, source: "[Usage] analytics usage_events, production-named projects, NFR excluded, last 28 days vs prior 28",
        match: `${acc.match.method} (${acc.match.confidence})`,
        tenants: acc.tenants.map((t) => `${t.name}${t.region ? ` (${t.region})` : ""}`),
        requests: metric("requests", "requests"), tokens: metric("tokens", "tokens"), transcription: metric("transcribe", "transcription units (unit not documented in the data)"),
        projects: projs.map((p) => ({ name: p.name, environment: p.cls === "prod" ? "production" : p.cls === "sandbox" ? "sandbox (trial)" : `non-production (by name; labelled ${p.environment_type})`,
          requests_last_28d: Math.round(an.projectUsage.get(p.id)?.requests.l28 ?? 0), requests_90d: Math.round(an.projectUsage.get(p.id)?.requests.total ?? 0) })),
        product_mix_last_28d: mix,
        product_mix_caveat: "In this dataset every customer shows the same fixed product mix, so the mix is descriptive only: it does not distinguish this account from others and is not used in ranking.",
        weekly_prod_requests_oldest_first: acc.tenants.reduce((s, t) => t.weekly.map((v, i) => (s[i] ?? 0) + v), [] as number[]),
      };
    },
  },
  usage_leaderboard: {
    def: fn("usage_leaderboard", "Rank accounts by product usage from the analytics database (last 28 days, production projects): biggest users, fastest growing or fastest declining.", {
      metric: { type: "string", enum: ["requests", "tokens", "transcribe"] }, order: { type: "string", enum: ["largest", "growing", "declining"] }, owner, stage: { type: "string", enum: ["prospect", "evaluation", "mvp", "customer", "closed_lost"] }, limit: { type: "number" } }, ["metric"]),
    run: (a, { book }) => {
      const m = (String(a.metric ?? "requests") as "requests" | "tokens" | "transcribe");
      const an = book.analytics;
      const rows = book.accounts.filter((x) => x.match.method !== "ambiguous" && x.tenants.length && (!a.owner || x.owner === a.owner) && (!a.stage || x.stage === a.stage)).map((x) => {
        const ids = an.projects.filter((p) => x.match.customerIds.includes(p.customer_id) && p.cls === "prod").map((p) => p.id);
        const l = ids.reduce((s, id) => s + (an.projectUsage.get(id)?.[m].l28 ?? 0), 0), p = ids.reduce((s, id) => s + (an.projectUsage.get(id)?.[m].p28 ?? 0), 0);
        return { account: `${x.name} (${x.id})`, stage: x.stage, owner: x.owner, last_28d: Math.round(l), prior_28d: Math.round(p), change_pct: p >= (m === "requests" ? 100 : 1) ? Math.round(((l - p) / p) * 100) : null };
      });
      const order = String(a.order ?? "largest");
      const sorted = order === "largest" ? rows.sort((x, y) => y.last_28d - x.last_28d)
        : rows.filter((r) => r.change_pct != null).sort((x, y) => (order === "growing" ? (y.change_pct! - x.change_pct!) : (x.change_pct! - y.change_pct!)));
      return { source: `[Usage] ${m}, production-named projects, last 28 days vs prior 28; ambiguous-match accounts excluded`, order, items: sorted.slice(0, Number(a.limit ?? 10)).map((r) => ({ ...r, change: r.change_pct == null ? "n/a" : pct(r.change_pct) })) };
    },
  },
  off_topic: {
    def: fn("off_topic", "Call this (and only this) when the question is NOT about the AE's accounts, contacts, deals, renewals, pipeline, MEDDPICC, product usage/billing or CRM tasks/notes - e.g. general knowledge, opinions, jokes, coding, personal questions.", {}),
    run: () => ({ status: "off topic" }),
  },
  create_task: {
    def: fn("create_task", "Create a CRM task on an account (asks the AE to confirm first).", { account_id: { type: "string" }, title: { type: "string" }, due_date: { type: "string", description: "YYYY-MM-DD" } }, ["account_id", "title"]),
    run: async (a, { book, crm, confirm }) => {
      const acc = book.byId.get(String(a.account_id));
      if (!acc) return { error: "unknown account_id" };
      if (!(await confirm(`Create task "${a.title}" on ${acc.name}${a.due_date ? ` due ${a.due_date}` : ""}?`))) return { status: "cancelled by the AE" };
      const r = await crm.createTask({ accountId: acc.id, title: String(a.title), dueDate: a.due_date ? String(a.due_date) : undefined });
      return { status: "created", task_id: r.task.id, note: "The mock CRM does not persist writes; this task won't appear on re-read." };
    },
  },
  add_note: {
    def: fn("add_note", "Add a note to an account in the CRM (asks the AE to confirm first).", { account_id: { type: "string" }, text: { type: "string" } }, ["account_id", "text"]),
    run: async (a, { book, crm, confirm }) => {
      const acc = book.byId.get(String(a.account_id));
      if (!acc) return { error: "unknown account_id" };
      if (!(await confirm(`Add note to ${acc.name}: "${a.text}"?`))) return { status: "cancelled by the AE" };
      const r = await crm.addNote(acc.id, String(a.text));
      return { status: "created", note_id: (r.note as { id: string }).id, note: "The mock CRM does not persist writes." };
    },
  },
};

export const toolDefs = () => Object.values(TOOLS).map((t) => t.def);
export { daysAgo };
