# app/pipeline/audio_pipeline.py
import os
import json
import asyncio
from pathlib import Path
from fastapi import WebSocket, WebSocketDisconnect
import redis.asyncio as aioredis

from app.schemas.chat import ChatCreate
from app.ai.voice_service import speech_to_text, text_to_speech_bytes
from app.pipeline.create_chat_pipeline import run_chat_pipeline
from app.ai.approval_manager import approval_manager

SAFE_WORKSPACE = Path("./workspace").resolve()
SAFE_WORKSPACE.mkdir(parents=True, exist_ok=True)

async def handle_audio_ws_pipeline(websocket, db, user_id="6ac1156aa1165fa861cc5aa0", convo_id=None):
    await websocket.accept()

    task_queue = asyncio.Queue()
    main_response_queue = asyncio.Queue()
    notification_queue = asyncio.Queue()

    is_jarvis_speaking = False
    active_background_tasks = set()
    latest_cancel_event = None

    # 1. Spontaneous notification callback
    async def send_voice_notification(text_message: str):
        print(f"🔔 Background Notification Triggered: {text_message}")
        tts_bytes = await asyncio.to_thread(text_to_speech_bytes, text_message)
        await notification_queue.put({"json": {"notification": text_message}, "bytes": tts_bytes})

    # =================================================================
    # 1. NON-BLOCKING AUDIO & TEXT LISTENER
    # =================================================================
    async def receive_loop():
        nonlocal latest_cancel_event
        try:
            while True:
                message = await websocket.receive()
                if message.get("type") == "websocket.disconnect":
                    break

                if "text" in message:
                    try:
                        text_data = json.loads(message["text"])
                        if text_data.get("type") == "cancel_last" and latest_cancel_event:
                            print("⚡ Interruption signal received! Triggering cancel event...")
                            latest_cancel_event.set()
                        if text_data.get("type") == "approval_response":
                            approval_manager.resolve_approval(
                                approval_id=text_data.get("approval_id"),
                                approved=text_data.get("approved", False)
                            )
                            continue
                    except json.JSONDecodeError:
                        pass
                    continue

                if "bytes" in message:
                    audio_bytes = message["bytes"]
                    temp_audio_path = SAFE_WORKSPACE / f"temp_input_{id(audio_bytes)}.wav"

                    try:
                        with open(temp_audio_path, "wb") as buffer:
                            buffer.write(audio_bytes)

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
            chat_payload = ChatCreate(type="user", message=prompt, convo_id=convo_id)

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

            tts_bytes = await asyncio.to_thread(text_to_speech_bytes, response_text)  # also stops it blocking the event loop

            if not cancel_event.is_set():
                await main_response_queue.put({
                    "json": {"transcribed_prompt": prompt, "response_text": response_text},
                    "bytes": tts_bytes,   # may be None; send_loop already handles that
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
                if not main_response_queue.empty():
                    is_jarvis_speaking = True
                    item = await main_response_queue.get()

                    if item.get("json"):
                        await websocket.send_json(item["json"])
                    if item.get("bytes"):
                        await websocket.send_bytes(item["bytes"])

                    main_response_queue.task_done()

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
        try:
            redis_client = await aioredis.from_url("redis://localhost:6379/0", decode_responses=True)
            await redis_client.ping()
            pubsub = redis_client.pubsub()
            channel_name = f"jarvis_notifications:{user_id}"
            await pubsub.subscribe(channel_name)
        except Exception as e:
            print(f"⚠️ Redis unavailable, background notifications disabled: {e}")
            return

        print(f"📡 Subscribed to Redis channel: {channel_name}")
        try:
            async for message in pubsub.listen():
                if message["type"] == "message":
                    try:
                        data = json.loads(message["data"])
                        msg = data.get("message")
                        if msg:
                            await send_voice_notification(msg)
                    except json.JSONDecodeError:
                        pass
        except asyncio.CancelledError:
            pass
        finally:
            try:
                await pubsub.unsubscribe(channel_name)
                await redis_client.close()
            except Exception:
                pass

    # ---- run everything; stop it all when the client leaves ----
    tasks = [
        asyncio.create_task(f())
        for f in (receive_loop, process_loop, send_loop, redis_listener_loop)
    ]
    try:
        # redis_listener_loop may return early (no Redis), so wait for receive_loop only
        await tasks[0]
    except Exception as e:
        print(f"❌ WebSocket connection error: {e}")
    finally:
        for t in tasks:
            t.cancel()
        for t in list(active_background_tasks):
            t.cancel()
        if latest_cancel_event:
            latest_cancel_event.set()