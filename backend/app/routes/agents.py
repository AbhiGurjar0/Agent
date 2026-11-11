import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.encoders import jsonable_encoder
from fastapi.responses import FileResponse

from app.core.dependencies import get_current_user
from app.db.database import get_database
from app.pipeline.create_chat_pipeline import DEFAULT_USER_ID
from app.schemas.agent import (
    JOB_STATUSES,
    AgentCreate,
    AgentUpdate,
    JobStatusUpdate,
    utc_now,
)

router = APIRouter(prefix="/agents", tags=["Agents"])

UPLOAD_DIR = Path("uploads/jobs")
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
MAX_FILE_BYTES = 25 * 1024 * 1024

# Jobs created here (with file uploads) live in their own collection, so the job engine's
# background ticker (which scans `jobs`) never touches them. Jobs run by the engine stay in `jobs`.
UPLOADED = "agent_jobs"
ENGINE = "jobs"


NEGOTIATION_DEFAULTS = {
    "auto_negotiate": False, "ask_price": None, "min_price": None, "currency": "USD",
    "negotiation_style": "balanced", "max_rounds": 4,"instructions": "", "paypal_email": None,
}


def _with_defaults(item: dict) -> dict:
    for k, v in NEGOTIATION_DEFAULTS.items():
        item.setdefault(k, v)
    return item


# ---------- helpers ----------
def _uid(current_user) -> str:
    if isinstance(current_user, dict) and current_user.get("_id"):
        return str(current_user["_id"])
    return DEFAULT_USER_ID


def _json(data):
    return jsonable_encoder(data, custom_encoder={ObjectId: str})


def _oid(value: str, what: str = "id") -> ObjectId:
    if not ObjectId.is_valid(value):
        raise HTTPException(400, f"Invalid {what}")
    return ObjectId(value)


def _out(doc: dict) -> dict:
    d = dict(doc)
    d["id"] = str(d.pop("_id"))
    d.pop("user_id", None)
    return _json(d)


def _clean_skills(skills: List[str]) -> List[str]:
    seen, out = set(), []
    for s in skills:
        s = s.strip()
        if s and s.lower() not in seen:
            seen.add(s.lower())
            out.append(s)
    return out


def _iso_from_epoch(ts: float) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()


def _uploaded_view(d: dict) -> dict:
    ts = d["updated_at"].timestamp() if d.get("updated_at") else 0.0
    return {
        "id": str(d["_id"]),
        "title": d["title"],
        "description": d.get("description", ""),
        "agent_id": d.get("agent_id"),
        "agent_name": d.get("agent_name"),
        "status": d["status"],
        "action": None,
        "files": [{"filename": f["filename"], "size": f.get("size", 0)} for f in d.get("files", [])],
        "created_at": _json(d.get("created_at")),
        "managed": False,
        "_sort": ts,
    }


def _engine_status(j: dict) -> str:
    """Map the job engine's state to the six dashboard statuses."""
    st, stage = j.get("status"), j.get("stage")
    if st == "completed":
        return "payment_received"          # completed means validated and paid
    if st == "failed":
        return "bug_reported"
    if stage == "payment":
        return "done"                      # work accepted, payment in progress
    if stage == "validate" or j.get("blockedOn") == "your_approval":
        return "under_review"
    if st in ("waiting", "scheduled"):
        return "waiting_for_agent"
    return "running"


def _desk_action(j: dict) -> Optional[str]:
    if j.get("status") not in ("running", "waiting"):
        return None
    fid = (j.get("freelancer") or {}).get("id")
    cand = next((c for c in j.get("candidates", []) if c.get("id") == fid), None)
    if not cand:
        return None
    s = j.get("_s") or {}
    if (j.get("stage") == "negotiate" and j.get("status") == "waiting"
            and j.get("blockedOn") == "freelancer_reply" and not cand.get("auto")):
        return "reply_offer"
    if j.get("stage") == "work" and s.get("assigned"):
        return "submit_work"          # works for auto and manual agents
    return None


def _engine_view(j: dict) -> dict:
    fid = (j.get("freelancer") or {}).get("id") or ""
    ts = float(j.get("updatedAt") or 0)
    return {
        "id": str(j["_id"]),
        "title": j.get("title", ""),
        "description": j.get("description", ""),
        "agent_id": fid[len("agent_"):] if fid.startswith("agent_") else None,
        "agent_name": (j.get("freelancer") or {}).get("name"),
        "status": _engine_status(j),
        "action": _desk_action(j),
        "files": [{"filename": f["filename"], "size": f.get("size", 0)} for f in j.get("files", [])],
        "created_at": _iso_from_epoch(ts) if ts else None,
        "managed": True,                   # status is driven by the engine, not editable here
        "_sort": ts,
    }


async def _all_jobs(db, uid: str) -> List[Dict[str, Any]]:
    uploaded = await db[UPLOADED].find({"user_id": uid}).to_list(length=1000)
    engine = await db[ENGINE].find({"user_id": uid, "status": {"$ne": "draft"}}).to_list(length=1000)
    rows = [_uploaded_view(d) for d in uploaded] + [_engine_view(j) for j in engine]
    rows.sort(key=lambda r: r["_sort"], reverse=True)
    for r in rows:
        r.pop("_sort")
    return rows


# =====================================================================
#  STATS     GET /api/v1/agents/stats
# =====================================================================
@router.get("/stats")
async def get_stats(db=Depends(get_database), current_user: dict = Depends(get_current_user)):
    counts = {s: 0 for s in JOB_STATUSES}
    for j in await _all_jobs(db, _uid(current_user)):
        if j["status"] in counts:
            counts[j["status"]] += 1
    return {**counts, "total": sum(counts.values())}


# =====================================================================
#  JOBS
# =====================================================================
@router.post("/jobs", status_code=status.HTTP_201_CREATED)
async def create_job(
    title: str = Form(..., min_length=1),
    description: str = Form(""),
    agent_id: Optional[str] = Form(None),
    files: List[UploadFile] = File(default=[]),
    db=Depends(get_database),
    current_user: dict = Depends(get_current_user),
):
    """Create a job by hand (multipart form), assign it to an agent and attach files."""
    uid = _uid(current_user)

    agent_name = None
    if agent_id:
        agent = await db["agents"].find_one({"_id": _oid(agent_id, "agent_id"), "user_id": uid})
        if not agent:
            raise HTTPException(404, "Agent not found")
        agent_name = agent["name"]

    job_id = ObjectId()
    job_dir = UPLOAD_DIR / str(job_id)
    saved = []
    try:
        for f in files:
            if not f.filename:
                continue
            job_dir.mkdir(parents=True, exist_ok=True)
            original = Path(f.filename).name
            stored = f"{uuid.uuid4().hex[:8]}_{original}"
            path = job_dir / stored
            with path.open("wb") as out:
                shutil.copyfileobj(f.file, out)
            size = path.stat().st_size
            if size > MAX_FILE_BYTES:
                path.unlink(missing_ok=True)
                raise HTTPException(413, f"{original} is larger than 25 MB")
            saved.append(
                {"filename": original, "stored_name": stored, "size": size, "content_type": f.content_type}
            )
    except HTTPException:
        shutil.rmtree(job_dir, ignore_errors=True)
        raise

    now = utc_now()
    doc = {
        "_id": job_id,
        "user_id": uid,
        "title": title.strip(),
        "description": description,
        "agent_id": agent_id or None,
        "agent_name": agent_name,
        "status": "waiting_for_agent",
        "files": saved,
        "created_at": now,
        "updated_at": now,
    }
    await db[UPLOADED].insert_one(doc)
    view = _uploaded_view(doc)
    view.pop("_sort")
    return view


@router.get("/jobs")
async def list_jobs(
    agent_id: Optional[str] = None,
    status_filter: Optional[str] = None,
    db=Depends(get_database),
    current_user: dict = Depends(get_current_user),
):
    if status_filter and status_filter not in JOB_STATUSES:
        raise HTTPException(400, "Unknown status")
    rows = await _all_jobs(db, _uid(current_user))
    if agent_id:
        rows = [r for r in rows if r["agent_id"] == agent_id]
    if status_filter:
        rows = [r for r in rows if r["status"] == status_filter]
    return rows


@router.patch("/jobs/{job_id}/status")
async def update_job_status(
    job_id: str,
    body: JobStatusUpdate,
    db=Depends(get_database),
    current_user: dict = Depends(get_current_user),
):
    uid, oid = _uid(current_user), _oid(job_id, "job_id")
    res = await db[UPLOADED].find_one_and_update(
        {"_id": oid, "user_id": uid},
        {"$set": {"status": body.status, "updated_at": utc_now()}},
        return_document=True,
    )
    if not res:
        if await db[ENGINE].find_one({"_id": oid, "user_id": uid}, {"_id": 1}):
            raise HTTPException(409, "This job is run by the job engine, its status updates automatically")
        raise HTTPException(404, "Job not found")
    view = _uploaded_view(res)
    view.pop("_sort")
    return view


@router.get("/jobs/{job_id}/files/{filename}")
async def download_job_file(
    job_id: str,
    filename: str,
    db=Depends(get_database),
    current_user: dict = Depends(get_current_user),
):
    job = await db[UPLOADED].find_one({"_id": _oid(job_id, "job_id"), "user_id": _uid(current_user)})
    if not job:
        raise HTTPException(404, "Job not found")
    for f in job.get("files", []):
        if f["filename"] == filename:
            path = UPLOAD_DIR / job_id / f["stored_name"]
            if path.exists():
                return FileResponse(path, filename=f["filename"], media_type=f.get("content_type"))
    raise HTTPException(404, "File not found")


@router.delete("/jobs/{job_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_job(job_id: str, db=Depends(get_database), current_user: dict = Depends(get_current_user)):
    res = await db[UPLOADED].delete_one({"_id": _oid(job_id, "job_id"), "user_id": _uid(current_user)})
    if not res.deleted_count:
        raise HTTPException(404, "Job not found (jobs run by the engine are cancelled via /jobs/{id}/cancel)")
    shutil.rmtree(UPLOAD_DIR / job_id, ignore_errors=True)


# =====================================================================
#  AGENTS    CRUD
# =====================================================================
@router.get("/")
async def list_agents(db=Depends(get_database), current_user: dict = Depends(get_current_user)):
    """All agents, each with its tasks (uploaded + engine-run jobs) and their status."""
    uid = _uid(current_user)
    agents = await db["agents"].find({"user_id": uid}).sort("created_at", -1).to_list(length=200)

    by_agent: Dict[str, list] = {}
    for j in await _all_jobs(db, uid):
        if j["agent_id"]:
            by_agent.setdefault(j["agent_id"], []).append(
                {"id": j["id"], "title": j["title"], "status": j["status"], "action": j.get("action")}
            )

    out = []
    for a in agents:
        item = _out(a)
        item["tasks"] = by_agent.get(item["id"], [])
        out.append(item)
    return out


@router.post("/", status_code=status.HTTP_201_CREATED)
async def create_agent(
    body: AgentCreate, db=Depends(get_database), current_user: dict = Depends(get_current_user)
):
    now = utc_now()
    doc = {
        "user_id": _uid(current_user),
        "name": body.name.strip(),
        "skills": _clean_skills(body.skills),
        "description": body.description.strip(),
        "auto_negotiate": body.auto_negotiate,
        "ask_price": body.ask_price,
        "min_price": body.min_price or (round(body.ask_price * 0.8) if body.ask_price else None),
        "currency": (body.currency or "USD").upper(),
        "negotiation_style": body.negotiation_style,
        "max_rounds": body.max_rounds,
        "instructions": body.instructions.strip(),
        "created_at": now,
        "updated_at": now,
        "paypal_email": (body.paypal_email or "").strip().lower() or None,   # <- add
    }
    res = await db["agents"].insert_one(doc)
    doc["_id"] = res.inserted_id
    item = _with_defaults(_out(doc))
    item["tasks"] = []
    return item


@router.put("/{agent_id}")
async def update_agent(
    agent_id: str,
    body: AgentUpdate,
    db=Depends(get_database),
    current_user: dict = Depends(get_current_user),
):
    uid = _uid(current_user)
    changes = body.model_dump(exclude_unset=True)
    if "name" in changes:
        changes["name"] = changes["name"].strip()
    if "skills" in changes:
        changes["skills"] = _clean_skills(changes["skills"])
    if "description" in changes:
        changes["description"] = (changes["description"] or "").strip()
    if "instructions" in changes:
        changes["instructions"] = (changes["instructions"] or "").strip()
    if "currency" in changes and changes["currency"]:
        changes["currency"] = changes["currency"].upper()
    if "paypal_email" in changes:
        changes["paypal_email"] = (changes["paypal_email"] or "").strip().lower() or None
    changes["updated_at"] = utc_now()

    res = await db["agents"].find_one_and_update(
        {"_id": _oid(agent_id, "agent_id"), "user_id": uid}, {"$set": changes}, return_document=True
    )
    if not res:
        raise HTTPException(404, "Agent not found")

    if "name" in changes:  # keep the denormalised name on uploaded jobs in sync
        await db[UPLOADED].update_many(
            {"user_id": uid, "agent_id": agent_id}, {"$set": {"agent_name": changes["name"]}}
        )
    return _out(res)


@router.delete("/{agent_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_agent(
    agent_id: str, db=Depends(get_database), current_user: dict = Depends(get_current_user)
):
    uid = _uid(current_user)
    res = await db["agents"].delete_one({"_id": _oid(agent_id, "agent_id"), "user_id": uid})
    if not res.deleted_count:
        raise HTTPException(404, "Agent not found")
    # uploaded jobs stay, but become unassigned
    await db[UPLOADED].update_many(
        {"user_id": uid, "agent_id": agent_id}, {"$set": {"agent_id": None, "agent_name": None}}
    )