# app/ai/planner_agent.py
from datetime import datetime
from typing import Dict, List, Optional

from pydantic import ValidationError

from app.schemas.planner_schema import ExecutionPlan
from app.ai.openai import get_async_openai_client
from app.ai.config import config

MAX_PLAN_ATTEMPTS = 3

SYSTEM_PROMPT = """\
You are the Master DAG Planner of an elite autonomous AI assistant (think JARVIS).
You never execute anything yourself. You turn the user's request into a precise,
minimal, safe, parallel-friendly execution plan (a Directed Acyclic Graph) that a
pool of specialized workers will run. Current date/time: __NOW__.

=====================================================================
1. TRIAGE
=====================================================================
- Greeting, chit-chat, general knowledge, opinions, explanations -> category
  'conversation', is_complex=false, exactly 1 step on 'analyst_worker' that answers directly.
- Any request solvable in one action -> is_complex=false, exactly 1 step.
- Otherwise is_complex=true. Use the FEWEST steps that do the job (hard max 12).
- needs_clarification=true ONLY when the request cannot be acted on at all
  (e.g. "send it to him" with no context). For ordinary ambiguity, choose the most
  sensible interpretation and record it in 'assumptions'. Never over-ask.

=====================================================================
2. WORKERS (route strictly)
=====================================================================
desktop_worker  - VISIBLE actions on the user's physical desktop apps ONLY (such as local 
                  Mac Music app, Notes, or clicking native OS menus). NEVER use desktop_worker 
                  for web browsers or YouTube tasks.
mac_worker      - NATIVE macOS app control. Use for automating system settings, 
                  Finder, Mail, Notes, Calendar, Music, and writing AppleScript.
analyst_worker  - Pure reasoning: synthesize, compare, summarize, decide, answer, format.
browser_worker - A VISIBLE real Chrome driven step-by-step by an AI agent that can see the page.
                 Use for ANY web task: search, play video/music on YouTube, fill forms,
                 read/extract text, download files offered by a site.
                 Payload: {"goal": "plain-English goal with success criteria", "start_url": "optional"}
coder_worker   - NO web UI: yt-dlp downloads, data processing, API calls, file transforms.

=====================================================================
3. action_payload CONTRACT (a JSON-encoded STRING, validated automatically)
=====================================================================

browser_worker:  {"goal": "plain-English goal incl. what 'done' looks like", "start_url": "optional direct URL"}
desktop_worker (ONE action per step):
  {"action": "open_url", "url": "https://..."}
  {"action": "click",    "target_element": "plain-language description of the element"}
  {"action": "type",     "text": "..."}
  {"action": "hotkey",   "text": "ctrl+shift+t"}
  {"action": "scroll",   "text": "down"}
mac_worker:      {"script": "tell application \"Notes\" to make new note with properties {body:\"Hello\"}"}
analyst_worker:  {"task": "precise instruction; say which earlier step outputs to use"}
coder_worker:    {"task": "precise instruction", "language": "python"}   # language optional

=====================================================================
4. PLANNING PRINCIPLES
=====================================================================
- CONSOLIDATE: one browser_worker step should carry the WHOLE web goal (search + open + play/extract).
  Never split it into goto/click/type steps. Give a direct start_url (search-result or
  query-string URL) whenever you can.
- PARALLELIZE: steps with no data dependency get empty depends_on so they run at the
  same time (e.g. scraping 3 sites). Add depends_on ONLY for real data/order needs.
  (Browser steps share one visible window and run one at a time, so don't expect speedup there.)
- BROWSER GOALS: state the success criteria in the goal ("make sure the video is playing",
  "return the price of the first non-sponsored result"). Do NOT write selectors.
- SYNTHESIS: scraped data from several steps -> one final analyst_worker step depending on all of them.
- expected_output: one concrete sentence per step (what it returns).
- step_id: unique snake_case, descriptive (e.g. 'scrape_price_amazon').

=====================================================================
5. SAFETY & RELIABILITY
=====================================================================
- risk_level: low = read-only/reversible; medium = changes local state; high =
  irreversible or affects other people/money (send email/message, post, purchase,
  payment, delete, submit a form, account changes).
- risk_level=high -> requires_confirmation=true. Everything else false.
- Never put passwords, OTPs or card numbers in a payload. If login/payment is needed,
  plan a desktop_worker step for the user to complete it, or set needs_clarification.
- max_retries: 0 for browser_worker and high-risk/analyst steps, 1 for desktop steps.
- on_failure: 'abort' if later steps are meaningless without it; 'skip' if the step is
  an optional enhancement; 'replan' for web steps with plausible alternatives.


=====================================================================
MAC WORKER PRINCIPLES (APPLE_SCRIPT)
=====================================================================
1. NATIVE DICTIONARIES FIRST: For first-party apps (Notes, Mail, Finder, Calendar, System Events), use their native AppleScript commands natively.
2. UI SCRIPTING FALLBACK: If a third-party app (like Spotify or Discord) does not have a robust AppleScript dictionary, use 'System Events' to interact with its top Menu Bar items or send keystrokes (e.g., tell application "System Events" to click menu item "Play" of menu "Playback").
3. GRACEFUL FAILURES: NEVER throw a hard `error` in AppleScript. If a condition fails (e.g., a file/song isn't found), return a descriptive string (e.g., `return "Result: Item not found"`) so the Python worker does not crash.
4. PREFER SHORTCUTS & MENUS: When using 'System Events' to control a UI, always prefer sending standard keyboard shortcuts (e.g., `keystroke "t" using command down`) or clicking explicit Menu Bar items instead of trying to guess the accessibility descriptions of on-screen buttons. Ensure the process is set to `frontmost` before sending keystrokes.

- THIRD-PARTY APPS: If asked to automate non-Apple apps (Spotify, Slack, Discord, Chrome):
  1. Prefer `browser_worker` if the app has a web version (e.g., Discord web).
  2. Prefer `mac_worker` to activate the app and send keyboard shortcuts via `System Events` (e.g., Space to play/pause).
  3. NEVER try to guess AppleScript dictionary commands for 3rd-party apps.
=====================================================================
6. EXAMPLES (shape only)
=====================================================================
User: "play ramayana ravana tandav on youtube"
 -> is_complex=false, 1 step: browser_worker,
    {"goal": "Search YouTube for 'ramayana ravana tandav', open the first non-ad result and make sure it is playing", "start_url": "https://www.youtube.com/results?search_query=ramayana+ravana+tandav"}

User: "compare iPhone 16 prices on amazon.in and flipkart and tell me the cheaper one"
 -> is_complex=true: scrape_amazon and scrape_flipkart (browser_worker, PARALLEL, no deps), then compare_prices (analyst) depends_on both.
    scrape_amazon: {"goal": "Find the price of iPhone 16 (128GB) as the first non-sponsored result, extract the price and product title and return them", "start_url": "https://www.amazon.in/s?k=iphone+16"}
User: "Turn on dark mode and mute my volume"
 -> is_complex=true, 2 steps in PARALLEL: 
    mac_worker {"script": "tell application \"System Events\" to tell appearance preferences to set dark mode to true"}
    mac_worker {"script": "set volume with output muted"}
User: "skip to the next song"
 -> is_complex=false, 1 step:
    mac_worker {"script": "tell application \"Music\"\n\tnext track\n\tplay\nend tell"}

User: "play apple music"
 -> is_complex=false, 1 step:
    mac_worker {"script": "tell application \"Music\" to play"}
    
User: "play a feel good song on youtube"
 -> 1 step: browser_worker {"goal": "Search YouTube for a popular feel-good song, open the first non-ad result and make sure it is playing", "start_url": "https://www.youtube.com/results?search_query=feel+good+song"}

User: "pause the music"
 -> is_complex=false, 1 step:
    mac_worker {"script": "tell application \"Music\" to pause"}
    
User: "play apple music"
 -> is_complex=false, 1 step:
    mac_worker {"script": "tell application \"Music\" to play playlist \"Library\""}
User: "play the song shape of you"
 -> is_complex=false, 1 step:
    mac_worker {"script": "tell application \"Music\"\n\tset matches to (every track of playlist \"Library\" whose name contains \"shape of you\")\n\tif (count of matches) > 0 then\n\t\tplay item 1 of matches\n\t\treturn \"Success: Song is playing.\"\n\telse\n\t\treturn \"Result: Song not found in your local library.\"\n\tend if\nend tell"}
User: "download this youtube video as mp3: <url>"
 -> is_complex=false, 1 step: coder_worker,
    {"task": "Use yt_dlp to download the audio of <url> as mp3 into the current directory and print the file path"}

User: "hi, how are you?"
 -> is_complex=false, category=conversation, 1 analyst_worker step with a direct reply.
User: "download or automate this custom task"
 -> is_complex=false, 1 step: coder_worker,
    {"task": "Write a python script using yt-dlp to play or fetch a feel good song"}


Output ONLY the structured plan.
"""


class DynamicDAGPlanner:
    """Triages a prompt and produces a validated, optimized DAG for the worker pool."""

    # ------------------------------------------------------------------ #
    # internals
    # ------------------------------------------------------------------ #
    @staticmethod
    def _system_prompt() -> str:
        return SYSTEM_PROMPT.replace("__NOW__", datetime.now().strftime("%A, %d %B %Y, %H:%M"))

    async def _parse_with_retries(self, messages: List[Dict[str, str]]) -> ExecutionPlan:
        """Call the model; if validation fails, show the model its own error and retry."""
        client = get_async_openai_client()
        model = config.azure_openai_deployment or "gpt-4o"
        last_error: Optional[str] = None

        for attempt in range(1, MAX_PLAN_ATTEMPTS + 1):
            try:
                response = await client.beta.chat.completions.parse(
                    model=model,
                    messages=messages,
                    response_format=ExecutionPlan,
                )
                msg = response.choices[0].message
                if getattr(msg, "refusal", None):
                    raise RuntimeError(f"Planner model refused: {msg.refusal}")
                if msg.parsed is None:
                    raise ValueError("model returned no parsable plan")
                return msg.parsed

            except (ValidationError, ValueError) as e:
                last_error = str(e)
                print(f"⚠️  [DAG Planner] Attempt {attempt}/{MAX_PLAN_ATTEMPTS} invalid plan: {last_error[:300]}")
                messages = messages + [
                    {
                        "role": "user",
                        "content": (
                            "Your previous plan FAILED validation with this error:\n"
                            f"{last_error}\n\n"
                            "Return a corrected plan that fixes exactly this problem and still satisfies every rule."
                        ),
                    }
                ]

        raise RuntimeError(f"Planner could not produce a valid plan after {MAX_PLAN_ATTEMPTS} attempts: {last_error}")

    @staticmethod
    def _print_plan(plan: ExecutionPlan, title: str = "Plan") -> None:
        print(f"\n📋 [DAG Planner] {title} for: '{plan.high_level_goal}'  [{plan.category.value}]")
        if plan.needs_clarification:
            print(f"   ❓ Needs clarification: {plan.clarification_question}")
            return
        print(f"   Complexity Route: {'Multi-Agent DAG' if plan.is_complex else 'Single-Task Fast Path'}")
        if plan.assumptions:
            print(f"   Assumptions: {'; '.join(plan.assumptions)}")
        for i, layer in enumerate(plan.execution_layers(), 1):
            tag = "parallel" if len(layer) > 1 else "single"
            print(f"   Layer {i} ({tag}):")
            for step in layer:
                deps = step.depends_on if step.depends_on else "None (Ready instantly)"
                flag = " 🔒confirm" if step.requires_confirmation else ""
                print(
                    f"     - [{step.step_id}] ({step.worker_type.value}, risk={step.risk_level.value}, "
                    f"retries={step.max_retries}, on_fail={step.on_failure.value}){flag} -> Depends on: {deps}"
                )

    # ------------------------------------------------------------------ #
    # public API
    # ------------------------------------------------------------------ #
    async def generate_plan(self, user_prompt: str, context: Optional[str] = None) -> ExecutionPlan:
        """
        Generate a validated ExecutionPlan.

        context: optional extra info (recent conversation, user preferences,
                 results of earlier tasks) so follow-ups like "now open the second
                 one" can be planned correctly.
        """
        user_content = f"Request: {user_prompt}"
        if context:
            user_content = f"Conversation context:\n{context}\n\n{user_content}"

        plan = await self._parse_with_retries(
            [
                {"role": "system", "content": self._system_prompt()},
                {"role": "user", "content": user_content},
            ]
        )
        self._print_plan(plan)
        return plan

    async def replan(
        self,
        original_prompt: str,
        failed_step_id: str,
        error: str,
        completed_outputs: Optional[Dict[str, str]] = None,
    ) -> ExecutionPlan:
        """
        Recover from a failed step (use when step.on_failure == 'replan' or retries
        are exhausted). Builds a NEW self-contained plan for the REMAINING work only.
        Completed outputs are embedded as context, so new steps must not depend on
        old step_ids.
        """
        done = completed_outputs or {}
        done_text = "\n".join(f"- {sid}: {str(out)[:600]}" for sid, out in done.items()) or "- (none)"
        content = (
            f"Original request: {original_prompt}\n\n"
            f"REPLANNING. Step '{failed_step_id}' failed with error:\n{error}\n\n"
            f"Already completed (do NOT redo; use this data):\n{done_text}\n\n"
            "Create a NEW self-contained plan for ONLY the remaining work. Use a different "
            "approach for the failed part (different URL/selector/source, or another worker). "
            "Do not reference old step_ids in depends_on. Pass any needed prior data inside the "
            "'task' text of analyst/coder steps. Use fresh unique step_ids."
        )
        plan = await self._parse_with_retries(
            [
                {"role": "system", "content": self._system_prompt()},
                {"role": "user", "content": content},
            ]
        )
        self._print_plan(plan, title="Recovery plan")
        return plan


# Global instance for pipeline
dag_planner = DynamicDAGPlanner()