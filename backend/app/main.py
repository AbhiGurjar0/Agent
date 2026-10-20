from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.db.database import client
from app.routes.chat import router as chat_router
from app.routes.auth import router as auth_router


app = FastAPI(
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
        "Ans":ans,
    }