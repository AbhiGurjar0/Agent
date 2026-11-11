### 4. /api/v1/chats/upload   POST  // Upload video to YouTube

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