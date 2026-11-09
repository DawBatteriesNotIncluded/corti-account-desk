/**
 * Thin client for the Corti Models API.
 *
 * Corti Models is an OpenAI-compatible API. See:
 * https://docs.corti.ai/api-reference/corti-models
 *
 * Set your API key in your environment:
 *
 *   export CORTI_API_KEY="..."
 *
 * You can list the models available to your key and specify a model when
 * making a completion request. If no model is specified, the client uses a
 * default model.
 */

export function getEnvironment(): string {
  return process.env.CORTI_ENVIRONMENT ?? "eu";
}

export function getBaseUrl(): string {
  return process.env.CORTI_BASE_URL ?? `https://ai.${getEnvironment()}.corti.app/v1`;
}

export function getDefaultModel(): string {
  return process.env.CORTI_DEFAULT_MODEL ?? "corti-s1";
}

export type ChatRole = "system" | "user" | "assistant" | "tool";

/** OpenAI-compatible tool call returned by the model. */
export type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type ToolDef = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export type ChatMessage = {
  role: ChatRole;
  content: string | null;
  /** assistant messages that called tools */
  tool_calls?: ToolCall[];
  /** tool result messages */
  tool_call_id?: string;
  name?: string;
};

export type ChatOptions = {
  /** Override the model used for this request. Defaults to DEFAULT_MODEL. */
  model?: string;
  messages: Array<ChatMessage>;
  maxTokens?: number;
  temperature?: number;
  tools?: ToolDef[];
  toolChoice?: "auto" | "none" | "required";
};

export type ModelInfo = {
  id: string;
  object: string;
  created: number;
  owned_by: string;
};

export type Usage = {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
};

export type ChatResult = {
  id: string;
  model: string;
  content: string;
  finishReason: string | null;
  usage?: Usage;
  /** Tool calls requested by the model (empty when it answered directly). */
  toolCalls: ToolCall[];
};

export function getApiKey(): string {
  const key = process.env.CORTI_API_KEY;
  if (!key) {
    throw new Error(
      "CORTI_API_KEY is not set. Export it in your environment before calling the Corti Models API.",
    );
  }
  return key;
}

/**
 * Auth: either a static bearer token (CORTI_API_KEY) or OAuth2 client
 * credentials (CORTI_CLIENT_ID + CORTI_CLIENT_SECRET, tenant + environment).
 * Client-credential tokens last ~5 minutes; they are cached and refreshed
 * 30s before expiry.
 */
let cachedToken: { token: string; expiresAt: number } | null = null;
let inflightToken: Promise<string> | null = null;

export function authMode(): "api_key" | "client_credentials" | "none" {
  if (process.env.CORTI_API_KEY) return "api_key";
  if (process.env.CORTI_CLIENT_ID && process.env.CORTI_CLIENT_SECRET) return "client_credentials";
  return "none";
}

export function getTenantName(): string {
  return process.env.CORTI_TENANT_NAME ?? "base";
}

export function clearTokenCache(): void {
  cachedToken = null;
  inflightToken = null;
}

async function fetchClientCredentialsToken(): Promise<string> {
  const tokenUrl =
    process.env.CORTI_AUTH_URL ??
    `https://auth.${getEnvironment()}.corti.app/realms/${getTenantName()}/protocol/openid-connect/token`;
  const body = new URLSearchParams({
    client_id: process.env.CORTI_CLIENT_ID ?? "",
    client_secret: process.env.CORTI_CLIENT_SECRET ?? "",
    grant_type: "client_credentials",
    scope: "openid",
  });
  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    let detail: unknown;
    try {
      detail = await res.json();
    } catch {
      detail = await res.text().catch(() => "no response body");
    }
    const d = detail as Record<string, unknown>;
    const msg = typeof d?.error_description === "string" ? d.error_description : asError(detail);
    throw new Error(`Corti auth error: HTTP ${res.status} - ${msg}`);
  }
  const data = (await res.json()) as { access_token: string; expires_in?: number };
  const ttlMs = (data.expires_in ?? 300) * 1000;
  cachedToken = { token: data.access_token, expiresAt: Date.now() + ttlMs - 30_000 };
  return data.access_token;
}

export async function getAccessToken(): Promise<string> {
  const mode = authMode();
  if (mode === "api_key") return getApiKey();
  if (mode === "none") {
    throw new Error(
      "No Corti credentials found. Set CORTI_CLIENT_ID and CORTI_CLIENT_SECRET (or CORTI_API_KEY) in .env.local.",
    );
  }
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.token;
  inflightToken ??= fetchClientCredentialsToken().finally(() => {
    inflightToken = null;
  });
  return inflightToken;
}

function asError(detail: unknown): string {
  if (detail == null) return "unknown error";
  if (typeof detail === "string") return detail;
  if (typeof detail === "object") {
    const anyDetail = detail as Record<string, unknown>;
    if (typeof anyDetail.message === "string") return anyDetail.message;
    if (typeof anyDetail.error === "string") return anyDetail.error;
    try {
      return JSON.stringify(detail);
    } catch {
      return String(detail);
    }
  }
  return String(detail);
}

async function request<T>(
  path: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const send = async () =>
      fetch(`${getBaseUrl()}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${await getAccessToken()}`,
          ...(process.env.CORTI_TENANT_NAME ? { "Tenant-Name": getTenantName() } : {}),
          ...(init.headers ?? {}),
        },
      });

    let res = await send();
    // A cached client-credentials token can be revoked early: refresh once.
    if (res.status === 401 && authMode() === "client_credentials") {
      clearTokenCache();
      res = await send();
    }

    if (!res.ok) {
      let detail: unknown;
      try {
        detail = await res.json();
      } catch {
        detail = await res.text().catch(() => "no response body");
      }
      throw new Error(
        `Corti Models API error: HTTP ${res.status} - ${asError(detail)}`,
      );
    }

    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export async function listModels(
  opts: { timeoutMs?: number } = {},
): Promise<Array<ModelInfo>> {
  const data = await request<{ object: string; data: Array<ModelInfo> }>(
    "/models",
    { method: "GET" },
    opts.timeoutMs ?? 30_000,
  );
  return data.data;
}

export async function chat(
  options: ChatOptions,
  { timeoutMs = 120_000 }: { timeoutMs?: number } = {},
): Promise<ChatResult> {
  const selectedModel = options.model ?? getDefaultModel();

  const payload: Record<string, unknown> = {
    model: selectedModel,
    messages: options.messages,
  };
  if (options.maxTokens != null) payload.max_tokens = options.maxTokens;
  if (options.temperature != null) payload.temperature = options.temperature;
  if (options.tools?.length) {
    payload.tools = options.tools;
    payload.tool_choice = options.toolChoice ?? "auto";
  }

  const data = await request<{
    id: string;
    model: string;
    choices: Array<{
      message?: { content?: string | null; tool_calls?: ToolCall[] | null };
      finish_reason?: string | null;
    }>;
    usage?: Usage;
  }>("/chat/completions", { method: "POST", body: JSON.stringify(payload) }, timeoutMs);

  const choice = data.choices?.[0];
  return {
    id: data.id,
    model: data.model ?? selectedModel,
    content: choice?.message?.content ?? "",
    finishReason: choice?.finish_reason ?? null,
    usage: data.usage,
    toolCalls: choice?.message?.tool_calls ?? [],
  };
}

const corti = {
  chat,
  listModels,
  getDefaultModel,
  getApiKey,
  getAccessToken,
  authMode,
};

export default corti;
