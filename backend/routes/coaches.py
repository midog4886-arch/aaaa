from fastapi import APIRouter, HTTPException, Depends
from typing import List, Optional
from datetime import datetime, timezone
import uuid

from database import db
from models.coach import CoachCreate, Coach
from utils.auth import get_current_user

router = APIRouter(prefix="/coaches", tags=["Coaches"])

@router.get("", response_model=List[Coach])
async def get_coaches(
    branch_filter: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    is_admin = current_user.get("is_admin", False)
    branch_id = current_user.get("branch_id")
    
    if is_admin:
        if branch_filter and branch_filter != "all":
            coaches = await db.coaches.find(
                {"$or": [{"branch_id": branch_filter}, {"branch_id": None}, {"branch_id": {"$exists": False}}]},
                {"_id": 0}
            ).to_list(100)
        else:
            coaches = await db.coaches.find({}, {"_id": 0}).to_list(100)
    else:
        coaches = await db.coaches.find(
            {"$or": [{"branch_id": branch_id}, {"branch_id": None}, {"branch_id": {"$exists": False}}]}, 
            {"_id": 0}
        ).to_list(100)
    return coaches

@router.post("", response_model=Coach)
async def create_coach(coach: CoachCreate, current_user: dict = Depends(get_current_user)):
    coach_id = str(uuid.uuid4())
    is_admin = current_user.get("is_admin", False)
    
    if is_admin and coach.branch_id:
        final_branch_id = coach.branch_id if coach.branch_id != "all" else None
    else:
        final_branch_id = current_user.get("branch_id")
    
    coach_doc = {
        "id": coach_id,
        **coach.model_dump(),
        "branch_id": final_branch_id,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.coaches.insert_one(coach_doc)
    return Coach(**{k: v for k, v in coach_doc.items() if k != "_id"})

@router.put("/{coach_id}", response_model=Coach)
async def update_coach(coach_id: str, coach: CoachCreate, current_user: dict = Depends(get_current_user)):
    result = await db.coaches.find_one_and_update(
        {"id": coach_id},
        {"$set": coach.model_dump()},
        return_document=True
    )
    if not result:
        raise HTTPException(status_code=404, detail="Coach not found")
    return Coach(**{k: v for k, v in result.items() if k != "_id"})

@router.delete("/{coach_id}")
async def delete_coach(coach_id: str, current_user: dict = Depends(get_current_user)):
    result = await db.coaches.delete_one({"id": coach_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Coach not found")
    return {"message": "Coach deleted"}
