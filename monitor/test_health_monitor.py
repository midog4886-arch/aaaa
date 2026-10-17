import unittest
from unittest.mock import patch

from health_monitor import MonitorState


class MonitorStateTests(unittest.TestCase):
    def test_alerts_once_after_repeated_failure_and_on_recovery(self):
        with patch("health_monitor.FAILURE_THRESHOLD", 2):
            state = MonitorState("app")
            self.assertEqual(state.update(False, None, "timeout"), [])
            self.assertEqual(state.update(False, None, "timeout")[0][0], "down")
            self.assertEqual(state.update(False, None, "timeout"), [])
            self.assertEqual(state.update(True, 100, "ok")[0][0], "recovered")

    def test_detects_restart_without_observed_failure(self):
        state = MonitorState("app")
        self.assertEqual(state.update(True, 100, "ok"), [])
        self.assertEqual(state.update(True, 120, "ok"), [])
        self.assertEqual(state.update(True, 3, "ok")[0][0], "restarted")


if __name__ == "__main__":
    unittest.main()
