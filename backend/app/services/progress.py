"""
Progress events for a running task (the source of the SSE stream).

Imported by routes/chat.py as:  from app.services.progress import ProgressEmitter, EMITTERS, CANCELS
and by the orchestrator / pipeline as:  from app.services.progress import agent_for

Every event is a dict:  {"id": int, "type": str, "ts": float, ...fields}
  * `id`   increases by 1 per event (used as the SSE id, so reconnects can resume)
  * `type` is also used as the SSE `event:` name, so the frontend can addEventListener(type)
"""
import asyncio
import threading
import time
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

from app.schemas.planner_schema import WorkerType


EMITTERS: Dict[str, "ProgressEmitter"] = {}
CANCELS: Dict[str, asyncio.Event] = {}




_AGENT_MAP = {
    WorkerType.BROWSER: "browser",
    WorkerType.DESKTOP_GUI: "desktop",
    WorkerType.ANALYST: "analyst",
    WorkerType.MAC_OS: "mac",
    WorkerType.CODER: "builder",
    WorkerType.SEARCH: "researcher",
}

def agent_for(worker_type) -> str:
    return _AGENT_MAP.get(worker_type, "planner")


class ProgressEmitter:
    MAX_EVENTS = 5000

    def __init__(self, task_id: str):
        self.task_id = task_id
        self.meta: Dict[str, Any] = {}          # title, user_id, convo_id ... filled by the route
        self.closed = False
        self.status = "running"
        self.started_at = time.time()
        self._events: List[Dict[str, Any]] = []
        self._subs: List[asyncio.Queue] = []
        self._next_id = 1
        self._lock = threading.Lock()
        try:
            self._loop: Optional[asyncio.AbstractEventLoop] = asyncio.get_running_loop()
        except RuntimeError:
            self._loop = None

    @property
    def events(self) -> List[Dict[str, Any]]:
        return list(self._events)

    # ---- producing -------------------------------------------------------
    def emit(self, etype: str, **fields: Any) -> Optional[Dict[str, Any]]:
        with self._lock:
            if self.closed:
                return None
            ev = {**fields, "id": self._next_id, "type": etype, "ts": round(time.time(), 3)}
            self._next_id += 1
            self._events.append(ev)
            if len(self._events) > self.MAX_EVENTS:
                del self._events[: len(self._events) - self.MAX_EVENTS]
            subs = list(self._subs)
        self._push(subs, ev)
        return ev

    def notify(self, message: Any) -> None:
        """notify_callback used by the orchestrator / tools. Accepts a string or an event dict."""
        if isinstance(message, dict):
            data = dict(message)
            self.emit(str(data.pop("type", "log")), **data)
        else:
            self.emit("log", agent="planner", level="info", text=str(message))

    def close(self, status: str = "completed") -> None:
        with self._lock:
            if self.closed:
                return
        self.emit("task.finished", status=status)   # must go out before `closed` flips
        with self._lock:
            self.closed = True
            self.status = status
            subs = list(self._subs)
        self._push(subs, None)                      # None = end-of-stream sentinel

    def _push(self, subs: List[asyncio.Queue], item: Any) -> None:
        for q in subs:
            try:
                running = asyncio.get_running_loop()
            except RuntimeError:
                running = None
            if self._loop is None or running is self._loop:
                q.put_nowait(item)
            else:  # called from a worker thread
                self._loop.call_soon_threadsafe(q.put_nowait, item)

    # ---- consuming (SSE) -------------------------------------------------
    def attach(self, last_event_id: int = 0) -> Tuple[asyncio.Queue, List[Dict[str, Any]]]:
        q: asyncio.Queue = asyncio.Queue()
        with self._lock:
            backlog = [e for e in self._events if e["id"] > last_event_id]
            self._subs.append(q)
        return q, backlog

    def detach(self, q: asyncio.Queue) -> None:
        with self._lock:
            if q in self._subs:
                self._subs.remove(q)


# --------------------------------------------------------------------------- #
# Digest of the event log -> live summary + the record saved when a task ends
# --------------------------------------------------------------------------- #
_STEP_STATUS = {
    "step.started": "running",
    "step.finished": "done",
    "step.failed": "failed",
    "step.skipped": "skipped",
}


def _digest(em: ProgressEmitter) -> Dict[str, Any]:
    steps: Dict[str, Dict[str, Any]] = {}
    goal, response, meta = "", "", {}
    contrib: Dict[str, Dict[str, Any]] = {}
    logs: List[Dict[str, Any]] = []
    agents: List[str] = ["planner"]

    def see(a: Optional[str]) -> None:
        if a and a not in agents:
            agents.append(a)

    for ev in em.events:
        t, sid = ev["type"], ev.get("step_id")
        if t == "plan.ready":
            goal = ev.get("goal") or goal
            for s in ev.get("steps", []):
                steps.setdefault(s["id"], {"label": s.get("label") or s["id"], "agent": s.get("agent"), "status": "pending"})
                see(s.get("agent"))
        elif t in _STEP_STATUS and sid in steps:
            steps[sid]["status"] = _STEP_STATUS[t]
        elif t == "task.result":
            response = str(ev.get("response") or "")
            meta = ev.get("meta") or {}
        elif t in ("agent.message", "log"):
            agent = ev.get("from") if t == "agent.message" else ev.get("agent")
            see(agent)
            see(ev.get("to"))
            logs.append({
                "t": datetime.fromtimestamp(ev["ts"]).strftime("%H:%M:%S"),
                "agent": agent or "planner",
                "level": ev.get("level", "info"),
                "text": str(ev.get("log") or ev.get("text") or ""),
            })
            c = contrib.setdefault(agent or "planner", {"did": "", "actions": 0})
            c["actions"] += 1
            if t == "agent.message" and ev.get("text"):
                c["did"] = str(ev["text"])
    return {"steps": steps, "goal": goal, "response": response, "meta": meta,
            "contrib": contrib, "logs": logs, "agents": agents}


def progress_summary(em: ProgressEmitter) -> Dict[str, Any]:
    d = _digest(em)
    total = len(d["steps"])
    done = sum(1 for s in d["steps"].values() if s["status"] in ("done", "failed", "skipped"))
    pct = min(98, round(100 * done / total)) if total else 5
    return {
        "id": em.task_id,
        "title": em.meta.get("title") or d["goal"] or "Task",
        "started": datetime.fromtimestamp(em.started_at).strftime("%H:%M"),
        "started_at": em.started_at,
        "progress": pct,
        "agents": d["agents"],
    }


def _when_label(ts: float) -> str:
    dt = datetime.fromtimestamp(ts)
    today = datetime.now().date()
    day = "Today" if dt.date() == today else "Yesterday" if dt.date() == today - timedelta(days=1) else dt.strftime("%d %b")
    return f"{day} · {dt:%H:%M}"


def _duration(sec: float) -> str:
    sec = int(sec)
    if sec < 60:
        return f"{sec}s"
    m = sec // 60
    return f"{m // 60}h {m % 60}m" if m >= 60 else f"{m}m"

def build_task_record(em: ProgressEmitter, *, user_id: str, convo_id: Optional[str],
                      title: str, message_id: Optional[str] = None) -> Dict[str, Any]:
    """Shape matches the `Completed` type in Tasks.tsx, plus bookkeeping fields."""
    d = _digest(em)
    finished = time.time()
    total = len(d["steps"])
    done = sum(1 for s in d["steps"].values() if s["status"] == "done")
    outcomes = [s["label"] for s in d["steps"].values() if s["status"] == "done"]
    if not outcomes and d["response"]:
        outcomes = [d["response"][:160]]
    contributions = [
        {"agent": a, "did": c["did"] or "Took part in this task", "actions": c["actions"]}
        for a, c in sorted(d["contrib"].items(), key=lambda kv: -kv[1]["actions"])
    ]
    if total:
        success = f"{round(100 * done / total)}%"
    else:
        success = "100%" if em.status == "completed" else "0%"
    return {
        "id": em.task_id,
        "message_id": message_id,
        "user_id": user_id,
        "convo_id": convo_id,
        "title": title or d["goal"] or "Task",
        "state": em.status,
        "finished": _when_label(finished),
        "finished_ts": finished,
        "started_ts": em.started_at,
        "duration": _duration(finished - em.started_at),
        "steps": total or len(d["logs"]),
        "success": success,
        "summary": d["response"] or "No summary was produced.",
        "outcomes": outcomes,
        "contributions": contributions,
        "logs": d["logs"][-500:],
        "events": em.events,          # lets /progress/:id rebuild the exact timeline
    }
    
class StreamMapper:
    """Converts ProgressEmitter events into the wire format used by POST /chats/stream."""

    def __init__(self):
        self.labels: Dict[str, str] = {}
        self.current: Optional[str] = None      # step currently running (for log lines)
        self.plan_closed = False

    def _step(self, sid, status, ev, detail=None):
        return {"type": "step", "step": sid, "title": self.labels.get(sid),
                "status": status, "detail": detail, "ts": ev["ts"]}

    def feed(self, ev: Dict[str, Any]) -> List[Dict[str, Any]]:
        t, out = ev["type"], []

        if t == "plan.ready":
            out.append({"type": "step", "step": "plan", "title": "Plan the steps",
                        "status": "done", "detail": ev.get("goal"), "ts": ev["ts"]})
            self.plan_closed = True
            for s in ev.get("steps", []):
                self.labels[s["id"]] = s.get("label") or s["id"]
                out.append(self._step(s["id"], "waiting", ev))

        elif t == "step.started":
            sid = ev.get("step_id")
            self.labels.setdefault(sid, ev.get("text") or sid)
            self.current = sid
            out.append(self._step(sid, "running", ev, ev.get("text")))

        elif t in ("step.finished", "step.failed", "step.skipped"):
            sid = ev.get("step_id")
            st = ev.get("status", "")
            if t == "step.failed" or st in ("error", "failed"):
                status = "failed"
            elif t == "step.skipped" or st == "skipped":
                status = "failed"
            else:
                status = "done"
            out.append(self._step(sid, status, ev))
            if self.current == sid:
                self.current = None

        elif t in ("log", "agent.message"):
            text = ev.get("log") or ev.get("text")
            if text:
                out.append({"type": "log", "step": self.current, "line": str(text)})

        elif t == "task.result":
            if not self.plan_closed:   # simple chat with no plan: close the "plan" step
                out.append({"type": "step", "step": "plan", "title": "Plan the steps",
                            "status": "done", "detail": None, "ts": ev["ts"]})
                self.plan_closed = True
            data = ev.get("result") or {"id": ev.get("message_id"),
                                        "response": ev.get("response"), **(ev.get("meta") or {})}
            out.append({"type": "final", "data": data})

        elif t == "task.error":
            out.append({"type": "error", "message": ev.get("message", "Task failed")})

        return out