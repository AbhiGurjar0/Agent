import asyncio, time

class ProgressEmitter:
    def __init__(self):
        self.queue: asyncio.Queue = asyncio.Queue()

    async def emit(self, step: str, status: str = "running", detail: str | None = None):
        await self.queue.put({"type": "step", "step": step, "status": status,
                              "detail": detail, "ts": time.time()})