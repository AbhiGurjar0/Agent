# app/routes/approval.py
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from app.ai.approval_manager import approval_manager

router = APIRouter(prefix="/api/v1/approvals", tags=["approvals"])

class ApprovalDecision(BaseModel):
    approval_id: str
    approved: bool

@router.post("/resolve")
async def resolve_tool_approval(decision: ApprovalDecision):
    """Called by UI or voice command handler to confirm or deny a high-risk tool."""
    success = approval_manager.resolve_approval(
        approval_id=decision.approval_id, 
        approved=decision.approved
    )
    if not success:
        raise HTTPException(status_code=404, detail="Approval request not found or expired.")
    return {"status": "success", "approved": decision.approved}