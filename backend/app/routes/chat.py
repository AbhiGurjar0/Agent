from email import header, message
from unittest import result
import json
from app.services.youtube_tool import upload_youtube_video
import httpx

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.concurrency import run_in_threadpool

from app.db.database import get_database
from app.models.chat import chat_document
from app.schemas.chat import ChatCreate
from app.ai.openai import call_model
from app.tools.tools import tools
from app.core.config import settings



router = APIRouter(
    prefix="/chats",
    tags=["Chats"],
)

async def save_chat(chat_data:ChatCreate,db):
    chat = chat_document(
        type = chat_data.type,
        message=chat_data.message,
    )
        
    result =  await db.chats.insert_one(chat)
    chat["id"] = str(result.inserted_id)
    chat.pop("_id", None)
        
    
    return chat
   
   
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
        refresh_token=settings.youtube_refresh_token
    )
    return result 

# @router.post("/",status_code=status.HTTP_201_CREATED)
# async def create_chat(chat_data:ChatCreate,db = Depends(get_database)):
#     result = await save_chat(chat_data,db)
#     if(chat_data.type == "user"):
#         try:
#             bot_text = await run_in_threadpool(
#                 call_json_model, chat_data.message + tools, 1000, "general-message"
#             )
#         except Exception as err:
#             raise HTTPException(
#                 status_code=status.HTTP_502_BAD_GATEWAY,
#                 detail=f"AI call failed: {err}",
#             )
#         bot_chat = await save_chat(
#             ChatCreate(type="bot", message=bot_text), db
#         )
#         return bot_chat
   
#    https://scheduler-theta-six.vercel.app/api/routine
#     return result


async def create_task_in_external_app(title: str, priority: str, cookies: dict = None):
    session_token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjEsInVzZXJuYW1lIjoiQWJoaXNoZWsiLCJpYXQiOjE3OTA2OTY3MjQsImV4cCI6MTc5MTMwMTUyNH0.yan8zL7UmsuP8GFc1TBzkENxFBEXN8ywOOQ2pAZyi24"
    url = "https://scheduler-theta-six.vercel.app/api/routine"
    headers = {"Content-Type": "application/json"}

    async with httpx.AsyncClient() as client:
        res = await client.post(
            url,
            headers=headers,
            json={"title": title, "priority": priority},
            cookies={"session_token": session_token}  # Forwards session cookies automatically
        )

    if res.status_code == 200:
        print(f"Task created successfully in external app: Title='{title}', Priority='{priority}'")
    else:
        print(f"Failed to create task in external app: Status Code={res.status_code}, Response={res.text}")
    # You can replace this with actual API calls to your external app.

@router.post("/",status_code=status.HTTP_201_CREATED)
async def create_chat(chat_data:ChatCreate,db = Depends(get_database)):
    # result = await save_chat(chat_data,db)
    messages = [
        {"role": "system", "content": "You are a helpful assistant."},
        {"role": "user", "content": chat_data.message},
    ]
    response = await call_model(messages=messages, tools=tools, max_tokens=1000)
    
    response_message = response.choices[0].message
    print(f"Model response: {response_message.content}")
    print(f"Model response Tools: {response_message.tool_calls}")
    print(f"Model response_fully: {response_message}")
    

    # Check if the model decided to call a function/tool
    if response_message.tool_calls:
        for tool_call in response_message.tool_calls:
            function_name = tool_call.function.name
            function_args = json.loads(tool_call.function.arguments)
            print(f"Function call: {function_name} with args {function_args}")
            if function_name == "save_memory":
                # Handle your DB save logic here
                print(f"Saving memory: {function_args}")
            elif function_name == "search_memory":
                # Handle your DB search logic here
                print(f"Searching memory: {function_args}")
            elif function_name == "create_task":
                # Handle your task creation logic here
                print(f"Creating task: {function_args}")
                await create_task_in_external_app(
                    title=function_args.get("title"),
                    priority=function_args.get("priority", "medium")
                )
            elif function_name == "create_reminder":
                # Handle your reminder creation logic here
                print(f"Creating reminder: {function_args}")
            elif function_name == "upload_youtube_video":
                args = json.loads(tool_call.function.arguments)
                result = await upload_youtube_video(
                    file_path=args.get("file_path"),
                    title=args.get("title"),
                    description=args.get("description"),
                    tags=args.get("tags"),
                    privacy_status=args.get("privacy_status", "private")
                )
                print(f"Upload result: {result}")

                messages.append({
                    "role": "tool",
                    "tool_call_id": tool_call.id,
                    "content": json.dumps(result)
                })
                print(f"Tool response added to messages: {messages[-1]}")
            else:
                print(f"Unknown function call: {function_name} with args {function_args}")

    return {"response": response_message.content or "Tool action executed."}
        

   


@router.get("/",status_code=status.HTTP_200_OK)
async def get_chat(db = Depends(get_database)):

    chats = []
    results = db.chats.find()
    async for chat in results:
        chat["id"] = str(chat["_id"])
        chat.pop("_id", None)

        chats.append(chat)
        
    
    return chats
    
    
    


