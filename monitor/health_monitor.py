"""Monitor application readiness and report outages and unexpected restarts."""

import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone


INTERNAL_URL = os.getenv("MONITOR_INTERNAL_URL", "http://app:8000/api/health")
PUBLIC_URL = os.getenv("MONITOR_PUBLIC_URL", "").strip()
INTERVAL = max(10, int(os.getenv("MONITOR_INTERVAL_SECONDS", "60")))
FAILURE_THRESHOLD = max(1, int(os.getenv("MONITOR_FAILURE_THRESHOLD", "2")))


def log(event, **details):
    print(json.dumps({"time": datetime.now(timezone.utc).isoformat(), "event": event, **details}), flush=True)


def notify(message):
    token = os.getenv("TELEGRAM_BOT_TOKEN", "")
    chat_id = os.getenv("TELEGRAM_CHAT_ID", "")
    if not token or not chat_id:
        log("alert_not_sent", reason="telegram_not_configured")
        return
    data = urllib.parse.urlencode({"chat_id": chat_id, "text": message}).encode()
    request = urllib.request.Request(
        f"https://api.telegram.org/bot{token}/sendMessage", data=data, method="POST"
    )
    try:
        with urllib.request.urlopen(request, timeout=8) as response:
            response.read()
    except (OSError, urllib.error.HTTPError) as exc:
        log("alert_delivery_failed", error=type(exc).__name__)


def probe(url):
    try:
        with urllib.request.urlopen(url, timeout=8) as response:
            payload = json.load(response)
        if payload.get("status") != "ok" or payload.get("db") != "ok":
            return False, None, "degraded"
        return True, payload.get("uptime_seconds"), "ok"
    except (OSError, ValueError, TypeError) as exc:
        return False, None, type(exc).__name__


class MonitorState:
    def __init__(self, name):
        self.name = name
        self.failures = 0
        self.down = False
        self.last_uptime = None

    def update(self, ok, uptime, reason):
        events = []
        if ok:
            if self.down:
                events.append(("recovered", f"✅ {self.name}: عادت الخدمة للعمل."))
            elif uptime is not None and self.last_uptime is not None and uptime < self.last_uptime:
                events.append(("restarted", f"⚠️ {self.name}: أُعيد تشغيل التطبيق."))
            self.down = False
            self.failures = 0
            if uptime is not None:
                self.last_uptime = uptime
        else:
            self.failures += 1
            if self.failures >= FAILURE_THRESHOLD and not self.down:
                self.down = True
                events.append(("down", f"🚨 {self.name}: الخدمة غير متاحة ({reason})."))
        return events


def main():
    targets = {"internal": (INTERNAL_URL, MonitorState("التطبيق"))}
    if PUBLIC_URL:
        targets["public"] = (PUBLIC_URL, MonitorState("الموقع العام"))
    log("monitor_started", targets=list(targets), interval_seconds=INTERVAL)
    while True:
        for name, (url, state) in targets.items():
            ok, uptime, reason = probe(url)
            for event, message in state.update(ok, uptime, reason):
                log(event, target=name, reason=reason, uptime_seconds=uptime)
                notify(message)
        time.sleep(INTERVAL)


if __name__ == "__main__":
    main()
