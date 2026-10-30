# app/schemas/healing_schema.py
from typing import Optional, List
from pydantic import BaseModel, Field

class HealingStrategy(BaseModel):
    blocker_detected: bool = Field(
        description="True if an unexpected popup, modal, cookie banner, CAPTCHA, or layout shift is blocking the action."
    )
    blocker_type: Optional[str] = Field(
        default=None,
        description="Type of blocker found: e.g., 'cookie_banner', 'newsletter_modal', 'selector_not_found', 'captcha'."
    )
    suggested_remedy: str = Field(
        description="Action strategy: 'CLOSE_OVERLAY', 'VISION_CLICK', 'WAIT_AND_RETRY', or 'ABORT_TO_HUMAN'."
    )
    overlay_close_x: Optional[int] = Field(
        default=None,
        description="Physical X coordinate of the close/dismiss button if an overlay is present."
    )
    overlay_close_y: Optional[int] = Field(
        default=None,
        description="Physical Y coordinate of the close/dismiss button if an overlay is present."
    )
    alternative_selector_or_text: Optional[str] = Field(
        default=None,
        description="An alternative CSS selector or visible text string to locate the target element."
    )
    explanation: str = Field(
        description="Brief reasoning behind why the action failed and how the remedy fixes it."
    )