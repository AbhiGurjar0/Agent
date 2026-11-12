# app/services/jobs/paypal_gateway.py
"""
PayPal Payouts gateway (SANDBOX) - drop-in replacement for SimulatedGateway.

.env:
    PAYPAL_CLIENT_ID=...
    PAYPAL_SECRET=...
    PAYPAL_BASE_URL=https://api-m.sandbox.paypal.com      # live: https://api-m.paypal.com
    PAYPAL_DEMO_RECEIVER_EMAIL=your-freelancer-sandbox-personal@example.com   # demo fallback

Requires: pip install httpx
"""
import os
import time
from typing import Any, Dict, Optional

import httpx

BASE = os.getenv("PAYPAL_BASE_URL", "https://api-m.sandbox.paypal.com")
CLIENT_ID = os.getenv("PAYPAL_CLIENT_ID", "")
SECRET = os.getenv("PAYPAL_SECRET", "")
DEMO_EMAIL = os.getenv("PAYPAL_DEMO_RECEIVER_EMAIL", "")

MAX_AUTO_PAYOUT = float(os.getenv("MAX_AUTO_PAYOUT", "500"))  # hard cap per payout

# PayPal batch_status -> our status
_DONE = {"SUCCESS"}
_FAILED = {"DENIED", "CANCELED"}


class PayPalGateway:
    def __init__(self):
        self._token: Optional[str] = None
        self._exp: float = 0

    async def _auth(self) -> str:
        if self._token and time.time() < self._exp - 30:
            return self._token
        async with httpx.AsyncClient(timeout=20) as c:
            r = await c.post(f"{BASE}/v1/oauth2/token", auth=(CLIENT_ID, SECRET),
                             data={"grant_type": "client_credentials"})
        r.raise_for_status()
        d = r.json()
        self._token, self._exp = d["access_token"], time.time() + d["expires_in"]
        return self._token

    @staticmethod
    def _receiver(job: Dict[str, Any]) -> Optional[str]:
        fid = (job.get("freelancer") or {}).get("id")
        cand = next((c for c in job.get("candidates", []) if c.get("id") == fid), None) or {}
        # Use the freelancer's real PayPal email if your agents/candidates store one.
        return cand.get("paypal_email") or cand.get("email") or DEMO_EMAIL or None

    async def charge(self, job: Dict[str, Any], amount: float, currency: str, idem: str) -> Dict[str, Any]:
        if amount > MAX_AUTO_PAYOUT:
            return {"status": "failed", "ref": None, "error": f"Amount exceeds auto-pay cap ({MAX_AUTO_PAYOUT:g})"}
        email = self._receiver(job)
        if not email:
            return {"status": "failed", "ref": None, "error": "No PayPal email for this freelancer"}
        key = idem.replace(":", "-")

        body = {
            "sender_batch_header": {
                "sender_batch_id": key,   # unique per job+attempt
                "email_subject": "You have received a payment",
            
            },
            "items": [{
                "recipient_type": "EMAIL",
                "receiver": email,
                "amount": {"value": f"{amount:.2f}", "currency": currency},
                "note": f"Payment for: {job.get('title', 'job')}"[:160],
                "sender_item_id": key,
                
                
            }],
        }
        try:
            token = await self._auth()
            async with httpx.AsyncClient(timeout=30) as c:
                r = await c.post(
                    f"{BASE}/v1/payments/payouts", json=body,
                    headers={"Authorization": f"Bearer {token}",
                             "PayPal-Request-Id": key},  # PayPal-side idempotency
                )
        except httpx.TimeoutException:
            return {"status": "failed", "ref": None, "ambiguous": True,
                "error": "PayPal timed out (outcome unknown). Retrying safely with the same key"}
           
        except Exception as e:  # noqa: BLE001
            return {"status": "failed", "ref": None, "ambiguous": True, "error": f"PayPal error: {str(e)[:150]}"}

        if r.status_code not in (200, 201):
            try:
                err = r.json().get("message") or r.text
            except Exception:  # noqa: BLE001
                err = r.text
            return {"status": "failed", "ref": None, "ambiguous": r.status_code >= 500,
            "error": f"PayPal {r.status_code}: {str(err)[:200]}"}

        batch_id = r.json()["batch_header"]["payout_batch_id"]
        return {"status": "pending", "ref": batch_id, "error": None}

    async def status(self, ref: str) -> Dict[str, Any]:
        try:
            token = await self._auth()
            async with httpx.AsyncClient(timeout=20) as c:
                r = await c.get(f"{BASE}/v1/payments/payouts/{ref}",
                                headers={"Authorization": f"Bearer {token}"})
            if r.status_code != 200:
                return {"status": "pending", "error": None}   # transient, ticker will ask again
            bs = r.json()["batch_header"]["batch_status"]
        except Exception:  # noqa: BLE001
            return {"status": "pending", "error": None}

        if bs in _DONE:
            return {"status": "confirmed", "error": None}
        if bs in _FAILED:
            return {"status": "failed", "error": f"PayPal batch {bs.lower()}"}
        return {"status": "pending", "error": None}   # PENDING / PROCESSING