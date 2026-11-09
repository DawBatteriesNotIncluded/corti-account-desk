/**
 * The "book": every CRM account joined to its product usage and contract,
 * with deterministic findings (signals), a MEDDPICC read and an explainable
 * priority. The LLM never computes any of this - it only explains it.
 */
import { THRESHOLDS as TH, TODAY, daysAgo, daysFromToday } from "./config.ts";
import type { Activity, Contact, CrmBundle, Opportunity, Task } from "./crm/client.ts";
import { pctChange, type Analytics, type Contract, type Customer, type TenantUsage } from "./analytics/usage.ts";
import { resolveAccounts, type Match } from "./join/resolve.ts";

export type Kind = "risk" | "grow" | "renewal" | "watch" | "hygiene";
export type Confidence = "high" | "medium" | "low";
export type Letter = "M" | "E" | "D1" | "D2" | "P" | "I" | "C1" | "C2";

export type Finding = {
  id: string;
  kind: Kind;
  points: number;
  text: string; // one line, numbers already formatted
  source: string; // where the evidence comes from
  confidence: Confidence;
  caveat?: string;
  action: string;
  meddpicc?: Letter;
};

/** basis: "data" = read directly from a record; "inferred" = our interpretation (title, keyword or email-direction rules). */
export type MeddpiccItem = { letter: Letter; name: string; status: "evidence" | "concern" | "unknown"; detail: string; basis?: "data" | "inferred"; source?: string; how?: string };

/** Short source tag shown next to every fact: where it came from. */
export function sourceTag(source: string): string {
  const s = source.toLowerCase();
  const tags = [s.includes("crm") && "CRM", s.includes("usage") && "Usage", s.includes("contract") && "Billing", s.includes("join") && "Match"].filter(Boolean);
  return `[${tags.join("+") || "Derived"}${s.includes("derived") ? ", estimate" : ""}]`;
}

const MEDDPICC_BASIS: Record<Letter, { basis: "data" | "inferred"; source: string; how: string }> = {
  M: { basis: "data", source: "Usage+Billing", how: "28-day production usage trend and contract balance, read from analytics" },
  E: { basis: "inferred", source: "CRM contacts+emails", how: "economic buyer INFERRED from job title (Chief/VP/Head of); CRM persona field is unreliable" },
  D1: { basis: "inferred", source: "CRM next steps+tasks", how: "INFERRED by keyword match (security, questionnaire, deep-dive, go-live)" },
  D2: { basis: "data", source: "CRM opportunity", how: "deal stage and close date as recorded" },
  P: { basis: "inferred", source: "CRM next steps+tasks", how: "INFERRED by keyword match (legal, contract, proposal, pricing, budget, renewal)" },
  I: { basis: "data", source: "CRM meetings+notes+tasks", how: "negative meetings, concern notes, support-ticket tasks as recorded" },
  C1: { basis: "inferred", source: "CRM emails+notes", how: "champion INFERRED from who emailed us (inbound) or 'no response' notes" },
  C2: { basis: "data", source: "CRM notes", how: "only from notes mentioning price loss or competitors" },
};

export type ContactView = {
  id: string;
  name: string;
  title: string | null;
  role: "executive" | "technical" | "operator";
  email: string | null;
  lastEmail: string | null;
  lastEmailDirection: "inbound" | "outbound" | null;
};

export type TenantView = {
  customerId: string;
  name: string;
  region: string | null;
  prodReqL28: number;
  prodReqP28: number;
  trendPct: number | null;
  sandboxReqL28: number;
  sandboxReqP28: number;
  totalReq90: number;
  weekly: number[];
  firstUsage: string | null;
  createdAt: string | null;
};

export type AccountView = {
  id: string;
  name: string;
  stage: string;
  owner: string | null;
  industry: string | null;
  employees: number | null;
  icpTier: string | null;
  domain: string | null;
  lastContactAt: string | null;
  daysSinceContact: number | null;
  nextStep: string | null;
  match: Match;
  tenants: TenantView[];
  candidates: TenantView[]; // populated when ambiguous
  usage: { prodL28: number; prodP28: number; trendPct: number | null; trendClass: "growing" | "declining" | "flat" | "low_volume" | "none"; tokensTrend: number | null; transcribeTrend: number | null; sandboxL28: number; sandboxP28: number; total90: number; agreement: "agrees" | "mixed" | "n/a" };
  contracts: Array<Contract & { balancePct: number; daysToEnd: number; burnPerDay: number; runwayDays: number | null; low: boolean }>;
  openOpp: (Opportunity & { daysToClose: number | null }) | null;
  renewal: (Opportunity & { daysToRenewal: number | null }) | null;
  contacts: ContactView[];
  notes: Array<{ date: string; text: string }>;
  meetings: Array<{ date: string; outcome: string | null }>;
  recent: Array<{ date: string; what: string }>;
  openTasks: Array<{ title: string; due: string | null; overdue: boolean }>;
  findings: Finding[];
  meddpicc: MeddpiccItem[];
  priority: number;
  priorityWhy: string[];
  kind: Kind | null;
  headline: string;
  nextStep_suggested: string;
  confidence: Confidence;
  /** why the account got that confidence (headline signal + match) */
  confidenceWhy: string;
  caveats: string[];
};

export type Book = {
  accounts: AccountView[];
  byId: Map<string, AccountView>;
  unmatchedCustomers: Array<{ id: string; name: string; contract: number | null; prodReqL28: number }>;
  asOf: string;
  /** raw analytics, for usage drill-downs (get_usage / usage_leaderboard) */
  analytics: Analytics;
};

// ---------- formatting helpers (facts are pre-formatted so the LLM copies, not computes) ----------
export const money = (v: number | null | undefined) =>
  v == null ? "n/a" : v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(2)}M` : v >= 1000 ? `$${Math.round(v / 1000)}k` : `$${Math.round(v)}`;
export const pct = (v: number | null | undefined) => (v == null ? "n/a" : `${v > 0 ? "+" : ""}${Math.round(v)}%`);
export const fmtDate = (d: string | null | undefined) => (d ? d.slice(0, 10) : "n/a");

function contactRole(title: string | null): ContactView["role"] {
  const t = title ?? "";
  if (/engineer|architect|^it director|^cto$|vp engineering/i.test(t)) return "technical";
  if (/^chief|^vp\b|^head of/i.test(t)) return "executive";
  return "operator";
}

function tenantView(c: Customer, u: TenantUsage | undefined): TenantView {
  const r = u?.byClass;
  const prod = r?.prod.requests ?? { l28: 0, p28: 0, total: 0 };
  const sb = r?.sandbox.requests ?? { l28: 0, p28: 0, total: 0 };
  const non = r?.nonprod.requests ?? { total: 0 };
  return {
    customerId: c.id,
    name: c.customer_name,
    region: c.region,
    prodReqL28: Math.round(prod.l28),
    prodReqP28: Math.round(prod.p28),
    trendPct: pctChange(prod.l28, prod.p28),
    sandboxReqL28: Math.round(sb.l28),
    sandboxReqP28: Math.round(sb.p28),
    totalReq90: Math.round(prod.total + sb.total + non.total),
    weekly: (u?.weeklyProdRequests ?? []).map(Math.round),
    firstUsage: u?.firstUsage ?? null,
    createdAt: c.created_at?.slice(0, 10) ?? null,
  };
}

const classify = (l: number, p: number): AccountView["usage"]["trendClass"] => {
  if (!l && !p) return "none";
  if (p < TH.minPriorRequests) return "low_volume";
  const ch = ((l - p) / p) * 100;
  return ch >= TH.trendPct ? "growing" : ch <= -TH.trendPct ? "declining" : "flat";
};

const RISK_NOTE = /(concern|dissatisf|no response|unclear|lost|quiet|low priority|unhappy|issue|churn)/i;

export function buildBook(crm: CrmBundle[], an: Analytics): Book {
  const { matches, unmatchedCustomers } = resolveAccounts(crm.map((b) => b.account), an.customers);
  const custById = new Map(an.customers.map((c) => [c.id, c]));
  const contractsByCust = new Map<string, Contract[]>();
  for (const k of an.contracts) contractsByCust.set(k.customer_id, [...(contractsByCust.get(k.customer_id) ?? []), k]);

  const accounts = crm.map((b) => buildAccount(b, matches.get(b.account.id)!, custById, contractsByCust, an));
  accounts.sort((a, b) => b.priority - a.priority);
  return {
    accounts,
    byId: new Map(accounts.map((a) => [a.id, a])),
    unmatchedCustomers: unmatchedCustomers.map((c) => ({
      id: c.id,
      name: c.customer_name,
      contract: contractsByCust.get(c.id)?.[0]?.amount ?? null,
      prodReqL28: Math.round(an.usage.get(c.id)?.byClass.prod.requests.l28 ?? 0),
    })),
    asOf: TODAY,
    analytics: an,
  };
}

function buildAccount(
  b: CrmBundle,
  match: Match,
  custById: Map<string, Customer>,
  contractsByCust: Map<string, Contract[]>,
  an: Analytics,
): AccountView {
  const a = b.account;
  const tenants = match.customerIds.map((id) => tenantView(custById.get(id)!, an.usage.get(id)));
  const candidates = match.method === "ambiguous" ? match.candidateIds.map((id) => tenantView(custById.get(id)!, an.usage.get(id))) : [];

  // ---- usage (only attributed tenants) ----
  const sum = (f: (u: TenantUsage) => number) => match.customerIds.reduce((s, id) => s + (an.usage.get(id) ? f(an.usage.get(id)!) : 0), 0);
  const prodL28 = sum((u) => u.byClass.prod.requests.l28);
  const prodP28 = sum((u) => u.byClass.prod.requests.p28);
  const trendPct = pctChange(prodL28, prodP28);
  const tokensTrend = pctChange(sum((u) => u.byClass.prod.tokens.l28), sum((u) => u.byClass.prod.tokens.p28));
  const transcribeTrend = pctChange(sum((u) => u.byClass.prod.transcribe.l28), sum((u) => u.byClass.prod.transcribe.p28));
  const trendClass = classify(prodL28, prodP28);
  const sign = (v: number | null) => (v == null ? 0 : v >= TH.trendPct ? 1 : v <= -TH.trendPct ? -1 : 0);
  const agreement: AccountView["usage"]["agreement"] =
    trendClass === "growing" || trendClass === "declining" ? ([tokensTrend, transcribeTrend].every((t) => sign(t) === sign(trendPct)) ? "agrees" : "mixed") : "n/a";
  const usage = {
    prodL28: Math.round(prodL28),
    prodP28: Math.round(prodP28),
    trendPct,
    trendClass,
    tokensTrend,
    transcribeTrend,
    sandboxL28: Math.round(sum((u) => u.byClass.sandbox.requests.l28)),
    sandboxP28: Math.round(sum((u) => u.byClass.sandbox.requests.p28)),
    total90: tenants.reduce((s, t) => s + t.totalReq90, 0),
    agreement,
  };

  // ---- contracts ----
  const contracts = match.customerIds.flatMap((id) => contractsByCust.get(id) ?? []).map((k) => {
    const elapsed = Math.max(1, daysAgo(k.starting_at));
    const burnPerDay = (k.amount - k.balance) / elapsed;
    const runwayDays = burnPerDay > 0 ? Math.round(k.balance / burnPerDay) : null;
    const balancePct = Math.round((k.balance / k.amount) * 1000) / 10;
    return { ...k, balancePct, daysToEnd: daysFromToday(k.ending_before), burnPerDay, runwayDays, low: k.balance / k.amount <= (TH.lowBalance[k.type] ?? 0.15) };
  });

  // ---- CRM ----
  const openRaw = b.opportunities.find((o) => o.status === "open") ?? null;
  const openOpp = openRaw ? { ...openRaw, daysToClose: openRaw.closeDate ? daysFromToday(openRaw.closeDate) : null } : null;
  const wonRaw = b.opportunities.find((o) => o.status === "won" && o.closeDate && o.closeDate >= TODAY) ?? null;
  const renewal = wonRaw ? { ...wonRaw, daysToRenewal: wonRaw.closeDate ? daysFromToday(wonRaw.closeDate) : null } : null;

  const lastEmail = new Map<string, { date: string; dir: "inbound" | "outbound" }>();
  for (const act of b.activities) {
    if (act.type === "email" && act.contactId && !lastEmail.has(act.contactId)) lastEmail.set(act.contactId, { date: act.timestamp.slice(0, 10), dir: act.direction });
  }
  const placeholder = (e: string | null) => (e && !e.endsWith("@example.invalid") ? e : null);
  const contacts: ContactView[] = b.contacts.map((c: Contact) => ({
    id: c.id,
    name: c.name,
    title: c.title,
    role: contactRole(c.title),
    email: placeholder(c.email),
    lastEmail: lastEmail.get(c.id)?.date ?? null,
    lastEmailDirection: lastEmail.get(c.id)?.dir ?? null,
  }));
  const notes = b.activities.filter((x): x is Extract<Activity, { type: "note" }> => x.type === "note").map((n) => ({ date: n.timestamp.slice(0, 10), text: n.text }));
  const meetings = b.activities.filter((x): x is Extract<Activity, { type: "meeting" }> => x.type === "meeting").map((m) => ({ date: m.timestamp.slice(0, 10), outcome: m.outcome ?? null }));
  const cname = (id?: string | null) => b.contacts.find((c) => c.id === id)?.name ?? "unknown contact";
  const recent = b.activities.slice(0, 6).map((x) => ({
    date: x.timestamp.slice(0, 10),
    what:
      x.type === "email" ? `${x.direction} email ${x.direction === "inbound" ? "from" : "to"} ${cname(x.contactId)}: "${x.subject ?? ""}"`
      : x.type === "meeting" ? `meeting, outcome ${x.outcome ?? "not recorded"} (attendees not recorded)`
      : x.type === "note" ? `note: "${x.text}"`
      : `stage ${x.from ?? "?"} -> ${x.to}`,
  }));
  const openTasks = b.tasks.filter((t: Task) => !t.completed).map((t) => ({ title: t.title ?? "(untitled)", due: t.dueDate, overdue: !!t.dueDate && t.dueDate < TODAY }));

  const v: AccountView = {
    id: a.id, name: a.name, stage: a.stage, owner: a.ownerId, industry: a.industry, employees: a.employeeCount, icpTier: a.icpTier, domain: a.domain,
    lastContactAt: a.lastContactAt?.slice(0, 10) ?? null,
    daysSinceContact: a.lastContactAt ? daysAgo(a.lastContactAt) : null,
    nextStep: a.nextStep,
    match, tenants, candidates, usage, contracts, openOpp, renewal, contacts, notes, meetings, recent, openTasks,
    findings: [], meddpicc: [], priority: 0, priorityWhy: [], kind: null, headline: "", nextStep_suggested: "", confidence: "medium", confidenceWhy: "", caveats: [],
  };
  v.findings = detectFindings(v);
  v.meddpicc = assessMeddpicc(v);
  scoreAccount(v);
  return v;
}

// ---------- contacts helpers ----------
const best = (v: AccountView, role: ContactView["role"]) =>
  v.contacts.filter((c) => c.role === role).sort((x, y) => (y.lastEmail ?? "").localeCompare(x.lastEmail ?? ""))[0];
const who = (c?: ContactView) => (c ? `${c.name} (${c.title}; role inferred from title)` : "the account's main contact (no suitable contact in the CRM)");

// ---------- findings: the signal registry ----------
type Detector = (v: AccountView) => Finding | Finding[] | null;

const usageConf = (v: AccountView): Confidence => (v.match.confidence === "high" && v.usage.agreement !== "mixed" ? "high" : "medium");
const usageCaveat = (v: AccountView) =>
  [v.match.confidence !== "high" ? v.match.note : "", v.usage.agreement === "mixed" ? "tokens/transcribe trends disagree with requests" : ""].filter(Boolean).join("; ") || undefined;
const isCustomer = (v: AccountView) => v.stage === "customer";
const renewalDays = (v: AccountView) => {
  const ds = [v.renewal?.daysToRenewal, ...v.contracts.map((k) => k.daysToEnd)].filter((d): d is number => d != null && d >= 0);
  return ds.length ? Math.min(...ds) : null;
};

export const DETECTORS: Array<{ id: string; describe: string; detect: Detector }> = [
  {
    id: "declining_near_renewal",
    describe: "Customer usage declining with a renewal or contract end within 90 days",
    detect: (v) => {
      const d = renewalDays(v);
      if (!isCustomer(v) || v.usage.trendClass !== "declining" || d == null || d > TH.renewalSoonDays) return null;
      const exec = best(v, "executive");
      return { id: "declining_near_renewal", kind: "risk", points: 35, meddpicc: "M", confidence: usageConf(v), caveat: usageCaveat(v),
        text: `Production usage ${pct(v.usage.trendPct)} (last 28 days vs prior 28) with renewal in ${d} days${v.renewal ? ` (${money(v.renewal.value)})` : ""}`,
        source: `analytics usage_events + ${[v.renewal && "CRM renewal opportunity", v.contracts[0] && "analytics contract end"].filter(Boolean).join(" / ")}`,
        action: `Book a call with ${who(exec)} before the renewal; find out why usage dropped` };
    },
  },
  {
    id: "usage_declining",
    describe: "Production usage down >=15% (last 28d vs prior 28d)",
    detect: (v) => v.usage.trendClass !== "declining" ? null : ({ id: "usage_declining", kind: "risk", points: isCustomer(v) ? 20 : 8, meddpicc: "M", confidence: usageConf(v), caveat: usageCaveat(v),
      text: `Production requests ${pct(v.usage.trendPct)} (${v.usage.prodL28} vs ${v.usage.prodP28} in the prior 28 days)`, source: "analytics usage_events (prod-named projects, NFR excluded)",
      action: `Ask ${who(best(v, "technical"))} what changed in their usage` }),
  },
  {
    id: "usage_growing",
    describe: "Production usage up >=15%",
    detect: (v) => v.usage.trendClass !== "growing" ? null : ({ id: "usage_growing", kind: "grow", points: isCustomer(v) ? 12 : 15, meddpicc: "M", confidence: usageConf(v), caveat: usageCaveat(v),
      text: `Production requests ${pct(v.usage.trendPct)} (${v.usage.prodL28} vs ${v.usage.prodP28} in the prior 28 days)`, source: "analytics usage_events (prod-named projects, NFR excluded)",
      action: isCustomer(v) ? "Open an expansion conversation while usage is climbing" : `Usage is growing on a ${v.stage} account: re-engage ${who(best(v, "executive"))}` }),
  },
  {
    id: "negative_meeting",
    describe: "Most recent meeting recorded with a negative outcome",
    detect: (v) => {
      const m = v.meetings[0];
      if (!m || m.outcome !== "negative") return null;
      return { id: "negative_meeting", kind: "risk", points: 25, meddpicc: "I", confidence: "high", text: `Meeting on ${m.date} recorded as negative`, source: "CRM activities (meeting)", caveat: "meeting attendees are not recorded",
        action: `Follow up on the ${m.date} meeting with ${who(best(v, "executive"))}` };
    },
  },
  {
    id: "concern_note",
    describe: "CRM note signalling a concern",
    detect: (v) => {
      const n = v.notes.find((x) => RISK_NOTE.test(x.text));
      if (!n) return null;
      return { id: "concern_note", kind: v.stage === "closed_lost" || v.stage === "prospect" ? "watch" : "risk", points: v.stage === "closed_lost" || v.stage === "prospect" ? 5 : 15, meddpicc: /no response/i.test(n.text) ? "C1" : "I", confidence: "high",
        text: `Note ${n.date}: "${n.text}"`, source: "CRM activities (note)", action: "Address the concern in the note directly" };
    },
  },
  {
    id: "positive_meeting",
    describe: "Positive meeting in the last 14 days",
    detect: (v) => {
      const m = v.meetings[0];
      if (!m || m.outcome !== "positive" || daysAgo(m.date) > 14) return null;
      return { id: "positive_meeting", kind: "grow", points: 8, meddpicc: "I", confidence: "high", text: `Positive meeting on ${m.date}`, source: "CRM activities (meeting)", action: "Lock in the next step while momentum is there" };
    },
  },
  {
    id: "low_balance",
    describe: "Contract balance at/below the alert threshold (15% credit/postpaid, 20% prepaid) - recomputed, alert table ignored",
    detect: (v) => v.contracts.filter((k) => k.low).map((k) => ({ id: "low_balance", kind: "grow" as Kind, points: 20, meddpicc: "M" as Letter, confidence: "high" as Confidence,
      text: `${k.type} contract ${money(k.amount)} has ${k.balancePct}% (${money(k.balance)}) left, term ends ${fmtDate(k.ending_before)}`, source: "analytics contracts",
      action: `Propose a top-up or expansion before the balance runs out${v.usage.trendClass === "growing" ? " (usage is growing)" : ""}` })),
  },
  {
    id: "runway_short",
    describe: "Balance projected to run out within 60 days and before term end (linear burn assumption)",
    detect: (v) => v.contracts.filter((k) => !k.low && k.runwayDays != null && k.runwayDays <= TH.runwayAlertDays && k.runwayDays < k.daysToEnd).map((k) => ({
      id: "runway_short", kind: "grow" as Kind, points: 8, meddpicc: "M" as Letter, confidence: "low" as Confidence,
      text: `At the average spend since ${fmtDate(k.starting_at)}, the ${money(k.balance)} balance lasts ~${k.runwayDays} days, but the term runs ${k.daysToEnd} more days`,
      source: "analytics contracts (derived)", caveat: "assumes linear burn; contract balances don't track product usage in this data",
      action: "Check the balance with finance before raising a top-up" })),
  },
  {
    id: "renewal_soon",
    describe: "Renewal opportunity or contract end within 90 days",
    detect: (v) => {
      const d = renewalDays(v);
      if (d == null || d > TH.renewalSoonDays || !isCustomer(v)) return null;
      const val = v.renewal?.value ?? v.contracts[0]?.amount ?? null;
      return { id: "renewal_soon", kind: "renewal", points: d <= TH.renewalUrgentDays ? 15 : 10, meddpicc: "P", confidence: "high",
        text: `Renewal in ${d} days${val ? ` (${money(val)})` : ""}${v.renewal ? ` - CRM renewal date ${fmtDate(v.renewal.closeDate)}` : ""}${v.contracts[0] ? `, contract term ends ${fmtDate(v.contracts[0].ending_before)}` : ""}`,
        source: [v.renewal && "CRM won renewal opportunity", v.contracts[0] && "analytics contract end"].filter(Boolean).join(" / "), action: "Confirm renewal terms and the signatory",
        caveat: v.renewal && v.contracts[0] && Math.abs(daysFromToday(v.renewal.closeDate!) - v.contracts[0].daysToEnd) > 30 ? "CRM renewal date and contract end date disagree by over 30 days" : undefined };
    },
  },
  {
    id: "deal_closing",
    describe: "Open opportunity closing within 45 days",
    detect: (v) => {
      const o = v.openOpp;
      if (!o || o.daysToClose == null || o.daysToClose > TH.dealClosingDays) return null;
      return { id: "deal_closing", kind: "renewal", points: 15 + Math.min(10, Math.round((o.value ?? 0) / 100_000)), meddpicc: "D2", confidence: "high",
        text: `${o.name ?? "Open deal"} ${money(o.value)} (${o.stage}) closes in ${o.daysToClose} days, next step: ${o.nextStep ?? "none recorded"}`,
        source: "CRM opportunities", action: o.nextStep ? `Drive the next step: ${o.nextStep}` : "Agree a concrete next step and owner" };
    },
  },
  {
    id: "big_deal_low_engagement",
    describe: "Open deal >= $500k with < 500 product requests in 90 days",
    detect: (v) => {
      const o = v.openOpp;
      if (!o || (o.value ?? 0) < TH.bigDealValue || v.match.method === "ambiguous" || v.usage.total90 >= TH.bigDealLowUsage) return null;
      return { id: "big_deal_low_engagement", kind: "risk", points: 30, meddpicc: "C1", confidence: v.match.confidence === "high" ? "high" : "medium",
        text: `${money(o.value)} deal but only ${v.usage.total90} product requests in 90 days (trial: ${v.usage.sandboxL28} in the last 28 days vs ${v.usage.sandboxP28} before)`,
        source: "CRM opportunity + analytics usage_events", action: `Get a trial success plan agreed with ${who(best(v, "technical"))} before the close date` };
    },
  },
  {
    id: "trial_heating_up",
    describe: "Pre-customer account whose sandbox trial usage is growing",
    detect: (v) => {
      if (isCustomer(v) || v.stage === "closed_lost" || v.usage.sandboxP28 < TH.minPriorRequests) return null;
      const ch = pctChange(v.usage.sandboxL28, v.usage.sandboxP28);
      if (ch == null || ch < TH.trendPct) return null;
      return { id: "trial_heating_up", kind: "grow", points: 18, meddpicc: "M", confidence: usageConf(v), text: `Sandbox trial requests ${pct(ch)} (${v.usage.sandboxL28} vs ${v.usage.sandboxP28})`,
        source: "analytics usage_events (SANDBOX projects)", action: "Propose moving the trial into a production pilot" };
    },
  },
  {
    id: "lost_or_prospect_growing",
    describe: "Prospect / closed-lost account with growing production usage",
    detect: (v) => (v.stage !== "prospect" && v.stage !== "closed_lost") || v.usage.trendClass !== "growing" ? null : ({
      id: "lost_or_prospect_growing", kind: "grow", points: 15, meddpicc: "I", confidence: usageConf(v), caveat: usageCaveat(v),
      text: `CRM says ${v.stage}, but production usage is growing ${pct(v.usage.trendPct)}`, source: "CRM stage vs analytics usage",
      action: v.stage === "closed_lost" ? "Win-back: reach out with what they're already using" : "Open an opportunity - they're already using the product" }),
  },
  {
    id: "reactivated",
    describe: "Usage restarted after being dormant in the prior 28 days",
    detect: (v) => {
      const l = v.tenants.reduce((s, t) => s + t.totalReq90, 0);
      const anyPrior = v.tenants.some((t) => t.firstUsage && daysAgo(t.firstUsage) > 28);
      if (!l || anyPrior || !v.tenants.length || v.tenants.every((t) => t.createdAt && daysAgo(t.createdAt) <= 28)) return null;
      return { id: "reactivated", kind: "grow", points: 20, meddpicc: "I", confidence: "medium", text: `Usage restarted on ${v.tenants.map((t) => t.firstUsage).sort()[0]} after no activity earlier in the 90-day window`,
        source: "analytics usage_events", action: v.stage === "closed_lost" ? "Win-back: they came back on their own - call them" : "Find out what they're trying" };
    },
  },
  {
    id: "regional_divergence",
    describe: "One account, several tenants moving in opposite directions",
    detect: (v) => {
      if (v.tenants.length < 2) return null;
      const cls = v.tenants.map((t) => ({ t, c: classify(t.prodReqL28, t.prodReqP28) }));
      const up = cls.filter((x) => x.c === "growing"), down = cls.filter((x) => x.c === "declining");
      if (!up.length || !down.length) return null;
      return { id: "regional_divergence", kind: "watch", points: 15, meddpicc: "M", confidence: "high",
        text: `Tenants diverge: ${cls.map((x) => `${x.t.name} ${pct(x.t.trendPct)}`).join(", ")} - the account total (${pct(v.usage.trendPct)}) hides this`,
        source: "analytics usage_events per tenant", action: `Ask about the declining tenant (${down.map((x) => x.t.name).join(", ")})` };
    },
  },
  {
    id: "stage_contradiction",
    describe: "CRM stage contradicted by billing (prospect/closed-lost with an active contract)",
    detect: (v) => (v.stage === "prospect" || v.stage === "closed_lost") && v.contracts.length ? ({
      id: "stage_contradiction", kind: "hygiene", points: 6, confidence: "medium", text: `CRM stage is ${v.stage} but billing shows an active ${money(v.contracts[0].amount)} ${v.contracts[0].type} contract`,
      source: "CRM stage vs analytics contracts", action: "Check which system is right and fix the CRM stage", caveat: "contract presence doesn't depend on stage across this dataset, so treat as a hygiene flag" }) : null,
  },
  {
    id: "ambiguous_match",
    describe: "Account can't be matched to a single usage record",
    detect: (v) => v.match.method !== "ambiguous" ? null : ({ id: "ambiguous_match", kind: "hygiene", points: 3, confidence: "low", text: v.match.note, source: "join (name/domain)",
      action: "Confirm which usage record belongs to this account (duplicate CRM accounts?)" }),
  },
  {
    id: "quiet",
    describe: "Active account with no CRM contact for 14+ days",
    detect: (v) => (v.stage === "customer" || v.stage === "evaluation" || v.stage === "mvp") && (v.daysSinceContact ?? 0) > TH.quietDays ? ({
      id: "quiet", kind: "watch", points: 3, meddpicc: "C1", confidence: "medium", text: `No CRM contact for ${v.daysSinceContact} days (last ${v.lastContactAt})`, source: "CRM account lastContactAt", action: "Send a check-in" }) : null,
  },
];

function detectFindings(v: AccountView): Finding[] {
  const out: Finding[] = [];
  for (const d of DETECTORS) {
    const r = d.detect(v);
    if (r) out.push(...(Array.isArray(r) ? r : [r]));
  }
  // the combined finding already covers plain decline / renewal
  if (out.some((f) => f.id === "declining_near_renewal")) return out.filter((f) => f.id !== "usage_declining").sort((a, b) => b.points - a.points);
  return out.sort((a, b) => b.points - a.points);
}

// ---------- MEDDPICC ----------
const PAPER = /(legal|contract|proposal|pricing|budget|renewal|finalize|sign)/i;
const CRITERIA = /(security|questionnaire|technical deep-dive|deep-dive|implementation|go-live)/i;

function assessMeddpicc(v: AccountView): MeddpiccItem[] {
  const f = (id: string) => v.findings.find((x) => x.id === id);
  const execs = v.contacts.filter((c) => c.role === "executive");
  const execTouched = execs.filter((c) => c.lastEmail).sort((x, y) => (y.lastEmail ?? "").localeCompare(x.lastEmail ?? ""))[0];
  const inbound = v.contacts.filter((c) => c.lastEmailDirection === "inbound").sort((x, y) => (y.lastEmail ?? "").localeCompare(x.lastEmail ?? ""))[0];
  const steps = [v.nextStep, v.openOpp?.nextStep, ...v.openTasks.map((t) => t.title)].filter((s): s is string => !!s);
  const paper = steps.find((s) => PAPER.test(s));
  const criteria = steps.find((s) => CRITERIA.test(s));
  const out: MeddpiccItem[] = [];

  // M - Metrics
  if (v.match.method === "ambiguous" || v.match.method === "none") out.push({ letter: "M", name: "Metrics", status: "unknown", detail: "No usage attributed to this account (see match note)." });
  else {
    const low = v.contracts.find((k) => k.low);
    const decl = v.usage.trendClass === "declining";
    out.push({ letter: "M", name: "Metrics", status: decl ? "concern" : v.usage.trendClass === "none" && v.usage.sandboxL28 === 0 ? "unknown" : "evidence",
      detail: `Prod usage ${v.usage.trendClass} ${pct(v.usage.trendPct)} (${v.usage.prodL28} req last 28d)${v.usage.sandboxL28 ? `; trial ${v.usage.sandboxL28} req last 28d` : ""}${v.contracts[0] ? `; contract ${v.contracts[0].balancePct}% balance left` : ""}${low ? " (low)" : ""}.` });
  }
  // E - Economic buyer
  if (!execs.length) out.push({ letter: "E", name: "Economic buyer", status: "concern", detail: "No executive-level contact in the CRM." });
  else if (!execTouched) out.push({ letter: "E", name: "Economic buyer", status: "concern", detail: `Executive contacts exist (${execs.map((c) => `${c.name}, ${c.title}`).join("; ")}) but none has a recorded email exchange.` });
  else out.push({ letter: "E", name: "Economic buyer", status: "evidence", detail: `Likely EB: ${execTouched.name} (${execTouched.title}), last email ${execTouched.lastEmail}. Inferred from title; persona field is unreliable.` });
  // D - Decision criteria
  out.push(criteria ? { letter: "D1", name: "Decision criteria", status: "evidence", detail: `Criteria in play: "${criteria}".` } : { letter: "D1", name: "Decision criteria", status: "unknown", detail: "Not captured in the CRM." });
  // D - Decision process
  if (v.openOpp) {
    const o = v.openOpp;
    const late = o.daysToClose != null && o.daysToClose <= TH.dealClosingDays && o.stage === "evaluation";
    out.push({ letter: "D2", name: "Decision process", status: late ? "concern" : "evidence",
      detail: `${o.name ?? "Deal"} in ${o.stage}, closes ${fmtDate(o.closeDate)} (${o.daysToClose} days)${late ? " - still in evaluation that close to the date" : ""}.` });
  } else if (v.renewal) out.push({ letter: "D2", name: "Decision process", status: "evidence", detail: `Renewal ${money(v.renewal.value)} recorded as won, renewal date ${fmtDate(v.renewal.closeDate)}.` });
  else out.push({ letter: "D2", name: "Decision process", status: "unknown", detail: "No open or renewal opportunity." });
  // P - Paper process
  const closing = v.openOpp?.daysToClose ?? v.renewal?.daysToRenewal ?? null;
  if (paper) out.push({ letter: "P", name: "Paper process", status: "evidence", detail: `Paper step recorded: "${paper}".` });
  else if (closing != null && closing <= 45) out.push({ letter: "P", name: "Paper process", status: "concern", detail: `Closing in ${closing} days with no legal/contract step recorded.` });
  else out.push({ letter: "P", name: "Paper process", status: "unknown", detail: "No paper-process step recorded." });
  // I - Identify pain
  const pains = [f("negative_meeting")?.text, f("concern_note")?.meddpicc === "I" ? f("concern_note")?.text : undefined, v.openTasks.some((t) => /support ticket/i.test(t.title)) ? "Open support-ticket task" : undefined].filter(Boolean);
  if (pains.length) out.push({ letter: "I", name: "Identify pain", status: "concern", detail: `Pain/dissatisfaction signals: ${pains.join("; ")}.` });
  else if (f("positive_meeting") || f("trial_heating_up") || f("usage_growing")) out.push({ letter: "I", name: "Identify pain", status: "evidence", detail: "Engagement signals (positive meeting / growing usage) suggest an active need." });
  else out.push({ letter: "I", name: "Identify pain", status: "unknown", detail: "No pain captured in notes or meetings." });
  // C - Champion
  const quietNote = v.notes.find((n) => /no response|quiet/i.test(n.text));
  if (quietNote) out.push({ letter: "C1", name: "Champion", status: "concern", detail: `Champion gone quiet: note ${quietNote.date} "${quietNote.text}".` });
  else if (inbound) out.push({ letter: "C1", name: "Champion", status: "evidence", detail: `Engaged contact: ${inbound.name} (${inbound.title}) emailed us on ${inbound.lastEmail}.` });
  else out.push({ letter: "C1", name: "Champion", status: "unknown", detail: "No inbound engagement from any contact recorded." });
  // C - Competition
  const lostNote = v.notes.find((n) => /lost on price|competit/i.test(n.text));
  out.push(lostNote ? { letter: "C2", name: "Competition", status: "concern", detail: `Previously: "${lostNote.text}".` } : { letter: "C2", name: "Competition", status: "unknown", detail: "Not captured in the CRM." });
  return out.map((m) => {
    const b = MEDDPICC_BASIS[m.letter];
    // "I" built from engagement signals (not a recorded pain) is our interpretation, not a record
    const basis = m.letter === "I" && m.status === "evidence" ? "inferred" : b.basis;
    return { ...m, basis, source: b.source, how: m.letter === "I" && basis === "inferred" ? "INFERRED from engagement (growing usage / positive meeting); no pain is recorded" : b.how };
  });
}

// ---------- priority ----------
function scoreAccount(v: AccountView) {
  const why: string[] = [];
  const signal = v.findings.filter((f) => f.kind !== "hygiene").reduce((s, f) => s + f.points, 0);
  if (signal) why.push(`signals +${signal} (${v.findings.filter((f) => f.kind !== "hygiene").map((f) => f.id).join(", ")})`);
  const value = Math.max(v.openOpp?.value ?? 0, v.renewal?.value ?? 0, ...v.contracts.map((k) => k.amount));
  const valuePts = signal ? Math.min(15, Math.round(value / 70_000)) : 0;
  if (valuePts) why.push(`value at stake ${money(value)} +${valuePts}`);
  // Account confidence = confidence of the finding that drives the ranking (the headline),
  // capped by how sure we are this is the right usage record. Weakest link wins.
  const RANKC: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };
  const lead = v.findings.find((f) => f.kind !== "hygiene");
  const leadConf: Confidence = lead?.confidence ?? "medium";
  v.confidence = RANKC[leadConf] <= RANKC[v.match.confidence] ? leadConf : v.match.confidence;
  v.confidenceWhy = !lead
    ? "no ranked signal"
    : `${v.confidence}: headline signal is ${leadConf}${lead.caveat ? ` (${lead.caveat})` : ""}; account match is ${v.match.confidence} (${v.match.method})`;
  const factor = v.match.method === "ambiguous" ? 0.7 : v.match.confidence === "medium" ? 0.85 : 1;
  if (factor < 1) why.push(`x${factor} for match confidence (${v.match.method})`);
  v.priority = Math.round((signal + valuePts) * factor);
  const top = v.findings.find((f) => f.kind !== "hygiene") ?? v.findings[0];
  v.kind = top?.kind ?? null;
  v.headline = top?.text ?? "Nothing notable in the data.";
  v.nextStep_suggested = top?.action ?? "Nothing needed today.";
  v.priorityWhy = why;
  v.caveats = [...new Set(v.findings.map((f) => f.caveat).filter((c): c is string => !!c))];
  if (v.match.confidence !== "high") v.caveats.unshift(v.match.note);
}

/**
 * Today's list: the strongest "protect revenue" items plus the strongest
 * "grow revenue" items, so growth isn't crowded out by risk.
 */
export function briefItems(book: Book, owner?: string | null, limit = 8): AccountView[] {
  const pool = book.accounts.filter((a) => (!owner || a.owner === owner) && a.priority >= TH.briefMinPriority);
  const growN = Math.max(1, Math.round(limit * 0.375));
  const grow = pool.filter((a) => a.kind === "grow").slice(0, growN);
  const protect = pool.filter((a) => a.kind !== "grow").slice(0, limit - grow.length);
  const picked = new Set([...protect, ...grow]);
  for (const a of pool) if (picked.size < limit) picked.add(a);
  return [...picked].sort((x, y) => y.priority - x.priority);
}
