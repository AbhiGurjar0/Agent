# app/services/jobs/agent_provider.py
"""
Marketplace provider that hires from the agents YOU added (the `agents` collection),
instead of the fake CATALOG in job_market.py.

- Candidates are your agents, scored against the job's skills / description.
- Rating comes from their track record on past jobs (4.5 until they have history).
- AGENTS_SIMULATE_REPLIES=1 (default): the engine auto-replies on the agent's behalf, so the
  whole flow (offer -> haggling -> delivery -> validation -> payment) runs end to end.
- AGENTS_SIMULATE_REPLIES=0: the engine waits for a real reply. Post it to
  POST /jobs/{id}/reply with {"sender": "freelancer", ...} from your agent's webhook.
"""
import os
from typing import Any, Dict, List

SIMULATE = os.getenv("AGENTS_SIMULATE_REPLIES", "1") != "0"


class AgentsProvider:
    name = "agents"
    simulated = SIMULATE
    db = None  # set by the engine in bind()

    async def search(self, job: Dict[str, Any]) -> List[Dict[str, Any]]:
        from app.services.jobs.job_market import _score  # lazy: avoids a circular import

        if self.db is None:
            return []
        uid = job.get("user_id")
        agents = await self.db["agents"].find({"user_id": uid}).to_list(length=200)
        if not agents:
            return []

        # track record per agent, from jobs the engine already ran with them
        record: Dict[str, Dict[str, int]] = {}
        rows = await self.db["jobs"].find(
            {"user_id": uid, "freelancer.id": {"$regex": "^agent_"}},
            {"freelancer.id": 1, "status": 1},
        ).to_list(length=2000)
        for r in rows:
            rec = record.setdefault(r["freelancer"]["id"], {"done": 0, "failed": 0})
            if r.get("status") == "completed":
                rec["done"] += 1
            elif r.get("status") == "failed":
                rec["failed"] += 1

        budget = float(job.get("budget") or 0) or 100.0
        skills = [s.lower() for s in job.get("skills", [])]
        text = f"{job.get('title', '')} {job.get('description', '')}".lower()

        out = []
        for a in agents:
            cid = f"agent_{a['_id']}"
            rec = record.get(cid, {"done": 0, "failed": 0})
            total = rec["done"] + rec["failed"]
            rating = 4.5 if total == 0 else round(3.0 + 2.0 * rec["done"] / total, 1)
            cskills = [s.lower() for s in a.get("skills", [])]
            desc = a.get("description", "") or ""
            auto = bool(a.get("auto_negotiate"))
            out.append({
                "id": cid,
                "agent_id": str(a["_id"]),
                "provider": self.name,
                "auto": auto,
                "simulated": auto,          # only auto agents answer by themselves; the rest wait for YOU
                "name": a["name"],
                "paypal_email": a.get("paypal_email"),
                "title": ", ".join(a.get("skills", [])[:3]) or "Agent",
                "rating": rating,
                "jobs_done": rec["done"],
                "skills": a.get("skills", []),
                "ask_price": a.get("ask_price"),
                "typical_rate": budget,
                "bio": desc or f"{a['name']}, one of your agents.",
                "match": self._match(skills, text, cskills, f"{a['name']} {desc}".lower(), rating, budget, _score),
            })
        return out

    @staticmethod
    def _match(skills, text, cskills, blob, rating, budget, score_fn) -> int:
        """_score() gives every agent ~25 points from rating and budget alone, which is above
        MIN_MATCH. So an agent with no skill overlap at all must not look hireable."""
        ctext = " ".join(cskills) + " " + blob
        relevant = any(sk in ctext or any(sk in c or c in sk for c in cskills) for sk in skills) or any(
            c in text for c in cskills
        )
        score = score_fn(skills, text, cskills, blob, rating, budget, budget)
        return score if relevant else min(score, 10)

    async def deliver(self, job: Dict[str, Any], cand: Dict[str, Any], msg: Dict[str, Any]) -> None:
        """Outbound messages are already stored in the job thread. Add a webhook call here
        if your agent should be notified when it gets an offer or a brief."""
        return None


agents_provider = AgentsProvider()