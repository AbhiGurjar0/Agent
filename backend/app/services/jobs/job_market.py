# app/services/job_market.py
"""
Freelancer marketplace + payment adapters.

SimulatedProvider gives you a working end-to-end demo (candidates, haggling, delivery).
To go live, subclass MarketProvider (search + deliver), add it to PROVIDERS, and feed real
replies into POST /jobs/{id}/reply (sender="freelancer") from your webhook/inbox poller.
Same idea for PaymentGateway: replace SimulatedGateway with Razorpay / Stripe / UPI.
"""
import asyncio
import hashlib
import os
import random
import time
import uuid
from typing import Any, Dict, List
from app.services.jobs.agent_provider import agents_provider   
from app.services.jobs.paypal_gateway import PayPalGateway

MIN_MATCH = 20  # candidates below this match % are never hired

# name, title, skills, rating, jobs_done, typical rate as a fraction of the budget
CATALOG = [
    ("Aarav Mehta", "Full-stack developer", ["react", "next.js", "typescript", "python", "fastapi", "node.js", "mongodb", "web development", "api"], 4.9, 212, 1.1),
    ("Sofia Rossi", "UI/UX designer", ["ui design", "ux", "figma", "branding", "logo design", "landing page", "mockups", "design"], 4.8, 164, 1.0),
    ("Kenji Tanaka", "Mobile developer", ["react native", "flutter", "ios", "android", "mobile app", "swift", "kotlin"], 4.7, 98, 1.2),
    ("Priya Nair", "Content writer", ["writing", "copywriting", "blog", "seo", "content", "editing", "articles"], 4.9, 320, 0.7),
    ("Lucas Meyer", "Video editor", ["video editing", "after effects", "premiere", "motion graphics", "youtube", "reels", "animation"], 4.6, 141, 0.9),
    ("Ananya Sharma", "Data analyst", ["data analysis", "python", "excel", "sql", "dashboards", "power bi", "research", "statistics"], 4.8, 87, 0.95),
    ("Omar Haddad", "Translator", ["translation", "arabic", "english", "french", "localization", "proofreading"], 4.7, 203, 0.6),
    ("Emily Carter", "Digital marketer", ["marketing", "seo", "social media", "ads", "email marketing", "growth", "content"], 4.5, 119, 0.85),
    ("Rohan Gupta", "Backend engineer", ["python", "django", "fastapi", "postgresql", "aws", "docker", "automation", "scraping", "backend"], 4.8, 176, 1.15),
    ("Chloe Dubois", "Illustrator", ["illustration", "logo design", "branding", "character design", "graphic design", "design"], 4.7, 132, 0.9),
    ("Vikram Singh", "AI / ML engineer", ["machine learning", "python", "llm", "ai", "chatbot", "automation", "data science", "nlp"], 4.9, 64, 1.4),
    ("Nora Lindqvist", "Virtual assistant", ["research", "data entry", "scheduling", "admin", "excel", "writing", "customer support"], 4.6, 410, 0.5),
]


def _r(x: float) -> float:
    return round(x) if abs(x) >= 100 else round(x, 2)


def _rng(*parts: Any) -> random.Random:
    return random.Random(int(hashlib.md5("|".join(map(str, parts)).encode()).hexdigest()[:12], 16))


def _score(job_skills: List[str], text: str, cskills: List[str], title: str, rating: float, rate: float, budget: float) -> int:
    ctext = " ".join(cskills) + " " + title.lower()
    hits = sum(1 for s in job_skills if s in ctext or any(s in c or c in s for c in cskills))
    by_skills = hits / len(job_skills) if job_skills else 0.0
    by_text = min(1.0, sum(1 for c in cskills if c in text) / 3)
    frac = max(by_skills, by_text)
    rate_fit = 1.0 if rate <= budget else max(0.0, 1 - (rate - budget) / max(budget, 1))
    quality = max(0.0, min(1.0, (rating - 4.0)))
    return int(round(100 * (0.65 * frac + 0.2 * quality + 0.15 * rate_fit)))


class MarketProvider:
    name = "base"
    simulated = False

    async def search(self, job: Dict[str, Any]) -> List[Dict[str, Any]]:
        raise NotImplementedError

    async def deliver(self, job: Dict[str, Any], cand: Dict[str, Any], msg: Dict[str, Any]) -> None:
        """Send an outbound message (offer / brief / fixes) to the real freelancer."""
        raise NotImplementedError


class SimulatedProvider(MarketProvider):
    name = "simulated"
    simulated = True

    async def search(self, job: Dict[str, Any]) -> List[Dict[str, Any]]:
        budget = float(job.get("budget") or 0) or 100.0
        skills = [s.lower() for s in job.get("skills", [])]
        text = f"{job.get('title', '')} {job.get('description', '')}".lower()
        out = []
        for name, title, cskills, rating, done, rate in CATALOG:
            cid = "sim_" + hashlib.md5(name.encode()).hexdigest()[:8]
            rng = _rng(job["_id"], cid)
            typical = _r(budget * rate * rng.uniform(0.85, 1.1))
            out.append({
                "id": cid, "provider": self.name, "simulated": True, "name": name, "title": title,
                "rating": rating, "jobs_done": done, "skills": cskills, "typical_rate": typical,
                "bio": f"{title} with {done} completed jobs. Strong in {', '.join(cskills[:4])}.",
                "match": _score(skills, text, cskills, title, rating, typical, budget),
            })
        return out


PROVIDERS: List[MarketProvider] = [agents_provider]  


async def search_all(job: Dict[str, Any]) -> List[Dict[str, Any]]:
    results = await asyncio.gather(*(p.search(job) for p in PROVIDERS), return_exceptions=True)
    seen, merged = set(), []
    for res in results:
        if isinstance(res, Exception):
            continue
        for c in res:
            if c["id"] not in seen:
                seen.add(c["id"])
                merged.append(c)
    merged.sort(key=lambda c: -c["match"])
    return merged[:8]


async def deliver(job: Dict[str, Any], cand: Dict[str, Any], msg: Dict[str, Any]) -> None:
    for p in PROVIDERS:
        if p.name == cand.get("provider") and not p.simulated:
            await p.deliver(job, cand, msg)


# ------------------------------------------------------------------ simulated freelancer brain
def persona(job: Dict[str, Any], cand: Dict[str, Any]) -> Dict[str, Any]:
    rng = _rng(job["_id"], cand["id"], "persona")
    budget = float(job.get("budget") or 100)
    reserve = _r(budget * rng.uniform(0.72, 1.12))
    return {"reserve": reserve, "ask": _r(reserve * rng.uniform(1.2, 1.35)),
            "patience": rng.choice([3, 4, 5]), "sloppy": rng.random() < 0.6}


def sim_delay(msg_type: str) -> float:
    return {"offer": random.uniform(4, 9), "assignment": random.uniform(25, 45),
            "revision_request": random.uniform(20, 35)}.get(msg_type, 5.0)


def sim_reply(job: Dict[str, Any], cand: Dict[str, Any], last_out: Dict[str, Any]) -> Dict[str, Any]:
    p, cur, t = persona(job, cand), job.get("currency", "USD"), last_out["type"]
    if t == "offer":
        price, rnd = float(last_out["price"]), int(last_out.get("round", 1))
        if price >= p["reserve"]:
            return {"type": "accept", "price": price, "text": f"That works for me. Happy to do it for {cur} {price:,.0f}."}
        if rnd >= p["patience"] and price < p["reserve"] * 0.9:
            return {"type": "reject", "text": "Sorry, that is below what I can take for this scope."}
        counter = _r(max(p["reserve"], p["ask"] - (p["ask"] - p["reserve"]) * min(1.0, rnd * 0.4)))
        if counter <= price:
            return {"type": "accept", "price": price, "text": f"Okay, {cur} {price:,.0f} it is."}
        return {"type": "counter", "price": counter,
                "text": f"Thanks for the offer. For this scope I would need {cur} {counter:,.0f}."}
    # assignment / revision_request -> deliver
    crit = list(job.get("criteria") or [])
    revising = t == "revision_request"
    lines = [f"Delivery for: {job.get('title', '')}"]
    skip = crit[-1] if (crit and len(crit) >= 2 and p["sloppy"] and not revising) else None
    for c in crit:
        if c != skip:
            lines.append(f"- DONE: {c}. Implemented and checked.")
    if skip:
        lines.append("- Note: the last item is mostly done, I will polish it later.")
    if not crit:
        lines.append(f"- Completed the work as described: {job.get('description', '')[:200]}")
    return {"type": "submission", "text": "\n".join(lines), "links": []}


# ------------------------------------------------------------------ payments
class SimulatedGateway:
    FAIL_RATE = float(os.getenv("SIM_PAYMENT_FAIL_RATE", "0"))

    async def charge(self, job: Dict[str, Any], amount: float, currency: str, idem: str) -> Dict[str, Any]:
        if random.random() < self.FAIL_RATE:
            return {"status": "failed", "ref": None, "error": "Payment declined (simulated)"}
        return {"status": "pending", "ref": f"pay_{int(time.time())}_{uuid.uuid4().hex[:6]}", "error": None}

    async def status(self, ref: str) -> Dict[str, Any]:
        ts = int(ref.split("_")[1])
        return {"status": "confirmed" if time.time() - ts >= 3 else "pending", "error": None}


gateway = PayPalGateway()