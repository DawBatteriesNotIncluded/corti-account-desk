/**
 * Analytics layer: one aggregation pass over usage_events (2.18M rows, ~30 s),
 * cached to .cache/ keyed on the DB file's size + mtime. Everything else is
 * computed in memory from the daily per-project aggregate.
 */
import Database from "better-sqlite3";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ANALYTICS_DB, CACHE_DIR, TODAY, WINDOWS, addDays, daysBetween } from "../config.ts";

export type Customer = {
  id: string;
  customer_name: string;
  billing_email: string | null;
  domain: string | null;
  region: string | null;
  environment_type: string;
  created_at: string | null;
};

export type Contract = {
  id: string;
  customer_id: string;
  type: string;
  amount: number;
  balance: number;
  starting_at: string;
  ending_before: string;
};

export type ProjectClass = "prod" | "nonprod" | "sandbox";

export type Project = {
  id: string;
  customer_id: string;
  name: string;
  environment_type: string;
  cls: ProjectClass;
};

/** Daily aggregate row: project, event type (r|k|s), day offset from window start, quantity. */
type DailyRow = [string, "r" | "k" | "s", number, number];
type Cache = { start: string; rows: DailyRow[] };

const NONPROD_NAME = /-(staging|qa|internal|sandbox|test|trial|eval)\d*$/i;

/**
 * The SANDBOX label is right, but ~50% of PRODUCTION-labelled usage comes from
 * projects *named* staging/qa/internal. We trust the name over the label.
 */
export function classifyProject(name: string, env: string): ProjectClass {
  if (env === "SANDBOX") return "sandbox";
  return NONPROD_NAME.test(name) ? "nonprod" : "prod";
}

export type Metric = "requests" | "tokens" | "transcribe";
const T2M: Record<string, Metric> = { r: "requests", k: "tokens", s: "transcribe" };

export type TenantUsage = {
  customerId: string;
  /** per class per metric: [l28, p28, total90] */
  byClass: Record<ProjectClass, Record<Metric, { l28: number; p28: number; l7: number; p7: number; total: number }>>;
  /** prod requests per 7-day week, oldest first, last entry = week ending today */
  weeklyProdRequests: number[];
  firstUsage: string | null;
  firstProdUsage: string | null;
};

export type ProjectUsage = Record<Metric, { l28: number; p28: number; total: number }>;

export type Analytics = {
  customers: Customer[];
  contracts: Contract[];
  projects: Project[];
  usage: Map<string, TenantUsage>;
  projectUsage: Map<string, ProjectUsage>;
  windowStart: string;
};

export const DIMENSIONS = ["agent_used", "model_name", "route", "language_used", "source"] as const;
export type Dimension = (typeof DIMENSIONS)[number];
/** [project_id, metric, dimension, value, quantity] for the last 28 days, NFR excluded */
type DimRow = [string, Metric, Dimension, string, number];
let dimCache: DimRow[] | null = null;

/** Product-mix aggregate (last 28 days). Built once on first use, then cached on disk. */
export function loadDimensions(onProgress?: (msg: string) => void): DimRow[] {
  if (dimCache) return dimCache;
  const st = statSync(ANALYTICS_DB);
  const file = resolve(CACHE_DIR, `usage-dims-${st.size}-${Math.round(st.mtimeMs)}-${WINDOWS.l28.from}.json`);
  if (existsSync(file)) return (dimCache = JSON.parse(readFileSync(file, "utf8")) as DimRow[]);
  onProgress?.("First product-mix question: aggregating usage dimensions (one-off, ~30 s)...");
  const db = openDb();
  try {
    const rows: DimRow[] = [];
    const m: Record<string, Metric> = { request: "requests", tokens: "tokens", transcribe: "transcribe" };
    for (const dim of DIMENSIONS) {
      const r = db.prepare(`SELECT project_id p, event_type t, COALESCE(NULLIF(${dim}, ''), '(none)') v, SUM(quantity) q FROM usage_events
        WHERE is_nfr = 0 AND event_date BETWEEN ? AND ? GROUP BY 1, 2, 3`).all(WINDOWS.l28.from, WINDOWS.l28.to) as Array<{ p: string; t: string; v: string; q: number }>;
      for (const x of r) rows.push([x.p, m[x.t], dim, x.v, Math.round(x.q * 100) / 100]);
    }
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(file, JSON.stringify(rows));
    return (dimCache = rows);
  } finally {
    db.close();
  }
}

function openDb() {
  if (!existsSync(ANALYTICS_DB)) {
    throw new Error(`Analytics DB not found at ${ANALYTICS_DB}. Copy data/ from the challenge zip.`);
  }
  return new Database(ANALYTICS_DB, { readonly: true, fileMustExist: true });
}

function loadDaily(db: Database.Database, onProgress?: (msg: string) => void): Cache {
  const st = statSync(ANALYTICS_DB);
  const key = `${st.size}-${Math.round(st.mtimeMs)}`;
  const file = resolve(CACHE_DIR, `usage-daily-${key}.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8")) as Cache;

  onProgress?.("First run: aggregating 2.2M usage events (one-off, ~30-60 s)...");
  const start = (db.prepare("SELECT MIN(event_date) d FROM usage_events").get() as { d: string }).d;
  const rows = db
    .prepare(
      `SELECT project_id p, event_type t, CAST(julianday(event_date) - julianday(?) AS INTEGER) d, SUM(quantity) q
       FROM usage_events WHERE is_nfr = 0
       GROUP BY project_id, event_type, event_date`,
    )
    .all(start) as Array<{ p: string; t: string; d: number; q: number }>;
  const short: Record<string, "r" | "k" | "s"> = { request: "r", tokens: "k", transcribe: "s" };
  const cache: Cache = { start, rows: rows.map((r) => [r.p, short[r.t], r.d, Math.round(r.q * 100) / 100]) };
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(file, JSON.stringify(cache));
  return cache;
}

const inWin = (date: string, w: { from: string; to: string }) => date >= w.from && date <= w.to;

export function loadAnalytics(onProgress?: (msg: string) => void): Analytics {
  const db = openDb();
  try {
    const customers = db.prepare("SELECT id, customer_name, billing_email, domain, region, environment_type, created_at FROM customers").all() as Customer[];
    const contracts = db.prepare("SELECT id, customer_id, type, amount, balance, starting_at, ending_before FROM contracts").all() as Contract[];
    const projects = (db.prepare("SELECT id, customer_id, name, environment_type FROM projects").all() as Omit<Project, "cls">[]).map(
      (p) => ({ ...p, cls: classifyProject(p.name, p.environment_type) }),
    );
    const daily = loadDaily(db, onProgress);
    const projById = new Map(projects.map((p) => [p.id, p]));
    const usage = new Map<string, TenantUsage>();
    const blank = () => ({ l28: 0, p28: 0, l7: 0, p7: 0, total: 0 });
    const weeks = 12;

    for (const c of customers) {
      usage.set(c.id, {
        customerId: c.id,
        byClass: {
          prod: { requests: blank(), tokens: blank(), transcribe: blank() },
          nonprod: { requests: blank(), tokens: blank(), transcribe: blank() },
          sandbox: { requests: blank(), tokens: blank(), transcribe: blank() },
        },
        weeklyProdRequests: new Array(weeks).fill(0),
        firstUsage: null,
        firstProdUsage: null,
      });
    }
    const projectUsage = new Map<string, ProjectUsage>();
    const pblank = () => ({ l28: 0, p28: 0, total: 0 });
    for (const [pid, t, d, q] of daily.rows) {
      const proj = projById.get(pid);
      if (!proj) continue;
      if (!projectUsage.has(pid)) projectUsage.set(pid, { requests: pblank(), tokens: pblank(), transcribe: pblank() });
      const pu = projectUsage.get(pid)![T2M[t]];
      const pdate = addDays(daily.start, d);
      pu.total += q;
      if (inWin(pdate, WINDOWS.l28)) pu.l28 += q;
      if (inWin(pdate, WINDOWS.p28)) pu.p28 += q;
      const u = usage.get(proj.customer_id);
      if (!u) continue;
      const date = addDays(daily.start, d);
      const m = u.byClass[proj.cls][T2M[t]];
      m.total += q;
      if (inWin(date, WINDOWS.l28)) m.l28 += q;
      if (inWin(date, WINDOWS.p28)) m.p28 += q;
      if (inWin(date, WINDOWS.l7)) m.l7 += q;
      if (inWin(date, WINDOWS.p7)) m.p7 += q;
      if (!u.firstUsage || date < u.firstUsage) u.firstUsage = date;
      if (proj.cls === "prod") {
        if (!u.firstProdUsage || date < u.firstProdUsage) u.firstProdUsage = date;
        if (t === "r") {
          const wkFromEnd = Math.floor(daysBetween(date, TODAY) / 7); // 0 = week ending today
          if (wkFromEnd < weeks) u.weeklyProdRequests[weeks - 1 - wkFromEnd] += q;
        }
      }
    }
    return { customers, contracts, projects, usage, projectUsage, windowStart: daily.start };
  } finally {
    db.close();
  }
}

export function pctChange(l: number, p: number): number | null {
  if (!p) return l ? null : 0;
  return Math.round(((l - p) / p) * 1000) / 10;
}
