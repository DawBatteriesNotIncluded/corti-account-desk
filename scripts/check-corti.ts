/**
 * Sanity check for the Corti Models credentials in .env.local.
 *   npm run corti:check
 * Gets a token (client credentials) or uses CORTI_API_KEY, lists models,
 * then sends one tiny chat request.
 */
import { authMode, chat, getAccessToken, getBaseUrl, getDefaultModel, listModels } from "../lib/corti.ts";

try {
  console.log(`Auth mode: ${authMode()}  |  API: ${getBaseUrl()}`);
  await getAccessToken();
  console.log("Token OK.");

  const models = await listModels();
  console.log(`Models available: ${models.map((m) => m.id).join(", ")}`);

  const res = await chat({
    messages: [{ role: "user", content: "Reply with the single word: ok" }],
  });
  console.log(`Chat OK via ${res.model} (default: ${getDefaultModel()}): "${res.content.trim()}"`);
} catch (err) {
  console.error(`Corti check failed: ${(err as Error).message}`);
  console.error("Run `npm run set-key` and paste the client secret, then re-run this check.");
  process.exit(1);
}
