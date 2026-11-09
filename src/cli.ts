/**
 * Terminal chat. Starts with the deterministic brief (no LLM needed), then the
 * AE can ask anything. Slash commands work even if the LLM is unavailable.
 */
import { createInterface } from "node:readline/promises";
import { authMode } from "../lib/corti.ts";
import { Agent } from "./agent.ts";
import { loadBook } from "./load.ts";
import { bold, cyan, dim, formatAnswer, renderAccount, renderBrief, width, yellow } from "./render.ts";
import { findAccount } from "./tools.ts";
import { loadLinks, saveLinks } from "./join/links.ts";
import { ensureSettings } from "./setup.ts";

const HELP = `${bold("Ask anything")}, e.g.
  What should I do first today?        Tell me about CrestlineMedical
  Who are the contacts at Ironwood?    Where are my MEDDPICC gaps on open deals?
  What's at risk this quarter?         Who is ready to grow?
  What changed last week?              Create a task to call Drew Taylor tomorrow
${bold("Commands")} (no LLM): /brief  /account <name|id>  /owner <id|all>  /reset  /help  /quit
${bold("Links")} (CRM account <-> usage record): /links  /link <acc_id> <cust_id>[,cust_id]  /unlink <acc_id>`;

export async function main(argv = process.argv.slice(2)) {
  const ownerArg = argv.includes("--owner") ? argv[argv.indexOf("--owner") + 1] : null;
  let owner: string | null = ownerArg ?? null;
  // First run (or --setup): ask for the Corti connection settings before anything else.
  await ensureSettings(argv.includes("--setup"));
  console.log(dim("Loading CRM (via API) and product analytics..."));
  const loaded = await loadBook((s) => console.log(dim(s)));
  let book = loaded.book;
  const { crm, rebuild } = loaded;
  const owners = [...new Set(book.accounts.map((a) => a.owner).filter(Boolean))].sort() as string[];
  if (owner && !owners.includes(owner)) { console.log(yellow(`Unknown owner ${owner}; showing the whole book. Owners: ${owners.join(", ")}`)); owner = null; }

  console.log("\n" + renderBrief(book, owner) + "\n");

  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdin.isTTY) });
  // Async iterator buffers lines, so typed-ahead or piped input is never lost while the model is answering.
  const lines = rl[Symbol.asyncIterator]();
  const prompt = async (p: string): Promise<string | null> => {
    process.stdout.write(p);
    const r = await lines.next();
    if (!process.stdin.isTTY && !r.done) process.stdout.write(`${r.value}\n`);
    return r.done ? null : r.value;
  };
  const confirm = async (q: string) => /^y(es)?$/i.test(((await prompt(yellow(`${q} [y/N] `))) ?? "").trim());
  const llm = authMode() !== "none";
  const agent = new Agent({ book, crm, confirm, owner: () => owner, onTool: (n, a) => console.log(dim(`  ↳ looking up ${n} ${Object.keys(a as object).length ? JSON.stringify(a) : ''}`)) });
  if (!llm) console.log(yellow("Corti isn't connected (run npm run setup): chat is off, slash commands still work."));
  console.log(HELP + "\n");

  for (;;) {
    const line = await prompt(cyan(bold("you › ")));
    if (line == null) break;
    const q = line.trim();
    if (!q) continue;
    if (q === "/quit" || q === "/exit") break;
    if (q === "/help") { console.log(HELP); continue; }
    if (q === "/reset") { agent.reset(); console.log(dim("Conversation cleared.")); continue; }
    if (q === "/brief") { console.log(renderBrief(book, owner)); continue; }
    if (q.startsWith("/owner")) {
      const o = q.split(/\s+/)[1];
      owner = !o || o === "all" ? null : owners.includes(o) ? o : owner;
      console.log(dim(o && o !== "all" && !owners.includes(o) ? `Unknown owner. Owners: ${owners.join(", ")}` : `Scope: ${owner ?? "whole book"}`));
      continue;
    }
    if (q === "/links") {
      const links = loadLinks();
      console.log(links.size ? [...links].map(([a, l]) => `  ${a} -> ${l.customerIds.join(", ")} (confirmed ${l.confirmedAt.slice(0, 10)})`).join("\n") : dim(`No confirmed links yet. Ambiguous accounts: ${book.accounts.filter((a) => a.match.method === "ambiguous").map((a) => a.id).join(", ")}`));
      continue;
    }
    if (q.startsWith("/link ") || q.startsWith("/unlink ")) {
      const [cmd, accId, custArg] = q.split(/\s+/);
      const acc = book.byId.get(accId ?? "");
      if (!acc) { console.log(yellow(`Unknown account id "${accId}". Use the acc_ id from /account.`)); continue; }
      const links = loadLinks();
      if (cmd === "/unlink") {
        if (!links.has(acc.id)) { console.log(dim(`${acc.id} has no confirmed link.`)); continue; }
        if (!(await confirm(`Remove the confirmed link for ${acc.name} (${acc.id})?`))) { console.log(dim("Cancelled.")); continue; }
        links.delete(acc.id);
      } else {
        const ids = (custArg ?? "").split(",").map((x) => x.trim()).filter(Boolean);
        const known = new Set(book.analytics.customers.map((c) => c.id));
        const bad = ids.filter((id) => !known.has(id));
        if (!ids.length || bad.length) { console.log(yellow(`Give valid usage-record ids (cust_...). ${bad.length ? `Unknown: ${bad.join(", ")}. ` : ""}Candidates for ${acc.id}: ${acc.match.candidateIds.join(", ") || "none"}`)); continue; }
        const taken = [...links].filter(([a, l]) => a !== acc.id && l.customerIds.some((c) => ids.includes(c))).map(([a]) => a);
        if (taken.length) { console.log(yellow(`Already confirmed for ${taken.join(", ")}. Run /unlink there first.`)); continue; }
        const names = ids.map((id) => book.analytics.customers.find((c) => c.id === id)!.customer_name).join(", ");
        console.log(dim(`Current match: ${acc.match.method} (${acc.match.confidence}) - ${acc.match.note}`));
        if (!(await confirm(`Confirm ${acc.name} (${acc.id}) uses usage record(s) ${ids.join(", ")} [${names}]?`))) { console.log(dim("Cancelled.")); continue; }
        links.set(acc.id, { customerIds: ids, confirmedAt: new Date().toISOString() });
        try { await crm.patchAccount(acc.id, { analyticsCustomerIds: ids }); console.log(dim("Sent to the CRM (PATCH /accounts/:id). Note: the mock CRM doesn't persist writes, so the link is kept in data/links.json.")); }
        catch (e) { console.log(yellow(`CRM update failed (${(e as Error).message}); the link is still saved locally.`)); }
      }
      saveLinks(links);
      book = rebuild();
      agent.setBook(book);
      const now = book.byId.get(acc.id)!;
      console.log(`${bold(now.name)}: match ${now.match.method} (${now.match.confidence}); confidence ${now.confidence}; priority ${now.priority}. Signals recomputed for the whole book.`);
      continue;
    }
    if (q.startsWith("/account")) {
      const r = findAccount(book, q.replace("/account", "").trim());
      console.log(r.account ? renderAccount(r.account) : `No unique match. Candidates: ${r.candidates.map((a) => `${a.name} (${a.id})`).join(", ") || "none"}`);
      continue;
    }
    if (!llm) { console.log(yellow("Chat needs Corti credentials. Try /brief or /account <name>.")); continue; }
    try {
      const t0 = Date.now();
      process.stdout.write(dim("  thinking...\n"));
      const r = await agent.ask(q);
      console.log("\n" + formatAnswer(r.text));
      if (r.unsupported.length) console.log("\n" + yellow(`  ⚠ Not found in the data I retrieved: ${r.unsupported.join(", ")}. Treat as unverified.`));
      console.log(dim(`\n  ${"─".repeat(Math.min(40, width()))}\n  ${((Date.now() - t0) / 1000).toFixed(1)}s · looked up: ${r.toolsUsed.length ? [...new Set(r.toolsUsed)].join(", ") : "nothing (answer not grounded)"}\n`));
    } catch (e) {
      console.log(yellow(`The model call failed: ${(e as Error).message}. Slash commands still work (/brief, /account).`));
    }
  }
  rl.close();
  process.exit(0);
}
