# app/services/job_engine.py
"""
Job engine. State lives in Mongo (`jobs` collection), so it survives restarts.

Flow:  draft -> (confirm) -> hire -> negotiate -> work -> validate -> payment -> completed
Every state change is written to `events` (the live trail the Jobs page polls).

How it runs: an idempotent `_step()` drives one transition at a time under a per-job lock.
It is woken (a) immediately by any reply/approve/hire/nudge/retry/confirm and (b) every few
seconds by a background ticker (scheduled starts, timeouts, simulated freelancer replies, payment confirmation).
"""
import asyncio
import logging
import os
import time
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

from bson import ObjectId

from app.services.jobs import job_market as market
from app.services.jobs.agent_provider import agents_provider   # <- add
from app.services.jobs.job_intake import default_plan, missing_fields
from app.services.jobs.job_validator import validate_submission
from app.services.agents import negotiator

log = logging.getLogger("jarvis.jobs")

OPEN_FRACTION = 0.75          # opening offer = 75% of budget
MAX_ROUNDS = 5
MAX_REVISIONS = 3
MAX_PAY_ATTEMPTS = 3
TICK_S = 3.0
REPLY_TIMEOUT_S = float(os.getenv("JOB_REPLY_TIMEOUT_S", 6 * 3600))
PROGRESS = {"hire": 10, "negotiate": 30, "work": 50, "validate": 75, "payment": 90}
EDITABLE = {"title", "description", "skills", "criteria", "budget", "maxBudget", "currency", "deadline", "scheduledFor"}
INTERNAL = {"_id", "_s", "user_id", "convo_id", "thread"}


class JobError(Exception):
    def __init__(self, code: int, msg: str):
        super().__init__(msg)
        self.code, self.msg = code, msg


def _r(x: float) -> float:
    return round(x) if abs(x) >= 100 else round(x, 2)


def _ts(iso: Optional[str]) -> Optional[float]:
    try:
        return datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp() if iso else None
    except Exception:
        return None


def public(job: Dict[str, Any]) -> Dict[str, Any]:
    out = {k: v for k, v in job.items() if k not in INTERNAL}
    out["id"] = str(job["_id"])
    return out


def public_thread(job: Dict[str, Any]) -> List[Dict[str, Any]]:
    hide = {"processed", "answered", "reply_at", "to"}
    return [{k: v for k, v in m.items() if k not in hide} for m in job.get("thread", [])]


def validate_draft(j: Dict[str, Any]) -> List[str]:
    errs = []
    if not (j.get("title") or "").strip():
        errs.append("Add a title")
    if len((j.get("description") or "").strip()) < 20:
        errs.append("Describe the work in a bit more detail")
    if not (j.get("budget") or 0) > 0:
        errs.append("Budget must be above 0")
    if j.get("maxBudget") and j["maxBudget"] < j["budget"]:
        errs.append("Max budget cannot be below budget")
    return errs


class JobEngine:
    def __init__(self):
        self.db = None
        self._locks: Dict[str, asyncio.Lock] = {}
        self._dirty: set = set()
        self._tasks: set = set()
        self._ticker: Optional[asyncio.Task] = None

    # ------------------------------------------------------------------ plumbing
    def bind(self, db) -> None:
        self.db = db
        agents_provider.db = db       
        if self._ticker is None or self._ticker.done():
            try:
                self._ticker = asyncio.get_running_loop().create_task(self._tick_loop())
            except RuntimeError:
                pass

    async def start(self, db) -> None:  # optional: call from FastAPI lifespan
        self.bind(db)

    async def stop(self) -> None:
        if self._ticker:
            self._ticker.cancel()

    @property
    def col(self):
        return self.db["jobs"]

    def _lock(self, jid: str) -> asyncio.Lock:
        return self._locks.setdefault(jid, asyncio.Lock())

    async def _load(self, jid: str, uid: Optional[str] = None) -> Dict[str, Any]:
        try:
            q: Dict[str, Any] = {"_id": ObjectId(jid)}
        except Exception:
            raise JobError(404, "Job not found")
        if uid:
            q["user_id"] = uid
        job = await self.col.find_one(q)
        if not job:
            raise JobError(404, "Job not found")
        job.setdefault("thread", [])
        job.setdefault("_s", {"rejected": []})
        return job

    async def _save(self, job: Dict[str, Any], **f) -> None:
        f["updatedAt"] = time.time()
        job.update(f)
        await self.col.update_one({"_id": job["_id"]}, {"$set": f})

    async def _sset(self, job: Dict[str, Any], **f) -> None:
        job["_s"].update(f)
        await self.col.update_one({"_id": job["_id"]}, {"$set": {f"_s.{k}": v for k, v in f.items()}})

    async def _push(self, job: Dict[str, Any], field: str, item: Dict[str, Any], cap: Optional[int] = None) -> None:
        job.setdefault(field, []).append(item)
        op: Dict[str, Any] = {"$each": [item]}
        if cap:
            op["$slice"] = -cap
        await self.col.update_one({"_id": job["_id"]}, {"$push": {field: op}, "$set": {"updatedAt": time.time()}})

    async def _tset(self, job: Dict[str, Any], mid: str, **f) -> None:
        for m in job["thread"]:
            if m["id"] == mid:
                m.update(f)
        await self.col.update_one(
            {"_id": job["_id"], "thread.id": mid}, {"$set": {f"thread.$.{k}": v for k, v in f.items()}}
        )

    async def _log(self, job: Dict[str, Any], level: str, text: str, stage: Optional[str] = None) -> None:
        await self._push(job, "events", {"ts": time.time(), "stage": stage or job["stage"], "level": level, "text": text}, cap=500)

    def _m(self, job: Dict[str, Any], n: float) -> str:
        return f"{job.get('currency', 'USD')} {n:,.0f}"

    def _cand(self, job: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        fid = (job.get("freelancer") or {}).get("id")
        return next((c for c in job.get("candidates", []) if c["id"] == fid), None)

    def _who(self, job: Dict[str, Any]) -> str:
        return (job.get("freelancer") or {}).get("name", "the freelancer")

    async def _say(self, job: Dict[str, Any], type_: str, text: str, price: Optional[float] = None) -> Dict[str, Any]:
        """Outbound message to the freelancer (also goes to the provider if it is a real one)."""
        cand = self._cand(job)
        now = time.time()
        msg: Dict[str, Any] = {"id": uuid.uuid4().hex[:12], "ts": now, "dir": "out", "type": type_, "from": "agent",
                               "price": price, "text": text, "answered": False, "to": cand["id"] if cand else None}
        if type_ == "offer":
            msg["round"] = job["_s"].get("round", 1)
        if cand and cand.get("simulated") and type_ in ("offer", "assignment", "revision_request"):
            delay = negotiator.reply_delay() if cand.get("auto") else market.sim_delay(type_)
            msg["reply_at"] = now + delay
        await self._push(job, "thread", msg)
        if cand and not cand.get("simulated"):
            try:
                await market.deliver(job, cand, msg)
            except Exception as e:  # noqa: BLE001
                await self._log(job, "error", f"Could not deliver message to {cand['name']}: {e}")
        return msg

    # ------------------------------------------------------------------ state helpers
    async def _busy(self, job, activity: str) -> None:
        if job["status"] != "running" or job.get("activity") != activity or job.get("blockedOn"):
            await self._save(job, status="running", activity=activity, blockedOn=None, waitingSince=None)

    async def _wait(self, job, blocked: str) -> None:
        if job["status"] != "waiting" or job.get("blockedOn") != blocked:
            await self._save(job, status="waiting", blockedOn=blocked, activity=None, waitingSince=time.time())

    async def _advance(self, job, stage: str) -> None:
        await self._save(job, stage=stage, progress=PROGRESS[stage], status="running", activity=None,
                         blockedOn=None, waitingSince=None)

    async def _fail(self, job, kind: str, reason: str, stage: Optional[str] = None, retryable: bool = False) -> bool:
        stage = stage or job["stage"]
        await self._save(job, status="failed", activity=None, blockedOn=None, waitingSince=None,
                         failure={"kind": kind, "stage": stage, "reason": reason, "retryable": retryable})
        await self._log(job, "error", reason, stage)
        return True

    # ------------------------------------------------------------------ public API (used by the router)
    async def create_draft(self, db, doc: Dict[str, Any]) -> Dict[str, Any]:
        self.bind(db)
        res = await self.col.insert_one(doc)
        doc["_id"] = res.inserted_id
        return public(doc)

    async def list(self, uid: str) -> List[Dict[str, Any]]:
        rows = await self.col.find({"user_id": uid}).sort("updatedAt", -1).to_list(length=200)
        return [public(r) for r in rows]

    async def get(self, uid: str, jid: str) -> Dict[str, Any]:
        return public(await self._load(jid, uid))

    async def thread(self, uid: str, jid: str) -> List[Dict[str, Any]]:
        return public_thread(await self._load(jid, uid))

    async def update_draft(self, uid: str, jid: str, patch: Dict[str, Any]) -> Dict[str, Any]:
        async with self._lock(jid):
            job = await self._load(jid, uid)
            if job["status"] != "draft":
                raise JobError(409, "Only drafts can be edited")
            clean: Dict[str, Any] = {}
            for k, v in patch.items():
                if k not in EDITABLE:
                    continue
                if k in ("skills", "criteria"):
                    clean[k] = [str(x).strip() for x in (v or []) if str(x).strip()]
                elif k == "budget":
                    clean[k] = float(v or 0)
                elif k == "maxBudget":
                    clean[k] = float(v) if v else None
                elif k in ("deadline", "scheduledFor"):
                    if v and _ts(v) is None:
                        raise JobError(422, f"Invalid date for {k}")
                    clean[k] = v or None
                else:
                    clean[k] = str(v or "").strip()
            job.update(clean)
            clean["missing"] = missing_fields(job)
            clean["plan"] = default_plan(job)
            await self._save(job, **clean)
            await self._log(job, "info", "Draft updated")
            return public(job)

    async def discard(self, uid: str, jid: str) -> None:
        async with self._lock(jid):
            job = await self._load(jid, uid)
            if job["status"] != "draft":
                raise JobError(409, "Only drafts can be discarded. Cancel the job instead.")
            await self.col.delete_one({"_id": job["_id"]})

    async def confirm(self, uid: str, jid: str) -> Dict[str, Any]:
        async with self._lock(jid):
            job = await self._load(jid, uid)
            if job["status"] != "draft":
                raise JobError(409, "This job was already sent")
            errs = validate_draft(job)
            if errs:
                raise JobError(422, "; ".join(errs))
            at = _ts(job.get("scheduledFor"))
            scheduled = bool(at and at > time.time() + 30)
            await self._save(job, status="scheduled" if scheduled else "running", stage="hire", progress=2,
                             missing=[], plan=job.get("plan") or default_plan(job), _s={"rejected": []},startedAt=time.time())
            await self._log(job, "success",
                            "Confirmed. Starts at the scheduled time." if scheduled else "Confirmed. Agent is starting.")
        self.wake(jid)
        return public(job)

    async def cancel(self, uid: str, jid: str) -> Dict[str, Any]:
        async with self._lock(jid):
            job = await self._load(jid, uid)
            if job["status"] not in ("running", "waiting", "scheduled"):
                raise JobError(409, "This job is not active")
            if job.get("freelancer") and job["stage"] != "hire":
                await self._say(job, "message", "The job has been cancelled by the client. Thank you for your time.")
            await self._fail(job, "cancelled", "Cancelled by you", retryable=False)
        return public(job)

    async def nudge(self, uid: str, jid: str) -> Dict[str, Any]:
        async with self._lock(jid):
            job = await self._load(jid, uid)
            if job.get("blockedOn") in ("budget_approval", "your_approval"):
                raise JobError(409, "The job is waiting on you, not the freelancer")
            if job["status"] != "waiting":
                raise JobError(409, "Nothing to remind: the job is not waiting")
            texts = {"freelancer_reply": "Quick reminder: could you reply to my offer?",
                     "freelancer_acceptance": "Quick reminder: please confirm you accept the job.",
                     "work_submission": "Quick reminder: please send the work when it is ready.",
                     "revision": "Quick reminder: I am waiting for the revision with the requested fixes."}
            await self._say(job, "reminder", texts.get(job.get("blockedOn") or "", "Quick reminder about this job."))
            last = next((m for m in reversed(job["thread"]) if m["dir"] == "out"
                         and m["type"] in ("offer", "assignment", "revision_request") and not m.get("answered")), None)
            if last and last.get("reply_at"):
                await self._tset(job, last["id"], reply_at=min(last["reply_at"], time.time() + 2))
            await self._log(job, "info", f"Reminder sent to {self._who(job)}")
        self.wake(jid)
        return public(job)

    async def retry(self, uid: str, jid: str) -> Dict[str, Any]:
        async with self._lock(jid):
            job = await self._load(jid, uid)
            f = job.get("failure")
            if job["status"] != "failed" or not f or not f.get("retryable"):
                raise JobError(409, "This job cannot be retried")
            base = dict(status="running", failure=None, activity=None, blockedOn=None, waitingSince=None)
            if f["kind"] in ("no_freelancer", "negotiation_failed"):
                await self._save(job, stage="hire", freelancer=None, agreedPrice=None, candidates=[], progress=10,
                                 _s={"rejected": []}, **base)
            elif f["kind"] == "payment_failed":
                pay = dict(job.get("payment") or {})
                pay.update(status="retry", attempts=0, error=None)
                await self._save(job, stage="payment", payment=pay, **base)
            else:
                await self._save(job, stage=f["stage"], **base)
            await self._log(job, "info", f"Retrying from {job['stage'].title()}")
        self.wake(jid)
        return public(job)

    async def approve(self, uid: str, jid: str) -> Dict[str, Any]:
        async with self._lock(jid):
            job = await self._load(jid, uid)
            if not (job["status"] == "waiting" and job.get("blockedOn") == "your_approval"):
                raise JobError(409, "Nothing is waiting for your approval")
            await self._sset(job, approved=True)
            await self._log(job, "success", "You approved the work")
        self.wake(jid)
        return public(job)

    async def reject(self, uid: str, jid: str, fixes: str) -> Dict[str, Any]:
        async with self._lock(jid):
            job = await self._load(jid, uid)
            if job["stage"] != "validate" or job["status"] not in ("running", "waiting"):
                raise JobError(409, "There is no submission to reject right now")
            await self._request_revision(job, fixes.strip() or "Please address the client's feedback.", "your")
        self.wake(jid)
        return public(job)

    async def hire(self, uid: str, jid: str, cand_id: str, price: Optional[float] = None) -> Dict[str, Any]:
        """Manual override: you pick a freelancer from the candidates list (optionally with a fixed price)."""
        async with self._lock(jid):
            job = await self._load(jid, uid)
            f = job.get("failure") or {}
            recoverable = job["status"] == "failed" and f.get("kind") in ("no_freelancer", "negotiation_failed")
            if job["status"] in ("draft", "completed", "scheduled") or (job["status"] == "failed" and not recoverable):
                raise JobError(409, "A freelancer cannot be hired in this state")
            if job["status"] != "failed" and job["stage"] not in ("hire", "negotiate"):
                raise JobError(409, "Work has already started with a freelancer")
            cand = next((c for c in job.get("candidates", []) if c["id"] == cand_id), None)
            if not cand:
                raise JobError(404, "Candidate not found")
            if price is not None and price <= 0:
                raise JobError(422, "Price must be above 0")
            if price and price > (job.get("maxBudget") or job["budget"]):
                await self._save(job, maxBudget=price)
                await self._log(job, "warn", f"Max budget raised to {self._m(job, price)} to match your hire")
            await self._save(job, status="running", failure=None, agreedPrice=None)
            await self._select(job, cand, job["_s"].get("rejected", []), by="you")
            if price:
                await self._agree(job, price)
            else:
                await self._advance(job, "negotiate")
        self.wake(jid)
        return public(job)

    async def candidates(self, uid: str, jid: str, refresh: bool = False) -> List[Dict[str, Any]]:
        async with self._lock(jid):
            job = await self._load(jid, uid)
            if refresh or not job.get("candidates"):
                found = await market.search_all(job)
                await self._save(job, candidates=found)
                if job["status"] != "draft":
                    await self._log(job, "info", f"Browsed marketplaces: {len(found)} candidates", "hire")
            return job.get("candidates", [])

    async def reply(self, uid: str, jid: str, body: Dict[str, Any]) -> Dict[str, Any]:
        """A reply from the freelancer (or you) wakes the agent immediately."""
        async with self._lock(jid):
            job = await self._load(jid, uid)
            if job["status"] not in ("running", "waiting"):
                raise JobError(409, "This job is not active")
            await self._ingest(job, body)
        self.wake(jid)
        return public(job)

    # ------------------------------------------------------------------ inbound
    async def _ingest(self, job, body: Dict[str, Any]) -> Dict[str, Any]:
        sender = body.get("sender", "user")
        text = (body.get("message") or body.get("text") or "").strip()
        price = body.get("price")
        links = body.get("links") or []
        t = body.get("type")
        if not t:
            if sender == "freelancer" and job["stage"] == "work" and (links or len(text) >= 40):
                t = "submission"
            elif sender == "freelancer" and job["stage"] == "negotiate" and price is not None:
                t = "counter"
            else:
                t = "message"
        if t not in ("accept", "counter", "reject", "message", "submission"):
            t = "message"
        msg = {"id": uuid.uuid4().hex[:12], "ts": time.time(), "dir": "in", "type": t, "from": sender,
               "price": price, "text": text, "links": links, "files": body.get("files") or [], "processed": False}
        await self._push(job, "thread", msg)
        return msg

    async def _on_inbound(self, job, msg: Dict[str, Any]) -> None:
        t, stage, s, who = msg["type"], job["stage"], job["_s"], self._who(job)
        if msg["from"] == "user":
            if msg.get("price") and msg["price"] > (job.get("maxBudget") or job["budget"]):
                await self._save(job, maxBudget=msg["price"])
                await self._log(job, "warn", f"Max budget raised to {self._m(job, msg['price'])} on your instruction")
            if msg["text"]:
                await self._log(job, "info", f"You: {msg['text'][:200]}")
            return
        if t == "message":
            await self._log(job, "info", f"{who}: {msg['text'][:200]}")
            return
        if t in ("accept", "counter", "reject"):
            if stage != "negotiate" or not s.get("outstanding"):
                await self._log(job, "warn", f"Ignored {t} from {who}: no offer is open")
                return
            await self._push(job, "offers", {"round": s.get("round", 1), "by": "freelancer", "price": msg.get("price"),
                                             "message": msg["text"], "ts": msg["ts"], "candidate_id": s.get("cand")})
            if t == "reject":
                return await self._next_candidate(job, f"{who} declined the offer")
            if t == "accept":
                p = msg.get("price") or s.get("last_offer")
                if p and p > (s.get("last_offer") or 0):
                    return await self._on_counter(job, msg)
                await self._log(job, "success", f"{who} accepted {self._m(job, p)}")
                return await self._agree(job, p)
            return await self._on_counter(job, msg)
        if t == "submission":
            if stage != "work" or not s.get("assigned"):
                await self._log(job, "warn", f"Ignored a submission from {who}: work has not been assigned")
                return
            await self._save(job, submission={"content": msg["text"], "links": msg.get("links") or [],
                                  "files": msg.get("files") or [], "ts": msg["ts"]})
            await self._sset(job, revising=False, approved=False)
            await self._log(job, "success", f"{who} submitted the work" + (f" with {len(msg['links'])} link(s)" if msg.get("links") else ""))
            await self._advance(job, "validate")

    # ------------------------------------------------------------------ HIRE
    async def _select(self, job, cand: Dict[str, Any], rejected: List[str], by: str = "agent") -> None:
        await self._save(job, freelancer={"id": cand["id"], "name": cand["name"], "rating": cand["rating"], "title": cand["title"]},
                         _s={"rejected": rejected, "cand": cand["id"], "round": 0, "outstanding": False})
        await self._log(job, "success", f"{'You picked' if by == 'you' else 'Selected'} {cand['name']} "
                                        f"({cand['title']}, {cand['rating']}★, {cand['match']}% match)", "hire")

    async def _do_hire(self, job, now) -> bool:
        if job.get("freelancer"):
            await self._advance(job, "negotiate")
            return True
        await self._busy(job, "searching_freelancers")
        await self._log(job, "info", "Searching marketplaces for: " + (", ".join(job["skills"]) or "the job description"))
        found = await market.search_all(job)
        await self._save(job, candidates=found)
        rejected = job["_s"].get("rejected", [])
        good = [c for c in found if c["match"] >= market.MIN_MATCH and c["id"] not in rejected]
        if not good:
            return await self._fail(job, "no_freelancer", "No freelancer matched the required skills", "hire", retryable=True)
        top = ", ".join(f"{c['name']} {c['match']}%" for c in good[:3])
        await self._log(job, "info", f"Found {len(found)} candidates. Top matches: {top}")
        await self._select(job, good[0], rejected)
        await self._advance(job, "negotiate")
        return True

    # ------------------------------------------------------------------ NEGOTIATE
    def _ceiling(self, job) -> float:
        return float(job.get("maxBudget") or job["budget"])

    async def _do_negotiate(self, job, now) -> bool:
        if job.get("pendingApproval"):
            await self._wait(job, "budget_approval")
            return False
        s = job["_s"]
        if not job.get("freelancer"):
            await self._save(job, stage="hire")
            return True
        if s.get("outstanding"):
            await self._wait(job, "freelancer_reply")
            if now - s.get("offer_ts", now) > REPLY_TIMEOUT_S:
                await self._next_candidate(job, f"{self._who(job)} did not reply in time")
                return True
            return False
        if s.get("round", 0) >= MAX_ROUNDS:
            await self._next_candidate(job, f"No agreement after {MAX_ROUNDS} rounds")
            return True
        price = s.get("next_offer") or _r(job["budget"] * OPEN_FRACTION)
        return await self._send_offer(job, min(price, self._ceiling(job)))

    async def _send_offer(self, job, price: float) -> bool:
        s, rnd, who = job["_s"], job["_s"].get("round", 0) + 1, self._who(job)
        await self._busy(job, "contacting" if rnd == 1 else "negotiating")
        await self._sset(job, round=rnd, last_offer=price, outstanding=True, offer_ts=time.time(), next_offer=None)
        if rnd == 1:
            dl = f" Deadline: {job['deadline'][:10]}." if job.get("deadline") else ""
            text = (f"Hi {who.split()[0]}, I would like to hire you for \"{job['title']}\". {job['description'][:300]} "
                    f"My offer is {self._m(job, price)}.{dl} Does that work?")
        else:
            text = f"Thanks for coming back. I can go up to {self._m(job, price)}, which is close to the top of my range."
        await self._say(job, "offer", text, price)
        await self._push(job, "offers", {"round": rnd, "by": "agent", "price": price, "message": text, "ts": time.time(),
                                         "candidate_id": s.get("cand")})
        await self._log(job, "info", f"Round {rnd}: offered {self._m(job, price)} to {who}")
        await self._wait(job, "freelancer_reply")
        return True

    async def _on_counter(self, job, msg: Dict[str, Any]) -> None:
        s, c = job["_s"], msg.get("price")
        who, ceil, target = self._who(job), self._ceiling(job), float(job["budget"])
        if not c or c <= 0:
            await self._log(job, "warn", f"{who} replied without a price: {msg['text'][:120]}")
            return  # offer stays open
        last, rnd = float(s.get("last_offer") or 0), s.get("round", 1)
        await self._sset(job, last_counter=c, outstanding=False)
        await self._log(job, "info", f"{who} countered with {self._m(job, c)}")
        if c <= target or c <= last:
            await self._log(job, "success", f"{self._m(job, c)} is within budget. Accepting.")
            return await self._agree(job, c)
        if c <= ceiling_ok(ceil):
            if rnd >= 3 or (c - last) / c <= 0.08:
                await self._log(job, "success", f"{self._m(job, c)} is above budget but inside your max {self._m(job, ceil)} and the gap is small. Accepting.")
                return await self._agree(job, c)
            nxt = min(ceil, _r(last + (c - last) * 0.5))
            nxt = nxt if nxt > last else min(ceil, c)
            await self._sset(job, next_offer=nxt)
            await self._log(job, "info", f"Above budget but within max {self._m(job, ceil)}. Countering at {self._m(job, nxt)}.")
            return
        # above the ceiling
        if last >= ceil or rnd >= MAX_ROUNDS:
            return await self._ask_over_budget(job, c)
        nxt = ceil if ceil - last < 0.05 * ceil else min(ceil, _r(last + (ceil - last) * 0.6))
        await self._sset(job, next_offer=nxt)
        await self._log(job, "warn", f"{self._m(job, c)} is above your max {self._m(job, ceil)}. Countering at {self._m(job, nxt)}.")

    async def _agree(self, job, price: float) -> None:
        price = _r(float(price))
        if price > self._ceiling(job) + 0.01:
            return await self._ask_over_budget(job, price)
        await self._save(job, agreedPrice=price)
        await self._sset(job, outstanding=False, assigned=False, revising=False, approved=False, validated_sub=None, val_errors=0)
        await self._say(job, "message", f"Great, we have a deal at {self._m(job, price)}. I will send the full brief now.", price)
        await self._log(job, "success", f"Deal agreed with {self._who(job)} at {self._m(job, price)}", "negotiate")
        await self._advance(job, "work")

    async def _next_candidate(self, job, reason: str) -> None:
        s = job["_s"]
        rejected = list(s.get("rejected", [])) + ([s["cand"]] if s.get("cand") else [])
        if job.get("freelancer"):
            await self._say(job, "message", "Thanks for your time. We will not be moving forward on this job.")
        await self._log(job, "warn", f"{reason}. Moving on.", "negotiate")
        nxt = next((c for c in job.get("candidates", []) if c["id"] not in rejected and c["match"] >= market.MIN_MATCH), None)
        if not nxt:
            await self._save(job, freelancer=None, agreedPrice=None, _s={"rejected": rejected})
            await self._fail(job, "negotiation_failed", f"{reason}, and there are no more candidates", "negotiate", retryable=True)
            return
        await self._save(job, agreedPrice=None)
        await self._select(job, nxt, rejected)

    # ------------------------------------------------------------------ WORK
    async def _do_work(self, job, now) -> bool:
        s = job["_s"]
        if not s.get("assigned"):
            await self._busy(job, "monitoring_work")
            crit = "\n".join(f"- {c}" for c in job.get("criteria", [])) or "- Matches the description"
            dl = f"\nDeadline: {job['deadline']}" if job.get("deadline") else ""
            files = job.get("files") or []
            att = ("\nAttached files: " + ", ".join(f["filename"] for f in files)) if files else ""
            await self._say(job, "assignment",
                f"Brief: {job['title']}\n{job['description']}\n\nAcceptance criteria:\n{crit}{dl}{att}\n"
                f"Agreed price: {self._m(job, job['agreedPrice'])}\n"
                "Reply with your submission (text and/or links).", job["agreedPrice"])
            await self._sset(job, assigned=True, work_ts=now)
            await self._log(job, "info", f"Sent the brief and {len(job.get('criteria', []))} acceptance criteria to {self._who(job)}")
            return True
        dl = _ts(job.get("deadline"))
        if dl and now > dl:
            return await self._fail(job, "deadline_missed", "The deadline passed before the work was submitted", "work")
        await self._wait(job, "revision" if s.get("revising") else "work_submission")
        return False

    # ------------------------------------------------------------------ VALIDATE
    async def _do_validate(self, job, now) -> bool:
        s, sub = job["_s"], job.get("submission")
        if not sub:
            await self._advance(job, "work")
            return True
        if s.get("validated_sub") == sub["ts"] and (job.get("lastValidation") or {}).get("passed"):
            if s.get("approved") or job.get("autoApprove", True):
                await self._log(job, "success", "Work approved. Moving to payment.")
                await self._advance(job, "payment")
                return True
            await self._wait(job, "your_approval")
            return False
        await self._busy(job, "validating")
        n = int(job.get("revisions", 0)) + 1
        await self._log(job, "info", f"Validating the submission against {len(job.get('criteria') or [1])} criteria (attempt {n})")
        try:
            v = await validate_submission(job)
        except Exception as e:  # noqa: BLE001
            errs = s.get("val_errors", 0) + 1
            await self._sset(job, val_errors=errs)
            if errs >= 3:
                return await self._fail(job, "other", f"The validator failed: {str(e)[:200]}", "validate", retryable=True)
            await self._log(job, "warn", f"Validator error, will retry: {str(e)[:120]}")
            return False
        await self._sset(job, val_errors=0, validated_sub=sub["ts"])
        await self._save(job, lastValidation=v)
        for c in v["criteria"]:
            await self._log(job, "success" if c["met"] else "warn",
                            ("PASS: " if c["met"] else "FAIL: ") + c["criterion"] + ("" if c["met"] else f" | {c['problem']}"))
        await self._log(job, "success" if v["passed"] else "warn", f"Score {v['score']}%. {v['summary']}")
        if not v["passed"]:
            await self._request_revision(job, v["fixes_text"], "the exact fixes")
        return True

    async def _request_revision(self, job, fixes_text: str, who: str) -> None:
        n = int(job.get("revisions", 0)) + 1
        if n > MAX_REVISIONS:
            await self._fail(job, "validation_failed", f"Work still failed validation after {MAX_REVISIONS} revisions", "validate")
            return
        await self._save(job, revisions=n)
        await self._say(job, "revision_request", f"Revision {n} of {MAX_REVISIONS}. Please fix exactly this and resubmit:\n{fixes_text}")
        await self._sset(job, revising=True, work_ts=time.time(), validated_sub=None)
        await self._log(job, "warn", f"Sent {who} to {self._who(job)} (revision {n} of {MAX_REVISIONS})")
        await self._save(job, stage="work", submission=None, progress=PROGRESS["work"], status="running",
                         activity=None, blockedOn=None, waitingSince=None)

    # ------------------------------------------------------------------ PAYMENT
    async def _do_payment(self, job, now) -> bool:
        p = job.get("payment") or {}
        amount, cur = float(job["agreedPrice"]), job["currency"]
        if p.get("status") == "paid":
            return await self._complete(job)
        if p.get("status") == "pending":
            st = await market.gateway.status(p["ref"])
            if st["status"] == "confirmed":
                await self._save(job, payment={**p, "status": "paid"})
                await self._log(job, "success", f"Payment {p['ref']} confirmed")
                return await self._complete(job)
            if st["status"] == "failed":
                return await self._pay_failed(job, p, st.get("error") or "Payment failed")
            await self._wait(job, "payment_confirmation")
            return False
        key = p.get("idem_key")
        if not key:
            key = f"{job['_id']}-{uuid.uuid4().hex[:12]}"
            p = {**p, "idem_key": key}
            await self._save(job, payment=p)          # persisted BEFORE charging (survives crashes)
        attempts = int(p.get("attempts", 0)) + 1
        await self._busy(job, "processing_payment" if attempts == 1 else "retrying_payment")
        await self._log(job, "info", f"Paying {self._m(job, amount)} to {self._who(job)} (attempt {attempts})")
        res = await market.gateway.charge(job, amount, cur, key)
        if res["status"] == "failed":
            return await self._pay_failed(job, {**p, "attempts": attempts}, res["error"], ambiguous=res.get("ambiguous", False))
        await self._save(job, payment={**p, "status": "pending", "ref": res["ref"], "attempts": attempts,
                                       "amount": amount, "error": None})
        await self._wait(job, "payment_confirmation")
        return True

    async def _pay_failed(self, job, p, err: str, ambiguous: bool = False) -> bool:
        p = dict(p)
        attempts = int(p.get("attempts", 1))
        if not ambiguous:               # definitive failure: next try is a NEW payment
            p.pop("idem_key", None)
            p.pop("ref", None)
        await self._log(job, "error", f"Payment attempt {attempts} failed: {err}")
        if attempts >= MAX_PAY_ATTEMPTS:
            await self._save(job, payment={**p, "status": "failed", "error": err})
            return await self._fail(job, "payment_failed",
                                    f"Payment failed after {attempts} attempts: {err}", "payment", retryable=True)
        await self._save(job, payment={**p, "status": "retry", "error": err, "attempts": attempts})
        await asyncio.sleep(1.0)
        return True
    async def _complete(self, job) -> bool:
        await self._say(job, "message", "Payment sent. Thank you, great working with you!")
        await self._save(job, status="completed", progress=100, activity=None, blockedOn=None, waitingSince=None)
        await self._log(job, "success", f"Job completed. Paid {self._m(job, job['agreedPrice'])} to {self._who(job)}", "payment")
        return False

    # ------------------------------------------------------------------ driver
    async def _auto_reply(self, job, cand: Dict[str, Any], last: Dict[str, Any]) -> Dict[str, Any]:
        """The AI agent answers for itself (offers go through the negotiator)."""
        agent = None
        try:
            agent = await self.db["agents"].find_one({"_id": ObjectId(cand["agent_id"])})
        except Exception:  # noqa: BLE001
            pass
        agent = agent or {"name": cand["name"], "skills": cand.get("skills", []), "description": cand.get("bio", "")}
        if last["type"] == "offer":
            hist = [o for o in job.get("offers", []) if o.get("candidate_id") == cand["id"]]
            d = await negotiator.decide_offer(agent, job, float(last["price"]), hist, int(last.get("round", 1)))
            return {"type": d["type"], "price": d["price"], "message": d["message"]}
        # assignment / revision: acknowledge. The work itself is uploaded by you (demo desk).
        return {"type": "message", "message": negotiator.ack_text(agent, job, last["type"])}

    async def _sim_reply(self, job, now) -> bool:
        cand = self._cand(job)
        if not cand or not cand.get("simulated"):
            return False
        last = next((m for m in reversed(job["thread"]) if m["dir"] == "out"
                     and m["type"] in ("offer", "assignment", "revision_request")), None)
        if not last or last.get("answered") or last.get("to") != cand["id"] or now < last.get("reply_at", 1e18):
            return False
        await self._tset(job, last["id"], answered=True)
        if cand.get("auto"):
            reply = await self._auto_reply(job, cand, last)
        else:
            reply = market.sim_reply(job, cand, last)
        await self._ingest(job, {"sender": "freelancer", **reply})
        return True

    async def _step(self, job) -> bool:
        st, now = job["status"], time.time()
        if st in ("draft", "completed", "failed"):
            return False
        if st == "scheduled":
            at = _ts(job.get("scheduledFor"))
            if at and now < at:
                return False
            await self._save(job, status="running", stage="hire", progress=2)
            await self._log(job, "info", "Scheduled time reached. Starting.", "hire")
            return True
        inbound = next((m for m in job["thread"] if m["dir"] == "in" and not m.get("processed")), None)
        if inbound:
            await self._tset(job, inbound["id"], processed=True)
            await self._on_inbound(job, inbound)
            return True
        if await self._sim_reply(job, now):
            return True
        handler = {"hire": self._do_hire, "negotiate": self._do_negotiate, "work": self._do_work,
                   "validate": self._do_validate, "payment": self._do_payment}[job["stage"]]
        return await handler(job, now)

    def wake(self, jid: str) -> None:
        t = asyncio.get_running_loop().create_task(self._run(jid))
        self._tasks.add(t)
        t.add_done_callback(self._tasks.discard)

    async def _run(self, jid: str) -> None:
        lock = self._lock(jid)
        if lock.locked():
            self._dirty.add(jid)  # the running loop will go again
            return
        async with lock:
            while True:
                self._dirty.discard(jid)
                for _ in range(40):
                    try:
                        job = await self._load(jid)
                    except JobError:
                        return
                    try:
                        if not await self._step(job):
                            break
                    except Exception as e:  # noqa: BLE001
                        log.exception("[Jobs] step crashed")
                        await self._fail(job, "other", f"Unexpected error: {str(e)[:200]}", retryable=True)
                        return
                if jid not in self._dirty:
                    break

    async def _tick_loop(self) -> None:
        while True:
            await asyncio.sleep(TICK_S)
            try:
                rows = await self.col.find({"status": {"$in": ["scheduled", "running", "waiting"]}}, {"_id": 1}).to_list(length=500)
                for r in rows:
                    self.wake(str(r["_id"]))
            except Exception as e:  # noqa: BLE001
                log.warning(f"[Jobs] ticker error: {e}")
                
    async def _ask_over_budget(self, job, price: float) -> None:
        ceil = self._ceiling(job)
        await self._sset(job, outstanding=False)
        await self._save(job, pendingApproval={
            "price": price, "max": ceil, "freelancer": self._who(job), "ts": time.time()})
        await self._log(job, "warn",
            f"{self._who(job)} needs {self._m(job, price)}, above your max {self._m(job, ceil)}. Waiting for your approval.")
        await self._say(job, "message",
            f"Thanks for your reply. {self._m(job, price)} is above what I'm authorised to pay, "
            "so I need to get my client's approval. I'll get back to you shortly.")
        await self._wait(job, "budget_approval")
    async def approve_budget(self, uid: str, jid: str) -> Dict[str, Any]:
        async with self._lock(jid):
            job = await self._load(jid, uid)
            pa = job.get("pendingApproval")
            if not pa or job["status"] != "waiting":
                raise JobError(409, "Nothing is waiting for a budget approval")
            price = float(pa["price"])
            await self._save(job, maxBudget=max(self._ceiling(job), price), pendingApproval=None,
                             status="running", blockedOn=None, waitingSince=None)
            await self._log(job, "success", f"You approved going above budget. Max raised to {self._m(job, price)}")
            await self._agree(job, price)
        self.wake(jid)
        return public(job)

    async def decline_budget(self, uid: str, jid: str) -> Dict[str, Any]:
        async with self._lock(jid):
            job = await self._load(jid, uid)
            pa = job.get("pendingApproval")
            if not pa or job["status"] != "waiting":
                raise JobError(409, "Nothing is waiting for a budget approval")
            await self._save(job, pendingApproval=None, status="running", blockedOn=None, waitingSince=None)
            await self._next_candidate(job, f"You declined {self._m(job, pa['price'])} (above your max)")
        self.wake(jid)
        return public(job)


def ceiling_ok(ceil: float) -> float:
    return ceil




engine = JobEngine()