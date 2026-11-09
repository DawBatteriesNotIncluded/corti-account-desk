/**
 * Corti connection settings. Runs automatically on first start when no
 * credentials are configured (and on demand: npm run setup / --setup).
 * Values are saved to .env.local (gitignored); the secret is typed hidden.
 */
import { createInterface } from "node:readline";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { authMode, clearTokenCache, getAccessToken, getBaseUrl } from "../lib/corti.ts";
import { ROOT } from "./config.ts";

const ENV_FILE = process.env.ENV_FILE ?? resolve(ROOT, ".env.local");
const KEYS = ["CORTI_TENANT_NAME", "CORTI_CLIENT_ID", "CORTI_CLIENT_SECRET", "CORTI_ENVIRONMENT", "CORTI_API_KEY"] as const;
type Settings = Partial<Record<(typeof KEYS)[number], string>>;

const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const b = (s: string) => (tty ? `\x1b[1m${s}\x1b[0m` : s);
const d = (s: string) => (tty ? `\x1b[2m${s}\x1b[0m` : s);
const g = (s: string) => (tty ? `\x1b[32m${s}\x1b[0m` : s);
const y = (s: string) => (tty ? `\x1b[33m${s}\x1b[0m` : s);

/** One readline for the whole setup (piped or typed-ahead input isn't lost); hidden mode mutes the echo. */
function makeAsker() {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdin.isTTY) });
  const r = rl as unknown as { _writeToOutput: (s: string) => void };
  const orig = r._writeToOutput.bind(rl);
  let muted = false;
  r._writeToOutput = (str: string) => { if (!muted) orig(str); };
  const queued: string[] = [];
  const waiting: Array<(v: string) => void> = [];
  let ended = false;
  rl.on("line", (l) => { const w = waiting.shift(); if (w) w(l); else queued.push(l); });
  rl.on("close", () => { ended = true; while (waiting.length) waiting.shift()!(""); });
  const ask = (question: string, hidden = false) =>
    new Promise<string>((done) => {
      muted = false;
      process.stdout.write(question);
      muted = hidden; // hide what's typed/pasted from here on
      const finish = (v: string) => { muted = false; if (hidden && process.stdin.isTTY) process.stdout.write("\n"); done(v.trim()); };
      if (queued.length) finish(queued.shift()!);
      else if (ended) finish("");
      else waiting.push(finish);
    });
  return { ask, close: () => rl.close() };
}

const unquote = (s: string) => s.trim().replace(/^["']|["']$/g, "");

/** Parse a pasted "CORTI_X=... CORTI_Y=..." line (space or newline separated). */
export function parseCredentialLine(input: string): Settings {
  const out: Settings = {};
  for (const m of input.matchAll(/\b(CORTI_[A-Z_]+)\s*=\s*("[^"]*"|'[^']*'|\S*)/g)) {
    if ((KEYS as readonly string[]).includes(m[1]) && unquote(m[2])) out[m[1] as keyof Settings] = unquote(m[2]);
  }
  return out;
}

export function saveSettings(s: Settings, file = ENV_FILE) {
  if (!existsSync(file)) copyFileSync(resolve(ROOT, ".env.example"), file);
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  for (const [k, v] of Object.entries(s)) {
    if (!v) continue;
    const i = lines.findIndex((l) => new RegExp(`^\\s*#?\\s*${k}\\s*=`).test(l));
    if (i >= 0) lines[i] = `${k}=${v}`;
    else lines.unshift(`${k}=${v}`);
    process.env[k] = v; // take effect immediately, no restart
  }
  writeFileSync(file, lines.join("\n"));
}

/** Interactive setup. Returns true when a token was obtained. */
export async function runSetup(): Promise<boolean> {
  const { ask, close } = makeAsker();
  try {
  console.log(`\n${b("Connect to Corti Models")}`);
  console.log(d("Account Desk uses Corti's API to understand your questions. Settings are saved to .env.local (gitignored, never committed).\n"));
  for (let attempt = 0; attempt < 3; attempt++) {
    const pasted = await ask(`Paste the credentials line from 1Password, or press Enter to fill in each field:\n${d("(input hidden)")} `, true);
    let s: Settings = parseCredentialLine(pasted);
    if (!Object.keys(s).length && pasted) s = { CORTI_CLIENT_SECRET: unquote(pasted) }; // a bare secret
    if (!s.CORTI_API_KEY) {
      const cur = (k: keyof Settings, def: string) => s[k] ?? process.env[k] ?? def;
      if (!s.CORTI_TENANT_NAME) s.CORTI_TENANT_NAME = (await ask(`Tenant name ${d(`[${cur("CORTI_TENANT_NAME", "base")}]`)}: `)) || cur("CORTI_TENANT_NAME", "base");
      if (!s.CORTI_ENVIRONMENT) s.CORTI_ENVIRONMENT = (await ask(`Environment, eu or us ${d(`[${cur("CORTI_ENVIRONMENT", "eu")}]`)}: `)) || cur("CORTI_ENVIRONMENT", "eu");
      if (!s.CORTI_CLIENT_ID) s.CORTI_CLIENT_ID = (await ask(`Client ID${process.env.CORTI_CLIENT_ID ? ` ${d(`[${process.env.CORTI_CLIENT_ID}]`)}` : ""}: `)) || process.env.CORTI_CLIENT_ID || "";
      if (!s.CORTI_CLIENT_SECRET) s.CORTI_CLIENT_SECRET = await ask(`Client secret ${d("(hidden)")}: `, true);
    }
    if (!s.CORTI_API_KEY && (!s.CORTI_CLIENT_ID || !s.CORTI_CLIENT_SECRET)) {
      console.log(y("Client ID and client secret are both required."));
      continue;
    }
    saveSettings(s);
    clearTokenCache();
    process.stdout.write(d(`Checking the connection to ${getBaseUrl()}... `));
    try {
      await getAccessToken();
      console.log(g("connected.\n"));
      return true;
    } catch (e) {
      console.log(y(`failed: ${(e as Error).message}`));
      if (!/^y/i.test(await ask("Try again? [y/N] "))) break;
    }
  }
  console.log(y("Continuing without chat. Slash commands (/brief, /account) still work; run `npm run setup` to try again.\n"));
  return false;
  } finally {
    close();
  }
}

/** Run setup only when needed (no credentials) and only in an interactive terminal. */
export async function ensureSettings(force = false): Promise<boolean> {
  if (!force && authMode() !== "none") return true;
  if (!process.stdin.isTTY) return authMode() !== "none";
  return runSetup();
}
