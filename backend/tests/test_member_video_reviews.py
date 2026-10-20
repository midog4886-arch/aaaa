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
                {"id": "public", "share_with_parent": True, "note": "ملاحظة منشورة", "pose_metrics": {"elbow_angle": 90},
                 "corrected_points": {"14": {"x": 0.5, "y": 0.5}}},
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
    assert result[0]["markers"][0]["coach_corrected"] is True
    assert "corrected_points" not in result[0]["markers"][0]
    assert "coach_summary" not in result[0]
    assert "storage_name" not in result[0]
    assert result[0]["has_video"] is True


def test_local_review_stores_only_report_metadata(monkeypatch):
    inserted = []

    async def staff_member(*_args, **_kwargs):
        return {"id": "child-1", "name": "Athlete", "branch_id": "branch-1"}

    class Collection:
        async def count_documents(self, *_args):
            return 0

        async def insert_one(self, doc):
            inserted.append(dict(doc))

    monkeypatch.setattr(reviews, "_staff_member", staff_member)
    monkeypatch.setattr(reviews, "get_current_tenant_slug", lambda: "test")
    monkeypatch.setattr(reviews, "db", SimpleNamespace(member_video_reviews=Collection()))
    result = asyncio.run(reviews.create_local_review(
        "child-1", reviews.LocalReviewCreate(title="Local clip", sport="swimming", skill="swimming_freestyle"),
        {"user_id": "coach"}))
    assert result["video_mode"] == "local"
    assert "storage_name" not in inserted[0]
    assert "file" not in inserted[0]


def test_local_review_has_no_play_ticket(monkeypatch):
    async def staff_review(*_args, **_kwargs):
        return {"id": "local-1", "video_mode": "local"}

    monkeypatch.setattr(reviews, "_staff_review", staff_review)
    with pytest.raises(HTTPException) as error:
        asyncio.run(reviews.play_ticket("local-1", {"user_id": "coach"}))
    assert error.value.status_code == 404


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
    with pytest.raises(ValidationError):
        reviews.Marker(id="frame-2", time=1, label="لقطة", corrected_points={"99": {"x": 0.5, "y": 0.5}})
    with pytest.raises(ValidationError):
        reviews.Marker(id="frame-2", time=1, label="لقطة", corrected_points={"14": {"x": 1.1, "y": 0.5}})


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
