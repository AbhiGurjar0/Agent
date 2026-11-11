# app/services/job_validator.py
"""Checks submitted work (text, links AND uploaded files) against each criterion and returns EXACT fixes."""
import asyncio
import base64
import mimetypes
import os
import re
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Tuple

from pydantic import BaseModel

from app.services.jobs.job_llm import parse

# Must match UPLOAD_DIR in routers/job_files.py (relative to the folder you run uvicorn from).
UPLOAD_DIR = Path(os.getenv("JOB_UPLOAD_DIR", "uploads/job_files"))
IMG_EXT = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
TEXT_EXT = {".txt", ".md", ".csv", ".json", ".html", ".css", ".js", ".ts", ".tsx", ".jsx", ".py", ".xml", ".yml", ".yaml", ".svg"}
MAX_IMAGES, MAX_IMAGE_BYTES, MAX_TEXT_CHARS = 4, 15 * 1024 * 1024, 6000


class CriterionCheck(BaseModel):
    index: int
    met: bool
    evidence: str
    problem: str
    fix: str


class ValidationOut(BaseModel):
    checks: List[CriterionCheck]
    summary: str


SYSTEM = """\
You are a strict work validator. A freelancer submitted work for a job. Judge EVERY numbered acceptance
criterion using ONLY: the submission text, the attached images (shown to you), the extracted file contents,
the fetched link content, and the SYSTEM METADATA (start time, submit time, deadline, file names/sizes/types).
Rules:
- SYSTEM METADATA is trustworthy evidence. Use it for timing criteria (for example "within 2 days") and file
  type/format criteria (for example "delivered as PNG").
- If an image is attached, LOOK at it and judge visual criteria (style, legibility, layout, artifacts) from what you see.
- met=true only if the evidence is actually present. Claims like "done" in the text are not enough for a
  checkable criterion when the actual deliverable is missing or cannot be inspected; say exactly what is missing.
- If a file could not be inspected (unsupported type, missing, too large), say that, and make the fix about
  re-sending it in a supported format (PNG/JPG/PDF/text) rather than blaming the work.
- evidence: point to the exact part (text, image detail, metadata) that proves it (empty if none).
- For unmet criteria, `problem` states precisely what is wrong or missing, and `fix` is a concrete,
  actionable instruction: what exactly to change or add, where, and what "done" looks like. No generic advice.
- For met criteria, problem and fix are empty strings.
- Return one check per criterion, using the same index."""


def _iso(ts: float) -> str:
    return datetime.fromtimestamp(ts).astimezone().strftime("%Y-%m-%d %H:%M %Z")


async def _fetch_links(links: List[str], limit: int = 3, chars: int = 4000) -> str:
    if not links:
        return ""
    import httpx
    from app.ai.worker import APIWorker  # reuse the SSRF guard

    async def one(url: str) -> str:
        try:
            await APIWorker._guard(url)
            async with httpx.AsyncClient(timeout=12, follow_redirects=False) as c:
                r = await c.get(url)
            body = re.sub(r"<[^>]+>", " ", r.text or "")
            return f"[{url}] HTTP {r.status_code}\n{' '.join(body.split())[:chars]}"
        except Exception as e:  # noqa: BLE001
            return f"[{url}] could not be fetched: {str(e)[:120]}"

    return "\n\n".join(await asyncio.gather(*(one(u) for u in links[:limit])))


def _extract_pdf(path: Path) -> str:
    from pypdf import PdfReader  # pip install pypdf
    return "\n".join((p.extract_text() or "") for p in PdfReader(str(path)).pages[:10])


def _extract_docx(path: Path) -> str:
    import docx  # pip install python-docx
    return "\n".join(p.text for p in docx.Document(str(path)).paragraphs)


def _read_files(job_id: str, files: List[Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], str]:
    """Returns (image content parts for the vision model, text notes describing every file)."""
    images: List[Dict[str, Any]] = []
    notes: List[str] = []
    for f in files[:10]:
        name = f.get("filename", "file")
        path = UPLOAD_DIR / job_id / f["id"]
        if not path.exists():
            notes.append(f"- {name}: the file is missing on the server")
            continue
        size = path.stat().st_size
        ext = Path(name).suffix.lower()
        ctype = f.get("content_type") or mimetypes.guess_type(name)[0] or "application/octet-stream"
        head = f"- {name} ({ctype}, {size:,} bytes)"
        try:
            if ext in IMG_EXT or ctype.startswith("image/") and ext != ".svg":
                if size > MAX_IMAGE_BYTES:
                    notes.append(f"{head}: image too large to inspect (limit {MAX_IMAGE_BYTES // 1024 // 1024} MB)")
                elif len(images) >= MAX_IMAGES:
                    notes.append(f"{head}: not inspected (only the first {MAX_IMAGES} images are checked)")
                else:
                    mime = ctype if ctype.startswith("image/") else (mimetypes.guess_type(name)[0] or "image/png")
                    b64 = base64.b64encode(path.read_bytes()).decode()
                    images.append({"type": "image_url", "image_url": {"url": f"data:{mime};base64,{b64}"}})
                    notes.append(f"{head}: IMAGE #{len(images)}, attached for you to look at")
            elif ext == ".pdf":
                notes.append(f"{head}: extracted text:\n{_extract_pdf(path)[:MAX_TEXT_CHARS] or '(no selectable text, probably scanned)'}")
            elif ext == ".docx":
                notes.append(f"{head}: extracted text:\n{_extract_docx(path)[:MAX_TEXT_CHARS]}")
            elif ext in TEXT_EXT or ctype.startswith("text/"):
                notes.append(f"{head}: contents:\n{path.read_text(encoding='utf-8', errors='replace')[:MAX_TEXT_CHARS]}")
            else:
                notes.append(f"{head}: this file type cannot be inspected automatically (only name, type and size are known)")
        except Exception as e:  # noqa: BLE001  (missing pypdf / python-docx, corrupt file...)
            notes.append(f"{head}: could not be read ({str(e)[:100]})")
    return images, "\n".join(notes)


def _pack(criteria: List[str], rows: Dict[int, Dict[str, Any]], summary: str, attempt: int) -> Dict[str, Any]:
    results = []
    for i, c in enumerate(criteria):
        r = rows.get(i) or {"met": False, "evidence": "", "problem": "This criterion was not evaluated.",
                            "fix": "Resubmit with clear proof for this criterion."}
        results.append({"criterion": c, "met": bool(r["met"]), "evidence": r["evidence"],
                        "problem": r["problem"], "fix": r["fix"]})
    unmet = [r for r in results if not r["met"]]
    fixes = [{"criterion": r["criterion"], "problem": r["problem"], "fix": r["fix"]} for r in unmet]
    fixes_text = "\n".join(
        f"{n}. [{f['criterion']}] Problem: {f['problem']} Fix: {f['fix']}" for n, f in enumerate(fixes, 1)
    )
    met = len(results) - len(unmet)
    return {"passed": not unmet, "score": round(100 * met / max(1, len(results))), "summary": summary,
            "attempt": attempt, "criteria": results, "fixes": fixes, "fixes_text": fixes_text}


async def validate_submission(job: Dict[str, Any]) -> Dict[str, Any]:
    sub = job.get("submission") or {}
    criteria = list(job.get("criteria") or []) or ["The deliverable matches the job description"]
    attempt = int(job.get("revisions", 0)) + 1
    content = (sub.get("content") or "").strip()
    links = sub.get("links") or []
    files = sub.get("files") or []

    if len(content) < 20 and not links and not files:
        rows = {i: {"met": False, "evidence": "", "problem": "Nothing was submitted.",
                    "fix": "Submit the finished deliverable (files or links) with a short description."}
                for i in range(len(criteria))}
        return _pack(criteria, rows, "Empty submission.", attempt)

    job_id = str(job["_id"])
    images, file_notes = await asyncio.to_thread(_read_files, job_id, files)
    link_text = await _fetch_links(links)
    started = job.get("startedAt") or job.get("createdAt") or sub.get("ts")
    meta = [f"Job started: {_iso(started)}", f"Work submitted: {_iso(sub.get('ts', started))}"]
    if job.get("deadline"):
        meta.append(f"Deadline: {job['deadline']}")
    meta.append(f"Revision attempt: {attempt}")

    numbered = "\n".join(f"{i}. {c}" for i, c in enumerate(criteria))
    text = (
        f"Job: {job.get('title')}\nDescription: {job.get('description')}\n\n"
        f"Acceptance criteria:\n{numbered}\n\n"
        f"SYSTEM METADATA:\n" + "\n".join(meta) + "\n\n"
        f"Submission text:\n{content[:8000] or '(none)'}\n\n"
        f"Attached files:\n{file_notes or '(none)'}\n\n"
        f"Links submitted: {links or 'none'}\n{('Fetched link content:' + chr(10) + link_text) if link_text else ''}"
    )
    user_content: Any = [{"type": "text", "text": text}, *images] if images else text
    out = await parse([{"role": "system", "content": SYSTEM}, {"role": "user", "content": user_content}], ValidationOut)
    rows = {c.index: c.model_dump() for c in out.checks if 0 <= c.index < len(criteria)}
    return _pack(criteria, rows, out.summary, attempt)