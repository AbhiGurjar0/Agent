import asyncio, re, sys, time

_subs: list[tuple[asyncio.AbstractEventLoop, asyncio.Queue]] = []

def subscribe() -> asyncio.Queue:
    q: asyncio.Queue = asyncio.Queue()
    _subs.append((asyncio.get_running_loop(), q))
    return q

def unsubscribe(q: asyncio.Queue):
    _subs[:] = [(l, x) for l, x in _subs if x is not q]

def _publish(line: str):
    for loop, q in list(_subs):
        loop.call_soon_threadsafe(q.put_nowait, line)  # safe even if print() runs in a thread

class _Tee:
    def __init__(self, orig):
        self._orig, self._buf = orig, ""
    def write(self, s):
        self._orig.write(s)
        self._buf += s
        while "\n" in self._buf:
            line, self._buf = self._buf.split("\n", 1)
            _publish(line)
        return len(s)
    def flush(self): self._orig.flush()
    def __getattr__(self, n): return getattr(self._orig, n)

def install():
    if not isinstance(sys.stdout, _Tee):
        sys.stdout = _Tee(sys.stdout)
        sys.stderr = _Tee(sys.stderr)

PLAN = re.compile(r"\[DAG Planner\] Plan for: '(.*)'")
TASK = re.compile(r"^\s*- \[(\w+)\] \((\w+),")
PICK = re.compile(r"Picked up task: '(\w+)'")
DONE = re.compile(r"Finished task: '(\w+)'")
FAIL = re.compile(r"(?:failed|error)\D*task: '(\w+)'", re.I)  # adjust to your real failure line

class Parser:
    def __init__(self): self.current = None
    def feed(self, line: str) -> list[dict]:
        line = line.rstrip(); ts = time.time()
        if not line or line.startswith("INFO:"):
            return []
        def step(i, status, detail=None, title=None):
            return {"type": "step", "step": i, "title": title, "status": status, "detail": detail, "ts": ts}
        if m := PLAN.search(line):  return [step("plan", "done", m[1], "Plan the steps")]
        if m := TASK.match(line):   return [step(m[1], "waiting", m[2])]
        if m := PICK.search(line):  self.current = m[1]; return [step(m[1], "running")]
        if m := DONE.search(line):  self.current = None; return [step(m[1], "done")]
        if m := FAIL.search(line):  self.current = None; return [step(m[1], "failed", line[:200])]
        return [{"type": "log", "step": self.current, "line": line[:300], "ts": ts}]