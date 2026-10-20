import asyncio
import json
import logging
import time
from datetime import datetime, timezone
from typing import Any, Dict, List
from bson import ObjectId
from fastapi import HTTPException, status
from app.ai.openai import call_model, get_text_embedding
from app.ai.dispatcher import execute_agent_tool
from app.schemas.chat import ChatCreate
from app.services.context_builder import build_agent_context
from app.services.tool_router import DynamicToolRouter
from app.tools.tools import tools

# Set up structured logger
logger = logging.getLogger("jarvis.agent")

# Initialize tool router once on backend startup
tool_router = DynamicToolRouter(
    all_tools=tools, 
    always_include=["run_terminal_command"]
)

async def run_chat_pipeline(
    chat_data: ChatCreate,
    db,
    current_user: dict,
    cancel_event: asyncio.Event = None,
    notify_callback = None,
    
):
    """
    Advanced Autonomous Agent Pipeline:
    - Resilient user context & embedding resolution
    - Dynamic tool routing & mid-loop context updates
    - Concurrent (Parallel) tool execution
    - Self-healing error recovery for tool failures
    - Exponential backoff & LLM retry logic
    - Non-blocking execution tracing & telemetry
    """
    start_time = time.perf_counter()

    # 1. User & Input Sanitization
    if isinstance(current_user, dict):
        user_id = str(current_user.get("_id", "6ac1156aa1165fa861cc5aa0"))
    else:
        user_id = "6ac1156aa1165fa861cc5aa0"
        
    assistant_chat_id = ObjectId()

    user_message = (
        chat_data.get("message") if isinstance(chat_data, dict) else chat_data.message
    )
    if not user_message or not user_message.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Message content cannot be empty."
        )

    logger.info(f"[Pipeline] Initialized request for user_id={user_id}")

    # 2. Parallel Context & Embedding Retrieval
    try:
        embedded_user_message_task = asyncio.create_task(get_text_embedding(user_message))
        
        recent_chats_cursor = (
            db["chats"]
            .find({"user_id": user_id})
            .sort("created_at", -1)
            .limit(10)
        )
        recent_chats = await recent_chats_cursor.to_list(length=10)
        recent_chats.reverse()

        embedded_user_message = await embedded_user_message_task
    except Exception as e:
        logger.error(f"[Pipeline] Error during context/embedding fetch: {e}")
        embedded_user_message = []

    chat_history = [
        {"role": chat.get("role", "user"), "content": chat.get("content", "")}
        for chat in recent_chats
    ]

    try:
        system_context = await build_agent_context(
            user_id=user_id,
            prompt=user_message,
            prompt_embedding=embedded_user_message
        )
    except Exception as e:
        logger.warning(f"[Pipeline] Agent context builder fallback: {e}")
        system_context = "You are Jarvis, an autonomous desktop AI assistant."

    messages: List[Dict[str, Any]] = [
        {"role": "system", "content": system_context}
    ] + chat_history + [
        {"role": "user", "content": user_message}
    ]

    # Save user prompt asynchronously
    asyncio.create_task(
        _safe_db_insert(
            db["chats"],
            {
                "user_id": user_id,
                "role": "user",
                "content": user_message,
                "embeddings": embedded_user_message,
                "created_at": datetime.now(timezone.utc),
            }
        )
    )

    # 3. Multi-Turn ReAct Loop with Parallel Tool Execution
    all_executed_tasks: List[Dict[str, Any]] = []
    max_tool_turns = 10
    final_content = "Task execution finished."
    
    for turn in range(max_tool_turns):
        if cancel_event and cancel_event.is_set():
            logger.info("[Pipeline] Interrupted by cancel_event.")
            break
        latest_context = messages[-1]["content"] if isinstance(messages[-1].get("content"), str) else user_message
        filtered_tools = tool_router.select_tools(latest_context, top_k=4)

        try:
            response = await _call_model_with_retry(
                user_id=user_id,
                messages=messages,
                tools=filtered_tools,
                max_tokens=1500
            )
        except Exception as e:
            logger.critical(f"[Pipeline Turn {turn}] LLM execution failed: {e}")
            final_content = "I encountered an error connecting to my intelligence engine. Please try again."
            break

        response_message = response.choices[0].message
        
        assistant_dict = {
            "role": "assistant",
            "content": response_message.content or "",
        }
        if response_message.tool_calls:
            assistant_dict["tool_calls"] = [
                {
                    "id": tc.id,
                    "type": "function",
                    "function": {
                        "name": tc.function.name,
                        "arguments": tc.function.arguments
                    }
                }
                for tc in response_message.tool_calls
            ]
        messages.append(assistant_dict)

        if not response_message.tool_calls:
            final_content = response_message.content or "Task completed."
            break

        # Parallel Tool Dispatch
        async def _run_single_tool(tool_call):
            fn_name = tool_call.function.name
            tool_id = tool_call.id
            
            try:
                fn_args = json.loads(tool_call.function.arguments)
            except Exception as parse_err:
                return tool_id, fn_name, {"status": "error", "error": f"Invalid JSON args: {parse_err}"}

            try:
                result = await asyncio.wait_for(
                    execute_agent_tool(tool_name=fn_name, arguments=fn_args, user_id=user_id,db=db,chat_id=assistant_chat_id,notify_callback=notify_callback),
                    timeout=45.0
                )
                return tool_id, fn_name, result
            except asyncio.TimeoutError:
                return tool_id, fn_name, {"status": "error", "error": f"Tool '{fn_name}' timed out after 45s."}
            except Exception as tool_err:
                return tool_id, fn_name, {"status": "error", "error": str(tool_err)}

        tool_tasks = [_run_single_tool(tc) for tc in response_message.tool_calls]
        tool_results = await asyncio.gather(*tool_tasks)

        for tool_id, fn_name, result in tool_results:
            task_record = {
                "tool_call_id": tool_id,
                "tool": fn_name,
                "result": result,
                "turn": turn
            }
            all_executed_tasks.append(task_record)

            messages.append({
                "role": "tool",
                "tool_call_id": tool_id,
                "content": json.dumps(result if isinstance(result, (dict, list)) else {"output": str(result)})
            })
    else:
        final_content = "Reached maximum step limit during execution."

    execution_time_ms = round((time.perf_counter() - start_time) * 1000, 2)

    asyncio.create_task(
        _save_assistant_response(
            db=db,
            chat_id=assistant_chat_id,
            user_id=user_id,
            content=final_content,
            tasks=all_executed_tasks,
            execution_time_ms=execution_time_ms
        )
    )

    return {
        "status": "success",
        "response": final_content,
        "tasks": all_executed_tasks,
        "meta": {
            "execution_time_ms": execution_time_ms,
            "turns_used": len(all_executed_tasks)
        }
    }


async def _call_model_with_retry(user_id: str, messages: list, tools: list, max_tokens: int = 1500, retries: int = 3):
    for attempt in range(retries):
        try:
            return await call_model(
                user_id=user_id,
                messages=messages,
                tools=tools,
                max_tokens=max_tokens
            )
        except Exception as e:
            if attempt == retries - 1:
                raise e
            await asyncio.sleep(0.5 * (2 ** attempt))


async def _save_assistant_response(db,chat_id: ObjectId, user_id: str, content: str, tasks: list, execution_time_ms: float):
    try:
        embedding = await get_text_embedding(content)
        await db["chats"].update_one({"_id": chat_id},
            {"$set": {
                "user_id": user_id,
                "role": "assistant",
                "content": content,
                "embeddings": embedding,
                "tool_calls": tasks,
                "created_at": datetime.now(timezone.utc),
                "type": "tool_execution" if tasks else "general_chat",
                "latency_ms": execution_time_ms
            }},
            upsert=True)
    except Exception as e:
        logger.error(f"[DB Error] Failed to persist final response: {e}")


async def _safe_db_insert(collection, document: dict):
    try:
        await collection.insert_one(document)
    except Exception as e:
        logger.error(f"[DB Error] Insert failed: {e}")