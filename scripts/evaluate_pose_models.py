"""Compare local MediaPipe pose models on academy videos without uploading them.

Requires Python 3.12/3.13, mediapipe, and opencv-python. Optional reference CSV:
video,time_seconds,target_center_x,target_center_y (normalized coordinates).
The reference lets this tool report selected-player center error. Without it,
coverage and runtime are diagnostics, not accuracy claims.
"""
from __future__ import annotations

import argparse
import csv
import math
import statistics
import time
from pathlib import Path

import cv2
import mediapipe as mp
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision


TORSO = (11, 12, 23, 24)


def center(points):
    visible = [points[i] for i in TORSO if points[i].visibility >= 0.5]
    if len(visible) < 2:
        return None
    return (sum(point.x for point in visible) / len(visible),
            sum(point.y for point in visible) / len(visible))


def load_reference(path):
    if not path:
        return {}
    with open(path, encoding="utf-8-sig", newline="") as handle:
        rows = csv.DictReader(handle)
        return {(row["video"], round(float(row["time_seconds"]), 2)):
                (float(row["target_center_x"]), float(row["target_center_y"])) for row in rows}


def evaluate(video_path, model_name, model_path, stride, references):
    capture = cv2.VideoCapture(str(video_path))
    fps = capture.get(cv2.CAP_PROP_FPS) or 25
    if not capture.isOpened():
        raise RuntimeError(f"Cannot open video: {video_path}")
    options = vision.PoseLandmarkerOptions(
        base_options=mp_python.BaseOptions(model_asset_path=str(model_path)),
        running_mode=vision.RunningMode.VIDEO, num_poses=6,
        min_pose_detection_confidence=0.5,
        min_pose_presence_confidence=0.5,
        min_tracking_confidence=0.5,
    )
    processed = selected = reliable = reference_frames = reference_matches = 0
    timings = []
    center_errors = []
    previous = None
    with vision.PoseLandmarker.create_from_options(options) as landmarker:
        frame_number = -1
        last_timestamp = -1
        while True:
            okay, frame = capture.read()
            if not okay:
                break
            frame_number += 1
            if frame_number % stride:
                continue
            timestamp = max(last_timestamp + 1, round(frame_number * 1000 / fps))
            last_timestamp = timestamp
            image = mp.Image(image_format=mp.ImageFormat.SRGB,
                             data=cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
            started = time.perf_counter()
            result = landmarker.detect_for_video(image, timestamp)
            timings.append((time.perf_counter() - started) * 1000)
            processed += 1
            centers = [(pose, point) for pose in result.pose_landmarks
                       if (point := center(pose)) is not None]
            if previous is None:
                chosen = max(centers, key=lambda item: sum(p.visibility >= 0.5 for p in item[0]), default=None)
            else:
                nearby = sorted(centers, key=lambda item: math.dist(item[1], previous))
                chosen = nearby[0] if nearby and math.dist(nearby[0][1], previous) < 0.22 else None
                if len(nearby) > 1 and math.dist(nearby[0][1], nearby[1][1]) < 0.08:
                    chosen = None
            if chosen:
                previous = chosen[1]
                selected += 1
                if sum(point.visibility >= 0.5 for point in chosen[0]) >= 8:
                    reliable += 1
            else:
                previous = None
            key = (video_path.name, round(timestamp / 1000, 2))
            if key in references:
                reference_frames += 1
                if chosen:
                    reference_matches += 1
                    center_errors.append(math.dist(chosen[1], references[key]))
    capture.release()
    return {
        "video": video_path.name, "model": model_name, "sampled_frames": processed,
        "selected_frames": selected, "visible_frames": reliable,
        "visible_rate": round(reliable / processed, 3) if processed else 0,
        "mean_inference_ms": round(statistics.mean(timings), 1) if timings else "",
        "reference_frames": reference_frames, "reference_matches": reference_matches,
        "mean_center_error": round(statistics.mean(center_errors), 4) if center_errors else "",
    }


def evaluate_rtmpose(video_path, stride, references):
    """Optional independent detector + RTMPose comparison via rtmlib."""
    from rtmlib import BodyWithFeet, PoseTracker

    capture = cv2.VideoCapture(str(video_path))
    fps = capture.get(cv2.CAP_PROP_FPS) or 25
    if not capture.isOpened():
        raise RuntimeError(f"Cannot open video: {video_path}")
    tracker = PoseTracker(BodyWithFeet, det_frequency=7, mode="balanced",
                          backend="onnxruntime", device="cpu")
    processed = selected = reliable = reference_frames = reference_matches = 0
    timings, center_errors = [], []
    previous = None
    frame_number = -1
    while True:
        okay, frame = capture.read()
        if not okay:
            break
        frame_number += 1
        if frame_number % stride:
            continue
        started = time.perf_counter()
        keypoints, scores = tracker(frame)
        timings.append((time.perf_counter() - started) * 1000)
        processed += 1
        height, width = frame.shape[:2]
        people = []
        for person, likelihood in zip(keypoints, scores):
            indices = [index for index in (5, 6, 11, 12) if len(person) > index and likelihood[index] >= 0.5]
            if len(indices) >= 2:
                position = (sum(float(person[index][0]) for index in indices) / len(indices) / width,
                            sum(float(person[index][1]) for index in indices) / len(indices) / height)
                people.append((position, int(sum(score >= 0.5 for score in likelihood))))
        if previous is None:
            chosen = max(people, key=lambda item: item[1], default=None)
        else:
            nearby = sorted(people, key=lambda item: math.dist(item[0], previous))
            chosen = nearby[0] if nearby and math.dist(nearby[0][0], previous) < 0.22 else None
            if len(nearby) > 1 and math.dist(nearby[0][0], nearby[1][0]) < 0.08:
                chosen = None
        if chosen:
            previous = chosen[0]
            selected += 1
            if chosen[1] >= 8:
                reliable += 1
        else:
            previous = None
        key = (video_path.name, round(frame_number / fps, 2))
        if key in references:
            reference_frames += 1
            if chosen:
                reference_matches += 1
                center_errors.append(math.dist(chosen[0], references[key]))
    capture.release()
    return {
        "video": video_path.name, "model": "rtmpose", "sampled_frames": processed,
        "selected_frames": selected, "visible_frames": reliable,
        "visible_rate": round(reliable / processed, 3) if processed else 0,
        "mean_inference_ms": round(statistics.mean(timings), 1) if timings else "",
        "reference_frames": reference_frames, "reference_matches": reference_matches,
        "mean_center_error": round(statistics.mean(center_errors), 4) if center_errors else "",
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("videos", nargs="+", type=Path)
    parser.add_argument("--models-dir", type=Path, default=Path(__file__).resolve().parents[1] / "frontend/public/mediapipe/models")
    parser.add_argument("--reference", type=Path)
    parser.add_argument("--stride", type=int, default=5, help="Process every Nth frame")
    parser.add_argument("--rtmpose", action="store_true", help="Include RTMPose + separate person detector (requires rtmlib)")
    parser.add_argument("--output", type=Path, default=Path("pose-model-comparison.csv"))
    args = parser.parse_args()
    if args.stride < 1:
        parser.error("--stride must be at least 1")
    references = load_reference(args.reference)
    results = []
    for video_path in args.videos:
        for name in ("lite", "full", "heavy"):
            results.append(evaluate(video_path, name, args.models_dir / f"pose_landmarker_{name}.task", args.stride, references))
            print(results[-1])
        if args.rtmpose:
            results.append(evaluate_rtmpose(video_path, args.stride, references))
            print(results[-1])
    with args.output.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=results[0])
        writer.writeheader()
        writer.writerows(results)


if __name__ == "__main__":
    main()
