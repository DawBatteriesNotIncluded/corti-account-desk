/**
 * Re-run the Corti connection setup on demand.
 *   npm run setup        (alias: npm run set-key)
 */
import { runSetup } from "../src/setup.ts";

process.exit((await runSetup()) ? 0 : 1);
