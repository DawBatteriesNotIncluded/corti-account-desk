/**
 * HTTP client for the mock CRM. The CRM is treated as an external API:
 * paginated, may fail, and returns `null` for missing fields.
 */
import { CRM_BASE } from "../config.ts";

export type Account = {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  employeeCount: number | null;
  ownerId: string | null;
  stage: "prospect" | "evaluation" | "mvp" | "customer" | "closed_lost";
  createdAt: string;
  updatedAt: string;
  lastContactAt: string | null;
  nextStep: string | null;
  opportunityAmount: number | null;
  closeDate: string | null;
  icpTier: string | null;
};

export type Contact = {
  id: string;
  accountId: string;
  name: string;
  email: string | null;
  title: string | null;
  persona: string | null;
  lastContactedAt: string | null;
};

export type Activity =
  | { id: string; accountId: string; type: "email"; timestamp: string; direction: "inbound" | "outbound"; contactId?: string | null; subject?: string | null }
  | { id: string; accountId: string; type: "meeting"; timestamp: string; contactIds: string[]; outcome?: "positive" | "neutral" | "negative" | null }
  | { id: string; accountId: string; type: "stage_change"; timestamp: string; from?: string | null; to: string }
  | { id: string; accountId: string; type: "note"; timestamp: string; text: string };

export type Opportunity = {
  id: string;
  accountId: string;
  name: string | null;
  stage: string;
  value: number | null;
  openedAt: string | null;
  closeDate: string | null;
  lastStageChangeAt: string | null;
  nextStep: string | null;
  ownerId: string | null;
  status: string | null;
};

export type Task = {
  id: string;
  accountId: string;
  contactId: string | null;
  ownerId: string;
  title: string | null;
  description: string | null;
  dueDate: string | null;
  completed: boolean;
  createdAt: string;
};

type Page<K extends string, T> = { [key in K]: T[] } & {
  meta: { total: number; has_more: boolean; next_offset: number | null };
};

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export class CrmError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

const PAGE_SIZE = 100; // API maximum; larger values return 400

export class CrmClient {
  constructor(
    readonly base: string = CRM_BASE,
    private readonly fetchFn: FetchFn = (u, i) => fetch(u, i),
    private readonly retries = 3,
  ) {}

  private async call<T>(path: string, init?: RequestInit): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        const res = await this.fetchFn(`${this.base}${path}`, {
          ...init,
          headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
        });
        if (res.ok) return (await res.json()) as T;
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        const err = new CrmError(`CRM ${init?.method ?? "GET"} ${path} -> ${res.status}: ${body.error ?? res.statusText}`, res.status);
        if (res.status < 500) throw err; // 4xx: retrying won't help
        lastErr = err;
      } catch (e) {
        if (e instanceof CrmError && (e.status ?? 500) < 500) throw e;
        lastErr = e;
      }
      await new Promise((r) => setTimeout(r, 150 * 2 ** attempt));
    }
    throw lastErr instanceof Error ? lastErr : new CrmError(String(lastErr));
  }

  /** Follow offset pagination until has_more is false. */
  private async all<K extends string, T>(path: string, key: K): Promise<T[]> {
    const out: T[] = [];
    let offset = 0;
    for (;;) {
      const sep = path.includes("?") ? "&" : "?";
      const page = await this.call<Page<K, T>>(`${path}${sep}limit=${PAGE_SIZE}&offset=${offset}`);
      out.push(...page[key]);
      if (!page.meta?.has_more || page.meta.next_offset == null) break;
      offset = page.meta.next_offset;
    }
    return out;
  }

  async health(): Promise<boolean> {
    try {
      const r = await this.fetchFn(`${this.base}/health`);
      return r.ok;
    } catch {
      return false;
    }
  }

  listAccounts() { return this.all<"accounts", Account>("/accounts", "accounts"); }
  getAccount(id: string) { return this.call<Account>(`/accounts/${encodeURIComponent(id)}`); }
  contacts(id: string) { return this.all<"contacts", Contact>(`/accounts/${encodeURIComponent(id)}/contacts`, "contacts"); }
  activities(id: string) { return this.all<"activities", Activity>(`/accounts/${encodeURIComponent(id)}/activities`, "activities"); }
  tasks(id: string) { return this.all<"tasks", Task>(`/accounts/${encodeURIComponent(id)}/tasks`, "tasks"); }
  async opportunities(id: string) {
    return (await this.call<{ opportunities: Opportunity[] }>(`/accounts/${encodeURIComponent(id)}/opportunities`)).opportunities;
  }

  createTask(body: { accountId: string; title: string; dueDate?: string; ownerId?: string }) {
    return this.call<{ task: Task }>("/tasks", { method: "POST", body: JSON.stringify(body) });
  }
  addNote(accountId: string, text: string) {
    return this.call<{ note: Activity }>(`/accounts/${encodeURIComponent(accountId)}/notes`, { method: "POST", body: JSON.stringify({ text }) });
  }
}

export type CrmBundle = {
  account: Account;
  contacts: Contact[];
  activities: Activity[];
  opportunities: Opportunity[];
  tasks: Task[];
};

/** Run async work over items with a concurrency cap. */
export async function pool<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
      }
    }),
  );
  return out;
}

/** Load the whole book: 1 + 4 calls per account (~800 local requests, ~1-2 s). */
export async function loadCrm(client: CrmClient): Promise<CrmBundle[]> {
  const accounts = await client.listAccounts();
  return pool(accounts, 10, async (account) => {
    const [contacts, activities, opportunities, tasks] = await Promise.all([
      client.contacts(account.id),
      client.activities(account.id),
      client.opportunities(account.id),
      client.tasks(account.id),
    ]);
    return { account, contacts, activities, opportunities, tasks };
  });
}
