"use client";
import type { ToolCall } from "@/lib/api";

export type StepStatus = "waiting" | "running" | "done" | "failed";
export interface Step {
  id: string;
  title: string;
  description?: string;
  status: StepStatus;
  startedAt?: number; // seconds (event ts)
  durationMs?: number;
  logs?: string[];
}

const pretty = (s: string) => {
  const t = s.replace(/[_-]+/g, " ").trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
};

const toStatus = (s: string): StepStatus => {
  const v = s.toLowerCase();
  if (["done", "success", "completed", "finished", "complete"].includes(v)) return "done";
  if (["failed", "error", "revoked"].includes(v)) return "failed";
  if (v === "waiting" || v === "pending" || v === "queued") return "waiting";
  return "running";
};

// Feed each SSE "step" event in; returns the updated list.
export function applyEvent(
  steps: Step[],
  ev: { step: string; title?: string | null; status: string; detail?: string | null; ts: number }
): Step[] {
  const status = toStatus(ev.status);
  const i = steps.findIndex((s) => s.id === ev.step);
  if (i === -1) {
    return [
      ...steps,
      { id: ev.step, title: ev.title || pretty(ev.step), description: ev.detail ?? undefined, status, startedAt: ev.ts },
    ];
  }
  const cur = steps[i];
  const next: Step = {
    ...cur,
    status,
    title: ev.title || cur.title,
    description: ev.detail ?? cur.description,
    startedAt: status === "running" ? ev.ts : cur.startedAt,
    durationMs: status === "done" || status === "failed"
      ? (cur.startedAt ? (ev.ts - cur.startedAt) * 1000 : cur.durationMs)
      : cur.durationMs,
  };
  return steps.map((s, j) => (j === i ? next : s));
}

// Feed each SSE "log" event in (a terminal line that belongs to a step).
export function applyLog(steps: Step[], ev: { step?: string | null; line: string }): Step[] {
  const id = ev.step ?? [...steps].reverse().find((s) => s.status === "running")?.id;
  if (!id) return steps;
  return steps.map((s) => (s.id === id ? { ...s, logs: [...(s.logs ?? []), ev.line].slice(-30) } : s));
}

// For finished runs loaded from /chats/history.
export function stepsFromToolCalls(calls: ToolCall[]): Step[] {
  return calls.map((c) => ({
    id: c.id,
    title: pretty(c.name),
    description: typeof c.result === "string" ? c.result : undefined,
    status: c.status === "completed" ? "done" : c.status === "running" ? "running" : "failed",
    durationMs: c.durationMs,
  }));
}

function Check() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

export function Timeline({ steps }: { steps: Step[] }) {
  const running = steps.find((s) => s.status === "running");
  const doneCount = steps.filter((s) => s.status === "done").length;
  const allDone = steps.length > 0 && steps.every((s) => s.status === "done");
  const pct = steps.length ? Math.round((doneCount / steps.length) * 100) : 0;

  return (
    <div className="rounded-2xl border border-[#2a2c4a] bg-[#14152b] p-5 text-slate-200">
      <p className="text-sm text-slate-400" aria-live="polite">
        {steps.length === 0 ? "Getting ready…" : allDone ? `All ${steps.length} tasks complete` : running ? `Task ${doneCount + 1} of ${steps.length}: ${running.title}` : "Working…"}
      </p>
      <div className="mb-5 mt-3 h-1.5 overflow-hidden rounded-full bg-[#292e50]">
        <div className="h-full rounded-full bg-gradient-to-r from-indigo-400 to-emerald-300 transition-all duration-500" style={{ width: `${pct}%` }} />
      </div>

      <ol>
        {steps.map((s, i) => {
          const last = i === steps.length - 1;
          const marker =
            s.status === "done" ? "border-emerald-300 bg-emerald-300 text-[#0f1020] shadow-[0_10px_20px_-8px_rgba(61,220,151,0.5)]"
            : s.status === "failed" ? "border-rose-300 bg-rose-300 text-[#0f1020]"
            : s.status === "running" ? "scale-105 border-indigo-300 bg-indigo-300 text-[#0f1020] ring-4 ring-indigo-300/20"
            : "border-[#292e50] bg-[#171b35] text-slate-400";
          return (
            <li key={s.id} className="grid grid-cols-[44px_1fr] gap-4">
              <div className="flex flex-col items-center">
                <div className={`relative grid h-11 w-11 shrink-0 place-items-center rounded-full border-2 font-semibold transition-all duration-300 ${marker}`}>
                  {s.status === "running" && <span className="absolute -inset-2 animate-spin rounded-full border-2 border-transparent border-r-indigo-300/50 border-t-indigo-300" />}
                  {s.status === "done" ? <Check /> : s.status === "failed" ? "!" : i + 1}
                </div>
                {!last && <div className={`my-2 min-h-7 w-0.5 flex-1 rounded ${s.status === "done" ? "bg-gradient-to-b from-indigo-300 to-emerald-300" : "bg-[#292e50]"}`} />}
              </div>
              <div className={`mb-4 rounded-2xl border bg-[#171b35] p-4 transition-all duration-300 ${s.status === "running" ? "translate-x-1 border-indigo-300/50" : "border-[#292e50]"} ${s.status === "waiting" ? "opacity-50" : ""}`}>
                <h3 className="font-semibold text-white">{s.title}</h3>
                {s.description && <p className="mt-1 line-clamp-3 text-sm text-slate-400">{s.description}</p>}
                {s.logs && s.logs.length > 0 && (
                  <pre className="mt-3 max-h-32 overflow-auto whitespace-pre-wrap rounded-lg bg-black/40 p-2 font-mono text-xs text-slate-400">{s.logs.slice(-6).join("\n")}</pre>
                )}
                <span className={`mt-3 inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ${
                  s.status === "done" ? "bg-emerald-400/10 text-emerald-300"
                  : s.status === "failed" ? "bg-rose-400/10 text-rose-300"
                  : s.status === "running" ? "bg-indigo-300/15 text-indigo-300" : "bg-[#292e50] text-slate-400"}`}>
                  {s.status === "running" && <i className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />}
                  {s.status === "waiting" ? "Waiting" : s.status === "running" ? "In progress" : s.status === "failed" ? "Failed"
                    : s.durationMs != null ? `Done in ${(s.durationMs / 1000).toFixed(1)}s` : "Done"}
                </span>
              </div>
            </li>
          );
        })}
      </ol>

      {allDone && (
        <div className="ml-[60px] flex items-center gap-3 rounded-2xl border border-emerald-300/60 bg-emerald-400/10 px-5 py-3 font-semibold text-emerald-300">
          <Check /> All tasks complete.
        </div>
      )}
    </div>
  );
}