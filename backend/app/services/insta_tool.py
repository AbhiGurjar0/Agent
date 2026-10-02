import asyncio
import httpx
from app.core.config import settings

async def upload_instagram_reel(video_url: str, caption: str) -> dict:
    """
    Uploads and publishes a Reel to Instagram via Meta Graph API.
    Note: video_url must be a publicly accessible URL (e.g. S3 bucket, Cloudinary, or public web link).
    """
    if not settings.META_ACCESS_TOKEN or not settings.INSTAGRAM_ACCOUNT_ID:
        return {"status": "error", "message": "Instagram API credentials missing in .env"}

    ig_user_id = settings.INSTAGRAM_ACCOUNT_ID
    access_token = settings.META_ACCESS_TOKEN

    async with httpx.AsyncClient(timeout=60.0) as client:
        # Step 1: Create Container
        init_url = f"https://graph.facebook.com/v19.0/{ig_user_id}/media"
        init_res = await client.post(
            init_url,
            data={
                "media_type": "REELS",
                "video_url": video_url,
                "caption": caption,
                "access_token": access_token
            }
        )
        init_data = init_res.json()
        container_id = init_data.get("id")
        
        if not container_id:
            return {"status": "error", "message": f"Instagram container creation failed: {init_data}"}

        # Step 2: Poll Container Status until READY
        status_url = f"https://graph.facebook.com/v19.0/{container_id}"
        for _ in range(12):  # Poll up to 60 seconds
            await asyncio.sleep(5)
            status_res = await client.get(
                status_url, 
                params={"fields": "status_code", "access_token": access_token}
            )
            status_code = status_res.json().get("status_code")
            if status_code == "FINISHED":
                break
            elif status_code == "ERROR":
                return {"status": "error", "message": "Instagram Reel processing failed on Meta servers."}

        # Step 3: Publish Container
        publish_url = f"https://graph.facebook.com/v19.0/{ig_user_id}/media_publish"
        pub_res = await client.post(
            publish_url,
            data={"creation_id": container_id, "access_token": access_token}
        )
        pub_data = pub_res.json()

        if "id" in pub_data:
            return {
                "status": "success",
                "media_id": pub_data["id"],
                "message": "Reel published successfully to Instagram!"
            }
        return {"status": "error", "message": f"Failed to publish Reel: {pub_data}"}