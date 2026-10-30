// All backend access lives here. Adjust the two ASSUMPTION spots if your pipeline differs.
export const API_BASE = "http://localhost:8000/api/v1";

export type ToolStatus = "completed" | "revoked" | "running" | "failed";

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  result: unknown;
  status: ToolStatus;
  durationMs?: number;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolCalls: ToolCall[];
  latencyMs?: number;
}

function headers(): HeadersInit {
  const token = localStorage.getItem("token") ;
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

// Accepts several likely field names so the UI works with whatever the pipeline stores.
function normalizeToolCalls(raw: any): ToolCall[] {
  const calls: any[] = raw?.tool_calls ?? [];
  const journal: any[] = raw?.journal_entries ?? [];
  return calls.map((c, i) => {
    const j = journal.find((e) => e.task_id && e.task_id === c.task_id) ?? journal[i];
    const rawStatus = String(c.status ?? j?.status ?? "completed").toLowerCase();
    return {
      id: String(c.id ?? c.task_id ?? `${raw?.id ?? "t"}-${i}`),
      name: c.name ?? c.tool_name ?? c.tool ?? "tool",
      args: c.args ?? c.arguments ?? c.input ?? j?.args ?? {},
      result: c.result ?? c.output ?? c.response ?? null,
      status: (["success", "done", "completed"].includes(rawStatus) ? "completed" : rawStatus) as ToolStatus,
      durationMs: c.duration_ms ?? c.latency_ms,
    };
  });
}

export function normalizeMessage(raw: any): ChatMessage {
  return {
    id: String(raw.id ?? raw._id ?? crypto.randomUUID()),
    role: raw.role === "user" ? "user" : "assistant",
    content: raw.content ?? raw.response ?? raw.message ?? "",
    toolCalls: normalizeToolCalls(raw),
    latencyMs: raw.latency_ms,
  };
}

// POST /chats/
export async function sendChat(text: string): Promise<ChatMessage> {
  const res = await fetch(`${API_BASE}/chats/`, {
    method: "POST",
    headers: headers(),
    // ASSUMPTION 1: ChatCreate has a "content" field. Rename here if yours differs.
    body: JSON.stringify({ message: text }),
  });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  // ASSUMPTION 2: the response is the assistant turn (content, tool_calls, journal_entries).
  return normalizeMessage({ role: "assistant", ...(await res.json()) });
}

// GET /chats/history
export async function getHistory(limit = 50): Promise<ChatMessage[]> {
  const res = await fetch(`${API_BASE}/chats/history?limit=${limit}`, { headers: headers() });
  if (!res.ok) throw new Error(`Could not load history (${res.status})`);
  const data = await res.json();
  return (data.history ?? []).map(normalizeMessage);
}


export type StreamEvent =
  | { type: "step"; step: string; status: string; detail?: string; ts: number }
  | { type: "final"; data: any }
  | { type: "error"; message: string };

export async function streamChat(text: string, onEvent: (e: StreamEvent) => void) {
  const res = await fetch(`${API_BASE}/chats/stream`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ message: text }),
  });
  if (!res.ok || !res.body) throw new Error(`Request failed (${res.status})`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const parts = buf.split("\n\n");
    buf = parts.pop() ?? "";
    for (const p of parts) {
      if (p.startsWith("data: ")) onEvent(JSON.parse(p.slice(6)));
    }
  }
}