import asyncio
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager,suppress
from app.db.database import client
from app.routes.chat import router as chat_router
from app.routes.auth import router as auth_router
# from app.pipeline.screen_monitor import ProactiveScreenMonitor
from app.tools.registry import load_all_generated_tools
from app.core.log_stream import install
install()


## monitor in every 5 sec
# monitor = ProactiveScreenMonitor(check_interval_sec=5.0)
# @asynccontextmanager
# async def lifespan(app: FastAPI):
#     # Start screen monitor task in background
#     load_all_generated_tools()
#     monitor_task = asyncio.create_task(monitor.start())
   
#     yield
#     # Cleanup on server shutdown
#     monitor.is_running = False
#     monitor_task.cancel()
#     with suppress(asyncio.CancelledError):
#         await monitor_task
    

app = FastAPI(
    # lifespan=lifespan,
    title="AGENTBACKEND",
    debug="true"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(
    chat_router,
    prefix="/api/v1",
)
app.include_router(
    auth_router,
    prefix="/api/v1",
)




@app.get("/health")
async def health_check():
    await client.admin.command("ping")
    return {
        "status": "ok",
        "database": "MongoDB connected",
        
    }