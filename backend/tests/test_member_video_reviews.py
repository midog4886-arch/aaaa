"""The parent-facing report must not leak coach-only annotations."""

import asyncio
import os
import sys
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from routes import member_video_reviews as reviews  # noqa: E402


class _Cursor:
    def sort(self, *_args):
        return self

    async def to_list(self, _limit):
        return [{
            "id": "review-1", "member_id": "child-1", "status": "approved",
            "parent_summary": "تحسن في الانطلاق", "coach_summary": "خاص بالمدرب", "storage_name": "secret.mp4", "markers": [
                {"id": "public", "share_with_parent": True, "note": "ملاحظة منشورة", "pose_metrics": {"elbow_angle": 90}},
                {"id": "private", "share_with_parent": False, "note": "ملاحظة خاصة", "pose_metrics": {"knee_angle": 85}},
            ],
        }]


class _Collection:
    def find(self, query, projection):
        assert query == {"member_id": {"$in": ["child-1"]}, "status": "approved"}
        assert projection["_id"] == 0
        return _Cursor()


def test_portal_returns_only_approved_annotations(monkeypatch):
    monkeypatch.setattr(reviews, "db", SimpleNamespace(member_video_reviews=_Collection()))
    result = asyncio.run(reviews.portal_reviews({"id": "child-1", "_linked_member_ids": ["child-1"]}))
    assert [item["id"] for item in result[0]["markers"]] == ["public"]
    assert result[0]["markers"][0]["pose_metrics"] == {"elbow_angle": 90}
    assert "coach_summary" not in result[0]
    assert "storage_name" not in result[0]


def test_drawing_coordinates_are_bounded():
    with pytest.raises(ValidationError):
        reviews.Drawing(x1=-0.1, y1=0.5, x2=0.5, y2=0.5)


def test_sport_and_pose_metrics_are_validated_before_saving():
    review = reviews.ReviewUpdate(title="تسديدة", sport="football", markers=[
        reviews.Marker(id="frame-1", time=1.25, label="لحظة التسديد", pose_side="right",
                       pose_metrics={"knee_angle": 92.0})
    ])
    assert review.model_dump()["markers"][0]["pose_metrics"] == {"knee_angle": 92.0}
    with pytest.raises(ValidationError):
        reviews.ReviewUpdate(title="تسديدة", sport="basketball")
    with pytest.raises(ValidationError):
        reviews.ReviewUpdate(title="تسديدة", sport="football", skill="swimming_freestyle")


def test_approval_rejects_comparison_with_insufficient_tracking(monkeypatch):
    current = {"id": "review-2", "member_id": "child-1", "sport": "swimming", "skill": "swimming_freestyle",
               "parent_summary": "ملخص", "samples": [], "comparison": {
                   "baseline_review_id": "review-1", "baseline_event_time": 1.0, "current_event_time": 1.0,
                   "coach_finding": "ملاحظة", "next_exercise": "تمرين", "share_with_parent": True}}
    baseline = {"id": "review-1", "member_id": "child-1", "sport": "swimming", "skill": "swimming_freestyle",
                "status": "approved", "samples": []}

    async def staff_review(*_args, **_kwargs):
        return current

    class Collection:
        async def find_one(self, *_args, **_kwargs):
            return baseline

    monkeypatch.setattr(reviews, "_staff_review", staff_review)
    monkeypatch.setattr(reviews, "db", SimpleNamespace(member_video_reviews=Collection()))
    with pytest.raises(HTTPException) as error:
        asyncio.run(reviews.set_review_status("review-2", reviews.ReviewStatus(status="approved"), {"user_id": "coach"}))
    assert error.value.status_code == 400
    assert "تتبّع" in error.value.detail
