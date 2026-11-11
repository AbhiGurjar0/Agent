# app/routers/jobs.py
"""Routes match lib/jobApi.ts exactly. Mount with: app.include_router(jobs.router)"""
from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Response
from pydantic import BaseModel, Field

from app.core.dependencies import get_current_user
from app.db.database import get_database
from app.pipeline.create_chat_pipeline import DEFAULT_USER_ID
from app.services.jobs.job_engine import JobError, engine

router = APIRouter(prefix="/jobs", tags=["Jobs"])


class ReplyBody(BaseModel):
    message: str = ""
    sender: Literal["freelancer", "user"] = "user"
    type: Optional[str] = None            # accept | counter | reject | message | submission (inferred if omitted)
    price: Optional[float] = None
    links: List[str] = Field(default_factory=list)


class RejectBody(BaseModel):
    fixes: str = ""


class HireBody(BaseModel):
    candidateId: str
    price: Optional[float] = None


def _ctx(db, user) -> str:
    engine.bind(db)
    return str(user["_id"]) if isinstance(user, dict) and user.get("_id") else DEFAULT_USER_ID


async def _do(coro):
    try:
        return await coro
    except JobError as e:
        raise HTTPException(e.code, e.msg)


@router.get("")
async def list_jobs(db=Depends(get_database), user=Depends(get_current_user)):
    return await _do(engine.list(_ctx(db, user)))


@router.get("/{job_id}")
async def get_job(job_id: str, db=Depends(get_database), user=Depends(get_current_user)):
    return await _do(engine.get(_ctx(db, user), job_id))


@router.patch("/{job_id}")
async def update_job(job_id: str, patch: Dict[str, Any] = Body(...), db=Depends(get_database), user=Depends(get_current_user)):
    return await _do(engine.update_draft(_ctx(db, user), job_id, patch))


@router.delete("/{job_id}", status_code=204)
async def discard_job(job_id: str, db=Depends(get_database), user=Depends(get_current_user)):
    await _do(engine.discard(_ctx(db, user), job_id))
    return Response(status_code=204)


@router.post("/{job_id}/confirm")
async def confirm_job(job_id: str, db=Depends(get_database), user=Depends(get_current_user)):
    return await _do(engine.confirm(_ctx(db, user), job_id))


@router.post("/{job_id}/cancel")
async def cancel_job(job_id: str, db=Depends(get_database), user=Depends(get_current_user)):
    return await _do(engine.cancel(_ctx(db, user), job_id))


@router.post("/{job_id}/nudge")
async def nudge_job(job_id: str, db=Depends(get_database), user=Depends(get_current_user)):
    return await _do(engine.nudge(_ctx(db, user), job_id))


@router.post("/{job_id}/retry")
async def retry_job(job_id: str, db=Depends(get_database), user=Depends(get_current_user)):
    return await _do(engine.retry(_ctx(db, user), job_id))


@router.post("/{job_id}/reply")
async def reply_job(job_id: str, body: ReplyBody, db=Depends(get_database), user=Depends(get_current_user)):
    return await _do(engine.reply(_ctx(db, user), job_id, body.model_dump()))


@router.post("/{job_id}/approve")
async def approve_job(job_id: str, db=Depends(get_database), user=Depends(get_current_user)):
    return await _do(engine.approve(_ctx(db, user), job_id))


@router.post("/{job_id}/reject")
async def reject_job(job_id: str, body: RejectBody, db=Depends(get_database), user=Depends(get_current_user)):
    return await _do(engine.reject(_ctx(db, user), job_id, body.fixes))


@router.get("/{job_id}/candidates")
async def job_candidates(job_id: str, refresh: bool = False, db=Depends(get_database), user=Depends(get_current_user)):
    return await _do(engine.candidates(_ctx(db, user), job_id, refresh))


@router.post("/{job_id}/hire")
async def hire_candidate(job_id: str, body: HireBody, db=Depends(get_database), user=Depends(get_current_user)):
    return await _do(engine.hire(_ctx(db, user), job_id, body.candidateId, body.price))


@router.get("/{job_id}/thread")
async def job_thread(job_id: str, db=Depends(get_database), user=Depends(get_current_user)):
    return await _do(engine.thread(_ctx(db, user), job_id))