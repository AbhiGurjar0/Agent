# app/ai/formatter.py
"""
Backend output formatter (standalone, no dependencies).

Turns whatever the pipeline produced (LLM text, worker output, dicts, raw code, raw JSON,
python-list "Sources") into clean, consistent Markdown that the frontend renderer
(jarvis_formatter.js) can display with coloured code boxes, tables, callouts and source chips.

    from app.ai.formatter import format_response
    content = format_response(content)
"""
import ast
import json
import re
from typing import Any

_FENCE_SPLIT = re.compile(r"(```[^\n]*\n.*?(?:```|\Z))", re.S)
_FENCE_PARTS = re.compile(r"```([^\n]*)\n(.*?)(```)?\Z", re.S)

_LANG_ALIASES = {
    "py": "python", "python3": "python", "js": "javascript", "ts": "typescript",
    "sh": "bash", "shell": "bash", "zsh": "bash", "yml": "yaml", "md": "markdown",
}

_CODE_LINE = re.compile(
    r"^\s*(def |class |import |from \S+ import |for .+ in .+:|if .+:|elif .+:|else:|try:|except|"
    r"return\b|print\(|const |let |var |function |async |await |#!|\$ |sudo |pip |npm |git |"
    r"SELECT |INSERT |UPDATE |CREATE |</?\w+[^>]*>|[{}\[\]();,]\s*$|\w[\w.]*\s*=\s*\S+)",
    re.I,
)


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #
def guess_language(code: str) -> str:
    s = code.strip()
    if s[:1] in "{[":
        try:
            json.loads(s)
            return "json"
        except Exception:
            pass
    if re.search(r"^\s*(def |class |import |from \S+ import |print\(|async def )", s, re.M):
        return "python"
    if re.match(r"^\s*(\$ |sudo |pip |npm |git |cd |ls |curl |brew |docker |osascript )", s) or s.startswith("#!/bin"):
        return "bash"
    if re.search(r"^\s*(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER)\b", s, re.I | re.M):
        return "sql"
    if re.search(r"<(!DOCTYPE|html|div|span|body|script)\b", s, re.I):
        return "html"
    if re.search(r"\b(const|let|var|function)\b|=>|console\.log", s):
        return "javascript"
    if re.search(r"^\w[\w-]*:\s*\S*$", s, re.M) and "{" not in s:
        return "yaml"
    if re.search(r"^tell application|end tell", s, re.M):
        return "applescript"
    return "text"


def _looks_like_code(text: str) -> bool:
    lines = [l for l in text.splitlines() if l.strip()]
    if len(lines) < 3:
        return False
    hits = sum(1 for l in lines if _CODE_LINE.match(l))
    prose = sum(1 for l in lines if len(l.split()) > 9 and l.rstrip().endswith("."))
    return hits / len(lines) >= 0.6 and prose == 0


def _fix_fence(seg: str) -> str:
    m = _FENCE_PARTS.match(seg)
    if not m:
        return seg
    lang = _LANG_ALIASES.get(m.group(1).strip().lower(), m.group(1).strip().lower())
    body = m.group(2).rstrip()
    if not lang:
        lang = guess_language(body)
    if lang == "json":
        try:
            body = json.dumps(json.loads(body), indent=2, ensure_ascii=False)
        except Exception:
            pass
    return f"```{lang}\n{body}\n```"


def _normalize_prose(seg: str) -> str:
    seg = re.sub(r"(?m)^(\s*)[•◦▪‣]\s+", r"\1- ", seg)          # fancy bullets -> markdown
    seg = re.sub(r"(?m)^(\s*)\*\s+(?=\S)", r"\1- ", seg)         # "* item" -> "- item"
    seg = re.sub(r"[ \t]+$", "", seg, flags=re.M)                # trailing spaces
    seg = re.sub(r"\n{3,}", "\n\n", seg)                         # collapse blank lines
    return seg


def _fix_sources(text: str) -> str:
    """'Sources: ['https://a', 'https://b']' -> a markdown list."""
    def repl(m: re.Match) -> str:
        try:
            items = ast.literal_eval(m.group(1))
            items = [str(i) for i in items if i]
        except Exception:
            return m.group(0)
        if not items:
            return ""
        return "\n\n**Sources:**\n" + "\n".join(f"- {i}" for i in items)

    return re.sub(r"(?im)^\**sources?\**\s*:\s*\**\s*(\[.*?\])\s*$", repl, text)


def _format_worker_output(text: str) -> str:
    """CoderWorker: 'Script OK (files in X).\\nOutput:\\n...' -> friendly summary + code box."""
    m = re.match(r"^Script OK \(files in (.+?)\)\.\s*\nOutput:\n(.*)\Z", text, re.S)
    if not m:
        return text
    folder, out = m.group(1), m.group(2).strip()
    msg = f"**Script finished successfully.** Files saved in `{folder}`."
    if out and out != "No stdout.":
        msg += f"\n\n**Output**\n\n```text\n{out}\n```"
    return msg


# --------------------------------------------------------------------------- #
# public API
# --------------------------------------------------------------------------- #
def format_response(content: Any) -> str:
    """Return clean Markdown for any final output. Never raises."""
    try:
        if content is None:
            return ""
        if isinstance(content, (dict, list)):
            return "```json\n" + json.dumps(content, indent=2, ensure_ascii=False, default=str) + "\n```"

        text = str(content).replace("\r\n", "\n").strip()
        if not text:
            return ""

        if "```" not in text:
            if text[:1] in "{[":                       # whole answer is JSON
                try:
                    return "```json\n" + json.dumps(json.loads(text), indent=2, ensure_ascii=False) + "\n```"
                except Exception:
                    pass
            if _looks_like_code(text):                 # whole answer is a raw script
                return f"```{guess_language(text)}\n{text}\n```"
            text = _format_worker_output(text)

        text = _fix_sources(text)

        parts = _FENCE_SPLIT.split(text)               # odd indexes are code fences
        parts = [_fix_fence(p) if i % 2 else _normalize_prose(p) for i, p in enumerate(parts)]
        out = "".join(parts)
        out = re.sub(r"(?<!\n)\n(```\w*\n)", r"\n\n\1", out)    # blank line before a fence
        out = re.sub(r"(\n```)\n(?!\n)(?=\S)", r"\1\n\n", out)   # blank line after a fence
        return out.strip()
    except Exception:
        return str(content)