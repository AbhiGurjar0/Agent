# app/services/job_intake.py
"""
(1) Categorise a chat message as JOB (hire a human freelancer, long-running, paid) or TASK (Jarvis does it).
(2) Build a full 5-stage plan for jobs.
Cheap regex pre-filter first, so normal messages never pay for an extra LLM call.
"""
import re
import time
from datetime import datetime
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel

from app.services.jobs.job_llm import parse

STAGES = ["hire", "negotiate", "work", "validate", "payment"]
Stage = Literal["hire", "negotiate", "work", "validate", "payment"]


class PlanStageModel(BaseModel):
    stage: Stage
    steps: List[str]


class JobSpec(BaseModel):
    title: str
    description: str
    skills: List[str]
    criteria: List[str]
    budget: Optional[float]
    max_budget: Optional[float]
    currency: str
    deadline_iso: Optional[str]
    start_iso: Optional[str]
    missing: List[str]
    plan: List[PlanStageModel]


class Intent(BaseModel):
    kind: Literal["job", "task"]
    reason: str
    needs_clarification: bool
    clarification_question: Optional[str]
    job: Optional[JobSpec]


JOB_HINT = re.compile(
    r"\b(hire|hiring|freelanc\w*|outsource\w*|contractor|gig|commission(?:ing)?|post (?:a )?job|"
    r"get (?:someone|somebody|a \w+) to|"
    r"find (?:me )?(?:a|an|some) (?:\w+ ){0,2}(?:designer|developer|writer|editor|translator|illustrator|animator|marketer|consultant|freelancer)|"
    r"pay (?:someone|somebody|a \w+) to)\b",
    re.I,
)

SYSTEM = """\
You triage messages for Jarvis, an autonomous assistant. Current date/time: __NOW__.

kind = "job" when the user wants a HUMAN freelancer/contractor hired and paid to deliver work
  (hire, outsource, "get someone to design...", "find me a developer for..."). Jarvis will search
  freelancers, negotiate the price, track the work, validate it and pay.
kind = "task" for everything Jarvis can do itself: search, play media, send email, run code, questions,
  or "write/design X for me" with no hiring intent.

If kind="job" fill `job`:
- title (short), description (clear scope, what to deliver, 2-6 sentences), skills (3-6 lowercase skills),
- criteria: 3-6 CHECKABLE acceptance criteria a validator could verify from the submitted work,
- budget / max_budget as numbers (max_budget = most the user would pay; null if not given),
- currency: USD, INR, EUR or GBP (infer from symbols like ₹/Rs/$; default USD),
- deadline_iso / start_iso: ISO-8601 or null (resolve "by Friday", "tomorrow 9am" from the current date),
- missing: any of ["budget","deadline","scope"] that the user did not provide,
- plan: exactly 5 entries (hire, negotiate, work, validate, payment), 2-4 concrete steps each, tailored to this job.
Set needs_clarification=true ONLY if the work itself is too vague to describe (not for a missing budget).
Return ONLY the structured result."""


async def classify_request(message: str, history: Optional[str] = None) -> Optional[Intent]:
    """None means 'normal task' (the existing pipeline continues)."""
    if not JOB_HINT.search(message):
        return None
    content = f"Conversation context:\n{history}\n\nMessage: {message}" if history else f"Message: {message}"
    intent = await parse(
        [
            {"role": "system", "content": SYSTEM.replace("__NOW__", datetime.now().strftime("%A, %d %B %Y, %H:%M"))},
            {"role": "user", "content": content},
        ],
        Intent,
    )
    if intent.kind != "job":
        return None
    if intent.job is None and not intent.needs_clarification:
        return None
    return intent


# ------------------------------------------------------------------ plan
def default_plan(job: Dict[str, Any]) -> List[Dict[str, Any]]:
    skills = ", ".join(job.get("skills") or []) or "the required skills"
    cur = job.get("currency", "USD")
    budget = job.get("budget") or 0
    ceil = job.get("maxBudget") or budget
    return [
        {"stage": "hire", "steps": [
            f"Search marketplaces for freelancers with: {skills}",
            "Rank candidates by skill match, rating and rate",
            "Shortlist and pick the best fit (you can override from the candidates list)"]},
        {"stage": "negotiate", "steps": [
            f"Open below the {cur} {budget:,.0f} budget and move up in small steps",
            f"Never agree above the {cur} {ceil:,.0f} ceiling",
            "Counter for up to 5 rounds, then switch to the next candidate",
            "Lock the price and terms"]},
        {"stage": "work", "steps": [
            "Send the brief, acceptance criteria and deadline",
            "Wait for the submission, send a reminder if it goes quiet",
            "Fail the job if the deadline passes"]},
        {"stage": "validate", "steps": [
            "Check the submission against every acceptance criterion",
            "If anything fails, send the exact fixes and request a revision (max 3)"]},
        {"stage": "payment", "steps": [
            "Pay the agreed price once the work is approved",
            "Retry up to 3 times if the payment fails",
            "Close the job"]},
    ]


def _plan_from_spec(spec: JobSpec, fallback: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    got = {p.stage: [s.strip() for s in p.steps if s.strip()] for p in spec.plan}
    if not all(got.get(s) for s in STAGES):
        return fallback
    return [{"stage": s, "steps": got[s]} for s in STAGES]


# ------------------------------------------------------------------ draft doc
def _iso(s: Optional[str]) -> Optional[str]:
    if not s:
        return None
    try:
        d = datetime.fromisoformat(s.replace("Z", "+00:00"))
        d = d.astimezone()  # naive -> local tz
        return d.isoformat() if d.timestamp() > time.time() else None
    except Exception:
        return None


def missing_fields(job: Dict[str, Any]) -> List[str]:
    out = []
    if not (job.get("budget") or 0) > 0:
        out.append("budget")
    if not job.get("deadline"):
        out.append("deadline")
    if not job.get("criteria"):
        out.append("criteria")
    return out


def build_draft(user_id: str, spec: JobSpec, convo_id: Optional[str] = None) -> Dict[str, Any]:
    now = time.time()
    job: Dict[str, Any] = {
        "user_id": user_id, "convo_id": convo_id,
        "title": spec.title.strip()[:120], "description": spec.description.strip(),
        "skills": [s.strip().lower() for s in spec.skills if s.strip()],
        "criteria": [c.strip() for c in spec.criteria if c.strip()],
        "budget": float(spec.budget or 0), "maxBudget": float(spec.max_budget) if spec.max_budget else None,
        "currency": spec.currency if spec.currency in ("USD", "INR", "EUR", "GBP") else "USD",
        "deadline": _iso(spec.deadline_iso), "scheduledFor": _iso(spec.start_iso),
        "status": "draft", "stage": "hire", "activity": None, "blockedOn": None, "waitingSince": None,
        "progress": 0, "createdAt": now, "updatedAt": now,
        "freelancer": None, "agreedPrice": None, "failure": None,
        "offers": [], "candidates": [], "revisions": 0, "lastValidation": None, "payment": None,
        "submission": None, "thread": [], "autoApprove": True, "_s": {"rejected": []},
    }
    job["missing"] = missing_fields(job)
    job["plan"] = _plan_from_spec(spec, default_plan(job))
    job["events"] = [
        {"ts": now, "stage": "hire", "level": "info", "text": "Drafted from your chat message. Review it and confirm to start."},
        {"ts": now, "stage": "hire", "level": "info",
         "text": "Plan: " + " > ".join(p["stage"].title() for p in job["plan"])},
    ]
    return job


def draft_reply(job: Dict[str, Any]) -> str:
    miss = job.get("missing") or []
    note = f"\n\nStill missing: **{', '.join(miss)}**. You can fill it in before confirming." if miss else ""
    cur, b = job["currency"], job["budget"]
    budget = f"{cur} {b:,.0f}" if b else "not set"
    return (
        f"This looks like a job for a freelancer, so I drafted it instead of running it myself.\n\n"
        f"**{job['title']}** · budget {budget}\n"
        f"Plan: Hire → Negotiate → Work → Validate → Pay{note}\n\n"
        f"Open **Jobs → Ready** to review, edit and confirm. Nothing is sent until you confirm."
    )