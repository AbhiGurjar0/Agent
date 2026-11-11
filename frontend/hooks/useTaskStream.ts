// hooks/useTaskStream.ts
"use client";
import { useEffect, useReducer } from "react";
import { API } from "../lib/api";

export type TaskEvent = { id?: number; type: string; ts?: number; [k: string]: any };
export type StepState = { id: string; label: string; agent: string; status: "pending" | "running" | "done" | "failed" | "skipped" };
type Status = "running" | "completed" | "cancelled" | "failed";

type S = {
  title: string;
  steps: StepState[];
  done: number;
  agents: Record<string, { status: string; doing: string }>;
  messages: any[];
  logs: any[];
  response: string | null;
  meta: any;
  status: Status;
  lastId: number;
};

const init: S = {
  title: "", steps: [], done: 0, agents: {}, messages: [], logs: [],
  response: null, meta: null, status: "running", lastId: 0,
};

const countDone = (steps: StepState[]) =>
  steps.filter((s) => s.status === "done" || s.status === "failed" || s.status === "skipped").length;

const mark = (s: S, id: string, status: StepState["status"]): S => {
  const steps = s.steps.map((x) => (x.id === id ? { ...x, status } : x));
  return { ...s, steps, done: countDone(steps) };
};

function reduce(s: S, e: TaskEvent): S {
  // Server events carry an increasing id: ignore anything we've already applied (reconnect replays).
  if (typeof e.id === "number") {
    if (e.id <= s.lastId) return s;
    s = { ...s, lastId: e.id };
  }
  switch (e.type) {
    case "task.started":   return { ...s, title: e.title ?? s.title };
    case "plan.ready":     return {
      ...s,
      steps: (e.steps ?? []).map((x: any) => ({ id: x.id, label: x.label, agent: x.agent, status: "pending" })),
      done: 0,
    };
    case "step.started":   return mark(s, e.step_id, "running");
    case "step.finished":  return mark(s, e.step_id, "done");
    case "step.failed":    return mark(s, e.step_id, "failed");
    case "step.skipped":   return mark(s, e.step_id, "skipped");
    case "agent.status":   return { ...s, agents: { ...s.agents, [e.agent]: { status: e.status, doing: e.doing } } };
    case "agent.message":  return {
      ...s,
      messages: [...s.messages, e],
      logs: [...s.logs, { ...e, agent: e.from, text: e.log ?? e.text }],
    };
    case "log":            return { ...s, logs: [...s.logs, e] };
    case "task.result":    return { ...s, response: e.response ?? "", meta: e.meta ?? null };
    case "task.finished":  return { ...s, status: e.status as Status };
    default:               return s;
  }
}

export const TASK_EVENT_TYPES = [
  "task.started", "plan.ready", "step.started", "step.finished", "step.failed", "step.skipped",
  "agent.status", "agent.message", "log", "task.result", "task.finished",
];

/** Low-level subscription (used by the Chats page, which tracks several tasks at once). Returns an unsubscribe fn. */
export function subscribeTask(taskId: string, onEvent: (ev: TaskEvent) => void): () => void {
  const es = new EventSource(`${API}/chats/${taskId}/events`, { withCredentials: true });
  let closed = false;
  const close = () => {
    if (!closed) {
      closed = true;
      es.close();
    }
  };
  TASK_EVENT_TYPES.forEach((t) =>
    es.addEventListener(t, (m) => {
      let ev: TaskEvent;
      try {
        ev = JSON.parse((m as MessageEvent).data);
      } catch {
        return;
      }
      onEvent(ev);
      if (t === "task.finished") close(); // otherwise EventSource reconnects forever
    })
  );
  // Network blips: EventSource retries by itself (and resumes via Last-Event-ID).
  // CLOSED means the server refused (e.g. unknown/expired task), so stop and report it.
  es.onerror = () => {
    if (!closed && es.readyState === EventSource.CLOSED) {
      onEvent({ type: "task.finished", status: "failed" });
      close();
    }
  };
  return close;
}

export function useTaskStream(taskId?: string) {
  const [state, dispatch] = useReducer(reduce, init);
  useEffect(() => {
    if (!taskId) return;
    return subscribeTask(taskId, dispatch);
  }, [taskId]);
  return state;
}