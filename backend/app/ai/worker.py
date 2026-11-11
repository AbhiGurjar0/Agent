# app/ai/worker.py
"""
Upgraded workers. Same class names and same `execute` / `execute_with_adaptation`
signatures as before, so the orchestrator and the rest of your pipeline keep working.

New:
  * BaseWorker: smarter self-healing (backoff, error history, non-retryable errors, hints)
  * BrowserWorker: per-session locking, returns ALL extracted data (single result unchanged)
  * DesktopWorker: multi-action payloads, vision retries, verify-after-action, open_app,
    wait, cross-platform open_url, non-blocking GUI calls, failure detection
  * AnalystWorker: context budgeting/truncation, goal-aware, optional JSON output
  * APIWorker  (optional): HTTP calls with SSRF guard
  * FileWorker (optional): sandboxed read/write/list inside AGENT_WORKSPACE
"""
import asyncio
import inspect
import json
import os
import re
import subprocess
import sys
import time
import uuid
from collections import defaultdict
from pathlib import Path
from typing import Any, Dict, List, Optional

from app.ai.self_healing_agent import SelfHealingReActEngine
from app.tools.gui_tool import handle_gui_action

# Vision targeting
from app.tools.vision_tool import find_element_on_screen
from app.client_mic import capture_active_screen

# Model client + config
from app.ai.openai import get_async_openai_client
from app.ai.config import config


class NonRetryableError(RuntimeError):
    """Raise for errors where retrying / LLM-refining the payload cannot help."""


def _model() -> str:
    return config.azure_openai_deployment or "gpt-4o"


def _truncate(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    head = int(limit * 0.7)
    tail = limit - head
    return f"{text[:head]}\n…[{len(text) - limit} chars truncated]…\n{text[-tail:]}"


# =============================================================================
# Base
# =============================================================================
class BaseWorker:
    name = "worker"
    max_retries = 3
    refine_on_error = True          # let the LLM rewrite the payload after a failure
    payload_hint = ""               # describe the payload schema to the refiner
    retry_hint = ""                 # extra guidance for the refiner
    llm_timeout = 60.0

    async def execute(self, payload: Dict[str, Any], context: Dict[str, Any]) -> str:
        raise NotImplementedError

    async def _chat(self, messages: List[Dict[str, str]], json_mode: bool = False) -> str:
        client = get_async_openai_client()
        kwargs: Dict[str, Any] = {"model": _model(), "messages": messages}
        if json_mode:
            kwargs["response_format"] = {"type": "json_object"}
        resp = await asyncio.wait_for(client.chat.completions.create(**kwargs), timeout=self.llm_timeout)
        return resp.choices[0].message.content or ""

    async def _refine_payload_based_on_error(
        self, payload: Dict[str, Any], error_msg: str, history: Optional[List[str]] = None
    ) -> Dict[str, Any]:
        """Asks the LLM to rewrite the payload dictionary given the recent execution error."""
        past = "\n".join(history or [])
        prompt = (
            f"Worker type: {self.name}\n"
            f"Payload schema hint: {self.payload_hint or 'n/a'}\n"
            f"{('Extra guidance: ' + self.retry_hint) if self.retry_hint else ''}\n\n"
            f"An execution step failed with this error:\n{error_msg}\n\n"
            f"Previous attempts:\n{past or 'none'}\n\n"
            f"Original payload was:\n{json.dumps(payload, default=str)}\n\n"
            "Analyze the error and rewrite the payload dictionary to fix the issue. "
            "Do not repeat an approach that already failed. Keep the same intent. "
            "Return ONLY a valid JSON object matching the payload schema."
        )
        try:
            content = await self._chat(
                [
                    {"role": "system", "content": "You are a self-healing payload refiner. Output raw JSON only."},
                    {"role": "user", "content": prompt},
                ],
                json_mode=True,
            )
            content = re.sub(r"^```(?:json)?|```$", "", content.strip(), flags=re.M).strip()
            refined = json.loads(content) if content else None
            return refined if isinstance(refined, dict) and refined else payload
        except Exception:
            return payload  # fallback to original if refinement fails

    async def execute_with_adaptation(self, payload: Dict[str, Any], context: Dict[str, Any]) -> str:
        """Adaptive retry loop: catches errors, backs off, refines payload via LLM, retries."""
        payload = dict(payload)
        meta = payload.pop("_meta", None)  # orchestrator metadata; never shown to the refiner
        current = payload
        history: List[str] = []

        for attempt in range(1, self.max_retries + 1):
            try:
                call_payload = {**current, "_meta": meta} if meta else current
                return await self.execute(call_payload, context)
            except NonRetryableError:
                raise
            except Exception as e:
                history.append(f"attempt {attempt}: {e}")
                print(f"⚠️ [{self.name} Adaptive Loop] Attempt {attempt}/{self.max_retries} failed: {e}")
                if attempt == self.max_retries:
                    raise RuntimeError(
                        f"Task failed after {self.max_retries} adaptive attempts. Last error: {str(e)}"
                    )
                await asyncio.sleep(min(0.5 * 2 ** (attempt - 1), 4.0))
                if self.refine_on_error:
                    print("🔄 Refining payload for next attempt...")
                    current = await self._refine_payload_based_on_error(current, str(e), history)


# =============================================================================
# Browser
# =============================================================================
class BrowserWorker(BaseWorker):
    name = "browser"
    payload_hint = '{"actions": [ ...engine actions... ], "session_id": "optional string"}'

    def __init__(self):
        self.engine = SelfHealingReActEngine(max_retries=3)
        # Two parallel steps on the same browser session would fight each other.
        self._session_locks: Dict[str, asyncio.Lock] = defaultdict(asyncio.Lock)

    async def execute(self, payload: Dict[str, Any], context: Dict[str, Any]) -> str:
        """Executes browser navigation with self-healing support and clean data extraction."""
        actions = payload.get("actions", [])
        session_id = payload.get("session_id", "default")

        async with self._session_locks[session_id]:
            result = await self.engine.run_browser_action_with_healing(actions=actions, session_id=session_id)

        if result.get("status") in ["completed", "success"]:
            logs = result.get("log", [])
            extracted: List[str] = []
            for item in logs:
                if isinstance(item, dict):
                    for k, v in item.items():
                        if "extracted_data" in k:
                            extracted.append(str(v))
            if extracted:
                # one extraction -> identical to old behaviour
                return extracted[0] if len(extracted) == 1 else "\n\n---\n\n".join(extracted)
            return f"Browser Task Succeeded: {logs[-1] if logs else 'Done'}"

        raise RuntimeError(f"Browser Task Failed: {result.get('error', 'Unknown browser error')}")


# =============================================================================
# Desktop
# =============================================================================
class DesktopWorker(BaseWorker):
    name = "desktop"
    payload_hint = (
        'Single action: {"action": "click|type|hotkey|open_url|open_app|wait|...", "text": str, '
        '"target_element": str, "url": str, "x": int, "y": int, "press_enter": bool, '
        '"verify": "element that should be visible afterwards"}  '
        'OR a sequence: {"actions": [ {single action}, ... ]}'
    )
    retry_hint = (
        "If the error says earlier actions already ran, return a payload whose 'actions' list "
        "contains ONLY the failed action and the remaining ones. For vision failures, make "
        "'target_element' a clearer, more visually specific description."
    )

    VISION_ACTIONS = {"click", "double_click", "right_click"}  # last two need support in handle_gui_action
    VISION_ATTEMPTS = 2
    RUN_GUI_IN_THREAD = True  # set False if your GUI lib must run on the main thread

    # ---- low-level helpers -------------------------------------------------
    async def _gui(self, **kwargs) -> str:
        if self.RUN_GUI_IN_THREAD:
            res = await asyncio.to_thread(handle_gui_action, **kwargs)
        else:
            res = handle_gui_action(**kwargs)
        if inspect.isawaitable(res):
            res = await res
        if isinstance(res, str) and res.strip().lower().startswith(("error", "failed", "exception", "unknown action")):
            raise RuntimeError(res)
        if res is None:
            return f"Action '{kwargs.get('action')}' executed."
        return res if isinstance(res, str) else str(res)

    async def _screenshot(self):
        shot = await asyncio.to_thread(capture_active_screen) if self.RUN_GUI_IN_THREAD else capture_active_screen()
        if not shot:
            raise RuntimeError("Failed to capture screen for visual targeting.")
        return shot

    @staticmethod
    async def _launch(target: str, is_url: bool):
        def _go():
            if sys.platform == "darwin":
                cmd = ["open", target] if is_url else ["open", "-a", target]
                subprocess.run(cmd, check=True, capture_output=True)
            elif sys.platform.startswith("win"):
                os.startfile(target)  # type: ignore[attr-defined]
            else:
                cmd = ["xdg-open", target] if is_url else [target]
                subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

        try:
            await asyncio.to_thread(_go)
        except Exception as e:
            raise RuntimeError(f"Could not open '{target}': {e}")

    # ---- vision ------------------------------------------------------------
    async def _locate(self, target: str) -> Dict[str, Any]:
        shot = await self._screenshot()
        return await find_element_on_screen(str(shot), target)

    async def _vision_interact(self, p: Dict[str, Any]) -> str:
        action, target, text = p["action"], p["target_element"], p.get("text")
        print(f"👁️ DesktopWorker: Searching screen visually for '{target}'...")

        coords: Dict[str, Any] = {}
        for attempt in range(1, self.VISION_ATTEMPTS + 1):
            coords = await self._locate(target)
            if coords.get("status") == "success":
                break
            if attempt < self.VISION_ATTEMPTS:
                await asyncio.sleep(1.5)  # UI may still be loading
        else:
            raise RuntimeError(f"Vision failed to locate: {target}")

        x, y = coords["x"], coords["y"]
        print(f"🎯 Vision pinpointed '{target}' at ({x}, {y})")
        await self._gui(action=action, x=x, y=y)
        await asyncio.sleep(0.5)

        if text:
            await self._gui(action="type", text=text)
            await asyncio.sleep(0.5)
            if p.get("press_enter", True):
                await self._gui(action="hotkey", text="enter")

        return f"Successfully located and interacted with: {target}"

    async def _verify(self, spec: Any):
        description = spec if isinstance(spec, str) else spec.get("element")
        timeout = 6.0 if isinstance(spec, str) else float(spec.get("timeout", 6.0))
        if not description:
            return
        deadline = time.monotonic() + timeout
        while True:
            res = await self._locate(description)
            if res.get("status") == "success":
                return
            if time.monotonic() >= deadline:
                raise RuntimeError(f"Verification failed: '{description}' not visible after the action.")
            await asyncio.sleep(1.0)

    # ---- single action -----------------------------------------------------
    async def _run_action(self, p: Dict[str, Any]) -> str:
        action = p.get("action")
        text = p.get("text")
        target_element = p.get("target_element")
        url = p.get("url")
        x, y = p.get("x"), p.get("y")

        if action == "wait":
            secs = float(p.get("seconds", p.get("wait", 1)))
            await asyncio.sleep(min(secs, 60))
            result = f"Waited {secs}s."

        elif action == "open_url" and url:
            if not re.match(r"^[a-z][a-z0-9+.\-]*://", url, re.I):
                url = "https://" + url
            if not re.match(r"^https?://", url, re.I):
                raise NonRetryableError(f"Only http(s) URLs may be opened, got: {url}")
            print("🚀 DesktopWorker: Opening URL natively in default OS browser...")
            await self._launch(url, is_url=True)
            await asyncio.sleep(float(p.get("wait", 4)))
            result = f"Successfully opened {url} natively on the screen."

        elif action == "open_app":
            app = p.get("app") or text
            if not app:
                raise RuntimeError("open_app needs 'app'.")
            await self._launch(app, is_url=False)
            await asyncio.sleep(float(p.get("wait", 2)))
            result = f"Opened application: {app}"

        elif action in self.VISION_ACTIONS and target_element:
            result = await self._vision_interact({**p, "action": action})

        elif action:
            # Standard blind fallback (coordinates / keys supplied by the planner)
            result = await self._gui(action=action, text=text, x=x, y=y)

        else:
            raise RuntimeError("Desktop payload has no 'action'.")

        if p.get("verify"):
            await self._verify(p["verify"])
        return result

    # ---- entry point -------------------------------------------------------
    async def execute(self, payload: Dict[str, Any], context: Dict[str, Any]) -> str:
        """Executes OS-level actions, using Vision for dynamic element targeting."""
        actions = payload.get("actions")
        if isinstance(actions, list) and actions:
            results: List[str] = []
            for i, sub in enumerate(actions):
                if not isinstance(sub, dict):
                    raise NonRetryableError(f"actions[{i}] must be an object.")
                try:
                    results.append(await self._run_action(sub))
                except NonRetryableError:
                    raise
                except Exception as e:
                    done = f" Actions #1-#{i} already ran successfully." if i else ""
                    raise RuntimeError(
                        f"Action #{i + 1}/{len(actions)} ('{sub.get('action')}') failed: {e}.{done}"
                    ) from e
            return " | ".join(results)
        return await self._run_action(payload)


# =============================================================================
# Analyst
# =============================================================================
class AnalystWorker(BaseWorker):
    name = "analyst"
    refine_on_error = False  # failures here are LLM/network issues; plain retry is right
    MAX_CHARS_PER_STEP = 12000
    MAX_TOTAL_CHARS = 60000

    def _build_context(self, context: Dict[str, Any]) -> str:
        if not context:
            return "(no prior step output)"
        per_step = min(self.MAX_CHARS_PER_STEP, max(1000, self.MAX_TOTAL_CHARS // len(context)))
        return "\n\n".join(f"Step {k} Output: {_truncate(str(v), per_step)}" for k, v in context.items())

    async def execute(self, payload: Dict[str, Any], context: Dict[str, Any]) -> str:
        """Processes, summarizes, and aggregates text outputs from prior steps."""
        prompt = payload.get("prompt") or payload.get("task")
        if not prompt:
            raise NonRetryableError("Analyst step needs a 'prompt'.")

        goal = (payload.get("_meta") or {}).get("goal")
        json_mode = bool(payload.get("json"))
        fmt = payload.get("format")

        system = (
            "You are a data analyst worker. Synthesize the provided context to answer the user request. "
            "Rely only on the provided context; if something is missing or uncertain, say so instead of guessing."
        )
        if fmt:
            system += f" Output format: {fmt}."
        if json_mode:
            system += " Respond with a single valid JSON object."

        user = f"Context:\n{self._build_context(context)}\n\nTask:\n{prompt}"
        if goal:
            user = f"Overall goal: {goal}\n\n" + user

        out = await self._chat(
            [{"role": "system", "content": system}, {"role": "user", "content": user}],
            json_mode=json_mode,
        )
        return out or "No output generated."


# =============================================================================
# Optional: API worker (needs WorkerType.API to be used by the planner)
# =============================================================================
class APIWorker(BaseWorker):
    name = "api"
    payload_hint = '{"method": "GET|POST|...", "url": str, "headers": {}, "params": {}, "json": {}, "timeout": 30}'
    MAX_BODY = 20000

    @staticmethod
    async def _guard(url: str):
        """Block requests to private/loopback hosts unless AGENT_ALLOW_PRIVATE_HTTP=1."""
        import ipaddress
        import socket
        from urllib.parse import urlparse

        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https") or not parsed.hostname:
            raise NonRetryableError(f"Invalid URL: {url}")
        if os.getenv("AGENT_ALLOW_PRIVATE_HTTP") == "1":
            return
        try:
            infos = await asyncio.get_running_loop().getaddrinfo(parsed.hostname, None)
        except socket.gaierror as e:
            raise RuntimeError(f"DNS lookup failed for {parsed.hostname}: {e}")
        for info in infos:
            ip = ipaddress.ip_address(info[4][0])
            if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
                raise NonRetryableError(f"Blocked request to non-public address ({ip}).")

    async def execute(self, payload: Dict[str, Any], context: Dict[str, Any]) -> str:
        import httpx  # already a dependency of the openai SDK

        url = payload.get("url")
        if not url:
            raise NonRetryableError("API step needs 'url'.")
        method = str(payload.get("method", "GET")).upper()
        await self._guard(url)

        async with httpx.AsyncClient(timeout=float(payload.get("timeout", 30)), follow_redirects=False) as client:
            r = await client.request(
                method,
                url,
                headers=payload.get("headers"),
                params=payload.get("params"),
                json=payload.get("json"),
                data=payload.get("data"),
            )
        body = r.text or ""
        if r.status_code >= 400:
            raise RuntimeError(f"HTTP {r.status_code} from {url}: {body[:500]}")
        return _truncate(body, self.MAX_BODY)


# =============================================================================
# Optional: File worker (needs WorkerType.FILE to be used by the planner)
# =============================================================================
class FileWorker(BaseWorker):
    name = "file"
    payload_hint = (
        '{"operation": "read|write|append|list|exists|mkdir", "path": "relative/path", '
        '"content": str, "content_from": "step_id (optional)"}'
    )
    MAX_READ = 200_000

    def __init__(self, root: Optional[str] = None):
        self.root = Path(root or os.getenv("AGENT_WORKSPACE", "~/agent_workspace")).expanduser().resolve()

    def _safe(self, rel: str) -> Path:
        p = (self.root / rel).resolve()
        if p != self.root and not p.is_relative_to(self.root):
            raise NonRetryableError(f"Path escapes the workspace sandbox: {rel}")
        return p

    async def execute(self, payload: Dict[str, Any], context: Dict[str, Any]) -> str:
        op = str(payload.get("operation", "")).lower()
        rel = payload.get("path", ".")
        self.root.mkdir(parents=True, exist_ok=True)
        path = self._safe(rel)

        content = payload.get("content")
        if content is None and payload.get("content_from") in context:
            content = context[payload["content_from"]]
        if content is None and op in ("write", "append") and len(context) == 1:
            content = next(iter(context.values()))

        def _do() -> str:
            if op == "read":
                return _truncate(path.read_text(encoding="utf-8", errors="replace"), self.MAX_READ)
            if op in ("write", "append"):
                if content is None:
                    raise RuntimeError("write/append needs 'content'.")
                path.parent.mkdir(parents=True, exist_ok=True)
                with open(path, "a" if op == "append" else "w", encoding="utf-8") as f:
                    f.write(content if isinstance(content, str) else json.dumps(content, default=str))
                return f"{op} OK: {path.relative_to(self.root)}"
            if op == "list":
                return "\n".join(sorted(x.name + ("/" if x.is_dir() else "") for x in path.iterdir()))
            if op == "exists":
                return str(path.exists())
            if op == "mkdir":
                path.mkdir(parents=True, exist_ok=True)
                return f"Created {path.relative_to(self.root)}"
            raise NonRetryableError(f"Unsupported file operation: '{op}'")

        return await asyncio.to_thread(_do)
    
# =============================================================================
# Mac (AppleScript)
# =============================================================================
# =============================================================================
# Mac (AppleScript / JXA) - generic native-app controller
# =============================================================================
class MacWorker(BaseWorker):
    name = "mac"
    max_retries = 3
    refine_on_error = True
    SCRIPT_TIMEOUT = 30
    MAX_OUTPUT = 4000
    payload_hint = (
        '{"script": "AppleScript source", "language": "AppleScript|JavaScript (optional)", '
        '"verify": "optional AppleScript that returns a string starting with OK when the task really worked", '
        '"timeout": 30}'
    )
    retry_hint = (
        "Fix the script using the scripting-dictionary names shown in the error. "
        "Rules: activate the app first; wrap risky lookups in try blocks; never use a bare error; "
        "if the app has no dictionary, use System Events (keystroke / click menu item) with the process frontmost; "
        "always return a short string saying what was done; return 'Result: <reason>' only for real failures."
    )

    _ALWAYS_PRESENT = {"system events", "finder", "system settings", "system preferences"}
    _MEDIA_APPS = {"music", "spotify"}
    _APP_RE = re.compile(r'(?:tell\s+application|application)\s*\(?\s*"([^"\\]+)"', re.I)
    BLOCKED = re.compile(
        r"\bsudo\b|rm\s+-rf|with\s+administrator\s+privileges|mkfs|diskutil\s+erase|do\s+shell\s+script\s+\"[^\"]*\brm\b",
        re.I,
    )

    # ---------------------------------------------------------------- low level
    @staticmethod
    def _osascript(source: str, timeout: float, language: str = "AppleScript") -> str:
        import tempfile
        suffix = ".js" if language.lower() == "javascript" else ".applescript"
        with tempfile.NamedTemporaryFile(mode="w", suffix=suffix, delete=False, encoding="utf-8") as f:
            f.write(source)
            path = f.name
        try:
            r = subprocess.run(
                ["osascript", "-l", language, path], capture_output=True, text=True, timeout=timeout
            )
        except subprocess.TimeoutExpired:
            raise RuntimeError(f"AppleScript timed out after {timeout:.0f}s (the app may be waiting on a dialog).")
        finally:
            try:
                os.remove(path)
            except OSError:
                pass

        if r.returncode == 0:
            return (r.stdout or "").strip()

        err = (r.stderr or "").strip()
        low = err.lower()
        if "-1743" in err or "not authorized to send apple events" in low:
            raise NonRetryableError(
                "macOS blocked Automation. Open System Settings > Privacy & Security > Automation and allow "
                "the app running this backend (Terminal / VS Code / Python) to control the target app."
            )
        if "not allowed to send keystrokes" in low or "(1002)" in err or "assistive access" in low or "-25211" in err:
            raise NonRetryableError(
                "macOS blocked UI scripting. Open System Settings > Privacy & Security > Accessibility "
                "and enable the app running this backend (Terminal / VS Code / Python)."
            )
        if "-128" in err or "user canceled" in low:
            raise NonRetryableError("The action was cancelled by a macOS dialog.")
        if "-1712" in err or "timed out" in low:
            raise RuntimeError(f"The app did not respond in time: {err}")
        ctx = ""
        m = re.search(r":(\d+):(\d+): ", err)
        if m:
            lines = source.splitlines()
            ln = int(m.group(1))
            ctx = (f"\n>> line {ln}: {lines[ln - 1]!r}" if 0 < ln <= len(lines)
                   else f"\n>> error at line {ln}, but this script has only {len(lines)} lines")
        raise RuntimeError(f"AppleScript Error: {err}{ctx}")

    def _apps_in(self, script: str) -> List[str]:
        seen: List[str] = []
        for name in self._APP_RE.findall(script):
            if name not in seen:
                seen.append(name)
        return seen

    def _is_running(self, app: str) -> bool:
        try:
            out = self._osascript(f'tell application "System Events" to (name of processes) contains "{app}"', 10)
            return out.strip().lower() == "true"
        except Exception:
            return False

    def _preflight(self, apps: List[str]) -> None:
        for app in apps:
            if app.lower() in self._ALWAYS_PRESENT:
                continue
            try:
                self._osascript(f'id of application "{app}"', 10)
            except NonRetryableError:
                raise
            except Exception:
                raise NonRetryableError(f"Application '{app}' is not installed or could not be found.")
            if not self._is_running(app):
                try:
                    subprocess.run(["open", "-g", "-a", app], check=True, capture_output=True, timeout=20)
                except Exception as e:
                    raise RuntimeError(f"Could not launch '{app}': {e}")
                time.sleep(2.0)
                if app.lower() in self._MEDIA_APPS:
                    try:
                        self._osascript(f'tell application "System Events" to set visible of process "{app}" to false', 10)
                    except Exception:
                        pass
            # Permission probe: triggers the Automation prompt now, with a clear error if denied.
            self._osascript(f'tell application "{app}" to get name', 30)

    def _sdef_hint(self, apps: List[str]) -> str:
        parts: List[str] = []
        for app in apps:
            if app.lower() in {"system events"}:
                continue
            try:
                path = self._osascript(f'POSIX path of (path to application "{app}")', 10)
                r = subprocess.run(["sdef", path], capture_output=True, text=True, timeout=15)
                names = sorted(set(re.findall(r'<(?:command|class|property|element)[^>]*\bname="([^"]+)"', r.stdout or "")))
                if names:
                    parts.append(f"Scripting dictionary of {app}: " + ", ".join(names)[:2000])
                else:
                    parts.append(
                        f"{app} has NO scripting dictionary: use System Events UI scripting "
                        f"(activate the app, then keystroke / click menu item)."
                    )
            except Exception:
                continue
        return "\n".join(parts)

    # ---------------------------------------------------------------- verification
    @staticmethod
    def _wants_playback(script: str, app: str) -> bool:
        s = script.lower()
        if f'"{app.lower()}"' not in s:
            return False
        if re.search(r"\b(pause|stop)\b", s) and "play" not in s:
            return False
        return bool(re.search(r"play|next track|previous track|keystroke space|key code 49", s))
    def _player_state(self, app: str) -> str:
        return self._osascript(f'tell application "{app}" to return (player state as string)', 15).strip().lower()

    def _verify_playback(self, app: str, script: str) -> str:
        try:
            # Allow Apple Music time to update its state engine
            time.sleep(2.0)
            state = self._player_state(app)
            
            if state in ("playing", "fast forwarding", "rewinding"):
                try:
                    name = self._osascript(f'tell application "{app}" to return (name of current track)', 10)
                except Exception:
                    name = ""
                return f"verified playing: {name or 'unknown track'}"

            # Fallback: if state is paused/stopped, trigger play directly on playlist 1
            if app.lower() == "music":
                self._osascript('tell application "Music" to play track 1 of playlist 1', 15)
                time.sleep(1.5)
                if self._player_state(app) == "playing":
                    return "verified playing: library track 1"

            return f"playback status: {state}"
        except Exception as e:
            return f"playback verification skipped ({e})"
    def _run_verify(self, verify_script: str, language: str) -> str:
        out = self._osascript(verify_script, 20, language)
        if not out.strip().lower().startswith(("ok", "true")):
            raise NonRetryableError(f"Verification failed: {out or 'verify script returned nothing'}")
        return out

    # ---------------------------------------------------------------- entry point
    def _execute_sync(self, payload: Dict[str, Any]) -> str:
        script = payload.get("script")
        if not script or not isinstance(script, str):
            raise NonRetryableError("MacWorker payload requires a 'script' field containing AppleScript.")
            
        language = str(payload.get("language") or "AppleScript")
        timeout = min(float(payload.get("timeout", self.SCRIPT_TIMEOUT)), 120.0)

        # 1. Run the script first
        try:
            out = self._osascript(script, timeout, language)
        except Exception as e:
            raise RuntimeError(f"osascript execution failed: {str(e)}")

        # 2. Check if the script reported its own result error
        if isinstance(out, str) and out.startswith("Result:"):
            raise NonRetryableError(out)

        # 3. Post-execution verification for media playback
        apps = self._apps_in(script)
        notes: List[str] = []
        for app in apps:
            if app.lower() in self._MEDIA_APPS and self._wants_playback(script, app):
                notes.append(self._verify_playback(app, script))
                break

        if payload.get("verify"):
            notes.append(self._run_verify(str(payload["verify"]), language))

        if notes:
            out = f"{out} ({'; '.join(notes)})" if out else "; ".join(notes)

        return f"Mac action succeeded. Output: {out or 'Done.'}"
    
 # Replace the CoderWorker class in app/ai/worker.py with this one.
# Extra imports needed at the top of worker.py:  import uuid
# (asyncio, json, re, sys, Path are already imported there)

class CoderWorker(BaseWorker):
    """Generate -> run -> read traceback -> fix, all inside one execute() call."""
    name = "coder"
    max_retries = 1            # the fix loop below replaces the generic adaptive retry
    refine_on_error = False
    llm_timeout = 90.0
    MAX_FIX_ROUNDS = 3
    RUN_TIMEOUT = 60
    BLOCKED = re.compile(r"rm\s+-rf|shutil\.rmtree|os\.remove|os\.rmdir|sudo\s|mkfs|format\s+c:", re.I)

    SYSTEM = (
        "You are an expert Python automation engineer. Return ONE complete standalone script in a "
        "```python block. Rules: no input() or interactive prompts; print the final result to stdout; "
        "exit non-zero on failure; save any files inside the current working directory; never delete files. "
        "For downloading video/audio use yt-dlp (import yt_dlp) rather than scraping."
    )

    async def execute(self, payload: Dict[str, Any], context: Dict[str, Any]) -> str:
        task = payload.get("task") or payload.get("prompt")
        if not task:
            raise NonRetryableError("CoderWorker payload requires a 'task' or 'prompt' field.")

        ctx_str = ""
        if context:
            ctx_str = "\n\nData from earlier steps:\n" + _truncate(json.dumps(context, default=str), 6000)

        # Unique folder per run: parallel coder steps no longer overwrite each other's dynamic_op.py
        run_dir = (Path("./workspace") / f"run_{uuid.uuid4().hex[:8]}").resolve()
        run_dir.mkdir(parents=True, exist_ok=True)

        messages = [
            {"role": "system", "content": self.SYSTEM},
            {"role": "user", "content": f"Task:\n{task}{ctx_str}"},
        ]
        last_err = ""
        for rnd in range(1, self.MAX_FIX_ROUNDS + 1):
            text = await self._chat(messages)
            m = re.search(r"```(?:python)?\s*(.*?)```", text, re.S)
            code = (m.group(1) if m else text).strip()
            if self.BLOCKED.search(code):
                raise NonRetryableError("Generated script contains a destructive command; refusing to run it.")

            script = run_dir / f"script_{rnd}.py"
            script.write_text(code, encoding="utf-8")
            print(f"💻 [CoderWorker] Round {rnd}: running {script}")

            proc = await asyncio.create_subprocess_exec(
                sys.executable, str(script), cwd=str(run_dir),
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
            )
            try:
                out, err = await asyncio.wait_for(proc.communicate(), self.RUN_TIMEOUT)
                out, err = out.decode(errors="replace"), err.decode(errors="replace")
                rc = proc.returncode
            except asyncio.TimeoutError:
                proc.kill()
                await proc.wait()
                rc, out, err = -1, "", f"Script timed out after {self.RUN_TIMEOUT}s"

            if rc == 0:
                return f"Script OK (files in {run_dir}).\nOutput:\n{_truncate(out.strip(), 4000) or 'No stdout.'}"

            last_err = _truncate((err or out).strip(), 3000)
            print(f"⚠️ [CoderWorker] Round {rnd} failed: {last_err[:200]}")
            messages += [
                {"role": "assistant", "content": text},
                {"role": "user", "content": f"The script failed:\n{last_err}\n\nReturn the full corrected script."},
            ]

        raise RuntimeError(f"Script still failing after {self.MAX_FIX_ROUNDS} rounds:\n{last_err}")
    
class SearchWorker(BaseWorker):
    """Web lookups through Tavily. No browser, no captchas."""
    name = "search"
    max_retries = 2
    payload_hint = '{"query": "specific search query", "max_results": 5}'

    async def execute(self, payload: Dict[str, Any], context: Dict[str, Any]) -> str:
        q = payload.get("query") or payload.get("task") or payload.get("goal") or payload.get("prompt")
        if not q:
            raise NonRetryableError("Search step needs a 'query'.")
        from app.tools.search_tool import search_web
        out = await asyncio.to_thread(search_web, q, int(payload.get("max_results", 5)))
        if out.startswith("Web search failed"):
            raise RuntimeError(out)
        return out