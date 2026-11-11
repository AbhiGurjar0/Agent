import json, uuid, asyncio, time
from datetime import timezone
from typing import Optional

from bson import ObjectId
from fastapi import APIRouter, WebSocket, Depends, status, Request, Header, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.encoders import jsonable_encoder
from app.db.database import get_database
from app.schemas.chat import ChatCreate
from app.core.dependencies import get_current_user
from app.services.progress import (
    ProgressEmitter, EMITTERS, CANCELS, StreamMapper, build_task_record, progress_summary,
)
from app.pipeline.create_chat_pipeline import run_chat_pipeline, _spawn, PipelineCancelled, DEFAULT_USER_ID
from app.pipeline.voice_chat_pipeline import handle_audio_ws_pipeline


router = APIRouter(
    prefix="/chats",
    tags=["Chats"],
)


def _uid(current_user) -> str:
    if isinstance(current_user, dict) and current_user.get("_id"):
        return str(current_user["_id"])
    return DEFAULT_USER_ID


def _iso(dt) -> Optional[str]:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()


def _json(data):
    return jsonable_encoder(data, custom_encoder={ObjectId: str})


def _new_task(chat_data: ChatCreate, user_id: str, chat_id: Optional[str] = None, full_result: bool = False):
    """Create + register the emitter / cancel event for one background run."""
    message = (getattr(chat_data, "message", "") or "").strip()
    task_id = uuid.uuid4().hex
    em, cancel = ProgressEmitter(task_id), asyncio.Event()
    em.meta = {
        "title": message[:60] or "Task",
        "user_id": user_id,
        "convo_id": getattr(chat_data, "convo_id", None) or chat_id,
        "full_result": full_result,     # stream endpoint also ships the whole result in task.result
    }
    EMITTERS[task_id], CANCELS[task_id] = em, cancel
    return task_id, em, cancel

async def _run_job(task_id, em, cancel, chat_data, db, current_user, user_id):
    """Runs the pipeline for one task, always ends with task.finished, saves the run for /progress."""
    final, message_id = "failed", None
    try:
        em.emit("task.started", title=em.meta["title"])
        em.emit("agent.status", agent="planner", status="Working", doing="Reading your request")
        result = await run_chat_pipeline(
            chat_data, db, current_user, cancel_event=cancel,
            notify_callback=em.notify, emitter=em,
        )
        message_id = str(result["id"]) if result.get("id") else None
        extra = {"result": _json(result)} if em.meta.get("full_result") else {}
        em.emit(
            "task.result",
            response=result.get("response", ""),
            meta=result.get("meta") or {},
            message_id=message_id,
            **extra,
        )
        em.emit("agent.status", agent="planner", status="Done", doing="Task complete")
        final = "cancelled" if cancel.is_set() else "completed"

    except PipelineCancelled:
        em.emit("log", level="warn", agent="planner", text="Task cancelled")
        final = "cancelled"

    except asyncio.CancelledError:
        final = "cancelled"
        raise                                  # let asyncio finish cancelling; finally still runs

    except Exception as e:
        detail = getattr(e, "detail", None) or str(e) or e.__class__.__name__
        em.emit("log", level="error", agent="planner", text=str(detail))
        em.emit("task.error", message=str(detail))
        final = "cancelled" if cancel.is_set() else "failed"

    finally:
        em.close(final)                        # always sends task.finished, so streams never hang
        try:
            if any(e["type"] in ("plan.ready", "step.started", "log") for e in em.events):
                record = build_task_record(
                    em, user_id=user_id, convo_id=em.meta.get("convo_id"),
                    title=em.meta["title"], message_id=message_id,
                )
                # don't store the full answer twice
                record["events"] = [
                    {k: v for k, v in e.items() if k != "result"} for e in record.get("events", [])
                ]
                await db["tasks"].insert_one(record)
        except Exception as persist_err:
            print(f"[tasks] could not save task record: {persist_err}")
        asyncio.get_running_loop().call_later(
            600, lambda: (EMITTERS.pop(task_id, None), CANCELS.pop(task_id, None))
        )

###########################################################################################################
############################################### Routes ####################################################
##########################################################################################################


### 1. /  GET       // Fetch all chat threads for the current user
@router.get("/", status_code=status.HTTP_200_OK)
async def get_chat(db=Depends(get_database)):

    chats = []
    seen = ()
    results = db.chats.find()
    async for chat in results:
        convo_id = chat.get("convo_id")

        if(convo_id and convo_id not in seen):
            seen += (convo_id,)
            chats.append({"convo_id": convo_id, "title": chat.get("title")})

    return chats


### 2. /api/v1/chats/:chatId/messages POST        // Create a new message in a specific chat thread
@router.post("/{chatId}/messages", status_code=status.HTTP_201_CREATED)
async def create_chat(
    chat_data: ChatCreate,
    db=Depends(get_database),
    current_user: dict = Depends(get_current_user),
):
    """Router endpoint delegating execution to the autonomous agent pipeline."""
    return await run_chat_pipeline(
        chat_data=chat_data, db=db, current_user=current_user
    )


### 3. /api/v1/chats/:chatId/messages GET       //Fetch all messages for a specific chat
@router.get("/{chatId}/messages", status_code=status.HTTP_200_OK)
async def get_chat_messages(
    chatId: str,
    db=Depends(get_database),
    current_user: dict = Depends(get_current_user),
):
    """Retrieve all messages for a specific chat (chatId == convo_id), with the tool calls of each answer."""
    rows = await (
        db["chats"]
        .find({"convo_id": chatId, "user_id": _uid(current_user)})
        .sort("created_at", 1)
        .to_list(length=500)
    )
    return _json([
        {
            "id": str(r["_id"]),
            "role": r.get("role", "user"),
            "content": r.get("content", ""),
            "created_at": _iso(r.get("created_at")),
            "tool_calls": r.get("tool_calls") or [],
            "images": r.get("images") or [],
        }
        for r in rows
    ])


### 3b. /api/v1/chats/:chatId/tasks POST        // Start a message as a background task with live progress
@router.post("/{chatId}/tasks", status_code=status.HTTP_201_CREATED)
async def start_task(
    chatId: str,
    chat_data: ChatCreate,
    db=Depends(get_database),
    current_user: dict = Depends(get_current_user),
):
    """Runs the same pipeline as POST /messages, but returns a task_id immediately.
    Progress is streamed from GET /chats/{task_id}/events; the answer arrives as `task.result`."""
    if not getattr(chat_data, "convo_id", None):
        try:
            chat_data.convo_id = chatId
        except Exception:
            pass
    user_id = _uid(current_user)
    task_id, em, cancel = _new_task(chat_data, user_id, chat_id=chatId)
    _spawn(_run_job(task_id, em, cancel, chat_data, db, current_user, user_id))
    return {"task_id": task_id}


### 4. /api/v1/chats/:task_id/events  GET // SSE stream

@router.get("/{task_id}/events")
async def events(task_id: str, request: Request, last_event_id: int = Header(0)):
    em = EMITTERS.get(task_id)
    if not em:
        raise HTTPException(404, "Unknown task")

    async def gen():
        q, backlog = em.attach(last_event_id)
        sent = last_event_id
        try:
            for ev in backlog:
                sent = ev["id"]
                yield _sse(ev)
            if em.closed:
                return
            while not await request.is_disconnected():
                try:
                    ev = await asyncio.wait_for(q.get(), 15)
                except asyncio.TimeoutError:
                    yield ": ping\n\n"          # keeps proxies from closing the stream
                    continue
                if ev is None:
                    return
                if ev["id"] > sent:
                    sent = ev["id"]
                    yield _sse(ev)
        finally:
            em.detach(q)

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


### 5.  /api/v1/chats/ws/audiochat   WebSocket  //audio chat

@router.websocket("/ws/audio-chat")
async def audio_chat(
    websocket: WebSocket,
    db=Depends(get_database),
    user_id: str = "6ac1156aa1165fa861cc5aa0",
    convo_id: Optional[str] = None,
):
    await handle_audio_ws_pipeline(websocket=websocket, db=db, user_id=user_id, convo_id=convo_id)


### 6.  /api/v1/chats/stream   POST SSE  //streaming chat (Home page)
# Same wire format as before ({"type": "step" | "log" | "final" | "error"}), but the steps now come from
# the pipeline's own progress events instead of scraping stdout, so they are per-request and exact.

@router.post("/stream")
async def create_chat_stream(
    chat_data: ChatCreate,
    db=Depends(get_database),
    current_user: dict = Depends(get_current_user),
):
    user_id = _uid(current_user)
    task_id, em, cancel = _new_task(chat_data, user_id, full_result=True)
    q, _ = em.attach(0)                      # attach BEFORE the job starts so nothing is missed
    _spawn(_run_job(task_id, em, cancel, chat_data, db, current_user, user_id))

    def line(obj):
        return f"data: {json.dumps(obj, default=str)}\n\n"

    async def gen():
        mapper = StreamMapper()
        yield line({"type": "task", "task_id": task_id})    # lets the client call /tasks/{id}/cancel
        yield line({"type": "step", "step": "plan", "title": "Plan the steps",
                    "status": "running", "detail": None, "ts": time.time()})
        try:
            while (ev := await q.get()) is not None:
                for out in mapper.feed(ev):
                    yield line(out)
        finally:
            em.detach(q)

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


### 7. /api/v1/chats/tasks GET   // running (live, in memory) + completed (saved) tasks for the Tasks page
@router.get("/tasks")
async def list_tasks(
    db=Depends(get_database),
    current_user: dict = Depends(get_current_user),
):
    uid = _uid(current_user)
    running = [
        progress_summary(em)
        for em in EMITTERS.values()
        if not em.closed and em.meta.get("user_id") == uid
    ]
    running.sort(key=lambda t: t["started_at"])
    completed = await (
        db["tasks"].find({"user_id": uid}, {"_id": 0, "user_id": 0, "events": 0})
        .sort("finished_ts", -1)
        .to_list(length=50)
    )
    return {"running": running, "completed": completed}


### 8. /api/v1/chats/tasks/:task_id/cancel POST
@router.post("/tasks/{task_id}/cancel")
async def cancel(task_id: str):
    ev = CANCELS.get(task_id)
    if not ev:
        raise HTTPException(404)
    ev.set()
    return {"ok": True}


### 9. /api/v1/chats/runs GET   // list of saved runs (the /progress page)
@router.get("/runs")
async def list_runs(
    db=Depends(get_database),
    current_user: dict = Depends(get_current_user),
):
    return await (
        db["tasks"]
        .find(
            {"user_id": _uid(current_user), "message_id": {"$ne": None}},
            {"_id": 0, "user_id": 0, "events": 0, "logs": 0, "contributions": 0, "outcomes": 0},
        )
        .sort("finished_ts", -1)
        .to_list(length=100)
    )


### 10. /api/v1/chats/runs/:message_id GET   // one saved run with its step/log events (/progress/:id)
@router.get("/runs/{message_id}")
async def get_run(
    message_id: str,
    db=Depends(get_database),
    current_user: dict = Depends(get_current_user),
):
    doc = await db["tasks"].find_one(
        {"user_id": _uid(current_user), "message_id": message_id}, {"_id": 0, "user_id": 0}
    )
    if not doc:
        raise HTTPException(404, "Run not found")
    return doc


def _sse(ev):
    return f"id: {ev['id']}\nevent: {ev['type']}\ndata: {json.dumps(ev, default=str)}\n\n"