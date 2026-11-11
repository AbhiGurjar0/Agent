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
    durationMs: c?.durationMs,
  }));
}

function Check() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

const RAISED_SM = "shadow-[4px_4px_9px_#c3cde0,-4px_-4px_9px_#ffffff]";
const INSET_SM = "shadow-[inset_3px_3px_6px_#c3cde0,inset_-3px_-3px_6px_#ffffff]";

export function Timeline({ steps }: { steps: Step[] }) {
  const running = steps.find((s) => s.status === "running");
  const failed = steps.find((s) => s.status === "failed");
  const doneCount = steps.filter((s) => s.status === "done").length;
  const allDone = steps.length > 0 && steps.every((s) => s.status === "done");
  const pct = steps.length ? Math.round((doneCount / steps.length) * 100) : 0;

  return (
    <div className="text-[#1c2a4a]">
      <p className="text-sm text-[#7a88a6]" aria-live="polite">
        {steps.length === 0 ? "Getting ready…"
          : failed ? `Stopped at: ${failed.title}`
          : allDone ? `All ${steps.length} tasks complete`
          : running ? `Task ${doneCount + 1} of ${steps.length}: ${running.title}`
          : "Working…"}
      </p>
      <div className={`mb-5 mt-3 h-2.5 overflow-hidden rounded-full bg-[#e7edf6] ${INSET_SM}`}>
        <div className="h-full rounded-full bg-gradient-to-r from-[#5b95ff] to-[#3a6fe0] transition-all duration-500" style={{ width: `${pct}%` }} />
      </div>

      <ol>
        {steps.map((s, i) => {
          const last = i === steps.length - 1;
          const marker =
            s.status === "done" ? "bg-emerald-500 text-white"
            : s.status === "failed" ? "bg-rose-500 text-white"
            : s.status === "running" ? "bg-gradient-to-br from-[#5b95ff] to-[#3a6fe0] text-white"
            : `bg-[#e7edf6] text-[#7a88a6] ${INSET_SM}`;
          return (
            <li key={s.id} className="grid grid-cols-[44px_1fr] gap-4">
              <div className="flex flex-col items-center">
                <div className={`relative grid h-11 w-11 shrink-0 place-items-center rounded-full font-semibold transition-all duration-300 ${marker}`}>
                  {s.status === "running" && <span className="absolute -inset-1.5 animate-spin rounded-full border-2 border-transparent border-t-[#3a6fe0]" />}
                  {s.status === "done" ? <Check /> : s.status === "failed" ? "!" : i + 1}
                </div>
                {!last && <div className={`my-2 min-h-7 w-1 flex-1 rounded ${s.status === "done" ? "bg-emerald-400" : "bg-[#c3cde0]"}`} />}
              </div>
              <div className={`mb-4 rounded-2xl bg-[#e7edf6] p-4 transition-all duration-300 ${RAISED_SM} ${s.status === "waiting" ? "opacity-50" : ""}`}>
                <h3 className="font-semibold">{s.title}</h3>
                {s.description && <p className="mt-1 line-clamp-3 text-sm text-[#7a88a6]">{s.description}</p>}
                {s.logs && s.logs.length > 0 && (
                  <pre className={`mt-3 max-h-32 overflow-auto whitespace-pre-wrap rounded-xl bg-[#e7edf6] p-2 font-mono text-xs text-[#3b4a6b] ${INSET_SM}`}>
                    {s.logs.slice(-6).join("\n")}
                  </pre>
                )}
                <span className={`mt-3 inline-flex items-center gap-2 rounded-full bg-[#e7edf6] px-3 py-1 text-xs font-bold ${INSET_SM} ${
                  s.status === "done" ? "text-emerald-600"
                  : s.status === "failed" ? "text-rose-600"
                  : s.status === "running" ? "text-[#3a6fe0]" : "text-[#7a88a6]"}`}>
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
        <div className={`ml-[60px] flex items-center gap-3 rounded-2xl bg-[#e7edf6] px-5 py-3 font-semibold text-emerald-600 ${INSET_SM}`}>
          <Check /> All tasks complete.
        </div>
      )}
    </div>
  );
}