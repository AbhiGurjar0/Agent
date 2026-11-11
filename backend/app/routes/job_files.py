# app/routers/job_files.py
"""
File attachments for jobs run by the job engine (the `jobs` collection).
Mount next to the jobs router:  app.include_router(job_files.router, prefix="/api/v1")

Files can be attached while a job is a draft or scheduled, i.e. before the brief is sent to the agent.
Files live on disk at uploads/job_files/<job_id>/<file_id>. The job document stores only
{id, filename, size, content_type}, so no server paths are exposed.
"""
import shutil
import time
import uuid
import re
from pathlib import Path
from typing import List

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse

from app.core.dependencies import get_current_user
from app.db.database import get_database
from app.pipeline.create_chat_pipeline import DEFAULT_USER_ID
from app.services.jobs.job_engine import JobError, engine, public

router = APIRouter(prefix="/jobs", tags=["Job files"])

UPLOAD_DIR = Path("uploads/job_files")
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
MAX_FILE_BYTES = 25 * 1024 * 1024
MAX_FILES_PER_JOB = 10
EDITABLE_STATUSES = ("draft", "scheduled")


def _ctx(db, user) -> str:
    engine.bind(db)
    return str(user["_id"]) if isinstance(user, dict) and user.get("_id") else DEFAULT_USER_ID


async def _load(job_id: str, uid: str):
    try:
        return await engine._load(job_id, uid)
    except JobError as e:
        raise HTTPException(e.code, e.msg)


async def _write(f: UploadFile, path: Path) -> int:
    size = 0
    with path.open("wb") as out:
        while chunk := await f.read(1024 * 1024):
            size += len(chunk)
            if size > MAX_FILE_BYTES:
                raise HTTPException(413, f"{f.filename} is larger than 25 MB")
            out.write(chunk)
    return size


@router.post("/{job_id}/files")
async def upload_files(
    job_id: str,
    files: List[UploadFile] = File(...),
    db=Depends(get_database),
    user=Depends(get_current_user),
):
    uid = _ctx(db, user)
    async with engine._lock(job_id):
        job = await _load(job_id, uid)
        if job["status"] not in EDITABLE_STATUSES:
            raise HTTPException(409, "Files can only be attached before the job is sent to the agent")
        existing = job.get("files") or []
        incoming = [f for f in files if f.filename]
        if len(existing) + len(incoming) > MAX_FILES_PER_JOB:
            raise HTTPException(422, f"A job can have at most {MAX_FILES_PER_JOB} files")

        job_dir = UPLOAD_DIR / job_id
        job_dir.mkdir(parents=True, exist_ok=True)
        saved, written = [], []
        try:
            for f in incoming:
                fid = uuid.uuid4().hex[:12]
                path = job_dir / fid
                written.append(path)
                size = await _write(f, path)
                saved.append({"id": fid, "filename": Path(f.filename).name, "size": size,
                              "content_type": f.content_type})
        except HTTPException:
            for p in written:
                p.unlink(missing_ok=True)
            raise

        # Written directly (no updatedAt bump) so the Ready form on the Jobs page is not reset mid-edit.
        event = {"ts": time.time(), "stage": job["stage"], "level": "info",
                 "text": f"Attached {len(saved)} file(s): " + ", ".join(s["filename"] for s in saved)}
        await engine.col.update_one(
            {"_id": job["_id"]},
            {"$push": {"files": {"$each": saved}, "events": {"$each": [event], "$slice": -500}}},
        )
        job.setdefault("files", []).extend(saved)
        job.setdefault("events", []).append(event)
        return public(job)


@router.get("/{job_id}/files/{file_id}")
async def download_file(job_id: str, file_id: str, db=Depends(get_database), user=Depends(get_current_user)):
    job = await _load(job_id, _ctx(db, user))
    meta = next((f for f in job.get("files", []) if f["id"] == file_id), None)
    path = UPLOAD_DIR / job_id / file_id
    if not meta or not path.exists():
        raise HTTPException(404, "File not found")
    return FileResponse(path, filename=meta["filename"], media_type=meta.get("content_type"))


@router.delete("/{job_id}/files/{file_id}")
async def remove_file(job_id: str, file_id: str, db=Depends(get_database), user=Depends(get_current_user)):
    uid = _ctx(db, user)
    async with engine._lock(job_id):
        job = await _load(job_id, uid)
        if job["status"] not in EDITABLE_STATUSES:
            raise HTTPException(409, "Files can only be removed before the job is sent to the agent")
        if not any(f["id"] == file_id for f in job.get("files", [])):
            raise HTTPException(404, "File not found")
        await engine.col.update_one({"_id": job["_id"]}, {"$pull": {"files": {"id": file_id}}})
        (UPLOAD_DIR / job_id / file_id).unlink(missing_ok=True)
        job["files"] = [f for f in job.get("files", []) if f["id"] != file_id]
        return public(job)
    
@router.post("/{job_id}/submit")
async def submit_work(
    job_id: str,
    message: str = Form(""),
    links: str = Form(""),
    files: List[UploadFile] = File(default=[]),
    db=Depends(get_database),
    user=Depends(get_current_user),
):
    """Demo desk: submit the work AS the hired agent (works for auto and manual agents)."""
    uid = _ctx(db, user)
    incoming = [f for f in files if f.filename]
    link_list = [x.strip() for x in re.split(r"[,\n]", links) if x.strip()]
    if not message.strip() and not incoming and not link_list:
        raise HTTPException(422, "Add a message, a link or a file")
    if len(incoming) > MAX_FILES_PER_JOB:
        raise HTTPException(422, f"At most {MAX_FILES_PER_JOB} files")

    async with engine._lock(job_id):
        job = await _load(job_id, uid)
        if job["stage"] != "work" or job["status"] not in ("running", "waiting") or not job["_s"].get("assigned"):
            raise HTTPException(409, "Work can be submitted once the agent has accepted and been briefed")

        job_dir = UPLOAD_DIR / job_id
        job_dir.mkdir(parents=True, exist_ok=True)
        saved, written = [], []
        try:
            for f in incoming:
                fid = uuid.uuid4().hex[:12]
                path = job_dir / fid
                written.append(path)
                size = await _write(f, path)
                saved.append({"id": fid, "filename": Path(f.filename).name, "size": size,
                              "content_type": f.content_type, "source": "freelancer"})
        except HTTPException:
            for p in written:
                p.unlink(missing_ok=True)
            raise

        if saved:
            await engine.col.update_one({"_id": job["_id"]}, {"$push": {"files": {"$each": saved}}})
            job.setdefault("files", []).extend(saved)
        text = message.strip() or f"Submitted {len(saved)} file(s)."
        if saved:
            text += "\n\nAttached files: " + ", ".join(s["filename"] for s in saved)
        await engine._ingest(job, {"sender": "freelancer", "type": "submission", "message": text,
                                   "links": link_list, "files": saved})
    engine.wake(job_id)          # after the lock is released, like reply()
    return public(job)