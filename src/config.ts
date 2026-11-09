/**
 * Central configuration. Everything time-relative is anchored on TODAY, the
 * last day present in both datasets (see docs/DECISIONS.md#reference-date).
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

/** Both CRM and analytics data end on this day; treat it as "today". */
export const TODAY = process.env.AE_TODAY ?? "2025-03-14";

export const CRM_BASE =
  process.env.CRM_BASE_URL ??
  `http://${process.env.CRM_HOST ?? "localhost"}:${process.env.CRM_PORT ?? "3001"}`;

export const ANALYTICS_DB =
  process.env.ANALYTICS_DB ?? resolve(ROOT, "data/analytics/analytics.sqlite");

export const CACHE_DIR = resolve(ROOT, ".cache");

/** Model used by the chat agent (tool selection + answer writing). */
// corti-s1-instant: same tool-calling quality in our tests at ~1/3 the latency of corti-s1 (10-15 s vs 30-40 s per answer).
export const CHAT_MODEL = process.env.AE_MODEL ?? "corti-s1-instant";

/** Signal thresholds. Tuned on the data inventory (docs/data-inventory.md). */
export const THRESHOLDS = {
  trendPct: 15, // +/- % change last-28d vs prior-28d to call growing/declining
  minPriorRequests: 100, // below this the trend is "low volume", not called
  renewalSoonDays: 90,
  renewalUrgentDays: 45,
  dealClosingDays: 45,
  bigDealValue: 500_000,
  bigDealLowUsage: 500, // requests in 90 days
  lowBalance: { credit: 0.15, postpaid: 0.15, prepaid: 0.2 } as Record<string, number>,
  runwayAlertDays: 60,
  quietDays: 14,
  briefMinPriority: 30,
};

export function addDays(date: string, n: number): string {
  const d = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Whole days from a to b (b - a). Accepts ISO dates or timestamps. */
export function daysBetween(a: string, b: string): number {
  const da = Date.parse(`${a.slice(0, 10)}T00:00:00Z`);
  const db = Date.parse(`${b.slice(0, 10)}T00:00:00Z`);
  return Math.round((db - da) / 86_400_000);
}

export const daysFromToday = (date: string) => daysBetween(TODAY, date);
export const daysAgo = (date: string) => daysBetween(date, TODAY);

/** Rolling, 7-day-aligned windows ending today (avoids the weekday/weekend skew). */
export const WINDOWS = {
  l28: { from: addDays(TODAY, -27), to: TODAY },
  p28: { from: addDays(TODAY, -55), to: addDays(TODAY, -28) },
  l7: { from: addDays(TODAY, -6), to: TODAY },
  p7: { from: addDays(TODAY, -13), to: addDays(TODAY, -7) },
};
