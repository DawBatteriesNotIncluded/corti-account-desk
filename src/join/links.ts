/**
 * Links the AE has confirmed by hand (CRM account -> analytics customer ids).
 * Stored locally in data/links.json because the mock CRM doesn't persist
 * writes; in a real CRM this would be a custom field on the account.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT } from "../config.ts";
import type { ConfirmedLink } from "./resolve.ts";

export const LINKS_FILE = process.env.AE_LINKS_FILE ?? resolve(ROOT, "data/links.json");

export function loadLinks(): Map<string, ConfirmedLink> {
  if (!existsSync(LINKS_FILE)) return new Map();
  try {
    const raw = JSON.parse(readFileSync(LINKS_FILE, "utf8")) as Record<string, ConfirmedLink>;
    return new Map(Object.entries(raw));
  } catch {
    return new Map();
  }
}

export function saveLinks(links: Map<string, ConfirmedLink>) {
  writeFileSync(LINKS_FILE, JSON.stringify(Object.fromEntries([...links].sort()), null, 2) + "\n");
}
