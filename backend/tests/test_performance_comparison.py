import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from utils.performance_comparison import comparison_summary, event_summary  # noqa: E402


def _samples(angle: int, count: int = 8):
    return [{"time": 1 + index * .25, "quality": "valid", "seen": 28,
             "metrics": {"elbow_angle": angle, "hip_angle": 160, "body_tilt": 20}}
            for index in range(count)]


def test_comparison_uses_event_window_and_reports_change_without_scoring_it():
    baseline = {"sport": "swimming", "samples": _samples(120)}
    current = {"sport": "swimming", "samples": _samples(145)}
    result = comparison_summary(current, baseline, {"baseline_event_time": 1.875,
                                                    "current_event_time": 1.875})
    assert result["usable"]
    assert result["deltas"]["elbow_angle"] == 25
    assert "improved" not in result


def test_missing_or_occluded_frames_are_not_filled_in():
    samples = _samples(120, 3)
    samples.append({"time": 1.75, "quality": "lost", "seen": 0, "metrics": {}})
    result = event_summary(samples, 1.5, "swimming")
    assert result["valid_samples"] == 3
    assert result["coverage"] < 0.6
    assert not result["usable"]
