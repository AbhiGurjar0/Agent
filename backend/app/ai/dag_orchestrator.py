# app/ai/dag_orchestrator.py
"""
Upgraded DAG orchestrator.

Backwards compatible with the old one:
  * same class name, same `DAGOrchestrator(num_workers=3)` constructor call
  * same `execute_plan(plan, notify_callback=None)` call
  * same result keys: status, summary, raw_outputs, steps_executed (new keys are additive)
  * works with your CURRENT planner_schema (new PlanStep fields are read with getattr)

What's new:
  * plan validation (unknown deps, duplicate ids, cycles) -> no more silent hang
  * per-step timeouts
  * {{step_id}} / {{step_id.key}} templating in payloads (+ auto-dependency inference)
  * exclusive lock for desktop GUI steps (one mouse, one keyboard)
  * failure policy per step ("abort" or "continue") + automatic skipping of dependents
  * optional `replanner` hook so a failed step can trigger a new plan (self-healing at DAG level)
  * optional progress notifications, telemetry (duration, worker type) on every step
  * optional `emitter` (ProgressEmitter) -> live step / agent / message events for the SSE stream
"""
import asyncio
import inspect
import json
import re
import time
from collections import defaultdict
from typing import Any, Awaitable, Callable, Dict, List, Optional, Set

from app.schemas.planner_schema import ExecutionPlan, PlanStep, WorkerType
from app.ai.browser_agent import BrowserAgentWorker
from app.ai.worker import (
    AnalystWorker,
    APIWorker,
    BrowserWorker,
    DesktopWorker,
    FileWorker,
    MacWorker,
    CoderWorker,
    SearchWorker
)
from app.services.progress import agent_for

_TEMPLATE_RE = re.compile(r"\{\{\s*([A-Za-z0-9_\-]+)(?:\.([A-Za-z0-9_\.\-]+))?\s*\}\}")

# async def replanner(plan, failed_step_id, error, completed_outputs) -> Optional[ExecutionPlan]
Replanner = Callable[[ExecutionPlan, str, str, Dict[str, Any]], Awaitable[Optional[ExecutionPlan]]]


def _short(value: Any, limit: int = 240) -> str:
    """One-line preview of a step output for the UI."""
    try:
        text = value if isinstance(value, str) else json.dumps(value, default=str, ensure_ascii=False)
    except Exception:
        text = str(value)
    text = " ".join(str(text).split())
    return text if len(text) <= limit else text[: limit - 1] + "…"


def _desc(step: PlanStep) -> str:
    return getattr(step, "description", None) or step.step_id


def _plan_steps_payload(steps: List[PlanStep]) -> List[Dict[str, str]]:
    return [{"id": s.step_id, "label": _desc(s), "agent": agent_for(s.worker_type)} for s in steps]


class PlanValidationError(ValueError):
    """The plan is structurally invalid (duplicate ids, unknown deps, cycles)."""


class PlanExecutionError(RuntimeError):
    """Raised when a plan aborts. Subclass of RuntimeError so old `except RuntimeError` still works."""

    def __init__(self, message: str, step_id: Optional[str] = None, partial: Optional[Dict[str, Any]] = None):
        super().__init__(message)
        self.step_id = step_id
        self.partial = partial or {}


class DAGOrchestrator:
    def __init__(
        self,
        num_workers: int = 3,
        *,
        fail_fast: bool = True,          # True = old behaviour (abort on first failed step)
        max_replans: int = 1,            # only used if a `replanner` is passed to execute_plan
        verbose_progress: bool = False,  # True = notify_callback after every step (off by default)
        default_timeout: float = 120.0,
    ):
        self.num_workers = max(1, num_workers)
        self.fail_fast = fail_fast
        self.max_replans = max_replans
        self.verbose_progress = verbose_progress
        self.default_timeout = default_timeout

        self.worker_instances: Dict[Any, Any] = {
            WorkerType.BROWSER: BrowserAgentWorker(legacy=BrowserWorker()),
            WorkerType.DESKTOP_GUI: DesktopWorker(),
            WorkerType.ANALYST: AnalystWorker(),
            WorkerType.MAC_OS:  MacWorker(),
            WorkerType.CODER: CoderWorker(),
        }

        # Optional new workers: only registered if you added them to WorkerType.
        for attr, cls in (("API", APIWorker), ("FILE", FileWorker), ("SEARCH", SearchWorker)):
            wt = getattr(WorkerType, attr, None)
            if wt is not None:
                self.worker_instances[wt] = cls()

        self.timeouts: Dict[Any, float] = {
            WorkerType.BROWSER: 240.0,
            WorkerType.DESKTOP_GUI: 90.0,
            WorkerType.ANALYST: 120.0,
            WorkerType.CODER: 200.0,
        }
        # Worker types that must never run two steps at the same time.
        self._exclusive_types = {WorkerType.DESKTOP_GUI, WorkerType.BROWSER}
        self._locks: Dict[Any, asyncio.Lock] = {}

    # ------------------------------------------------------------------ helpers
    def _lock_for(self, worker_type) -> Optional[asyncio.Lock]:
        if worker_type not in self._exclusive_types:
            return None
        if worker_type not in self._locks:
            self._locks[worker_type] = asyncio.Lock()
        return self._locks[worker_type]

    @staticmethod
    async def _notify(cb, message: str):
        if not cb:
            return
        try:
            res = cb(message)
            if inspect.isawaitable(res):
                await res
        except Exception as e:  # a broken callback must never kill a plan
            print(f"⚠️ [Dispatcher] notify_callback failed: {e}")

    @staticmethod
    def _emit(emitter, etype: str, **fields):
        """Progress events are best-effort: they must never break execution."""
        if emitter is None:
            return
        try:
            emitter.emit(etype, **fields)
        except Exception as e:
            print(f"⚠️ [Dispatcher] emit failed: {e}")

    @staticmethod
    def _template_refs(step: PlanStep) -> Set[str]:
        return {m.group(1) for m in _TEMPLATE_RE.finditer(step.action_payload or "")}

    def _substitute(self, value: Any, context: Dict[str, Any]) -> Any:
        """Replace {{step_id}} / {{step_id.key.0}} in every string of the payload."""
        if isinstance(value, str):
            def repl(m):
                sid, path = m.group(1), m.group(2)
                if sid not in context:
                    return m.group(0)
                out = context[sid]
                if path:
                    try:
                        out = json.loads(out) if isinstance(out, str) else out
                        for part in path.split("."):
                            out = out[int(part)] if isinstance(out, list) else out[part]
                    except Exception:
                        return m.group(0)
                return out if isinstance(out, str) else json.dumps(out, default=str)

            return _TEMPLATE_RE.sub(repl, value)
        if isinstance(value, dict):
            return {k: self._substitute(v, context) for k, v in value.items()}
        if isinstance(value, list):
            return [self._substitute(v, context) for v in value]
        return value

    def _build_payload(self, step: PlanStep, context: Dict[str, Any], goal: str) -> Dict[str, Any]:
        raw = step.action_payload
        try:
            payload = json.loads(raw)
        except Exception:
            payload = {"prompt": raw}  # LLM didn't produce strict JSON
        if not isinstance(payload, dict):  # e.g. payload was "123" or a JSON list
            payload = {"prompt": raw}
        payload = self._substitute(payload, context)
        payload["_meta"] = {"step_id": step.step_id, "goal": goal}
        return payload

    @staticmethod
    def _validate(new_steps: List[PlanStep], known_ids: Set[str]) -> Dict[str, Set[str]]:
        """Validate steps and return {step_id: effective_dependencies}. Does not mutate anything."""
        ids = [s.step_id for s in new_steps]
        dups = {i for i in ids if ids.count(i) > 1} | (set(ids) & known_ids)
        if dups:
            raise PlanValidationError(f"Duplicate step_id(s): {sorted(dups)}")

        all_ids = set(ids) | known_ids
        deps: Dict[str, Set[str]] = {}
        for s in new_steps:
            explicit = set(s.depends_on or [])
            missing = explicit - all_ids
            if missing:
                raise PlanValidationError(f"Step '{s.step_id}' depends on unknown step(s): {sorted(missing)}")
            implicit = (DAGOrchestrator._template_refs(s) & all_ids) - {s.step_id}
            deps[s.step_id] = explicit | implicit

        # Cycle detection (Kahn) among the new steps
        indeg = {sid: len([d for d in dset if d in deps]) for sid, dset in deps.items()}
        children: Dict[str, List[str]] = defaultdict(list)
        for sid, dset in deps.items():
            for d in dset:
                if d in deps:
                    children[d].append(sid)
        queue = [sid for sid, n in indeg.items() if n == 0]
        seen = 0
        while queue:
            n = queue.pop()
            seen += 1
            for c in children[n]:
                indeg[c] -= 1
                if indeg[c] == 0:
                    queue.append(c)
        if seen != len(deps):
            stuck = sorted(sid for sid, n in indeg.items() if n > 0)
            raise PlanValidationError(f"Dependency cycle detected involving: {stuck}")
        return deps

    # ------------------------------------------------------------------ progress events
    def _emit_result(
        self,
        emitter,
        step: PlanStep,
        res: Dict[str, Any],
        pending: Dict[str, PlanStep],
        deps: Dict[str, Set[str]],
        in_progress: Set[str],
    ):
        """Events for a finished step: step.finished/failed, the hand-off message, agent status."""
        if emitter is None:
            return
        sid = step.step_id
        agent = agent_for(step.worker_type)
        still_busy = any(
            agent_for(pending[p].worker_type) == agent for p in in_progress if p in pending
        )

        if res["status"] == "success":
            self._emit(emitter, "step.finished", step_id=sid, agent=agent, duration_s=res["duration_s"])
            targets: List[str] = []
            for other_id, other in pending.items():
                if sid in deps.get(other_id, ()):
                    t = agent_for(other.worker_type)
                    if t not in targets:
                        targets.append(t)
            if not targets:
                targets = ["planner"]
            summary = _short(res["output"])
            for t in targets:
                if t == agent:
                    t = "planner"
                if t == agent:  # the planner itself: nobody to hand over to
                    continue
                self._emit(
                    emitter, "agent.message",
                    **{"from": agent, "to": t, "text": summary, "level": "success",
                       "log": f"{agent.title()} finished {sid}"},
                )
            self._emit(
                emitter, "agent.status", agent=agent,
                status="Working" if still_busy else "Done",
                doing=_desc(step) if still_busy else "Step complete",
            )
        else:
            err = _short(res["output"])
            self._emit(emitter, "step.failed", step_id=sid, agent=agent, error=err)
            if agent != "planner":
                self._emit(
                    emitter, "agent.message",
                    **{"from": agent, "to": "planner", "text": err, "level": "error",
                       "log": f"{agent.title()} failed {sid}"},
                )
            else:
                self._emit(emitter, "log", agent="planner", level="error", text=f"{sid} failed: {err}")
            self._emit(
                emitter, "agent.status", agent=agent,
                status="Working" if still_busy else "Idle",
                doing=_desc(step) if still_busy else "Step failed",
            )

    # ------------------------------------------------------------------ worker pool
    async def _worker_node(
        self,
        worker_id: int,
        task_queue: asyncio.Queue,
        result_queue: asyncio.Queue,
        emitter=None,
    ):
        """Background worker: pulls tasks, enforces timeout + exclusivity, reports a result dict."""
        while True:
            step, context, goal = await task_queue.get()
            wtype = step.worker_type
            print(f"👷 [Worker-{worker_id}] Picked up task: '{step.step_id}' ({wtype.value})")
            started = time.monotonic()
            status, output = "success", None
            timeout = getattr(step, "timeout_s", None) or self.timeouts.get(wtype, self.default_timeout)

            agent = agent_for(wtype)
            self._emit(emitter, "step.started", step_id=step.step_id, agent=agent, text=_desc(step))
            self._emit(emitter, "agent.status", agent=agent, status="Working", doing=_desc(step))

            try:
                specialized_worker = self.worker_instances.get(wtype)
                if not specialized_worker:
                    raise ValueError(f"Unknown worker type: {wtype}")

                payload = self._build_payload(step, context, goal)

                async def _run():
                    return await specialized_worker.execute_with_adaptation(payload=payload, context=context)

                lock = self._lock_for(wtype)
                if lock:
                    async with lock:  # timeout starts AFTER the lock is acquired
                        output = await asyncio.wait_for(_run(), timeout)
                else:
                    output = await asyncio.wait_for(_run(), timeout)
                print(f"✅ [Worker-{worker_id}] Finished task: '{step.step_id}'")

            except asyncio.TimeoutError:
                status, output = "error", f"Step timed out after {timeout:.0f}s"
                print(f"⏱️ [Worker-{worker_id}] Timeout on '{step.step_id}'")
            except Exception as e:
                status, output = "error", (str(e) or e.__class__.__name__)
                print(f"❌ [Worker-{worker_id}] Failed task '{step.step_id}': {output}")
            finally:
                task_queue.task_done()

            await result_queue.put(
                {
                    "step_id": step.step_id,
                    "status": status,
                    "output": output,
                    "worker_type": wtype.value,
                    "duration_s": round(time.monotonic() - started, 2),
                }
            )

    # ------------------------------------------------------------------ dispatcher
    async def execute_plan(
        self,
        plan: ExecutionPlan,
        notify_callback=None,
        replanner: Optional[Replanner] = None,
        emitter=None,
    ) -> Dict[str, Any]:
        """
        Master dispatcher. Validates the DAG, schedules ready steps onto the worker pool,
        handles failures/skips/replans and collects results until everything is done.
        """
        t0 = time.monotonic()
        goal = getattr(plan, "high_level_goal", "") or ""

        pending: Dict[str, PlanStep] = {}            # not finished yet (includes in-progress)
        deps: Dict[str, Set[str]] = {}
        completed: Dict[str, Any] = {}
        failed: Dict[str, str] = {}
        skipped: Dict[str, str] = {}
        in_progress: Set[str] = set()
        log: List[Dict[str, Any]] = []
        replans_used = 0

        # Fail early and clearly instead of hanging forever.
        initial_deps = self._validate(list(plan.steps), set())
        for s in plan.steps:
            pending[s.step_id] = s
            deps[s.step_id] = initial_deps[s.step_id]

        if notify_callback:
            mode = "Complex DAG Mode" if plan.is_complex else "Single-Task Fast Path"
            await self._notify(notify_callback, f"Executing {len(plan.steps)} tasks via {mode}.")

        task_queue: asyncio.Queue = asyncio.Queue()
        result_queue: asyncio.Queue = asyncio.Queue()
        workers = [
            asyncio.create_task(self._worker_node(i, task_queue, result_queue, emitter))
            for i in range(self.num_workers)
        ]

        try:
            while pending:
                # A. Cascade-skip steps whose dependencies failed / were skipped
                changed = True
                while changed:
                    changed = False
                    for sid in list(pending):
                        if sid in in_progress:
                            continue
                        bad = [d for d in deps[sid] if d in failed or d in skipped]
                        if bad:
                            skipped[sid] = f"dependency '{bad[0]}' did not succeed"
                            pending.pop(sid)
                            log.append({"step_id": sid, "status": "skipped", "result": skipped[sid]})
                            print(f"⏭️ [Dispatcher] Skipping '{sid}': {skipped[sid]}")
                            self._emit(emitter, "step.skipped", step_id=sid, reason=skipped[sid])
                            self._emit(emitter, "log", agent="planner", level="warn",
                                       text=f"Skipped '{sid}': {skipped[sid]}")
                            changed = True

                # B. Enqueue every step whose dependencies are fully met
                for sid, step in list(pending.items()):
                    if sid in in_progress:
                        continue
                    if all(d in completed for d in deps[sid]):
                        ctx = {d: completed[d] for d in deps[sid]}
                        await task_queue.put((step, ctx, goal))
                        in_progress.add(sid)
                        print(f"📥 [Dispatcher] Enqueued ready task: '{sid}'")

                if not pending:
                    break
                if not in_progress:
                    raise PlanExecutionError(
                        f"Scheduler stalled; unresolved steps: {sorted(pending)}",
                        partial=completed,
                    )

                # C. Wait for ANY worker to finish
                res = await result_queue.get()
                sid = res["step_id"]
                in_progress.discard(sid)
                step = pending.pop(sid)
                log.append(
                    {
                        "step_id": sid,
                        "status": res["status"],
                        "result": res["output"],
                        "worker_type": res["worker_type"],
                        "duration_s": res["duration_s"],
                    }
                )
                self._emit_result(emitter, step, res, pending, deps, in_progress)

                if res["status"] == "success":
                    completed[sid] = res["output"]
                    if self.verbose_progress:
                        await self._notify(notify_callback, f"Finished '{sid}' ({len(completed)} done).")
                    continue

                # D. Failure handling
                failed[sid] = str(res["output"])

                if replanner and replans_used < self.max_replans:
                    replans_used += 1
                    try:
                        new_plan = await replanner(plan, sid, failed[sid], dict(completed))
                        if new_plan and new_plan.steps:
                            known = set(completed) | set(failed) | set(skipped) | in_progress
                            new_deps = self._validate(list(new_plan.steps), known)
                            for old in [p for p in pending if p not in in_progress]:
                                pending.pop(old)
                                deps.pop(old, None)
                                skipped[old] = "superseded by replan"
                                log.append({"step_id": old, "status": "skipped", "result": skipped[old]})
                                self._emit(emitter, "step.skipped", step_id=old, reason=skipped[old])
                            for s in new_plan.steps:
                                pending[s.step_id] = s
                                deps[s.step_id] = new_deps[s.step_id]
                            print(f"🧭 [Dispatcher] Replanned after '{sid}' failed ({len(new_plan.steps)} new steps).")
                            self._emit(emitter, "plan.ready",
                                       goal=getattr(new_plan, "high_level_goal", goal) or goal,
                                       steps=_plan_steps_payload(list(new_plan.steps)))
                            self._emit(emitter, "log", agent="planner", level="warn",
                                       text=f"'{sid}' failed, so the plan was adjusted.")
                            await self._notify(notify_callback, "A step failed, so I'm adjusting the plan.")
                            continue
                    except Exception as e:
                        print(f"⚠️ [Dispatcher] Replan failed: {e}")

                raw_policy = getattr(step, "on_failure", None)
                policy = str(getattr(raw_policy, "value", raw_policy) or "").lower()
                if policy == "skip":
                    policy = "continue"
                elif policy != "continue":      # "abort", "replan" with no replan left, or missing
                    policy = "abort"
                    
                if policy == "abort":
                    raise PlanExecutionError(
                        f"Step '{sid}' failed: {failed[sid]}", step_id=sid, partial=completed
                    )
                print(f"↪️ [Dispatcher] '{sid}' failed; policy is '{policy}', continuing.")

            print("🎉 [Dispatcher] DAG finished.")

            # E. Final synthesis for complex plans
            final_summary = None
            summary_error = None
            if plan.is_complex and completed:
                prompt = f"Synthesize final results for: '{plan.high_level_goal}'"
                if failed or skipped:
                    prompt += (
                        f"\n\nNote: some steps did not complete. Failed: {failed}. Skipped: {skipped}. "
                        "Clearly say what could not be done."
                    )
                self._emit(emitter, "agent.status", agent="analyst", status="Working",
                           doing="Writing the final summary")
                try:
                    final_summary = await self.worker_instances[WorkerType.ANALYST].execute_with_adaptation(
                        payload={"prompt": prompt, "_meta": {"goal": goal}},
                        context=completed,
                    )
                    self._emit(emitter, "agent.status", agent="analyst", status="Done", doing="Summary written")
                except Exception as e:
                    summary_error = str(e)
                    print(f"⚠️ [Dispatcher] Synthesis failed: {e}")
                    self._emit(emitter, "log", agent="analyst", level="error", text=f"Summary failed: {e}")

            if not failed and not skipped:
                status = "success"
            else:
                status = "partial" if completed else "failed"

            result = {
                "status": status,
                "summary": final_summary,
                "raw_outputs": completed,
                "steps_executed": log,
                # additive keys
                "failed": failed,
                "skipped": skipped,
                "replans_used": replans_used,
                "duration_s": round(time.monotonic() - t0, 2),
            }
            if summary_error:
                result["summary_error"] = summary_error
            return result

        finally:
            for w in workers:
                w.cancel()
            await asyncio.gather(*workers, return_exceptions=True)