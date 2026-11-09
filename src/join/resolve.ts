/**
 * CRM account <-> analytics customer resolution. There is no shared key
 * (customers.external_id is synthetic), so we match on normalised domain,
 * billing-email domain and name, and keep HOW we matched as a confidence.
 * Ambiguous groups are never merged silently.
 */
import type { Account } from "../crm/client.ts";
import type { Customer } from "../analytics/usage.ts";

export type MatchMethod = "domain" | "billing_domain" | "name_only";
export type MatchConfidence = "high" | "medium" | "low";

export type Match = {
  accountId: string;
  /** customers we attribute to this account (empty when ambiguous) */
  customerIds: string[];
  /** every candidate seen, even when ambiguous */
  candidateIds: string[];
  method: MatchMethod | "confirmed" | "ambiguous" | "none";
  confidence: MatchConfidence;
  note: string;
};

const alnum = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const stripTld = (s: string) => s.toLowerCase().replace(/\.example$/, "");

export function crmNameKey(name: string): string {
  return alnum(
    name
      .toLowerCase()
      .replace(/\s*-\s*(north|south|east|west)$/, "")
      .replace(/\b(group|llc|ltd|inc|healthcare)\b/g, ""),
  );
}
export const crmDomainKey = (d: string | null) => (d ? alnum(stripTld(d)) : null);

const CUST_SUFFIX = /(-prod|prod|-cloud|-trial|-us|-eu|-sandbox|-holdings|-health-group)$/;
export const custNameKey = (n: string) => alnum(n.toLowerCase().replace(CUST_SUFFIX, ""));
export const custDomainKey = (d: string | null) => (d ? alnum(stripTld(d).replace(/customers$/, "")) : null);
export const custBillingKey = (e: string | null) => (e && e.includes("@") ? alnum(stripTld(e.split("@")[1])) : null);

const RANK: Record<MatchMethod, number> = { domain: 3, billing_domain: 2, name_only: 1 };

/** A link the AE confirmed by hand (saved in data/links.json); always wins over the automatic join. */
export type ConfirmedLink = { customerIds: string[]; confirmedAt: string };

export function resolveAccounts(
  accounts: Account[],
  customers: Customer[],
  confirmed: Map<string, ConfirmedLink> = new Map(),
): { matches: Map<string, Match>; unmatchedCustomers: Customer[] } {
  const byDomain = new Map<string, string[]>();
  const byBilling = new Map<string, string[]>();
  const byName = new Map<string, string[]>();
  const push = (m: Map<string, string[]>, k: string | null, v: string) => {
    if (!k) return;
    m.set(k, [...(m.get(k) ?? []), v]);
  };
  for (const c of customers) {
    push(byDomain, custDomainKey(c.domain), c.id);
    push(byBilling, custBillingKey(c.billing_email), c.id);
    push(byName, custNameKey(c.customer_name), c.id);
  }

  // candidate edges with best method per (account, customer)
  const edges = new Map<string, Map<string, MatchMethod>>();
  for (const a of accounts) {
    const e = new Map<string, MatchMethod>();
    const set = (ids: string[] | undefined, m: MatchMethod) =>
      ids?.forEach((id) => {
        const cur = e.get(id);
        if (!cur || RANK[m] > RANK[cur]) e.set(id, m);
      });
    const dk = crmDomainKey(a.domain);
    if (dk) {
      set(byDomain.get(dk), "domain");
      set(byBilling.get(dk), "billing_domain");
    }
    set(byName.get(crmNameKey(a.name)), "name_only");
    edges.set(a.id, e);
  }

  // Confirmed links take their customers out of everyone else's candidate list.
  const confirmedCust = new Set([...confirmed.values()].flatMap((l) => l.customerIds));
  for (const [aid, e] of edges) {
    if (confirmed.has(aid)) e.clear();
    else for (const cid of confirmedCust) e.delete(cid);
  }

  // connected components over the bipartite graph
  const custToAccts = new Map<string, Set<string>>();
  for (const [aid, e] of edges) for (const cid of e.keys()) custToAccts.set(cid, (custToAccts.get(cid) ?? new Set()).add(aid));
  const custById = new Map(customers.map((c) => [c.id, c]));
  const matches = new Map<string, Match>();

  for (const a of accounts) {
    const link = confirmed.get(a.id);
    if (link) {
      matches.set(a.id, { accountId: a.id, customerIds: [...link.customerIds].sort(), candidateIds: [...link.customerIds].sort(), method: "confirmed", confidence: "high",
        note: `Link confirmed by the AE on ${link.confirmedAt.slice(0, 10)} (${link.customerIds.join(", ")}); overrides the automatic match.` });
      continue;
    }
    const e = edges.get(a.id)!;
    const candidateIds = [...e.keys()].sort();
    if (!candidateIds.length) {
      matches.set(a.id, { accountId: a.id, customerIds: [], candidateIds, method: "none", confidence: "low", note: "No product usage record found for this account." });
      continue;
    }
    // other CRM accounts competing for the same customers
    const rivals = new Set<string>();
    for (const cid of candidateIds) custToAccts.get(cid)?.forEach((x) => x !== a.id && rivals.add(x));
    // 1 account -> N regional tenants (e.g. -us / -eu) is a clean 1:N map
    const regional = candidateIds.length > 1 && candidateIds.every((cid) => /-(us|eu)$/.test(custById.get(cid)?.customer_name ?? ""));
    if (rivals.size || (candidateIds.length > 1 && !regional)) {
      const others = [...rivals].sort();
      matches.set(a.id, {
        accountId: a.id,
        customerIds: [],
        candidateIds,
        method: "ambiguous",
        confidence: "low",
        note: `Ambiguous: ${candidateIds.length} possible usage records (${candidateIds.join(", ")})${others.length ? ` also claimed by ${others.join(", ")}` : ""}. No reliable field separates them, so usage is not attributed.`,
      });
      continue;
    }
    const method = [...e.values()].sort((x, y) => RANK[y] - RANK[x])[0];
    matches.set(a.id, {
      accountId: a.id,
      customerIds: candidateIds,
      candidateIds,
      method,
      confidence: method === "name_only" ? "medium" : "high",
      note:
        method === "domain"
          ? "Matched on company domain."
          : method === "billing_domain"
            ? "Matched on billing-email domain (usage record has no domain)."
            : "Matched on company name only (no domain match) - verify before acting.",
    });
  }
  const unmatchedCustomers = customers.filter((c) => !custToAccts.has(c.id) && !confirmedCust.has(c.id));
  return { matches, unmatchedCustomers };
}
