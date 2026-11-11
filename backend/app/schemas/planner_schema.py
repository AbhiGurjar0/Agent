# app/schemas/planner_schema.py
"""
Schema for the DAG planner.

Design goals
------------
* Everything the LLM returns is validated HERE (payload contracts, unique ids,
  dependencies exist, no cycles) so the executor never receives a broken plan.
* Validation errors are fed back to the LLM by the planner for self-correction.
* Helper methods (execution_layers / ready_steps) let the executor run
  independent steps in parallel.

NOTE: Pydantic constraints like ge/le/pattern are deliberately NOT used on
fields, because OpenAI strict structured-output mode may reject them. All
checks live in validators instead.
"""
import json
import re
from enum import Enum
from typing import Any, Dict, List, Optional, Set
from urllib.parse import urlparse

from pydantic import BaseModel, Field, field_validator, model_validator

MAX_STEPS = 12
MAX_RETRIES_CAP = 3
_STEP_ID_RE = re.compile(r"^[a-z][a-z0-9_]{1,48}$")


# --------------------------------------------------------------------------- #
# Enums
# --------------------------------------------------------------------------- #
class WorkerType(str, Enum):
    BROWSER = "browser_worker"
    DESKTOP_GUI = "desktop_worker"
    ANALYST = "analyst_worker"
    CODER = "coder_worker"
    MAC_OS = "mac_worker"
    SEARCH = "search_worker"  # new worker type for web research tasks


class GUIActionType(str, Enum):
    OPEN_URL = "open_url"
    CLICK = "click"
    TYPE = "type"
    HOTKEY = "hotkey"
    SCROLL = "scroll"


class RiskLevel(str, Enum):
    LOW = "low"        # read-only / reversible (search, read, summarize)
    MEDIUM = "medium"  # changes local state (open apps, write files, type text)
    HIGH = "high"      # irreversible / external effect (send, post, pay, delete)


class FailurePolicy(str, Enum):
    ABORT = "abort"      # stop the whole plan
    SKIP = "skip"        # step is optional, continue without it
    REPLAN = "replan"    # ask the planner to build a new plan from here


class TaskCategory(str, Enum):
    CONVERSATION = "conversation"        # chit-chat, Q&A, no tools needed
    WEB_RESEARCH = "web_research"        # scraping / reading / comparing
    MEDIA = "media"                      # watch / listen / open visible content
    DESKTOP_CONTROL = "desktop_control"  # operate visible apps
    CODING = "coding"                    # write / run / debug code
    ANALYSIS = "analysis"                # synthesize, summarize, decide
    MIXED = "mixed"


# --------------------------------------------------------------------------- #
# Payload contracts (one per worker)
# --------------------------------------------------------------------------- #
_BROWSER_REQUIRED: Dict[str, tuple] = {
    "goto": ("url",),
    "click": ("selector",),
    "type": ("selector", "text"),
    "extract_text": ("selector",),
    "wait_for": ("selector",),
}

# desktop_worker
_DESKTOP_REQUIRED: Dict[str, tuple] = {
    "open_url": ("url",),
    "click": ("target_element",),
    "type": ("text",),
    "hotkey": ("text",),
    "scroll": ("text",),  # e.g. "down" / "up" / "down 500"
}


def _check_url(url: Any, where: str) -> None:
    parsed = urlparse(str(url))
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise ValueError(f"{where}: 'url' must be a full http(s) URL, got {url!r}")


def normalize_payload(worker: WorkerType, raw: str) -> str:
    """Validate + normalize an action_payload string. Raises ValueError with a
    message precise enough for the LLM to fix itself."""
    try:
        data = json.loads(raw)
    except (json.JSONDecodeError, TypeError) as e:
        raise ValueError(f"action_payload is not valid JSON: {e}")
    if not isinstance(data, dict):
        raise ValueError("action_payload must be a JSON object")

    if worker == WorkerType.BROWSER:
        goal = data.get("goal")
        actions = data.get("actions")

        if isinstance(goal, str) and goal.strip():
            # New agent contract: {"goal": "...", "start_url": "optional"}
            clean_data: Dict[str, Any] = {"goal": goal.strip()}
            start_url = data.get("start_url")
            if start_url:
                _check_url(start_url, "browser start_url")
                clean_data["start_url"] = start_url
            data = clean_data

        elif isinstance(actions, list) and actions:
            # Legacy contract, still accepted (BrowserAgentWorker converts it into a goal)
            clean: List[Dict[str, Any]] = []
            for i, act in enumerate(actions):
                t = act.get("type") if isinstance(act, dict) else None
                required = _BROWSER_REQUIRED.get(t)
                if required is None:
                    raise ValueError(
                        f"browser action #{i}: unknown type {t!r}; allowed: {sorted(_BROWSER_REQUIRED)}"
                    )
                missing = [k for k in required if not act.get(k)]
                if missing:
                    raise ValueError(f"browser action #{i} ({t}): missing {missing}")
                if t == "goto":
                    _check_url(act["url"], f"browser action #{i}")
                clean.append({k: act[k] for k in ("type",) + required})
            data = {"actions": clean}

        else:
            raise ValueError(
                "browser_worker payload needs a non-empty 'goal' (optionally with 'start_url')"
            )
    elif worker == WorkerType.DESKTOP_GUI:
        action = data.get("action")
        required = _DESKTOP_REQUIRED.get(action)
        if required is None:
            raise ValueError(
                f"desktop action {action!r} invalid; allowed: {sorted(_DESKTOP_REQUIRED)}"
            )
        missing = [k for k in required if not data.get(k)]
        if missing:
            raise ValueError(f"desktop action '{action}': missing {missing}")
        if action == "open_url":
            _check_url(data["url"], "desktop open_url")
        data = {k: data[k] for k in ("action",) + required}
    elif worker == WorkerType.MAC_OS:
        script = data.get("script")
        if not isinstance(script, str) or not script.strip():
            raise ValueError("mac_worker payload needs a non-empty string 'script'")
        data = {"script": script.strip()}

    else:  # ANALYST / CODER
        task = data.get("task")
        if not isinstance(task, str) or not task.strip():
            raise ValueError(f"{worker.value} payload needs a non-empty string 'task'")
        out: Dict[str, Any] = {"task": task.strip()}
        if isinstance(data.get("language"), str) and worker == WorkerType.CODER:
            out["language"] = data["language"]
        data = out

    return json.dumps(data, ensure_ascii=False)


# --------------------------------------------------------------------------- #
# Models
# --------------------------------------------------------------------------- #
class PlanStep(BaseModel):
    step_id: str = Field(
        description="Unique snake_case ID, 2-49 chars, starts with a letter (e.g. 'search_flights', 'summarize_results')."
    )
    worker_type: WorkerType = Field(description="The specialized worker required for this task.")
    description: str = Field(description="Clear, specific explanation of what the worker must do.")
    action_payload: str = Field(
        description=(
            "JSON-formatted STRING matching the worker's contract. "
            "browser_worker: {\"goal\": \"plain-English goal incl. what 'done' looks like\", \"start_url\": \"optional http(s) URL\"}. "
            "desktop_worker: {\"action\": \"open_url\"|\"click\"|\"type\"|\"hotkey\"|\"scroll\", \"url\"|\"target_element\"|\"text\": \"...\"}. "
            "mac_worker: {\"script\": \"raw applescript string...\"}. "
            "analyst_worker / coder_worker: {\"task\": \"...\"}."
        )
    )
    depends_on: List[str] = Field(
        description="step_ids that MUST complete before this step starts. Empty list if none."
    )
    expected_output: str = Field(
        description="One sentence: what concrete result this step produces (used as a success check and by downstream steps)."
    )
    risk_level: RiskLevel = Field(description="low = read-only, medium = local changes, high = irreversible/external effect.")
    requires_confirmation: bool = Field(
        description="True ONLY for high-risk steps (sending messages/emails, posting, paying, deleting, submitting forms)."
    )
    max_retries: int = Field(description="Automatic retries on failure, 0-3.")
    on_failure: FailurePolicy = Field(description="abort | skip (optional step) | replan.")

    @field_validator("step_id")
    @classmethod
    def _valid_id(cls, v: str) -> str:
        v = v.strip()
        if not _STEP_ID_RE.match(v):
            raise ValueError(f"step_id {v!r} must be snake_case: ^[a-z][a-z0-9_]{{1,48}}$")
        return v

    @field_validator("max_retries")
    @classmethod
    def _clamp_retries(cls, v: int) -> int:
        return max(0, min(int(v), MAX_RETRIES_CAP))

    @model_validator(mode="after")
    def _validate_step(self) -> "PlanStep":
        self.action_payload = normalize_payload(self.worker_type, self.action_payload)
        if self.step_id in self.depends_on:
            raise ValueError(f"step '{self.step_id}' depends on itself")
        # Safety invariant: high risk always needs the user's OK.
        if self.risk_level == RiskLevel.HIGH:
            self.requires_confirmation = True
        return self


class ExecutionPlan(BaseModel):
    high_level_goal: str = Field(description="Summary of the overall user request.")
    category: TaskCategory = Field(description="Dominant type of the task.")
    is_complex: bool = Field(description="True if multi-step, False if single task.")
    reasoning: str = Field(description="2-3 sentences: why this structure (parallelism, ordering, worker choice).")
    assumptions: List[str] = Field(description="Assumptions made where the request was ambiguous. Empty if none.")
    needs_clarification: bool = Field(
        description="True ONLY if the request is impossible to act on without more info. Then steps may be empty."
    )
    clarification_question: Optional[str] = Field(
        description="The single question to ask the user when needs_clarification is true, else null."
    )
    steps: List[PlanStep] = Field(description="The strict DAG of atomic tasks.")

    # ---------------------------- validation ---------------------------- #
    @model_validator(mode="after")
    def _validate_plan(self) -> "ExecutionPlan":
        if self.needs_clarification:
            if not (self.clarification_question or "").strip():
                raise ValueError("needs_clarification=true requires clarification_question")
            return self

        if not self.steps:
            raise ValueError("plan must contain at least one step")
        if len(self.steps) > MAX_STEPS:
            raise ValueError(f"plan has {len(self.steps)} steps; max is {MAX_STEPS}. Consolidate steps.")
        if not self.is_complex and len(self.steps) != 1:
            raise ValueError("is_complex=false requires exactly 1 step")

        ids = [s.step_id for s in self.steps]
        dupes = {i for i in ids if ids.count(i) > 1}
        if dupes:
            raise ValueError(f"duplicate step_ids: {sorted(dupes)}")

        known: Set[str] = set(ids)
        for s in self.steps:
            unknown = [d for d in s.depends_on if d not in known]
            if unknown:
                raise ValueError(f"step '{s.step_id}' depends on unknown steps {unknown}")

        self.execution_layers()  # raises ValueError on cycles
        return self

    # ------------------------------ helpers ----------------------------- #
    def get_step(self, step_id: str) -> PlanStep:
        for s in self.steps:
            if s.step_id == step_id:
                return s
        raise KeyError(step_id)

    def execution_layers(self) -> List[List[PlanStep]]:
        """Topological layers. Every step inside one layer is independent and
        can run in parallel; layers must run in order."""
        by_id = {s.step_id: s for s in self.steps}
        remaining = {s.step_id: set(s.depends_on) for s in self.steps}
        done: Set[str] = set()
        layers: List[List[PlanStep]] = []
        while remaining:
            ready = [sid for sid, deps in remaining.items() if deps <= done]
            if not ready:
                raise ValueError(f"dependency cycle among steps {sorted(remaining)}")
            layers.append([by_id[sid] for sid in ready])
            done.update(ready)
            for sid in ready:
                del remaining[sid]
        return layers

    def ready_steps(self, completed: Set[str], running: Optional[Set[str]] = None) -> List[PlanStep]:
        """Steps whose dependencies are all completed and that haven't started."""
        running = running or set()
        return [
            s for s in self.steps
            if s.step_id not in completed
            and s.step_id not in running
            and set(s.depends_on) <= completed
        ]