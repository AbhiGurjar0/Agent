# app/schemas/vision_schema.py
from typing import Optional
from pydantic import BaseModel, Field

class ScreenErrorAlert(BaseModel):
    has_actionable_error: bool = Field(
        description="True ONLY if a clear terminal error, code exception, build failure, test failure, or actionable warning is currently visible on screen."
    )
    error_summary: Optional[str] = Field(
        default=None,
        description="A concise 1-sentence summary of the error found on screen."
    )
    spoken_recommendation: Optional[str] = Field(
        default=None,
        description="A natural, conversational 1-sentence statement Jarvis should say out loud to the user (e.g., 'Your build failed due to a missing environment variable in .env')."
    )