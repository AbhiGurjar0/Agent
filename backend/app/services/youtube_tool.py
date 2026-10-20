import json
import os
from typing import List, Optional
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload
from googleapiclient.errors import HttpError
from app.core.config import settings  # Import your settings instance

YOUTUBE_UPLOAD_SCOPE = ["https://www.googleapis.com/auth/youtube.upload"]

def get_authenticated_youtube_client():
    print("Authenticating YouTube client with provided credentials.")
    credentials = Credentials(
        token=None,
        refresh_token=settings.YOUTUBE_REFRESH_TOKEN,
        token_uri="https://oauth2.googleapis.com/token",
        client_id=settings.YOUTUBE_CLIENT_ID,
        client_secret=settings.YOUTUBE_CLIENT_SECRET,
        scopes=YOUTUBE_UPLOAD_SCOPE,
    )
    return build("youtube", "v3", credentials=credentials)


async def upload_youtube_video(
    file_path: str,
    title: str,
    description: str,
    tags: Optional[List[str]] = None,
    category_id: str = "22",  # Default category "People & Blogs"
    privacy_status: str = "private",  # 'public', 'private', or 'unlisted'
    user_id: Optional[str] = None,
) -> dict:
    """
    Uploads a video file to YouTube via the Data API v3 using a resumable upload chunk system.
    """
    base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))) # adjust relative to your file location
    workspace_dir = os.path.join(base_dir, "workspace")
    if not os.path.exists(file_path):
        # Fallback: Extract just the filename (e.g., 'sample.mp4') and look in the local workspace folder
        filename = os.path.basename(file_path)
        actual_path = os.path.join(workspace_dir, filename)
        
        if os.path.exists(actual_path):
            file_path = actual_path
        else:
            # Ultimate fallback: Grab the most recent .mp4 file in the workspace folder
            mp4_files = [os.path.join(workspace_dir, f) for f in os.listdir(workspace_dir) if f.endswith('.mp4')]
            if mp4_files:
                file_path = max(mp4_files, key=os.path.getctime)
            else:
                return {"status": "error", "message": f"No video files found in workspace directory: {workspace_dir}"}

    print(f"Uploading resolved video file: {file_path}")

    try:
        print(f"Starting upload for file: {file_path} with title: '{title}' and description: '{description}'")
        youtube = get_authenticated_youtube_client()

        # Build request payload
        body = {
            "snippet": {
                "title": title,
                "description": description,
                "tags": tags or [],
                "categoryId": category_id,
            },
            "status": {
                "privacyStatus": privacy_status,
                "selfDeclaredMadeForKids": False,
            },
        }
        print

        # Media upload with chunksize=-1 for resumable uploads
        media = MediaFileUpload(
            file_path,
            chunksize=-1,
            resumable=True,
            mimetype="application/octet-stream"
        )
        print(f"Media upload initialized for file: {file_path}")

        request = youtube.videos().insert(
            part="snippet,status",
            body=body,
            media_body=media
        )

        response = None
        while response is None:
            status, response = request.next_chunk()
            if status:
                print(f"Upload Progress: {int(status.progress() * 100)}%")

        video_id = response.get("id")
        print(f"Upload complete! Video ID: {video_id}, URL: https://www.youtube.com/watch?v={video_id}")
        return {
            "status": "success",
            "video_id": video_id,
            "url": f"https://www.youtube.com/watch?v={video_id}",
            "message": f"Video uploaded successfully as '{privacy_status}'."
        }

    except HttpError as e:
        return {"status": "error", "message": f"HTTP Error during upload: {e}"}
    except Exception as e:
        return {"status": "error", "message": f"Unexpected error: {str(e)}"}