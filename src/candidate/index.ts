/**
 * GTM Engineer Challenge - entry point.
 *   npm run challenge                     terminal chat over the whole book
 *   npm run challenge -- --owner jordan.lee
 * See README.md and docs/DECISIONS.md.
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { main } from "../cli.ts";

export async function run(): Promise<void> {
  await main();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
