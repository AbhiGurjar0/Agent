# app/ai/browser_agent.py
"""
BrowserAgentWorker: observe -> think -> act loop on a REAL (visible) persistent Chromium.

Payload:  {"goal": "play a feel good song on youtube", "start_url": "optional"}
Legacy payloads ({"actions": [...]}) are forwarded to the old BrowserWorker.

Setup:  pip install playwright && playwright install chromium
"""
import asyncio
import json
import re
from pathlib import Path
from typing import Any, Dict, List, Optional

from app.ai.worker import BaseWorker, NonRetryableError, _truncate

USER_DIR = Path("./workspace/browser_profile").resolve()      # keeps logins/cookies
DOWNLOAD_DIR = Path("./workspace/downloads").resolve()

# Things the agent must never click without a human (extend / wire to approval_manager).
RISKY = re.compile(r"\b(buy now|place order|pay|purchase|checkout|delete|remove account|send|post|publish|submit)\b", re.I)

SNAPSHOT_JS = """
() => {
  document.querySelectorAll('[data-agent-id]').forEach(e => e.removeAttribute('data-agent-id'));
  const sel = 'a[href],button,input,textarea,select,video,[role=button],[role=link],[role=tab],[role=menuitem],[contenteditable=true]';
  const out = []; let i = 0;
  for (const el of document.querySelectorAll(sel)) {
    const r = el.getBoundingClientRect(), st = getComputedStyle(el);
    if (r.width < 4 || r.height < 4 || st.visibility === 'hidden' || st.display === 'none') continue;
    if (r.bottom < 0 || r.top > innerHeight * 1.5) continue;
    el.setAttribute('data-agent-id', String(i));
    const text = (el.innerText || el.value || el.getAttribute('aria-label') || el.placeholder || el.title || '')
                   .trim().replace(/\\s+/g, ' ').slice(0, 90);
    out.push({id: i, tag: el.tagName.toLowerCase(), type: el.getAttribute('role') || el.type || '',
              text, href: el.tagName === 'A' ? (el.href || '').slice(0, 90) : ''});
    if (++i >= 70) break;
  }
  return out;
}
"""

SYSTEM = """You control a real Chrome browser to accomplish the user's goal.
Each turn you get the current URL, title, and a numbered list of visible interactive elements.
Reply with ONE JSON object, either
  {"thought": "<short>", "action": {...}}
or, when finished,
  {"done": true, "success": true|false, "result": "<what happened / extracted data>"}

Actions:
  {"type":"goto","url":"https://..."}
  {"type":"click","id":N}
  {"type":"type","id":N,"text":"...","enter":true|false}
  {"type":"press","key":"Enter|Escape|Space|..."}
  {"type":"scroll","direction":"down|up"}
  {"type":"wait","seconds":2}
  {"type":"extract"}                 -> returns visible page text
  {"type":"download","id":N}         -> clicks element and saves the downloaded file
  {"type":"verify_playing"}          -> checks a <video>/<audio> is actually playing

Rules:
- Prefer direct URLs (e.g. youtube.com/results?search_query=...) over clicking through UIs.
- Dismiss cookie/consent popups first if they block the page.
- Skip sponsored/ad results (text containing 'Sponsored' or 'Ad').
- To play media: open the video page, then call verify_playing. Do NOT report success before it returns true.
- Never click buy/pay/delete/send/post/submit controls. Finish with success=false and say confirmation is needed.
- If an action errored, try a different approach; never repeat the same failing action.
"""


class _BrowserHost:
    """One long-lived browser per server process, so media keeps playing after a step ends."""
    _pw = None
    _ctx = None
    _lock = asyncio.Lock()

    @classmethod
    async def context(cls):
        async with cls._lock:
            if cls._ctx is None:
                from playwright.async_api import async_playwright
                USER_DIR.mkdir(parents=True, exist_ok=True)
                DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)
                cls._pw = await async_playwright().start()
                cls._ctx = await cls._pw.chromium.launch_persistent_context(
                    str(USER_DIR),
                    headless=False,
                    accept_downloads=True,
                    downloads_path=str(DOWNLOAD_DIR),
                    args=["--autoplay-policy=no-user-gesture-required"],
                )
                cls._ctx.on("close", lambda *_: setattr(cls, "_ctx", None))  # user closed the window
            return cls._ctx


class BrowserAgentWorker(BaseWorker):
    name = "browser_agent"
    max_retries = 1            # the loop does its own recovery; don't re-run the whole task
    refine_on_error = False
    llm_timeout = 45.0
    MAX_STEPS = 15

    def __init__(self, legacy: Optional[BaseWorker] = None):
        self.legacy = legacy
        self._task_lock = asyncio.Lock()   # one agent drives the visible browser at a time

    # ---------------------------------------------------------------- helpers
    @staticmethod
    async def _page(ctx):
        pages = [p for p in ctx.pages if not p.is_closed()]
        return pages[-1] if pages else await ctx.new_page()   # follows new tabs

    @staticmethod
    async def _snapshot(page) -> List[Dict[str, Any]]:
        for _ in range(2):
            try:
                await page.wait_for_load_state("domcontentloaded", timeout=5000)
                return await page.evaluate(SNAPSHOT_JS)
            except Exception:
                await asyncio.sleep(1)
        return []

    async def _decide(self, goal, page, elements, history, last) -> Dict[str, Any]:
        listing = "\n".join(
            f'[{e["id"]}] <{e["tag"]}{" " + e["type"] if e["type"] else ""}> {e["text"]}'
            + (f' -> {e["href"]}' if e["href"] else "")
            for e in elements
        ) or "(no interactive elements visible)"
        user = (
            f"GOAL: {goal}\nURL: {page.url}\nTITLE: {await page.title()}\n"
            f"RECENT ACTIONS:\n{chr(10).join(history[-6:]) or '(none)'}\n"
            f"LAST RESULT: {last or '(none)'}\n\nELEMENTS:\n{listing}"
        )
        raw = await self._chat(
            [{"role": "system", "content": SYSTEM}, {"role": "user", "content": user}], json_mode=True
        )
        m = re.search(r"\{.*\}", raw, re.S)
        return json.loads(m.group(0)) if m else {}

    async def _act(self, page, a: Dict[str, Any], elements) -> str:
        t = a.get("type")
        by_id = {e["id"]: e for e in elements}

        def loc():
            if a.get("id") not in by_id:
                raise RuntimeError(f"No element with id {a.get('id')} on the current page.")
            return page.locator(f'[data-agent-id="{a["id"]}"]').first

        if t == "goto":
            url = a.get("url", "")
            if not re.match(r"^https?://", url, re.I):
                raise RuntimeError("Only http(s) URLs allowed.")
            await page.goto(url, wait_until="domcontentloaded", timeout=30000)
            return f"Navigated to {url}"
        if t in ("click", "download"):
            label = by_id.get(a.get("id"), {}).get("text", "")
            if RISKY.search(label):
                return f"BLOCKED: '{label}' needs explicit user confirmation. Finish with success=false."
            if t == "click":
                await loc().click(timeout=8000)
                await asyncio.sleep(1.2)
                return f"Clicked [{a['id']}] {label}"
            async with page.expect_download(timeout=30000) as dl:
                await loc().click(timeout=8000)
            d = await dl.value
            dest = DOWNLOAD_DIR / d.suggested_filename
            await d.save_as(str(dest))
            return f"Downloaded file to {dest}"
        if t == "type":
            el = loc()
            await el.fill(a.get("text", ""), timeout=8000)
            if a.get("enter"):
                await el.press("Enter")
                await asyncio.sleep(1.2)
            return f"Typed into [{a['id']}]"
        if t == "press":
            await page.keyboard.press(a.get("key", "Enter"))
            await asyncio.sleep(0.8)
            return f"Pressed {a.get('key')}"
        if t == "scroll":
            await page.mouse.wheel(0, 700 if a.get("direction", "down") == "down" else -700)
            await asyncio.sleep(0.5)
            return "Scrolled"
        if t == "wait":
            await asyncio.sleep(min(float(a.get("seconds", 2)), 10))
            return "Waited"
        if t == "extract":
            return _truncate(await page.inner_text("body"), 6000)
        if t == "verify_playing":
            await page.evaluate("() => { const v=document.querySelector('video,audio'); if(v&&v.paused) v.play().catch(()=>{}); }")
            await asyncio.sleep(2)
            playing = await page.evaluate(
                "() => { const v=document.querySelector('video,audio'); return !!v && !v.paused && v.currentTime>0; }"
            )
            return "PLAYING" if playing else "NOT PLAYING (try clicking the player or dismissing a popup)"
        raise RuntimeError(f"Unknown action type: {t}")

    # ---------------------------------------------------------------- entry
    async def execute(self, payload: Dict[str, Any], context: Dict[str, Any]) -> str:
        goal = payload.get("goal") or payload.get("task") or payload.get("prompt")
        start_url = payload.get("start_url")
        if not goal and payload.get("actions"):
            acts = payload["actions"]
            goal = "Accomplish the following using the live page (treat as intent, not      exact selectors): " + json.dumps(acts)
            first = next((a for a in acts if a.get("type") == "goto"), None)
            start_url = start_url or (first or {}).get("url")

        if not goal:
            raise NonRetryableError("Browser step needs a 'goal'.")
        if context:
            goal += "\n(Data from earlier steps: " + _truncate(json.dumps(context, default=str), 2000) + ")"

        async with self._task_lock:
            ctx = await _BrowserHost.context()
            page = await self._page(ctx)
            if start_url:
                await page.goto(start_url, wait_until="domcontentloaded", timeout=30000)

            history: List[str] = []
            last, repeats, prev = "", 0, None
            for step in range(1, self.MAX_STEPS + 1):
                page = await self._page(ctx)
                elements = await self._snapshot(page)
                d = await self._decide(goal, page, elements, history, last)

                if d.get("done"):
                    if d.get("success", True):
                        return d.get("result") or "Done."
                    raise NonRetryableError(d.get("result") or "Agent reported failure.")

                action = d.get("action") or {}
                key = json.dumps(action, sort_keys=True)
                repeats = repeats + 1 if key == prev else 0
                prev = key
                if repeats >= 2:
                    raise RuntimeError(f"Agent is stuck repeating {key}")

                try:
                    last = await self._act(page, action, elements)
                except Exception as e:
                    last = f"ERROR: {str(e)[:300]}"
                history.append(f"{step}. {key} -> {last[:120]}")
                print(f"🌐 [BrowserAgent] {history[-1]}")

            raise RuntimeError(f"Browser agent ran out of steps ({self.MAX_STEPS}). Last: {last}")