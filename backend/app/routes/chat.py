import os
import json
import httpx
import asyncio
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends, status,Query
import redis.asyncio as aioredis
from pathlib import Path
from app.services.youtube_tool import upload_youtube_video
from app.db.database import get_database
from app.schemas.chat import ChatCreate
from app.ai.voice_service import speech_to_text, text_to_speech_bytes
from app.core.config import settings
from app.core.dependencies import get_current_user
from app.pipeline.create_chat_pipeline import run_chat_pipeline
from app.pipeline.voice_chat_pipeline import handle_audio_ws_pipeline


router = APIRouter(
    prefix="/chats",
    tags=["Chats"],
)

###########################################################################################################
############################################### Routes ####################################################
##########################################################################################################


### 1. / GET
@router.get("/", status_code=status.HTTP_200_OK)
async def get_chat(db=Depends(get_database)):

    chats = []
    results = db.chats.find()
    async for chat in results:
        chat["id"] = str(chat["_id"])
        chat.pop("_id", None)

        chats.append(chat)

    return chats


### 2. / POST
@router.post("/", status_code=status.HTTP_201_CREATED)
async def create_chat(
    chat_data: ChatCreate,
    db=Depends(get_database),
    current_user: dict = Depends(get_current_user),
):
    """Router endpoint delegating execution to the autonomous agent pipeline."""
    return await run_chat_pipeline(
        chat_data=chat_data, db=db, current_user=current_user
    )


### 3. /ws/audiochat

@router.websocket("/ws/audio-chat")
async def audio_chat(
    websocket: WebSocket,
    db=Depends(get_database),
    user_id: str = "6ac1156aa1165fa861cc5aa0",
):
    """WebSocket endpoint delegating audio communication & real-time execution to the audio pipeline."""
    await handle_audio_ws_pipeline(
        websocket=websocket,
        db=db,
        user_id=user_id
    )
        
### 4. /upload

@router.post("/upload")
async def upload_video_endpoint(
    file_path: str,
    title: str,
    description: str,
):
    # Pass settings directly or load them into environment
    result = await upload_youtube_video(
        file_path=file_path,
        title=title,
        description=description,
        client_id=settings.youtube_client_id,
        client_secret=settings.youtube_client_secret,
        refresh_token=settings.youtube_refresh_token,
    )
    return result

### 5. /history

@router.get("/history", status_code=status.HTTP_200_OK)
async def get_chat_history(
    limit: int = Query(50, ge=1, le=100),
    db=Depends(get_database),
    current_user: dict = Depends(get_current_user),
):
    """
    Retrieves chronological chat history, including side-effect journal entries 
    and their current rollback statuses (completed vs revoked).
    """
    if isinstance(current_user, dict):
        user_id = str(current_user.get("_id", "6ac1156aa1165fa861cc5aa0"))
    else:
        user_id = "6ac1156aa1165fa861cc5aa0"

    # Fetch latest chats, sorted newest to oldest to apply limit, then reverse for chronological display
    cursor = db["chats"].find(
        {"user_id": user_id}, 
        {"embeddings": 0}  # Exclude heavy vector embeddings from standard history payload
    ).sort("created_at", -1).limit(limit)
    
    raw_chats = await cursor.to_list(length=limit)
    raw_chats.reverse()

    formatted_history = []
    
    for chat in raw_chats:
        # Safely extract journal entries if they exist for this turn
        journal_entries = chat.get("journal_entries", [])
        
        # Clean up journal data for frontend consumption (hiding sensitive rollback system paths)
        safe_journal = [
            {
                "task_id": entry.get("task_id"),
                "tool_name": entry.get("tool_name"),
                "status": entry.get("status", "completed"),  # 'completed' or 'revoked'
                "args": entry.get("args", {}),
                "created_at": entry.get("created_at")
            }
            for entry in journal_entries
        ]

        formatted_history.append({
            "id": str(chat["_id"]),
            "role": chat.get("role"),
            "content": chat.get("content"),
            "type": chat.get("type", "general_chat"),
            "created_at": chat.get("created_at"),
            "latency_ms": chat.get("latency_ms"),
            "tool_calls": chat.get("tool_calls", []),
            "journal_entries": safe_journal,
        })

    return {
        "status": "success",
        "count": len(formatted_history),
        "history": formatted_history
    }
    
###########################################################################################################
############################################### Helper Functions ##########################################
###########################################################################################################


##1.Create External Tasks


async def create_task_in_external_app(title: str, priority: str, cookies: dict = None):
    session_token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjEsInVzZXJuYW1lIjoiQWJoaXNoZWsiLCJpYXQiOjE3OTA2OTY3MjQsImV4cCI6MTc5MTMwMTUyNH0.yan8zL7UmsuP8GFc1TBzkENxFBEXN8ywOOQ2pAZyi24"
    url = "https://scheduler-theta-six.vercel.app/api/routine"
    headers = {"Content-Type": "application/json"}

    async with httpx.AsyncClient() as client:
        res = await client.post(
            url,
            headers=headers,
            json={"title": title, "priority": priority},
            cookies={
                "session_token": session_token
            },  # Forwards session cookies automatically
        )

    if res.status_code == 200:
        print(
            f"Task created successfully in external app: Title='{title}', Priority='{priority}'"
        )
    else:
        print(
            f"Failed to create task in external app: Status Code={res.status_code}, Response={res.text}"
        )
