/**
 * Non-interactive: ask the agent one or more questions (useful for demos/CI).
 *   npm run ask -- "What should I do first today?" "Tell me about Ironwood"
 */
import { Agent } from "../src/agent.ts";
import { loadBook } from "../src/load.ts";
import { formatAnswer } from "../src/render.ts";

const qs = process.argv.slice(2);
const { book, crm } = await loadBook(() => {});
const agent = new Agent({ book, crm, confirm: async () => false, owner: () => null, onTool: (n, a) => console.log(`  -> ${n}(${JSON.stringify(a)})`) });
for (const q of qs) {
  console.log(`\n### ${q}`);
  const t0 = Date.now();
  const r = await agent.ask(q);
  console.log(formatAnswer(r.text));
  console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s | tools: ${r.toolsUsed.join(", ") || "none"} | unsupported: ${r.unsupported.join(", ") || "none"}]`);
}
process.exit(0);
