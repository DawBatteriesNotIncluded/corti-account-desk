/**
 * End-to-end tests of the deterministic layer on the real challenge data.
 * The CRM is called through its HTTP app (in-process), exactly as the tool does.
 */
import { before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../mock-crm/app.ts";
import { CrmDb } from "../mock-crm/db.ts";
import { CrmClient, loadCrm } from "../src/crm/client.ts";
import { loadAnalytics } from "../src/analytics/usage.ts";
import { buildBook, briefItems, type Book } from "../src/book.ts";
import { classifyProject } from "../src/analytics/usage.ts";
import { groundingCheck } from "../src/agent.ts";
import { findAccount, TOOLS } from "../src/tools.ts";
import { offTopicReply } from "../src/agent.ts";

let book: Book;
let bundles: Awaited<ReturnType<typeof loadCrm>>;
let an: ReturnType<typeof loadAnalytics>;

before(async () => {
  const app = createApp(new CrmDb());
  const client = new CrmClient("http://crm.test", (url, init) => Promise.resolve(app.request(url.replace("http://crm.test", ""), init)));
  bundles = await loadCrm(client);
  an = loadAnalytics();
  book = buildBook(bundles, an);
});

describe("join", () => {
  test("every CRM account is loaded through the API", () => assert.equal(book.accounts.length, 200));
  test("CrestlineChild maps cleanly to two regional tenants", () => {
    const a = book.byId.get("acc_011")!;
    assert.deepEqual(a.match.customerIds, ["cust_011", "cust_012"]);
    assert.equal(a.match.confidence, "high");
  });
  test("duplicate LakeviewMen accounts are ambiguous, not merged", () => {
    for (const id of ["acc_010", "acc_047"]) {
      const a = book.byId.get(id)!;
      assert.equal(a.match.method, "ambiguous");
      assert.deepEqual(a.match.customerIds, []);
      assert.deepEqual(a.match.candidateIds, ["cust_010", "cust_046"]);
    }
  });
  test("Pinnacle (billing on an old domain) is a name-only match with medium confidence", () => {
    const a = book.byId.get("acc_016")!;
    assert.equal(a.match.method, "name_only");
    assert.equal(a.match.confidence, "medium");
  });
  test("8 usage tenants have no CRM account", () => assert.equal(book.unmatchedCustomers.length, 8));
});

describe("signals", () => {
  const ids = (acc: string) => book.byId.get(acc)!.findings.map((f) => f.id);
  test("CrestlineMedical: declining near renewal + negative meeting + concern note", () => {
    for (const f of ["declining_near_renewal", "negative_meeting", "concern_note"]) assert.ok(ids("acc_022").includes(f), f);
  });
  test("Ironwood: low balance recomputed from contracts (no alert fired) and growing usage", () => {
    for (const f of ["low_balance", "usage_growing"]) assert.ok(ids("acc_007").includes(f), f);
  });
  test("Cascade: $1M deal with almost no product use", () => assert.ok(ids("acc_008").includes("big_deal_low_engagement")));
  test("CrestlineChild: regional divergence is surfaced", () => assert.ok(ids("acc_011").includes("regional_divergence")));
  test("Cornerstone: closed-lost account reactivating", () => assert.ok(ids("acc_005").includes("reactivated")));
  test("brief leads with CrestlineMedical and includes growth items", () => {
    const items = briefItems(book);
    assert.equal(items[0].id, "acc_022");
    assert.ok(items.some((a) => a.kind === "grow"));
  });
  test("project names override the PRODUCTION label", () => {
    assert.equal(classifyProject("unitynetwork-staging2", "PRODUCTION"), "nonprod");
    assert.equal(classifyProject("ironwoodhealth-new", "PRODUCTION"), "prod");
    assert.equal(classifyProject("aspenmedical-test", "SANDBOX"), "sandbox");
  });
  test("MEDDPICC has all 8 elements and flags unknowns honestly", () => {
    const m = book.byId.get("acc_022")!.meddpicc;
    assert.equal(m.length, 8);
    assert.equal(m.find((x) => x.letter === "C2")!.status, "unknown");
  });
});

describe("confidence", () => {
  test("account confidence is capped by the match: name-only <= medium, ambiguous = low", () => {
    for (const a of book.accounts) {
      if (a.match.method === "name_only") assert.notEqual(a.confidence, "high", a.id);
      if (a.match.method === "ambiguous") assert.equal(a.confidence, "low", a.id);
      assert.ok(a.confidenceWhy.length > 0, a.id);
    }
  });
  test("an estimate-led account can't be high confidence", () => {
    for (const a of book.accounts) {
      const lead = a.findings.find((f) => f.kind !== "hygiene");
      if (lead?.id === "runway_short") assert.equal(a.confidence, "low", a.id);
    }
  });
});

describe("AE-confirmed links", () => {
  test("confirming acc_010 -> cust_010 makes it high confidence and resolves its duplicate acc_047 to cust_046", () => {
    const b = buildBook(bundles, an, new Map([["acc_010", { customerIds: ["cust_010"], confirmedAt: "2025-03-14T09:00:00Z" }]]));
    const a = b.byId.get("acc_010")!;
    assert.equal(a.match.method, "confirmed");
    assert.equal(a.match.confidence, "high");
    assert.ok(a.usage.prodL28 > 0, "usage now attributed");
    const dup = b.byId.get("acc_047")!;
    assert.deepEqual(dup.match.customerIds, ["cust_046"]);
    assert.equal(dup.match.confidence, "high");
  });
});

describe("account lookup", () => {
  test("ambiguous name returns candidates", () => {
    const r = findAccount(book, "Lakeview");
    assert.equal(r.account, null);
    assert.ok(r.candidates.length >= 2);
  });
  test("id and name both resolve", () => {
    assert.equal(findAccount(book, "acc_022").account?.id, "acc_022");
    assert.equal(findAccount(book, "Ironwood Health").account?.id, "acc_007");
  });
});

describe("usage tools and scope guard", () => {
  const ctx = () => ({ book, crm: {} as never, confirm: async () => false });
  test("get_usage returns sourced metrics, classified projects and the mix caveat", async () => {
    const r = (await TOOLS.get_usage.run({ query: "acc_007" }, ctx())) as Record<string, unknown>;
    assert.match(String(r.source), /\[Usage\]/);
    assert.ok((r.projects as unknown[]).length >= 2);
    assert.match(String(r.product_mix_caveat), /descriptive only/);
  });
  test("get_usage refuses to attribute usage on an ambiguous match", async () => {
    const r = (await TOOLS.get_usage.run({ query: "acc_010" }, ctx())) as Record<string, unknown>;
    assert.match(String(r.error), /ambiguous/);
  });
  test("usage_leaderboard ranks by the chosen metric", async () => {
    const r = (await TOOLS.usage_leaderboard.run({ metric: "tokens", order: "largest", limit: 5 }, ctx())) as { items: Array<{ last_28d: number }> };
    assert.equal(r.items.length, 5);
    for (let i = 1; i < 5; i++) assert.ok(r.items[i - 1].last_28d >= r.items[i].last_28d);
  });
  test("off-topic reply declines and suggests tasks from the brief", () => {
    const t = offTopicReply(book, null);
    assert.match(t, /can only help with your accounts/);
    assert.match(t, /acc_022/);
  });
});

describe("grounding check", () => {
  const facts = JSON.stringify({ weekly: [561, 540, 242], value: "$145k", trend: "-28%", note: "Upgrade concerns; AE needs to follow up on dissatisfaction." });
  test("accepts numbers and quotes that are in the facts", () => {
    assert.deepEqual(groundingCheck('Usage down 28%, $145k renewal, 561 -> 242. Note: "Upgrade concerns; AE needs to follow up"', facts).unsupported, []);
  });
  test("flags invented numbers, ids and quotes", () => {
    const r = groundingCheck('Renewal $200k, acc_999, note "customer asked for multi-year option"', facts).unsupported;
    assert.ok(r.includes("$200k") && r.includes("acc_999") && r.some((x) => x.includes("multi-year")));
  });
});
