// Talks to the FastAPI /agents routes.
// Uses the same API root and auth as lib/api.ts (cookie + optional Bearer token).
import { API } from "./api";

export type JobStatus =
  | "running"
  | "waiting_for_agent"
  | "payment_received"
  | "bug_reported";

export const STATUS_META: Record<JobStatus, { label: string; cls: string }> = {
  running: { label: "Running", cls: "text-[#3a6fe0]" },
  waiting_for_agent: { label: "Waiting for agent", cls: "text-amber-600" },
  payment_received: { label: "Payment received", cls: "text-teal-600" },
  bug_reported: { label: "Bug reported", cls: "text-rose-600" },
};

export const STATUS_ORDER = Object.keys(STATUS_META) as JobStatus[];

export type DeskAction = "reply_offer" | "submit_work" | null;
export type AgentTask = { id: string; title: string; status: JobStatus; action?: DeskAction };





export type Job = {
  id: string;
  title: string;
  description: string;
  agent_id: string | null;
  agent_name: string | null;
  status: JobStatus;
  files: { filename: string; size: number }[];
  created_at: string | null;
  managed?: boolean; // true = run by the job engine, status is automatic
  action?: DeskAction;
};
export type NegotiationStyle = "firm" | "balanced" | "flexible";

export type AgentInput = {
  name: string;
  skills: string[];
  description: string;
  auto_negotiate: boolean;
  ask_price: number | null;
  min_price: number | null;
  currency: string;
  negotiation_style: NegotiationStyle;
  max_rounds: number;
  instructions: string;
  paypal_email?: string | null;
};

export type Agent = AgentInput & { id: string; tasks: AgentTask[] };

export type Stats = Record<JobStatus, number> & { total: number };

function authHeaders(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const token = localStorage.getItem("token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    credentials: "include", // send the login cookie, same as lib/api.ts
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
      ...((init.headers as Record<string, string>) ?? {}),
    },
  });
  if (!res.ok) {
    let msg = `${init.method ?? "GET"} ${path} failed (${res.status})`;
    try {
      const body = await res.json();
      if (typeof body.detail === "string") msg = `${msg}: ${body.detail}`;
    } catch {
      /* no json body */
    }
    throw new Error(msg);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

export const agentsApi = {
  list: () => req<Agent[]>("/agents/"),
  create: (body: AgentInput) =>
    req<Agent>("/agents/", { method: "POST", body: JSON.stringify(body) }),
  update: (id: string, body: AgentInput) =>
    req<Agent>(`/agents/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  remove: (id: string) => req<void>(`/agents/${id}`, { method: "DELETE" }),

  stats: () => req<Stats>("/agents/stats"),
  jobs: () => req<Job[]>("/agents/jobs"),
  setJobStatus: (id: string, status: JobStatus) =>
    req<Job>(`/agents/jobs/${id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }),
  removeJob: (id: string) => req<void>(`/agents/jobs/${id}`, { method: "DELETE" }),
};

