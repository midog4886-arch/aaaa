"""Conservative, coach-reviewed before/after summaries for pose video samples."""

from __future__ import annotations

from math import isfinite
from statistics import median

PRIMARY_METRICS = {
    "swimming": ("elbow_angle", "hip_angle"),
    "football": ("knee_angle", "hip_angle"),
}
WINDOW_SECONDS = 1.0
EXPECTED_SAMPLES = 8  # Samples are stored at most four times per second.


def event_summary(samples: list[dict], anchor: float, sport: str) -> dict:
    """Return an event window; absent/occluded frames lower measured coverage."""
    primary = PRIMARY_METRICS.get(sport, ())
    buckets = {}
    for sample in samples:
        time = float(sample.get("time", -1))
        if abs(time - anchor) <= WINDOW_SECONDS:
            buckets[round(time * 4)] = sample
    usable = [sample for sample in buckets.values()
              if sample.get("quality") == "valid"
              and all(isinstance(sample.get("metrics", {}).get(key), (int, float))
                      and isfinite(sample["metrics"][key]) for key in primary)]
    coverage = min(1.0, len(usable) / EXPECTED_SAMPLES)
    values = {}
    for key in (*primary, "body_tilt"):
        numbers = [sample.get("metrics", {}).get(key) for sample in usable]
        numbers = [number for number in numbers if isinstance(number, (int, float)) and isfinite(number)]
        if numbers:
            values[key] = round(median(numbers), 1)
    return {"coverage": round(coverage, 2), "valid_samples": len(usable),
            "sampled_frames": len(buckets), "values": values,
            "usable": coverage >= 0.6 and len(usable) >= 5}


def comparison_summary(current: dict, baseline: dict, comparison: dict) -> dict:
    sport = current.get("sport", "swimming")
    before = event_summary(baseline.get("samples", []), comparison["baseline_event_time"], sport)
    after = event_summary(current.get("samples", []), comparison["current_event_time"], sport)
    deltas = {key: round(value - before["values"][key], 1)
              for key, value in after["values"].items() if key in before["values"]}
    return {"before": before, "after": after, "deltas": deltas,
            "usable": before["usable"] and after["usable"]}
