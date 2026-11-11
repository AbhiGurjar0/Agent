import json, uuid, asyncio, time
from datetime import timezone
from typing import Optional

from bson import ObjectId
from fastapi import APIRouter, WebSocket, Depends, status, Request, Header, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.encoders import jsonable_encoder
from app.db.database import get_database
from app.schemas.chat import ChatCreate
from app.core.dependencies import get_current_user
from app.services.progress import (
    ProgressEmitter, EMITTERS, CANCELS, StreamMapper, build_task_record, progress_summary,
)
from app.pipeline.create_chat_pipeline import run_chat_pipeline, PipelineCancelled, DEFAULT_USER_ID
from app.services.tasks import _spawn
from app.pipeline.voice_chat_pipeline import handle_audio_ws_pipeline