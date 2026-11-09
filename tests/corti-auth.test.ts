import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { chat, clearTokenCache, authMode } from "../lib/corti.ts";

const realFetch = globalThis.fetch;
const KEYS = ["CORTI_API_KEY", "CORTI_CLIENT_ID", "CORTI_CLIENT_SECRET", "CORTI_TENANT_NAME", "CORTI_ENVIRONMENT", "CORTI_BASE_URL", "CORTI_AUTH_URL"];
let saved: Record<string, string | undefined> = {};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
const completion = { id: "c1", model: "corti-s1", choices: [{ message: { content: "ok" }, finish_reason: "stop" }] };

describe("corti client-credentials auth", () => {
  beforeEach(() => {
    saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
    for (const k of KEYS) delete process.env[k];
    process.env.CORTI_CLIENT_ID = "client-x";
    process.env.CORTI_CLIENT_SECRET = "secret-y";
    process.env.CORTI_TENANT_NAME = "base";
    process.env.CORTI_ENVIRONMENT = "eu";
    clearTokenCache();
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    clearTokenCache();
  });

  test("fetches a token once, caches it, and sends bearer + Tenant-Name", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    (globalThis as any).fetch = async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.includes("/protocol/openid-connect/token")) return json({ access_token: "tok-1", expires_in: 300 });
      return json(completion);
    };
    assert.equal(authMode(), "client_credentials");
    await chat({ messages: [{ role: "user", content: "hi" }] });
    await chat({ messages: [{ role: "user", content: "hi again" }] });

    const tokenCalls = calls.filter((c) => c.url.includes("openid-connect/token"));
    assert.equal(tokenCalls.length, 1, "token should be cached across calls");
    assert.equal(tokenCalls[0].url, "https://auth.eu.corti.app/realms/base/protocol/openid-connect/token");
    const form = new URLSearchParams(String(tokenCalls[0].init?.body));
    assert.equal(form.get("grant_type"), "client_credentials");
    assert.equal(form.get("client_id"), "client-x");
    assert.equal(form.get("client_secret"), "secret-y");

    const apiCalls = calls.filter((c) => !c.url.includes("openid-connect"));
    assert.equal(apiCalls.length, 2);
    assert.equal(apiCalls[0].url, "https://ai.eu.corti.app/v1/chat/completions");
    const h = apiCalls[0].init?.headers as Record<string, string>;
    assert.equal(h.authorization, "Bearer tok-1");
    assert.equal(h["Tenant-Name"], "base");
  });

  test("refreshes the token once on a 401", async () => {
    let tokenN = 0;
    let apiN = 0;
    (globalThis as any).fetch = async (url: string, init?: RequestInit) => {
      if (url.includes("openid-connect/token")) return json({ access_token: `tok-${++tokenN}`, expires_in: 300 });
      apiN++;
      const auth = (init?.headers as Record<string, string>).authorization;
      return auth === "Bearer tok-1" ? json({ error: "expired" }, 401) : json(completion);
    };
    const res = await chat({ messages: [{ role: "user", content: "hi" }] });
    assert.equal(res.content, "ok");
    assert.equal(tokenN, 2);
    assert.equal(apiN, 2);
  });

  test("surfaces a bad client secret clearly", async () => {
    (globalThis as any).fetch = async () =>
      json({ error: "unauthorized_client", error_description: "Invalid client or Invalid client credentials" }, 401);
    await assert.rejects(() => chat({ messages: [{ role: "user", content: "hi" }] }), /Corti auth error: HTTP 401 - Invalid client/);
  });

  test("CORTI_API_KEY still takes precedence (no token request)", async () => {
    process.env.CORTI_API_KEY = "static-key";
    let tokenRequested = false;
    let sentAuth = "";
    (globalThis as any).fetch = async (url: string, init?: RequestInit) => {
      if (url.includes("openid-connect")) tokenRequested = true;
      sentAuth = (init?.headers as Record<string, string>).authorization;
      return json(completion);
    };
    await chat({ messages: [{ role: "user", content: "hi" }] });
    assert.equal(tokenRequested, false);
    assert.equal(sentAuth, "Bearer static-key");
  });
});
