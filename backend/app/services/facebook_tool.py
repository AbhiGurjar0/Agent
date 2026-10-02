import httpx
from app.core.config import settings

async def upload_facebook_video(file_path_or_url: str, title: str, description: str) -> dict:
    """
    Uploads a video to a Facebook Page using Meta Graph API.
    Supports either local file path upload or direct web URL.
    """
    if not settings.META_ACCESS_TOKEN or not settings.FACEBOOK_PAGE_ID:
        return {"status": "error", "message": "Facebook API credentials missing in .env"}

    page_id = settings.FACEBOOK_PAGE_ID
    access_token = settings.META_ACCESS_TOKEN
    url = f"https://graph-video.facebook.com/v19.0/{page_id}/videos"

    async with httpx.AsyncClient(timeout=120.0) as client:
        # If it's a web URL
        if file_path_or_url.startswith("http://") or file_path_or_url.startswith("https://"):
            response = await client.post(
                url,
                data={
                    "file_url": file_path_or_url,
                    "title": title,
                    "description": description,
                    "access_token": access_token
                }
            )
        else:
            # Local binary file upload
            with open(file_path_or_url, "rb") as video_file:
                response = await client.post(
                    url,
                    data={
                        "title": title,
                        "description": description,
                        "access_token": access_token
                    },
                    files={"source": video_file}
                )

        res_data = response.json()
        if "id" in res_data:
            return {
                "status": "success",
                "facebook_video_id": res_data["id"],
                "message": "Video successfully uploaded to Facebook Page!"
            }
        return {"status": "error", "message": f"Facebook upload failed: {res_data}"}