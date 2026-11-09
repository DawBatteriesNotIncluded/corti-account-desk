/**
 * No-LLM entry point: prints today's ranked brief, or one account.
 *   npm run brief                    whole book
 *   npm run brief -- --owner jordan.lee
 *   npm run brief -- --account acc_022
 */
import { loadBook } from "./load.ts";
import { renderAccount, renderBrief } from "./render.ts";
import { findAccount } from "./tools.ts";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};

const { book } = await loadBook((s) => console.error(s));
const acct = arg("account");
if (acct) {
  const r = findAccount(book, acct);
  console.log(r.account ? renderAccount(r.account) : `No unique match for "${acct}". Candidates: ${r.candidates.map((a) => `${a.name} (${a.id})`).join(", ") || "none"}`);
} else {
  console.log(renderBrief(book, arg("owner")));
}
process.exit(0);
