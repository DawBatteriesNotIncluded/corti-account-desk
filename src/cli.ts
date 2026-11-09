/**
 * Terminal chat. Starts with the deterministic brief (no LLM needed), then the
 * AE can ask anything. Slash commands work even if the LLM is unavailable.
 */
import { createInterface } from "node:readline/promises";
import { authMode } from "../lib/corti.ts";
import { Agent } from "./agent.ts";
import { loadBook } from "./load.ts";
import { bold, cyan, dim, md, renderAccount, renderBrief, yellow } from "./render.ts";
import { findAccount } from "./tools.ts";

const HELP = `${bold("Ask anything")}, e.g.
  What should I do first today?        Tell me about CrestlineMedical
  Who are the contacts at Ironwood?    Where are my MEDDPICC gaps on open deals?
  What's at risk this quarter?         Who is ready to grow?
  What changed last week?              Create a task to call Drew Taylor tomorrow
${bold("Commands")} (no LLM): /brief  /account <name|id>  /owner <id|all>  /reset  /help  /quit`;

export async function main(argv = process.argv.slice(2)) {
  const ownerArg = argv.includes("--owner") ? argv[argv.indexOf("--owner") + 1] : null;
  let owner: string | null = ownerArg ?? null;
  console.log(dim("Loading CRM (via API) and product analytics..."));
  const { book, crm } = await loadBook((s) => console.log(dim(s)));
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
  const agent = new Agent({ book, crm, confirm, owner: () => owner, onTool: (n, a) => console.log(dim(`  -> ${n}(${JSON.stringify(a)})`)) });
  if (!llm) console.log(yellow("Corti credentials not set (npm run set-key): chat is off, slash commands still work."));
  console.log(HELP + "\n");

  for (;;) {
    const line = await prompt(cyan("you> "));
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
    if (q.startsWith("/account")) {
      const r = findAccount(book, q.replace("/account", "").trim());
      console.log(r.account ? renderAccount(r.account) : `No unique match. Candidates: ${r.candidates.map((a) => `${a.name} (${a.id})`).join(", ") || "none"}`);
      continue;
    }
    if (!llm) { console.log(yellow("Chat needs Corti credentials. Try /brief or /account <name>.")); continue; }
    try {
      const t0 = Date.now();
      const r = await agent.ask(q);
      console.log("\n" + md(r.text));
      if (r.unsupported.length) console.log(yellow(`\n! Not found in the data I retrieved: ${r.unsupported.join(", ")} - treat as unverified.`));
      console.log(dim(`\n(${((Date.now() - t0) / 1000).toFixed(1)}s; sources: ${r.toolsUsed.length ? [...new Set(r.toolsUsed)].join(", ") : "none - answer not grounded in a tool call"})\n`));
    } catch (e) {
      console.log(yellow(`The model call failed: ${(e as Error).message}. Slash commands still work (/brief, /account).`));
    }
  }
  rl.close();
  process.exit(0);
}
