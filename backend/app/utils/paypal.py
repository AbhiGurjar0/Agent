"""
FastAPI + PayPal Payouts (SANDBOX) - lets an AI agent pay a freelancer.

Setup:
    pip install fastapi uvicorn httpx python-dotenv

.env file:
    PAYPAL_CLIENT_ID=your_sandbox_client_id
    PAYPAL_SECRET=your_sandbox_secret

Run:
    uvicorn main:app --reload

Docs / test UI:
    http://127.0.0.1:8000/docs
"""

import os
import time

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, EmailStr, Field

load_dotenv()

PAYPAL_BASE = "https://api-m.sandbox.paypal.com"  # live: https://api-m.paypal.com
CLIENT_ID = os.getenv("PAYPAL_CLIENT_ID")
SECRET = os.getenv("PAYPAL_SECRET")

MAX_AUTO_PAYOUT = 50.00  # agent can't pay more than this without human approval

# Only these freelancers can be paid (replace with your database lookup).
# Never let the agent pay an email it made up.
FREELANCERS = {
    "freelancer-1": "sb-0ph3v53822775@business.example.com",
}

app = FastAPI(title="Agent Freelancer Payments (PayPal Sandbox)")

_token_cache = {"token": None, "expires_at": 0}


async def get_access_token() -> str:
    """Fetch and cache a PayPal OAuth token."""
    if _token_cache["token"] and time.time() < _token_cache["expires_at"] - 30:
        return _token_cache["token"]

    if not CLIENT_ID or not SECRET:
        raise HTTPException(500, "PAYPAL_CLIENT_ID / PAYPAL_SECRET not set")

    async with httpx.AsyncClient() as client:
        r = await client.post(
            f"{PAYPAL_BASE}/v1/oauth2/token",
            auth=(CLIENT_ID, SECRET),
            data={"grant_type": "client_credentials"},
        )
    if r.status_code != 200:
        raise HTTPException(502, f"PayPal auth failed: {r.text}")

    data = r.json()
    _token_cache["token"] = data["access_token"]
    _token_cache["expires_at"] = time.time() + data["expires_in"]
    return data["access_token"]


class PayRequest(BaseModel):
    freelancer_id: str
    amount: float = Field(gt=0, description="Amount in USD")
    job_id: str = Field(description="Unique per job; prevents double payment")
    note: str = "Payment for completed work"
    human_approved: bool = False


@app.post("/pay-freelancer")
async def pay_freelancer(req: PayRequest):
    # Guardrail 1: only known freelancers
    email = FREELANCERS.get(req.freelancer_id)
    if not email:
        raise HTTPException(404, "Unknown freelancer_id")

    # Guardrail 2: spending cap unless a human approved
    if req.amount > MAX_AUTO_PAYOUT and not req.human_approved:
        raise HTTPException(
            403,
            f"Amount exceeds ${MAX_AUTO_PAYOUT:.2f}. Human approval required.",
        )

    token = await get_access_token()

    payload = {
        "sender_batch_header": {
            # Guardrail 3: unique per job, so retries can't pay twice
            "sender_batch_id": f"job-{req.job_id}",
            "email_subject": "You have received a payment",
        },
        "items": [
            {
                "recipient_type": "EMAIL",
                "receiver": email,
                "amount": {"value": f"{req.amount:.2f}", "currency": "USD"},
                "note": req.note,
                "sender_item_id": f"item-{req.job_id}",
            }
        ],
    }

    async with httpx.AsyncClient() as client:
        r = await client.post(
            f"{PAYPAL_BASE}/v1/payments/payouts",
            json=payload,
            headers={"Authorization": f"Bearer {token}"},
        )

    if r.status_code not in (200, 201):
        raise HTTPException(r.status_code, r.json())

    body = r.json()
    return {
        "status": "submitted",
        "payout_batch_id": body["batch_header"]["payout_batch_id"],
        "batch_status": body["batch_header"]["batch_status"],
    }


@app.get("/payout-status/{batch_id}")
async def payout_status(batch_id: str):
    token = await get_access_token()
    async with httpx.AsyncClient() as client:
        r = await client.get(
            f"{PAYPAL_BASE}/v1/payments/payouts/{batch_id}",
            headers={"Authorization": f"Bearer {token}"},
        )
    if r.status_code != 200:
        raise HTTPException(r.status_code, r.json())
    return r.json()


