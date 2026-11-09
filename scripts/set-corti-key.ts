/**
 * Prompts for the Corti client secret and saves it to .env.local (gitignored).
 *   npm run set-key      -> paste the secret at the prompt, press Enter
 *
 * Accepts either the bare secret, or a single line of KEY=VALUE pairs such as
 * "CORTI_TENANT_NAME=base CORTI_CLIENT_ID=... CORTI_CLIENT_SECRET=... CORTI_ENVIRONMENT=eu".
 * Input is hidden while you paste. Re-run any time to replace values.
 */
import { createInterface } from "node:readline";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";

const target = process.env.ENV_FILE ?? ".env.local";
const ALLOWED = ["CORTI_TENANT_NAME", "CORTI_CLIENT_ID", "CORTI_CLIENT_SECRET", "CORTI_ENVIRONMENT", "CORTI_API_KEY"];

function askHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: Boolean(process.stdin.isTTY),
    });
    let answered = false;
    rl.question(question, (answer) => {
      answered = true;
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
    // Ctrl+C / end of input without an answer -> treat as empty.
    rl.on("close", () => {
      if (!answered) {
        process.stdout.write("\n");
        resolve("");
      }
    });
    // Prompt is already printed; suppress echo of the pasted secret.
    (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = () => {};
  });
}

const unquote = (s: string) => s.trim().replace(/^["']|["']$/g, "");
const input = (await askHidden("Paste your Corti client secret and press Enter: ")).trim();

const updates: Record<string, string> = {};
if (/\bCORTI_[A-Z_]+\s*=/.test(input)) {
  for (const m of input.matchAll(/\b(CORTI_[A-Z_]+)\s*=\s*("[^"]*"|'[^']*'|\S*)/g)) {
    if (ALLOWED.includes(m[1]) && unquote(m[2])) updates[m[1]] = unquote(m[2]);
  }
} else if (unquote(input)) {
  updates.CORTI_CLIENT_SECRET = unquote(input);
}

if (Object.keys(updates).length === 0) {
  console.error("Nothing entered — .env.local unchanged.");
  process.exit(1);
}

if (!existsSync(target)) copyFileSync(".env.example", target);
const lines = readFileSync(target, "utf8").split(/\r?\n/);
for (const [k, v] of Object.entries(updates)) {
  const i = lines.findIndex((l) => new RegExp(`^\\s*${k}\\s*=`).test(l));
  if (i >= 0) lines[i] = `${k}=${v}`;
  else lines.unshift(`${k}=${v}`);
}
writeFileSync(target, lines.join("\n"), "utf8");

const shown = Object.entries(updates)
  .map(([k, v]) => (k.endsWith("SECRET") || k.endsWith("KEY") ? `${k} (ends …${v.slice(-4)})` : `${k}=${v}`))
  .join(", ");
console.log(`Saved to ${target}: ${shown}. Checking it works…`);
