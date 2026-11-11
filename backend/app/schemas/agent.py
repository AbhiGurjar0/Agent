from datetime import datetime, timezone
from typing import List, Literal, Optional
from pydantic import BaseModel, Field, model_validator

JOB_STATUSES = ["running", "done", "waiting_for_agent", "under_review", "payment_received", "bug_reported"]
JobStatusName = Literal["running", "done", "waiting_for_agent", "under_review", "payment_received", "bug_reported"]
Style = Literal["firm", "balanced", "flexible"]


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class JobStatusUpdate(BaseModel):
    status: JobStatusName


class AgentCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    skills: List[str] = Field(default_factory=list)
    description: str = ""
    # negotiation
    auto_negotiate: bool = False
    ask_price: Optional[float] = Field(default=None, gt=0)
    min_price: Optional[float] = Field(default=None, gt=0)
    currency: str = "USD"
    negotiation_style: Style = "balanced"
    max_rounds: int = Field(default=4, ge=1, le=5)
    instructions: str = Field(default="", max_length=1000)
    paypal_email: Optional[str] = None 

    @model_validator(mode="after")
    def _check(self):
        if self.auto_negotiate and not self.ask_price:
            raise ValueError("Set an asking price for an auto-negotiating agent")
        if self.ask_price and self.min_price and self.min_price > self.ask_price:
            raise ValueError("Minimum price cannot be above the asking price")
        return self


class AgentUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=80)
    skills: Optional[List[str]] = None
    description: Optional[str] = None
    auto_negotiate: Optional[bool] = None
    ask_price: Optional[float] = Field(default=None, gt=0)
    min_price: Optional[float] = Field(default=None, gt=0)
    currency: Optional[str] = None
    negotiation_style: Optional[Style] = None
    max_rounds: Optional[int] = Field(default=None, ge=1, le=5)
    instructions: Optional[str] = Field(default=None, max_length=1000)
    paypal_email: Optional[str] = None 

    @model_validator(mode="after")
    def _check(self):
        if self.ask_price and self.min_price and self.min_price > self.ask_price:
            raise ValueError("Minimum price cannot be above the asking price")
        return self