import asyncio
import json
import logging
import time
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

from bson import ObjectId
from fastapi import HTTPException, status

from app.ai.openai import call_model, get_text_embedding
from app.ai.dispatcher import execute_agent_tool
from app.services.context_builder import build_agent_context
from app.services.tool_router import DynamicToolRouter
from app.services.progress import agent_for
from app.tools.tools import tools
from app.ai.planner_agent import dag_planner
from app.ai.dag_orchestrator import DAGOrchestrator,PlanExecutionError
from app.schemas.planner_schema import (
    ExecutionPlan,
    FailurePolicy,
    TaskCategory,
    WorkerType,
)
from app.ai.direct_first import (
    ESCALATE, ESCALATE_NAME, ESCALATE_TOOL, ROUTING_NOTE, select_direct_tools,
)
from app.ai.formatter import format_response
from app.services.jobs.job_intake import classify_request, build_draft, draft_reply
from app.services.jobs.job_engine import engine as job_engine


logger = logging.getLogger("jarvis.agent")

# --------------------------------------------------------------------------- #
# Config
# --------------------------------------------------------------------------- #
DEFAULT_USER_ID = "6ac1156aa1165fa861cc5aa0"  # dev fallback only
PLANNER_TIMEOUT_S = 30.0
PLAN_EXECUTION_TIMEOUT_S = 300.0
TOOL_TIMEOUT_S = 45.0
MAX_TOOL_TURNS = 10
MAX_REPLANS = 1
PENDING_PLAN_TTL = timedelta(minutes=10)
MAX_TOOL_RESULT_CHARS = 8000

TRIVIAL_MESSAGES = {
    "hi", "hello", "hey", "yo", "thanks", "thank you", "ok", "okay",
    "good morning", "good night", "bye", "hii", "hlo",
}
CONFIRM_WORDS = {
    "yes", "y", "yep", "confirm", "confirmed", "go ahead", "do it", "proceed",
    "ok", "okay", "sure", "haan", "ha", "kar do", "karo",
}
DENY_WORDS = {"no", "n", "nope", "cancel", "stop", "dont", "don't", "nahi", "mat karo"}

orchestrator = DAGOrchestrator(num_workers=3)

tool_router = DynamicToolRouter(
    all_tools=tools,
    always_include=["run_terminal_command"],
)

# Keep strong references so fire-and-forget tasks are never garbage-collected.
_background_tasks: set = set()


HIRE_RE = re.compile(
    r"\b(hire|hiring|freelancer|get someone to|find (me )?(an? )?(agent|editor|developer|designer|writer)|outsource)\b", re.I
)


MAX_IMAGES = 4
MAX_IMAGE_CHARS = 3_000_000   # ~2.2 MB per image after base64

def _get_images(chat_data: Any) -> List[str]:
    raw = chat_data.get("images") if isinstance(chat_data, dict) else getattr(chat_data, "images", None)
    out = []
    for s in (raw or [])[:MAX_IMAGES]:
        if isinstance(s, str) and s.startswith("data:image/") and len(s) <= MAX_IMAGE_CHARS:
            out.append(s)
    return out

def _user_content(text: str, images: List[str]):
    if not images:
        return text
    return [{"type": "text", "text": text}] + [
        {"type": "image_url", "image_url": {"url": u}} for u in images
    ]
    
def _looks_like_hire(message: str, history: List[Dict[str, Any]]) -> bool:
    recent = " ".join(str(r["content"]) for r in history[-4:] if r["role"] == "user")
    return bool(HIRE_RE.search(message) or HIRE_RE.search(recent))


def _spawn(coro) -> None:
    task = asyncio.create_task(coro)
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)


class PipelineCancelled(Exception):
    pass


# --------------------------------------------------------------------------- #
# Progress events (all best-effort; `emitter` is None for plain POST /messages)
# --------------------------------------------------------------------------- #
def _em(emitter, etype: str, **fields) -> None:
    if emitter is None:
        return
    try:
        emitter.emit(etype, **fields)
    except Exception as e:
        logger.debug(f"[Pipeline] emit failed: {e}")


def _emit_plan(emitter, plan: ExecutionPlan) -> None:
    _em(
        emitter, "plan.ready",
        goal=plan.high_level_goal,
        steps=[
            {"id": s.step_id, "label": getattr(s, "description", None) or s.step_id,
             "agent": agent_for(s.worker_type)}
            for s in plan.steps
        ],
    )
    _em(emitter, "agent.status", agent="planner", status="Working", doing="Coordinating the steps")


def _convo_id(chat_data: Any) -> Optional[str]:
    if isinstance(chat_data, dict):
        return chat_data.get("convo_id")
    return getattr(chat_data, "convo_id", None)


# --------------------------------------------------------------------------- #
# Main entry
# --------------------------------------------------------------------------- #
async def run_chat_pipeline(
    chat_data: Any,
    db,
    current_user: dict,
    cancel_event: asyncio.Event = None,
    notify_callback=None,
    emitter=None,
) -> Dict[str, Any]:
    """
    Autonomous agent pipeline:
      1. Resilient identity / context / embedding resolution
      2. Pending high-risk plan confirmation ("yes, go ahead")
      3. LLM planner triage -> clarification | DAG orchestrator | ReAct tool loop
      4. Cancel + timeout protection, one automatic replan on failure
      5. Unified persistence + metrics
    """
    start_time = time.perf_counter()

    # 1. Identity & input -------------------------------------------------- #
    if isinstance(current_user, dict) and current_user.get("_id"):
        user_id = str(current_user["_id"])
    else:
        logger.warning("[Pipeline] No authenticated user, using DEFAULT_USER_ID")
        user_id = DEFAULT_USER_ID

    assistant_chat_id = ObjectId()
    cid = _convo_id(chat_data)
    images = _get_images(chat_data)

    if isinstance(chat_data, dict):
        user_message = chat_data.get("message", "")
    else:
        user_message = getattr(chat_data, "message", "")

    if not user_message or not user_message.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Message content cannot be empty.",
        )
    user_message = user_message.strip()
    logger.info(f"[Pipeline] Request for user_id={user_id}")

    # 2. Context & embedding (each failure isolated) ------------------------ #
    recent_chats: List[dict] = []
    embedded_user_message: List[float] = []

    async def _fetch_history():
        cursor = db["chats"].find({"user_id": user_id}).sort("created_at", -1).limit(10)
        rows = await cursor.to_list(length=10)
        rows.reverse()
        return rows

    history_res, embed_res = await asyncio.gather(
        _fetch_history(), get_text_embedding(user_message), return_exceptions=True
    )
    if isinstance(history_res, Exception):
        logger.error(f"[Pipeline] History fetch failed: {history_res}")
    else:
        recent_chats = history_res
    if isinstance(embed_res, Exception):
        logger.error(f"[Pipeline] Embedding failed: {embed_res}")
    else:
        embedded_user_message = embed_res

    chat_history = [
        {"role": c.get("role", "user"), "content": c.get("content", "")}
        for c in recent_chats
    ]

    # 3. Pending confirmation for a previously proposed risky plan ---------- #
    pending = await _load_pending_plan(db, user_id)
    if pending:
        answer = user_message.lower().strip(" .!")
        if answer in CONFIRM_WORDS:
            _spawn(_safe_db_insert(db["chats"], _user_doc(user_id, user_message, embedded_user_message, cid)))
            await _clear_pending_plan(db, user_id)
            _emit_plan(emitter, pending["plan"])
            content, tasks = await _run_plan(
                pending["plan"], pending["original_prompt"], notify_callback, cancel_event, emitter
            )
            return _finish(db, assistant_chat_id, user_id, content, tasks, start_time,
                           turns=1, planner_used=True, convo_id=cid,
                           extra={"confirmed_plan": True, "goal": pending["plan"].high_level_goal})
        if answer in DENY_WORDS:
            _spawn(_safe_db_insert(db["chats"], _user_doc(user_id, user_message, embedded_user_message, cid)))
            await _clear_pending_plan(db, user_id)
            return _finish(db, assistant_chat_id, user_id,
                           "Okay, I cancelled that plan. Nothing was executed.",
                           [], start_time, turns=0, planner_used=False, convo_id=cid)
        # Unrelated new message -> drop the stale pending plan and continue normally.
        await _clear_pending_plan(db, user_id)

    # 4. System context ------------------------------------------------------ #
    try:
        system_context = await build_agent_context(
            user_id=user_id,
            prompt=user_message,
            prompt_embedding=embedded_user_message,
        )
    except Exception as e:
        logger.warning(f"[Pipeline] Agent context builder fallback: {e}")
        system_context = "You are Jarvis, an autonomous desktop AI assistant."

    messages: List[Dict[str, Any]] = (
    [{"role": "system", "content": system_context}]
    + chat_history
    + [{"role": "user", "content": _user_content(user_message, images)}]
)

    _spawn(_safe_db_insert(db["chats"], _user_doc(user_id, user_message, embedded_user_message, cid, images)))
    
        # 0. Categorise: JOB (hire a freelancer) vs normal TASK -------------------- #
    if user_message.lower().strip(" .!?") not in TRIVIAL_MESSAGES:
        hist = _history_text(chat_history)
        intent = None
        for attempt in range(2):
            try:
                intent = await classify_request(user_message, hist)
                break
            except Exception as e:
                logger.warning(f"[Pipeline] Job classifier attempt {attempt + 1} failed: {e}")
                await asyncio.sleep(0.5)
    
        if intent is None and _looks_like_hire(user_message, chat_history):
            # the classifier said "not a job" (or crashed) but this reads like a hire request: nudge it
            try:
                intent = await classify_request(f"Hire a freelancer for this job: {user_message}", hist)
            except Exception as e:
                logger.warning(f"[Pipeline] Hire retry failed: {e}")
    
        logger.info(f"[Pipeline] Job intent: {'job' if intent else 'none'}")
        if intent is not None:
            if intent.needs_clarification and intent.clarification_question:
                return _finish(db, assistant_chat_id, user_id, intent.clarification_question, [], start_time,
                               turns=0, planner_used=False, convo_id=cid,
                               extra={"category": "job", "clarification": True})
            doc = build_draft(user_id, intent.job, cid)
            job = await job_engine.create_draft(db, doc)
            _em(emitter, "log", agent="planner", level="success", text=f"Job draft created: {job['title']}")
            return _finish(db, assistant_chat_id, user_id, draft_reply(job), [], start_time,
                           turns=0, planner_used=False, convo_id=cid,
                           extra={"category": "job", "job_id": job["id"], "open": f"/jobs?job={job['id']}&tab=ready"})
    
    if not images and user_message.lower().strip(" .!?") not in TRIVIAL_MESSAGES:
        _em(emitter, "agent.status", agent="planner", status="Working", doing="Checking quick tools")
        content, tasks, turns = await _react_loop(
            list(messages), user_message, user_id, db, assistant_chat_id,
            cancel_event, notify_callback, emitter, allow_escalation=True,
        )
        if content is not ESCALATE:
            return _finish(db, assistant_chat_id, user_id, content, tasks, start_time,
                           turns=turns, planner_used=False, convo_id=cid,
                           extra={"route": "direct"})
        logger.info("[Pipeline] No direct tool fits -> DAG planner")

    # 5. Planner triage ------------------------------------------------------ #
    plan: Optional[ExecutionPlan] = None
    if not images and user_message.lower().strip(" .!?") not in TRIVIAL_MESSAGES:
        _em(emitter, "agent.status", agent="planner", status="Working", doing="Planning the task")
        try:
            plan = await asyncio.wait_for(
                dag_planner.generate_plan(user_message, context=_history_text(chat_history)),
                timeout=PLANNER_TIMEOUT_S,
            )
        except Exception as plan_err:
            logger.error(f"[Pipeline] Planner failed, falling back to ReAct: {plan_err}")
            _em(emitter, "log", agent="planner", level="warn",
                text="Planner failed, answering directly instead.")

    if plan is not None:
        # 5a. Needs more info from the user
        if plan.needs_clarification:
            return _finish(db, assistant_chat_id, user_id, plan.clarification_question,
                           [], start_time, turns=0, planner_used=True, convo_id=cid,
                           extra={"clarification": True})

        # 5b. Real multi-agent / tool work
        if _should_orchestrate(plan):
            risky = [s for s in plan.steps if s.requires_confirmation]
            if risky:
                await _save_pending_plan(db, user_id, plan, user_message)
                lines = "\n".join(f"- {s.description}" for s in risky)
                return _finish(
                    db, assistant_chat_id, user_id,
                    "This plan includes sensitive actions:\n"
                    f"{lines}\n\nReply **yes** to proceed or **no** to cancel.",
                    [], start_time, turns=0, planner_used=True, convo_id=cid,
                    extra={"awaiting_confirmation": True, "goal": plan.high_level_goal},
                )

            _emit_plan(emitter, plan)
            content, tasks = await _run_plan(plan, user_message, notify_callback, cancel_event, emitter)
            return _finish(db, assistant_chat_id, user_id, content, tasks, start_time,
                           turns=1, planner_used=True, convo_id=cid,
                           extra={"goal": plan.high_level_goal, "steps": len(plan.steps)})

    # 6. ReAct loop (conversation, simple Q&A, or planner fallback) ---------- #
    _em(emitter, "agent.status", agent="planner", status="Working", doing="Handling your request")
    final_content, all_executed_tasks, turns_used = await _react_loop(
        messages, user_message, user_id, db, assistant_chat_id, cancel_event, notify_callback, emitter
    )
    return _finish(db, assistant_chat_id, user_id, final_content, all_executed_tasks,
                   start_time, turns=turns_used, planner_used=False, convo_id=cid)
  


# --------------------------------------------------------------------------- #
# Routing helpers
# --------------------------------------------------------------------------- #
def _should_orchestrate(plan: ExecutionPlan) -> bool:
    """Plain conversation / single analyst answers go through the ReAct loop
    (which has memory context and tools); everything else uses the DAG."""
    if plan.category == TaskCategory.CONVERSATION:
        return False
    if len(plan.steps) == 1 and plan.steps[0].worker_type == WorkerType.ANALYST:
        return False
    return True


def _history_text(chat_history: List[Dict[str, Any]], n: int = 6, max_chars: int = 300) -> Optional[str]:
    rows = chat_history[-n:]
    if not rows:
        return None
    return "\n".join(f"{r['role']}: {str(r['content'])[:max_chars]}" for r in rows)


def _user_doc(user_id, message, embedding, convo_id=None, images=None) -> dict:
    doc = {
        "user_id": user_id, "convo_id": convo_id, "title": message[:60],
        "role": "user", "content": message, "embeddings": embedding,
        "created_at": datetime.now(timezone.utc),
    }
    if images:
        doc["images"] = images
    return doc


# --------------------------------------------------------------------------- #
# Plan execution (cancel + timeout + replan)
# --------------------------------------------------------------------------- #
async def _run_with_cancel(coro, cancel_event: Optional[asyncio.Event], timeout: float):
    task = asyncio.ensure_future(coro)
    waiters = {task}
    cancel_task = None
    if cancel_event is not None:
        cancel_task = asyncio.ensure_future(cancel_event.wait())
        waiters.add(cancel_task)
    try:
        done, _ = await asyncio.wait(waiters, timeout=timeout, return_when=asyncio.FIRST_COMPLETED)
        if task in done:
            return task.result()
        task.cancel()
        try:
            await task
        except (asyncio.CancelledError, Exception):
            pass
        if cancel_task is not None and cancel_task in done:
            raise PipelineCancelled()
        raise asyncio.TimeoutError()
    finally:
        if cancel_task is not None and not cancel_task.done():
            cancel_task.cancel()


def _format_result(result: Any) -> str:
    if not isinstance(result, dict):
        return str(result)
    failed = result.get("failed")
    if failed and result.get("status") in ("failed", "partial"):
        errs = "\n".join(f"- {sid}: {str(err)[:400]}" for sid, err in failed.items())
        body = str(result["summary"]) if result.get("summary") else ""
        return (body + "\n\n" if body else "") + "Some steps did not complete:\n" + errs
    if result.get("summary"):
        return str(result["summary"])
    raw = result.get("raw_outputs")
    if raw:
        try:
            return json.dumps(raw, indent=2, ensure_ascii=False, default=str)
        except Exception:
            return str(raw)
    if result.get("error"):
        return f"Execution finished with an error: {result['error']}"
    return "Task completed."


async def _run_plan(
    plan: ExecutionPlan,
    original_prompt: str,
    notify_callback,
    cancel_event: Optional[asyncio.Event],
    emitter=None,
) -> Tuple[str, List[Dict[str, Any]]]:
    """Execute a plan; on a failed step whose policy is 'replan', try once more
    with a recovery plan. Returns (final_text, executed_steps)."""
    replans = 0
    result: Any = {}

    async def _replanner(_plan, failed_id, error, completed):      # <- ADD
        return await dag_planner.replan(original_prompt, failed_id, error, completed)

    while True:
        try:
            logger.info(f"[Pipeline] Executing plan: {plan.high_level_goal}")
            result = await _run_with_cancel(
                orchestrator.execute_plan(
                    plan,
                    notify_callback=notify_callback,
                    replanner=_replanner,                           
                    emitter=emitter,
                ),
                cancel_event,
                PLAN_EXECUTION_TIMEOUT_S,
            )
        except PipelineCancelled:
            return "Task cancelled by user.", []
        except asyncio.TimeoutError:
            return f"The task took longer than {int(PLAN_EXECUTION_TIMEOUT_S)}s and was stopped.", []
        except PlanExecutionError as exc:
            _em(emitter, "log", agent="planner", level="error", text=str(exc))
            return f"I couldn't finish that: {exc}", []
        except Exception as exc:
            logger.exception("[Pipeline] Orchestrator crashed")
            _em(emitter, "log", agent="planner", level="error", text=f"Plan failed: {exc}")
            return f"Failed to execute plan: {exc}", []

        # Recovery requires the orchestrator to report which step failed
        # (result["failed_step_id"], result["error"], result["raw_outputs"]).
        failed_id = result.get("failed_step_id") if isinstance(result, dict) else None
        if not failed_id or replans >= MAX_REPLANS:
            break
        try:
            if plan.get_step(failed_id).on_failure != FailurePolicy.REPLAN:
                break
        except KeyError:
            pass

        raw = result.get("raw_outputs")
        completed = {k: str(v) for k, v in raw.items()} if isinstance(raw, dict) else {}
        try:
            logger.warning(f"[Pipeline] Step '{failed_id}' failed, replanning...")
            _em(emitter, "log", agent="planner", level="warn",
                text=f"Step '{failed_id}' failed, replanning.")
            plan = await asyncio.wait_for(
                dag_planner.replan(original_prompt, failed_id, str(result.get("error", "unknown error")), completed),
                timeout=PLANNER_TIMEOUT_S,
            )
        except Exception as e:
            logger.error(f"[Pipeline] Replan failed: {e}")
            break
        if plan.needs_clarification:
            return plan.clarification_question, []
        _emit_plan(emitter, plan)
        replans += 1

    tasks = result.get("steps_executed", []) if isinstance(result, dict) else []
    return _format_result(result), tasks


# --------------------------------------------------------------------------- #
# ReAct loop
# --------------------------------------------------------------------------- #
async def _react_loop(
    messages: List[Dict[str, Any]],
    user_message: str,
    user_id: str,
    db,
    assistant_chat_id: ObjectId,
    cancel_event: Optional[asyncio.Event],
    notify_callback,
    emitter=None,
    allow_escalation: bool = False
) -> Tuple[str, List[Dict[str, Any]], int]:
    all_executed_tasks: List[Dict[str, Any]] = []
    final_content = "Reached maximum step limit during execution."
    turns_used = 0

    # Route tools off the user's actual request, not the last tool-result JSON.
    if allow_escalation:
        direct = select_direct_tools(tool_router, user_message)
        if not direct:                       # nothing fits -> straight to planner, no LLM call wasted
            return ESCALATE, [], 0
        filtered_tools = direct + [ESCALATE_TOOL]
        messages.insert(1, {"role": "system", "content": ROUTING_NOTE})
    else:
        filtered_tools = tool_router.select_tools(user_message, top_k=6)

    for turn in range(MAX_TOOL_TURNS):
        turns_used = turn + 1
        if cancel_event and cancel_event.is_set():
            logger.info("[Pipeline] Interrupted by cancel_event.")
            return "Task cancelled by user.", all_executed_tasks, turn

        try:
            response = await _call_model_with_retry(
                user_id=user_id, messages=messages, tools=filtered_tools, max_tokens=1500
            )
        except Exception as e:
            logger.critical(f"[Pipeline Turn {turn}] LLM execution failed: {e}")
            return ("I encountered an error connecting to my intelligence engine. Please try again.",
                    all_executed_tasks, turns_used)

        response_message = response.choices[0].message
        if allow_escalation:
            calls = response_message.tool_calls or []
            if any(tc.function.name == ESCALATE_NAME for tc in calls):
                if not all_executed_tasks:   # nothing ran yet -> hand off cleanly
                    return ESCALATE, [], turns_used
                # tools already ran: drop the escalate call and let the model finish
                response_message.tool_calls = [tc for tc in calls if tc.function.name != ESCALATE_NAME] or None
        assistant_dict: Dict[str, Any] = {
            "role": "assistant",
            "content": response_message.content or "",
        }
        if response_message.tool_calls:
            assistant_dict["tool_calls"] = [
                {
                    "id": tc.id,
                    "type": "function",
                    "function": {"name": tc.function.name, "arguments": tc.function.arguments},
                }
                for tc in response_message.tool_calls
            ]
        messages.append(assistant_dict)

        if not response_message.tool_calls:
            _em(emitter, "agent.status", agent="builder", status="Done", doing="Finished")
            return response_message.content or "Task completed.", all_executed_tasks, turns_used

        async def _run_single_tool(tool_call):
            fn_name, tool_id = tool_call.function.name, tool_call.id
            if cancel_event and cancel_event.is_set():
                return tool_id, fn_name, {"status": "cancelled", "error": "Task cancelled before tool start."}
            try:
                fn_args = json.loads(tool_call.function.arguments or "{}")
            except Exception as parse_err:
                return tool_id, fn_name, {"status": "error", "error": f"Invalid JSON args: {parse_err}"}

            _em(emitter, "agent.status", agent="builder", status="Working", doing=f"Running {fn_name}")
            _em(emitter, "log", agent="builder", level="info", text=f"{fn_name} started")
            t_tool = time.perf_counter()
            try:
                result = await asyncio.wait_for(
                    execute_agent_tool(
                        tool_name=fn_name,
                        arguments=fn_args,
                        user_id=user_id,
                        db=db,
                        chat_id=assistant_chat_id,
                        notify_callback=notify_callback,
                    ),
                    timeout=TOOL_TIMEOUT_S,
                )
                _em(emitter, "log", agent="builder", level="success",
                    text=f"{fn_name} finished in {time.perf_counter() - t_tool:.1f}s")
                return tool_id, fn_name, result
            except asyncio.TimeoutError:
                _em(emitter, "log", agent="builder", level="error",
                    text=f"{fn_name} timed out after {int(TOOL_TIMEOUT_S)}s")
                return tool_id, fn_name, {"status": "error", "error": f"Tool '{fn_name}' timed out after {int(TOOL_TIMEOUT_S)}s."}
            except Exception as tool_err:
                _em(emitter, "log", agent="builder", level="error", text=f"{fn_name} failed: {tool_err}")
                return tool_id, fn_name, {"status": "error", "error": str(tool_err)}

        tool_results = await asyncio.gather(*[_run_single_tool(tc) for tc in response_message.tool_calls])

        for tool_id, fn_name, result in tool_results:
            all_executed_tasks.append(
                {"tool_call_id": tool_id, "tool": fn_name, "result": result, "turn": turn}
            )
            payload = json.dumps(
                result if isinstance(result, (dict, list)) else {"output": str(result)},
                default=str,
            )
            if len(payload) > MAX_TOOL_RESULT_CHARS:
                payload = payload[:MAX_TOOL_RESULT_CHARS] + '..."[truncated]"'
            messages.append({"role": "tool", "tool_call_id": tool_id, "content": payload})

    return final_content, all_executed_tasks, turns_used


# --------------------------------------------------------------------------- #
# Pending (confirmation-gated) plans
# --------------------------------------------------------------------------- #
async def _save_pending_plan(db, user_id: str, plan: ExecutionPlan, original_prompt: str) -> None:
    try:
        await db["pending_plans"].update_one(
            {"user_id": user_id},
            {"$set": {
                "user_id": user_id,
                "plan": plan.model_dump(mode="json"),
                "original_prompt": original_prompt,
                "created_at": datetime.now(timezone.utc),
            }},
            upsert=True,
        )
    except Exception as e:
        logger.error(f"[DB Error] Could not save pending plan: {e}")


async def _load_pending_plan(db, user_id: str) -> Optional[Dict[str, Any]]:
    try:
        doc = await db["pending_plans"].find_one({"user_id": user_id})
        if not doc:
            return None
        created = doc["created_at"]
        if created.tzinfo is None:
            created = created.replace(tzinfo=timezone.utc)
        if datetime.now(timezone.utc) - created > PENDING_PLAN_TTL:
            await _clear_pending_plan(db, user_id)
            return None
        return {
            "plan": ExecutionPlan.model_validate(doc["plan"]),
            "original_prompt": doc.get("original_prompt", ""),
        }
    except Exception as e:
        logger.error(f"[DB Error] Could not load pending plan: {e}")
        return None


async def _clear_pending_plan(db, user_id: str) -> None:
    try:
        await db["pending_plans"].delete_many({"user_id": user_id})
    except Exception as e:
        logger.error(f"[DB Error] Could not clear pending plan: {e}")


# --------------------------------------------------------------------------- #
# Response + persistence
# --------------------------------------------------------------------------- #
def _finish(
    db,
    chat_id: ObjectId,
    user_id: str,
    content: str,
    tasks: list,
    start_time: float,
    turns: int,
    planner_used: bool,
    extra: Optional[Dict[str, Any]] = None,
    convo_id: Optional[str] = None,
) -> Dict[str, Any]:
    content = format_response(content) 
    execution_time_ms = round((time.perf_counter() - start_time) * 1000, 2)
    _spawn(_save_assistant_response(db, chat_id, user_id, content, tasks, execution_time_ms, convo_id))
    meta = {
        "execution_time_ms": execution_time_ms,
        "turns_used": turns,
        "planner_used": planner_used,
    }
    if extra:
        meta.update(extra)
    return {"status": "success", "response": content, "tasks": tasks, "meta": meta}


async def _call_model_with_retry(user_id: str, messages: list, tools: list, max_tokens: int = 1500, retries: int = 3):
    for attempt in range(retries):
        try:
            return await call_model(user_id=user_id, messages=messages, tools=tools, max_tokens=max_tokens)
        except Exception as e:
            if attempt == retries - 1:
                raise
            await asyncio.sleep(0.5 * (2 ** attempt))


async def _save_assistant_response(
    db, chat_id: ObjectId, user_id: str, content: str, tasks: list,
    execution_time_ms: float, convo_id: Optional[str] = None,
):
    try:
        try:
            embedding = await get_text_embedding(content)
        except Exception as e:
            logger.warning(f"[Pipeline] Embedding for response failed, saving without: {e}")
            embedding = []
        await db["chats"].update_one(
            {"_id": chat_id},
            {"$set": {
                "user_id": user_id,
                "convo_id": convo_id,
                "role": "assistant",
                "content": content,
                "embeddings": embedding,
                "tool_calls": tasks,
                "created_at": datetime.now(timezone.utc),
                "type": "tool_execution" if tasks else "general_chat",
                "latency_ms": execution_time_ms,
            }},
            upsert=True,
        )
    except Exception as e:
        logger.error(f"[DB Error] Failed to persist final response: {e}")


async def _safe_db_insert(collection, document: dict):
    try:
        await collection.insert_one(document)
    except Exception as e:
        logger.error(f"[DB Error] Insert failed: {e}")