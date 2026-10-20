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


SAFE_WORKSPACE = Path("./workspace").resolve()
SAFE_WORKSPACE.mkdir(parents=True, exist_ok=True)

@router.websocket("/ws/audio-chat")
async def audio_chat(
    websocket: WebSocket,
    db=Depends(get_database),
    user_id: str = "6ac1156aa1165fa861cc5aa0",
):
    await websocket.accept()

    task_queue = asyncio.Queue()
    main_response_queue = asyncio.Queue()
    notification_queue = asyncio.Queue()
    
    is_jarvis_speaking = False
    active_background_tasks = set()
    latest_cancel_event = None

    # 1. Spontaneous notification callback (pushes to priority notification queue)
    async def send_voice_notification(text_message: str):
        print(f"🔔 Background Notification Triggered: {text_message}")
        tts_bytes = text_to_speech_bytes(text_message)
        if tts_bytes:
            await notification_queue.put({
                "json": {"notification": text_message},
                "bytes": tts_bytes
            })

    # =================================================================
    # 1. NON-BLOCKING AUDIO & TEXT LISTENER
    # =================================================================
    async def receive_loop():
        nonlocal latest_cancel_event
        try:
            while True:
                message = await websocket.receive()

                if "text" in message:
                    try:
                        text_data = json.loads(message["text"])
                        if text_data.get("type") == "cancel_last" and latest_cancel_event:
                            print("⚡ Interruption signal received! Triggering cancel event...")
                            latest_cancel_event.set()
                    except json.JSONDecodeError:
                        pass
                    continue

                if "bytes" in message:
                    audio_bytes = message["bytes"]
                    temp_audio_path = SAFE_WORKSPACE / f"temp_input_{id(audio_bytes)}.wav"

                    try:
                        with open(temp_audio_path, "wb") as buffer:
                            buffer.write(audio_bytes)

                        # FIX: Run Whisper transcription in a separate thread to prevent event loop freeze
                        user_prompt = await asyncio.to_thread(speech_to_text, str(temp_audio_path))
                    finally:
                        if os.path.exists(temp_audio_path):
                            os.remove(temp_audio_path)

                    if user_prompt:
                        await task_queue.put(user_prompt)
                    else:
                        await main_response_queue.put({
                            "json": {"error": "Could not understand audio."},
                            "bytes": None
                        })

        except WebSocketDisconnect:
            print("⚡ WebSocket client disconnected in receive loop.")
        except Exception as e:
            print(f"❌ Listener error: {e}")

    # =================================================================
    # 2. PARALLEL AGENT PIPELINE EXECUTION
    # =================================================================
    async def execute_pipeline_task(prompt: str):
        nonlocal latest_cancel_event
        cancel_event = asyncio.Event()
        latest_cancel_event = cancel_event

        try:
            chat_payload = ChatCreate(type="user", message=prompt)
            
            agent_response = await run_chat_pipeline(
                chat_data=chat_payload,
                db=db,
                current_user={"_id": user_id},
                cancel_event=cancel_event,
                notify_callback=send_voice_notification
            )

            if cancel_event.is_set():
                print(f"🛑 Interrupted: Dropping output for prompt: '{prompt}'")
                return

            response_text = (
                agent_response.get("response", "Task completed.")
                if isinstance(agent_response, dict)
                else str(agent_response)
            )

            tts_bytes = text_to_speech_bytes(response_text)

            if tts_bytes and not cancel_event.is_set():
                # Push response into main response queue
                await main_response_queue.put({
                    "json": {
                        "transcribed_prompt": prompt,
                        "response_text": response_text
                    },
                    "bytes": tts_bytes
                })

        except Exception as turn_err:
            print(f"❌ Error during task processing: {turn_err}")
            await main_response_queue.put({
                "json": {"error": str(turn_err)},
                "bytes": None
            })

    async def process_loop():
        try:
            while True:
                prompt = await task_queue.get()
                task = asyncio.create_task(execute_pipeline_task(prompt))
                active_background_tasks.add(task)
                task.add_done_callback(active_background_tasks.discard)
                task_queue.task_done()
        except asyncio.CancelledError:
            pass

    # =================================================================
    # 3. PRIORITY-MANAGED WEBSOCKET SENDER
    # =================================================================
    async def send_loop():
        nonlocal is_jarvis_speaking
        try:
            while True:
                # Priority 1: Main conversation responses
                if not main_response_queue.empty():
                    is_jarvis_speaking = True
                    item = await main_response_queue.get()
                    
                    if item.get("json"):
                        await websocket.send_json(item["json"])
                    if item.get("bytes"):
                        await websocket.send_bytes(item["bytes"])
                        
                    main_response_queue.task_done()
                    
                # Priority 2: Spontaneous background notifications (only when silent)
                elif not notification_queue.empty() and not is_jarvis_speaking:
                    is_jarvis_speaking = True
                    notif = await notification_queue.get()
                    
                    if notif.get("json"):
                        await websocket.send_json(notif["json"])
                    if notif.get("bytes"):
                        await websocket.send_bytes(notif["bytes"])
                    
                    notification_queue.task_done()
                    
                else:
                    is_jarvis_speaking = False
                    await asyncio.sleep(0.05)
                
        except asyncio.CancelledError:
            pass

    # =================================================================
    # 4. REDIS PUB/SUB LISTENER FOR CELERY NOTIFICATIONS
    # =================================================================
    async def redis_listener_loop():
        redis_client = await aioredis.from_url("redis://localhost:6379/0", decode_responses=True)
        pubsub = redis_client.pubsub()
        channel_name = f"jarvis_notifications:{user_id}"
        
        await pubsub.subscribe(channel_name)
        print(f"📡 Subscribed to Redis channel: {channel_name}")
        
        try:
            async for message in pubsub.listen():
                if message["type"] == "message":
                    try:
                        data = json.loads(message["data"])
                        notification_msg = data.get("message")
                        if notification_msg:
                            await send_voice_notification(notification_msg)
                    except json.JSONDecodeError:
                        pass
        except asyncio.CancelledError:
            pass
        finally:
            await pubsub.unsubscribe(channel_name)
            await redis_client.close()

    try:
        await asyncio.gather(
            receive_loop(),
            process_loop(),
            send_loop(),
            redis_listener_loop()
        )
    except WebSocketDisconnect:
        print("⚡ WebSocket client disconnected.")
    except Exception as e:
        print(f"❌ WebSocket connection error: {e}")
        
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
