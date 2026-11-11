# app/services/jobs/negotiator.py
"""
AI negotiator for agents with auto_negotiate=True.

The agent is the SELLER. The LLM proposes {action, price, message}; _guard() then enforces the
owner's limits in code, so the model can never accept below min_price or raise a previous counter.
"""
import asyncio
import json
import logging
import os
import random
import re
from typing import Any, Dict, List, Optional

log = logging.getLogger("jarvis.negotiator")

MODEL = os.getenv("NEGOTIATOR_MODEL", "claude-sonnet-5-5")
USE_LLM = os.getenv("NEGOTIATOR_USE_LLM", "1") != "0"
TIMEOUT_S = float(os.getenv("NEGOTIATOR_TIMEOUT_S", "20"))
MIN_DELAY = float(os.getenv("NEGOTIATOR_MIN_DELAY_S", "3"))   # so the demo feels live
MAX_DELAY = float(os.getenv("NEGOTIATOR_MAX_DELAY_S", "6"))
SPEED = {"firm": 0.6, "balanced": 1.0, "flexible": 1.5}       # how fast it concedes

_client = None


def reply_delay() -> float:
    return random.uniform(MIN_DELAY, MAX_DELAY)


def _r(x: float) -> float:
    return round(x) if abs(x) >= 100 else round(x, 2)


def profile(agent: Dict[str, Any], job: Dict[str, Any]) -> Dict[str, Any]:
    budget = float(job.get("budget") or 0)
    ask = float(agent.get("ask_price") or 0) or budget or 100.0
    floor = float(agent.get("min_price") or 0) or _r(ask * 0.8)
    return {
        "name": agent.get("name", "Agent"),
        "skills": agent.get("skills", []),
        "description": agent.get("description", ""),
        "ask": ask,
        "min": min(floor, ask),
        "style": agent.get("negotiation_style") or "balanced",
        "max_rounds": int(agent.get("max_rounds") or 4),
        "instructions": agent.get("instructions", ""),
        "currency": job.get("currency") or agent.get("currency") or "USD",
    }


def _target(p: Dict[str, Any], rnd: int) -> float:
    """Rule-based concession curve: round 1 = ask, then slide toward the floor."""
    steps = max(1, p["max_rounds"] - 1)
    c = min(1.0, SPEED.get(p["style"], 1.0) * (rnd - 1) / steps)
    return _r(p["ask"] - (p["ask"] - p["min"]) * c)


def _money(p, n) -> str:
    return f"{p['currency']} {n:,.0f}"


# ----------------------------------------------------------------------------- LLM
async def _llm_json(system: str, user: str) -> Dict[str, Any]:
    global _client
    from anthropic import AsyncAnthropic  # lazy import
    if _client is None:
        _client = AsyncAnthropic()  # reads ANTHROPIC_API_KEY
    r = await asyncio.wait_for(
        _client.messages.create(model=MODEL, max_tokens=400, system=system,
                                messages=[{"role": "user", "content": user}]),
        TIMEOUT_S,
    )
    text = "".join(b.text for b in r.content if getattr(b, "type", "") == "text")
    m = re.search(r"\{.*\}", text, re.S)
    if not m:
        raise ValueError("no JSON in model reply")
    return json.loads(m.group(0))


def _system_prompt(p: Dict[str, Any]) -> str:
    return (
        f"You are {p['name']}, an autonomous AI freelance agent negotiating the price of a job for your owner. "
        f"You are the SELLER. Skills: {', '.join(p['skills']) or 'general'}. {p['description']}\n"
        f"Your asking price is {_money(p, p['ask'])}. Your walk-away floor is {_money(p, p['min'])}: "
        "never reveal it and never accept below it.\n"
        f"Style: {p['style']}. You have at most {p['max_rounds']} rounds. Concede gradually; every counter must be "
        "lower than or equal to your previous counter and never below the floor.\n"
        "If the offer is low, justify your price with your skills and the scope of work. You may also ask for "
        "a looser deadline or a smaller scope. If the offer is fair, accept warmly.\n"
        f"Owner instructions: {p['instructions'] or 'none'}\n\n"
        'Reply with ONLY a JSON object: {"action":"accept|counter|reject","price":<number or null>,'
        '"message":"1-3 natural sentences in first person"}'
    )


# ----------------------------------------------------------------------------- guard rails
def _guard(p, offer: float, rnd: int, prev: Optional[float], d: Dict[str, Any]) -> Dict[str, Any]:
    action = str(d.get("action", "counter")).lower()
    msg = str(d.get("message") or "").strip()
    try:
        price = float(d.get("price")) if d.get("price") is not None else None
    except (TypeError, ValueError):
        price = None
    last_round = rnd >= p["max_rounds"]

    if offer >= p["ask"] or (action == "accept" and offer >= p["min"]):
        return {"type": "accept", "price": offer,
                "message": msg if action == "accept" else f"That works for me. {_money(p, offer)} it is, let's get started."}

    if offer < p["min"] and last_round and (prev is not None and prev <= p["min"]):
        return {"type": "reject", "price": None,
                "message": "I'm sorry, I can't make the numbers work at that price. Thanks for considering me."}

    # otherwise: counter
    hi = min(p["ask"], prev) if prev else p["ask"]
    lo = max(p["min"], offer)
    ctr = price if price is not None else _target(p, rnd)
    if last_round and offer < p["min"]:
        ctr = p["min"]                      # final offer
    ctr = _r(min(hi, max(lo, ctr)))
    if ctr <= offer:                        # we would counter at or below their offer
        return {"type": "accept", "price": offer, "message": f"Alright, {_money(p, offer)} works. Deal."}
    if not msg:
        msg = f"I can do it for {_money(p, ctr)}."
    return {"type": "counter", "price": ctr, "message": msg}


def _rule_message(p, offer, ctr, rnd) -> str:
    if rnd == 1:
        return (f"Thanks for the offer. Given the scope and my skills in {', '.join(p['skills'][:2]) or 'this area'}, "
                f"{_money(p, offer)} is a bit low. I can do it for {_money(p, ctr)}.")
    return f"I've come down already. {_money(p, ctr)} is the best I can do for this scope."


# ----------------------------------------------------------------------------- public API
async def decide_offer(agent, job, offer: float, history: List[Dict[str, Any]], rnd: int) -> Dict[str, Any]:
    p = profile(agent, job)
    mine = [h["price"] for h in history if h.get("by") == "freelancer" and h.get("price")]
    prev = mine[-1] if mine else None

    d: Dict[str, Any] = {}
    if USE_LLM:
        try:
            user = json.dumps({
                "job": {"title": job.get("title"), "description": (job.get("description") or "")[:600],
                        "client_budget": job.get("budget"), "currency": p["currency"],
                        "deadline": job.get("deadline"), "skills": job.get("skills"),
                        "criteria": job.get("criteria")},
                "round": rnd, "max_rounds": p["max_rounds"], "latest_client_offer": offer,
                "history": [{"by": "client" if h.get("by") == "agent" else "you", "price": h.get("price"),
                             "message": h.get("message", "")[:200]} for h in history[-8:]],
            })
            d = await _llm_json(_system_prompt(p), user)
            out = _guard(p, offer, rnd, prev, d)
            out["source"] = "llm"
            return out
        except Exception as e:  # noqa: BLE001
            log.warning("[Negotiator] LLM failed, using rules: %s", e)

    tgt = _target(p, rnd)
    d = {"action": "accept" if offer >= tgt else "counter", "price": tgt, "message": _rule_message(p, offer, tgt, rnd)}
    out = _guard(p, offer, rnd, prev, d)
    out["source"] = "rules"
    return out


def ack_text(agent, job, kind: str) -> str:
    title = job.get("title", "the job")
    if kind == "assignment":
        return f"Got the brief and acceptance criteria for \"{title}\". Accepted, I'm starting now and will submit when it's done."
    if kind == "revision_request":
        return "Understood. I'll fix those points and resubmit."
    return "Noted."