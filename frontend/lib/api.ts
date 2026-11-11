// lib/api.ts
// NEXT_PUBLIC_API must point at the API root including the version, e.g. http://localhost:8000/api/v1
export const API = (
  process.env.NEXT_PUBLIC_API ?? "http://localhost:8000/api/v1"
).replace(/\/$/, "");
import { getToken, clearToken } from "./auth";

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function j<T>(path: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(`${API}${path}`, {
    credentials: "include",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
      ...(init.headers as Record<string, string>),
    },
  });
  if (r.status === 401 && typeof window !== "undefined") {
    try {
      clearToken();
    } catch {
      /* ignore */
    }
    if (!window.location.pathname.startsWith("/login")) {
      window.location.assign(
        `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`,
      );
    }
  }
  if (!r.ok)
    throw new Error(`${init.method ?? "GET"} ${path} failed (${r.status})`);
  return r.json() as Promise<T>;
}

export type ApiChat = { convo_id: string; title: string | null };
export type ApiMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string | null;
  images?: string[];
};
export type RunningSummary = {
  id: string;
  title: string;
  started: string;
  started_at: number;
  progress: number;
  agents: string[];
};
export type CompletedRecord = {
  id: string;
  title: string;
  finished: string;
  duration: string;
  steps: number;
  success: string;
  summary: string;
  outcomes: string[];
  contributions: { agent: string; did: string; actions: number }[];
  logs: {
    t: string;
    agent: string;
    level: "info" | "success" | "warn" | "error";
    text: string;
  }[];
};

export const api = {
  chats: () => j<ApiChat[]>("/chats/"),
  messages: (convoId: string) =>
    j<ApiMessage[]>(`/chats/${encodeURIComponent(convoId)}/messages`),
  startTask: (convoId: string, message: string, images: string[] = []) =>
    j(`/chats/${encodeURIComponent(convoId)}/tasks`, {
      method: "POST",
      body: JSON.stringify({ message, convo_id: convoId, images }),
    }),
  cancelTask: (taskId: string) =>
    j<{ ok: boolean }>(`/chats/tasks/${taskId}/cancel`, { method: "POST" }),
  tasks: () =>
    j<{ running: RunningSummary[]; completed: CompletedRecord[] }>(
      "/chats/tasks",
    ),
  runs: () => j<RunSummary[]>("/chats/runs"),
  run: (messageId: string) =>
    j<RunDetail>(`/chats/runs/${encodeURIComponent(messageId)}`),
};

// ---------- types the Home page uses ----------
export type ToolCall = {
  id: string;
  name: string;
  args: unknown;
  result: unknown;
  status: "completed" | "running" | "revoked" | "failed" | string;
  durationMs?: number;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolCalls: ToolCall[];
};

// Matches what StreamMapper emits on POST /chats/stream
export type StreamEvent =
  | { type: "task"; task_id: string }
  | {
      type: "step";
      step: string;
      title: string;
      status: string;
      detail: string | null;
      ts: number;
    }
  | {
      type: "log";
      level: "info" | "success" | "warn" | "error";
      agent?: string;
      text: string;
      ts?: number;
    }
  | { type: "final"; data: any }
  | { type: "error"; message: string };

// Add tool_calls to ApiMessage (GET /messages returns it)
// export type ApiMessage = { ...; tool_calls?: any[] }

// ---------- normalizing ----------
export function normalizeMessage(raw: any): ChatMessage {
  const calls = raw.toolCalls ?? raw.tool_calls ?? raw.meta?.tool_calls ?? [];
  return {
    id: String(raw.id ?? raw.message_id ?? crypto.randomUUID()),
    role: raw.role === "user" ? "user" : "assistant",
    content: raw.content ?? raw.response ?? "",
    toolCalls: calls.map(
      (c: any, i: number): ToolCall => ({
        id: String(c.id ?? `${raw.id ?? "m"}-${i}`),
        name: c.name ?? c.tool ?? "tool",
        args: c.args ?? c.input ?? {},
        result: c.result ?? c.output ?? "",
        status: c.status ?? "completed",
      }),
    ),
  };
}

// ---------- history ----------
// Home calls getHistory() with no args, so fall back to the latest convo.
export async function getHistory(convoId?: string): Promise<ChatMessage[]> {
  let id = convoId;
  if (!id) {
    const chats = await api.chats();
    id = chats[chats.length - 1]?.convo_id;
    if (!id) return [];
  }
  const rows = await api.messages(id);
  return rows.map(normalizeMessage);
}

// ---------- POST /chats/stream (SSE over fetch, since EventSource can't POST) ----------
export async function streamChat(
  message: string,
  onEvent: (e: StreamEvent) => void,
  opts: { convoId?: string; signal?: AbortSignal } = {},
): Promise<void> {
  const r = await fetch(`${API}/chats/stream`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, convo_id: opts.convoId }),
    signal: opts.signal,
  });
  if (!r.ok || !r.body)
    throw new Error(`POST /chats/stream failed (${r.status})`);

  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n\n")) !== -1) {
      // one SSE frame
      const frame = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const data = frame
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trim())
        .join("");
      if (!data) continue; // ": ping" comments etc.
      try {
        onEvent(JSON.parse(data));
      } catch {
        /* ignore malformed frame */
      }
    }
  }
}

// ---------- saved runs (/progress pages) ----------
export type RunSummary = Omit<
  CompletedRecord,
  "logs" | "contributions" | "outcomes"
> & { message_id: string };
export type RunDetail = CompletedRecord & {
  message_id: string;
  events?: any[];
};

// add to the `api` object:
//   runs: () => j<RunSummary[]>("/chats/runs"),
//   run:  (messageId: string) => j<RunDetail>(`/chats/runs/${encodeURIComponent(messageId)}`),

// ---------- GET /chats/{task_id}/events (live task page, reconnect-safe) ----------
export function subscribeTask(
  taskId: string,
  onEvent: (ev: any) => void,
  onClose?: () => void,
) {
  const es = new EventSource(`${API}/chats/${taskId}/events`, {
    withCredentials: true,
  });
  const types = [
    "task.started",
    "plan.ready",
    "step.started",
    "step.finished",
    "agent.status",
    "agent.message",
    "log",
    "task.result",
    "task.error",
    "task.finished",
  ];
  types.forEach((t) =>
    es.addEventListener(t, (m) => {
      const ev = JSON.parse((m as MessageEvent).data);
      onEvent(ev);
      if (t === "task.finished") {
        es.close();
        onClose?.();
      }
    }),
  );
  es.onerror = () => {
    /* browser auto-reconnects and sends Last-Event-ID */
  };
  return () => es.close();
}
