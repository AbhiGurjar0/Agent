// Job API client + types.
// IMPORTANT: BASE must point at your FastAPI server (same host you use in lib/api.ts).
// An empty BASE sends /jobs to the Next.js dev server, which answers with an HTML 404 page, and then
// res.json() throws "JSON.parse: unexpected character at line 1 column 1".
const ROOT = (process.env.NEXT_PUBLIC_API_URL ?? process.env.NEXT_PUBLIC_API_BASE ?? "https://paypal-agent-backend.onrender.com").replace(/\/$/, "");
export const BASE = /\/api\/v\d+$/.test(ROOT) ? ROOT : `${ROOT}/api/v1`;
import { getToken, clearToken } from "./auth";

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export type Stage = "hire" | "negotiate" | "work" | "validate" | "payment";
export const STAGES: { id: Stage; label: string }[] = [
  { id: "hire", label: "Hire" },
  { id: "negotiate", label: "Negotiate" },
  { id: "work", label: "Work" },
  { id: "validate", label: "Validate" },
  { id: "payment", label: "Payment" },
];

export type JobStatus = "draft" | "scheduled" | "running" | "waiting" | "completed" | "failed";

export type Activity =
  | "searching_freelancers"
  | "contacting"
  | "negotiating"
  | "monitoring_work"
  | "validating"
  | "processing_payment"
  | "retrying_payment";

export type BlockedOn =
  | "freelancer_reply"
  | "freelancer_acceptance"
  | "work_submission"
  | "revision"
  | "payment_confirmation"
  | "your_approval"
  | "budget_approval";


export type FailureKind =
  | "no_freelancer"
  | "negotiation_failed"
  | "deadline_missed"
  | "validation_failed"
  | "payment_failed"
  | "cancelled"
  | "other";

export type JobEvent = { ts: number; stage: Stage; level: "info" | "success" | "warn" | "error"; text: string };

export type Candidate = {
  id: string; provider: string; simulated?: boolean; name: string; title: string; rating: number;
  jobs_done: number; skills: string[]; bio: string; typical_rate: number; match: number;
  auto?: boolean; agent_id?: string; ask_price?: number | null;   // <- add this line
};
export type Offer = { round: number; by: "agent" | "freelancer"; price: number | null; message: string; ts: number; candidate_id: string };
export type CriterionResult = { criterion: string; met: boolean; evidence: string; problem: string; fix: string };
export type Validation = {
  passed: boolean; score: number; summary: string; attempt: number;
  criteria: CriterionResult[]; fixes: { criterion: string; problem: string; fix: string }[]; fixes_text: string;
};
export type PlanStage = { stage: Stage; steps: string[] };
export type ThreadMsg = { id: string; ts: number; dir: "in" | "out"; type: string; from: string; price?: number | null; text: string };

export type Job = {
  id: string;
  title: string;
  description: string;
  skills: string[];
  criteria: string[];
  budget: number;
  maxBudget?: number | null;
  currency: string;
  deadline?: string | null;
  scheduledFor?: string | null;
  status: JobStatus;
  stage: Stage;
  activity?: Activity | null;
  blockedOn?: BlockedOn | null;
  waitingSince?: number | null;
  progress: number;
  createdAt: number;
  updatedAt: number;
  freelancer?: { id?: string; name: string; rating?: number; title?: string } | null;
  agreedPrice?: number | null;
  failure?: { kind: FailureKind; stage: Stage; reason: string; retryable: boolean } | null;
  events: JobEvent[];
  // added by the new backend
  plan?: PlanStage[];
  missing?: string[];
  offers?: Offer[];
  candidates?: Candidate[];
  revisions?: number;
  lastValidation?: Validation | null;
  payment?: { status: string; ref?: string; attempts?: number; amount?: number; error?: string | null } | null;
  submission?: { content: string; links: string[]; ts: number } | null;
  files?: { id: string; filename: string; size: number; content_type?: string | null; source?: string }[];
  pendingApproval?: { price: number; max: number; freelancer: string; ts: number } | null;
};

export type JobDraft = Pick<
  Job,
  "title" | "description" | "skills" | "criteria" | "budget" | "maxBudget" | "currency" | "deadline" | "scheduledFor"
>;

async function j<T>(path: string, init?: RequestInit): Promise<T> {
  let r: Response;
  try {
    r = await fetch(`${BASE}${path}`, {
      credentials: "include",
      headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
    },
      ...init,
    });
  } catch {
    throw new Error(`Cannot reach the server at ${BASE}. Is the backend running and is CORS allowed?`);
  }
  const text = await r.text();
  const ctype = r.headers.get("content-type") ?? "";
  if (!r.ok) {
    let msg = text;
    try { const d = JSON.parse(text); msg = d.detail ?? d.message ?? text; } catch { /* not json */ }
    throw new Error(typeof msg === "string" && msg.length < 300 ? msg : `Request failed (${r.status})`);
  }
  if (r.status === 204 || !text) return undefined as T;
  if (!ctype.includes("json")) {
    throw new Error(`Got a non-JSON response from ${BASE}${path}. NEXT_PUBLIC_API_URL probably points at the Next.js app instead of the API, or the /jobs router is not mounted.`);
  }
  return JSON.parse(text) as T;
}

const post = <T,>(path: string, body?: unknown) => j<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });

export const jobsApi = {
  list: () => j<Job[]>("/jobs"),
  get: (id: string) => j<Job>(`/jobs/${id}`),
  update: (id: string, patch: Partial<JobDraft>) => j<Job>(`/jobs/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  confirm: (id: string) => post<Job>(`/jobs/${id}/confirm`),
  discard: (id: string) => j<void>(`/jobs/${id}`, { method: "DELETE" }),
  cancel: (id: string) => post<Job>(`/jobs/${id}/cancel`),
  nudge: (id: string) => post<Job>(`/jobs/${id}/nudge`),
  approveBudget: (id: string) => post<Job>(`/jobs/${id}/approve-budget`),
  declineBudget: (id: string) => post<Job>(`/jobs/${id}/decline-budget`),
  retry: (id: string) => post<Job>(`/jobs/${id}/retry`),
  // replies: wakes the agent immediately
  reply: (id: string, body: { message: string; sender: "freelancer" | "user"; type?: string; price?: number; links?: string[] }) =>
    post<Job>(`/jobs/${id}/reply`, body),
  approve: (id: string) => post<Job>(`/jobs/${id}/approve`),
  reject: (id: string, fixes: string) => post<Job>(`/jobs/${id}/reject`, { fixes }),
  candidates: (id: string) => j<Candidate[]>(`/jobs/${id}/candidates`),
  hire: (id: string, candidateId: string, price?: number) => post<Job>(`/jobs/${id}/hire`, { candidateId, price }),
  thread: (id: string) => j<ThreadMsg[]>(`/jobs/${id}/thread`),
};