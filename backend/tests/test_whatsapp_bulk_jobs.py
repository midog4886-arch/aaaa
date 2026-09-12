import asyncio
import os
import sys
from copy import deepcopy
from datetime import datetime, timedelta, timezone

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from services import whatsapp_bulk_jobs as jobs


def run(coro):
    return asyncio.run(coro)


async def finish_tenant_tick(tenant=None):
    result = await jobs._tenant_tick(tenant)
    tasks = list(jobs._inflight_branch_tasks.values())
    if tasks:
        await asyncio.gather(*tasks)
    return result


class Clock(datetime):
    value = datetime(2026, 1, 1, 8, 0, tzinfo=timezone.utc)

    @classmethod
    def now(cls, _tz=None):
        return cls.value

    @classmethod
    def set(cls, value):
        cls.value = value


def match(row, query):
    for key, expected in query.items():
        if key == "$or":
            if not any(match(row, option) for option in expected):
                return False
            continue
        actual = row.get(key)
        if isinstance(expected, dict):
            for op, value in expected.items():
                if op == "$exists" and ((key in row) != value):
                    return False
                if op == "$lte" and not (actual is not None and actual <= value):
                    return False
                if op == "$lt" and not (actual is not None and actual < value):
                    return False
                if op == "$in" and actual not in value:
                    return False
                if op == "$nin" and actual in value:
                    return False
                if op == "$ne" and actual == value:
                    return False
        elif actual != expected:
            return False
    return True


class Cursor:
    def __init__(self, rows):
        self.rows = [deepcopy(row) for row in rows]

    def sort(self, key, direction=None):
        if direction is None:
            assert isinstance(key, list)
            for field, field_direction in reversed(key):
                self.rows.sort(
                    key=lambda row: (
                        row.get(field) is not None,
                        row.get(field),
                    ),
                    reverse=field_direction < 0,
                )
            return self
        self.rows.sort(
            key=lambda row: (row.get(key) is not None, row.get(key)),
            reverse=direction < 0,
        )
        return self

    def limit(self, number):
        self.rows = self.rows[:number]
        return self

    async def to_list(self, length):
        return self.rows[:length]

    def __aiter__(self):
        self._iterator = iter(self.rows)
        return self

    async def __anext__(self):
        try:
            return next(self._iterator)
        except StopIteration:
            raise StopAsyncIteration


class Collection:
    def __init__(self):
        self.rows = []
        self.lock = asyncio.Lock()

    async def create_index(self, *_args, **_kwargs):
        return "index"

    async def insert_one(self, row):
        self.rows.append(deepcopy(row))

    async def insert_many(self, rows):
        self.rows.extend(deepcopy(rows))

    async def delete_one(self, query):
        self.rows[:] = [row for row in self.rows if not match(row, query)]

    async def find_one(self, query, projection=None):
        row = next((row for row in self.rows if match(row, query)), None)
        return deepcopy(row) if row else None

    def find(self, query, projection=None):
        return Cursor(row for row in self.rows if match(row, query))

    async def update_one(self, query, update, upsert=False):
        async with self.lock:
            row = next((row for row in self.rows if match(row, query)), None)
            if row is None and upsert:
                row = {key: value for key, value in query.items()
                       if not key.startswith("$") and not isinstance(value, dict)}
                row.update(deepcopy(update.get("$setOnInsert", {})))
                self.rows.append(row)
            if row is not None:
                row.update(deepcopy(update.get("$set", {})))
                for key in update.get("$unset", {}):
                    row.pop(key, None)
                for key, value in update.get("$inc", {}).items():
                    row[key] = row.get(key, 0) + value
            return type("Result", (), {"matched_count": int(row is not None)})()

    async def update_many(self, query, update):
        count = 0
        for row in self.rows:
            if match(row, query):
                row.update(deepcopy(update.get("$set", {})))
                for key in update.get("$unset", {}):
                    row.pop(key, None)
                count += 1
        return type("Result", (), {"modified_count": count})()

    async def find_one_and_update(self, query, update, sort=None, **_kwargs):
        async with self.lock:
            candidates = [row for row in self.rows if match(row, query)]
            if sort:
                for key, direction in reversed(sort):
                    candidates.sort(key=lambda row: row.get(key), reverse=direction < 0)
            if not candidates:
                return None
            row = candidates[0]
            row.update(deepcopy(update.get("$set", {})))
            return deepcopy(row)

    def aggregate(self, pipeline):
        query = pipeline[0]["$match"]
        if (
            len(pipeline) > 2
            and "$group" in pipeline[2]
            and pipeline[2]["$group"]["_id"] == "$branch_id"
        ):
            rows = [deepcopy(row) for row in self.rows if match(row, query)]
            sort_spec = pipeline[1]["$sort"]
            for field, direction in reversed(list(sort_spec.items())):
                rows.sort(
                    key=lambda row: (
                        row.get(field) is not None,
                        row.get(field),
                    ),
                    reverse=direction < 0,
                )
            grouped = {}
            for row in rows:
                branch_id = row.get("branch_id")
                if branch_id in grouped:
                    continue
                grouped[branch_id] = {
                    "_id": branch_id,
                    "head_created_at": row.get("created_at"),
                    "head_id": row.get("_id"),
                }
            rows = list(grouped.values())
            sort_spec = pipeline[3]["$sort"]
            for field, direction in reversed(list(sort_spec.items())):
                rows.sort(
                    key=lambda row: (
                        row.get(field) is not None,
                        row.get(field),
                    ),
                    reverse=direction < 0,
                )
            return Cursor({"branch_id": row["_id"]} for row in rows)
        counts = {}
        for row in self.rows:
            if match(row, query):
                counts[row["status"]] = counts.get(row["status"], 0) + 1
        return Cursor({"_id": key, "n": value} for key, value in counts.items())


class DB:
    def __init__(self):
        self.data = {}

    def __getitem__(self, name):
        return self.data.setdefault(name, Collection())


@pytest.fixture
def queue(monkeypatch):
    db = DB()
    Clock.set(datetime(2026, 1, 1, 8, 0, tzinfo=timezone.utc))
    monkeypatch.setattr(jobs, "datetime", Clock)
    sent = []
    reservations = []
    releases = []

    async def send(item, _config, assert_fence):
        await assert_fence()
        sent.append((Clock.now(), item["branch_id"], item["provider"], item["id"]))
        return True

    async def reserve(branch, _limit, amount):
        reservation = {"_id": f"{branch}:{Clock.now().date()}", "amount": amount}
        reservations.append(reservation)
        return reservation

    async def release(key, amount, refund_key):
        releases.append((key, amount))

    async def config(_branch):
        return {"enabled": True, "waha_daily_limit": 30}

    jobs.configure(db, get_config=config, validate_config=lambda _p, _c: None,
                   reserve_quota=reserve, release_quota=release, send=send)
    return db, sent, reservations, releases


def recipients(count=1):
    return [{"phone": f"96650000000{i}", "message": f"message {i}"} for i in range(count)]


def test_enqueue_is_idempotent_and_media_expands_to_durable_items(queue):
    db, *_ = queue
    first, created = run(jobs.enqueue("a", "meta_cloud", recipients(2), "stable-key-123",
                                      [{"attachment_id": "one"}, {"attachment_id": "two"}]))
    second, created_again = run(jobs.enqueue("a", "meta_cloud", recipients(2), "stable-key-123"))
    assert created is True and created_again is False
    assert second["id"] == first["id"]
    assert first["total"] == 4
    assert len(db["whatsapp_campaign_job_items"].rows) == 4


def test_gate_is_branch_wide_across_jobs_workers_and_provider_change(queue):
    db, sent, *_ = queue
    run(jobs.enqueue("a", "meta_cloud", recipients(), "job-a-meta-123"))
    run(jobs.enqueue("a", "waha", recipients(), "job-a-waha-123"))
    run(jobs.enqueue("b", "meta_cloud", recipients(), "job-b-meta-123"))
    # Simulated concurrent workers atomically claim distinct rows. Only one lane
    # for branch a may dispatch, while branch b is independent.
    async def workers():
        return await asyncio.gather(jobs.process_one(), jobs.process_one(), jobs.process_one())
    run(workers())
    assert [(branch, provider) for _, branch, provider, _ in sent] == [
        ("a", "meta_cloud"), ("b", "meta_cloud")]
    Clock.set(Clock.now() + timedelta(seconds=179))
    run(jobs.process_one())
    assert len(sent) == 2
    Clock.set(Clock.now() + timedelta(seconds=1))
    run(jobs.process_one())
    assert sent[-1][1:3] == ("a", "waha")


def test_cancel_changes_only_pending_and_preserves_inflight(queue):
    db, *_ = queue
    job, _ = run(jobs.enqueue("a", "meta_cloud", recipients(3), "cancel-key-123"))
    items = db["whatsapp_campaign_job_items"].rows
    items[0]["status"] = "dispatching"
    result = run(jobs.cancel(job["id"], "a"))
    assert [item["status"] for item in items] == ["dispatching", "cancelled", "cancelled"]
    assert result["pending"] == 1
    assert result["cancelled"] == 2


def test_uncertain_provider_exception_is_unknown_and_never_retried(queue):
    db, sent, reservations, releases = queue

    async def uncertain(_item, _config, _assert_fence):
        raise TimeoutError("response lost")

    jobs._handlers["send"] = uncertain
    job, _ = run(jobs.enqueue("a", "waha", recipients(), "unknown-key-123"))
    assert run(jobs.process_one()) is True
    item = db["whatsapp_campaign_job_items"].rows[0]
    assert item["status"] == "unknown"
    assert run(jobs.process_one()) is False
    assert len(reservations) == 1 and releases == []
    assert run(jobs.get_job(job["id"], "a"))["unknown"] == 1


def test_expired_dispatch_lease_recovers_to_unknown_without_send(queue):
    db, sent, *_ = queue
    job, _ = run(jobs.enqueue("a", "meta_cloud", recipients(), "crash-key-123"))
    item = db["whatsapp_campaign_job_items"].rows[0]
    item.update(status="dispatching", lease_until=Clock.now() - timedelta(seconds=1))
    assert run(jobs.process_one()) is False
    assert item["status"] == "unknown"
    assert sent == []
    assert run(jobs.get_job(job["id"], "a"))["unknown"] == 1


def test_expired_dispatch_lease_notifies_followup_status_callback(queue):
    db, sent, *_ = queue
    observed = []
    async def completed(item, status):
        observed.append((item["id"], status))
    jobs._handlers["completed"] = completed
    run(jobs.enqueue(
        "a", "meta_cloud",
        [{**recipients()[0], "communication_kind": "registration_followup"}],
        "followup-crash-key-123", kind="registration_followup",
    ))
    item = db["whatsapp_campaign_job_items"].rows[0]
    item.update(status="dispatching", lease_until=Clock.now() - timedelta(seconds=1))
    assert run(jobs.process_one()) is False
    assert observed == [(item["id"], "unknown")]
    assert sent == []


def test_quota_is_reserved_per_send_on_actual_execution_day_and_failed_released(queue):
    db, sent, reservations, releases = queue
    run(jobs.enqueue("a", "waha", recipients(2), "quota-day-key-123"))
    run(jobs.process_one())
    Clock.set(Clock.now() + timedelta(days=1))

    async def rejected(item, config, assert_fence):
        await queue_send(item, config, assert_fence)
        return False

    queue_send = jobs._handlers["send"]
    jobs._handlers["send"] = rejected
    run(jobs.process_one())
    assert [entry["_id"] for entry in reservations] == ["a:2026-01-01", "a:2026-01-02"]
    assert releases == [("a:2026-01-02", 1)]


def test_worker_does_not_start_or_send_in_test_environment(queue, monkeypatch):
    _db, sent, *_ = queue
    called = []
    monkeypatch.setenv("ENVIRONMENT", "test")
    monkeypatch.setattr(jobs.asyncio, "ensure_future", lambda coro: called.append(coro))
    jobs._started = False
    jobs.start_worker()
    assert called == []
    assert sent == []


def test_slow_worker_sets_cooldown_from_completion_not_gate_acquisition(queue):
    _db, sent, *_ = queue
    run(jobs.enqueue("a", "meta_cloud", recipients(2), "slow-worker-key-123"))
    async def slow_send(item, _config, assert_fence):
        await assert_fence()
        sent.append((Clock.now(), item["id"]))
        Clock.set(Clock.now() + timedelta(minutes=2))
        return True
    jobs._handlers["send"] = slow_send
    run(jobs.process_one())
    completed = Clock.now()
    Clock.set(completed + timedelta(seconds=179))
    assert run(jobs.process_one()) is False
    Clock.set(completed + timedelta(seconds=180))
    assert run(jobs.process_one()) is True
    assert len(sent) == 2


def test_cancel_during_claim_wins_dispatch_cas_and_never_sends(queue):
    db, sent, *_ = queue
    job, _ = run(jobs.enqueue("a", "meta_cloud", recipients(), "cancel-claim-key-123"))
    async def config(_branch):
        await jobs.cancel(job["id"], "a")
        return {"enabled": True}
    jobs._handlers["get_config"] = config
    assert run(jobs.process_one()) is False
    assert sent == []
    assert db["whatsapp_campaign_job_items"].rows[0]["status"] == "cancelled"


def test_crash_after_quota_reserve_freezes_lane_and_does_not_reserve_again(queue):
    db, sent, reservations, _releases = queue
    run(jobs.enqueue("a", "waha", recipients(2), "quota-crash-key-123"))
    collection = db["whatsapp_campaign_job_items"]
    original = collection.update_one
    failed = {"done": False}
    async def fail_persist(query, update, upsert=False):
        if "quota_reservation_id" in update.get("$set", {}) and not failed["done"]:
            failed["done"] = True
            raise RuntimeError("database disconnected after quota commit")
        return await original(query, update, upsert)
    collection.update_one = fail_persist
    assert run(jobs.process_one()) is False
    assert len(reservations) == 1
    assert collection.rows[0]["status"] == "unknown"
    assert db["whatsapp_campaign_rate_gates"].rows[0]["frozen"] is True
    assert run(jobs.process_one()) is False
    assert len(reservations) == 1
    assert sent == []


def test_crashed_claim_owner_honors_cancel_and_releases_orphan_lane(queue):
    db, sent, *_ = queue
    job, _ = run(jobs.enqueue("a", "meta_cloud", recipients(), "orphan-cancel-key-123"))
    item = db["whatsapp_campaign_job_items"].rows[0]
    item.update(status="claimed", claim_token="dead-owner",
                claim_until=Clock.now() - timedelta(seconds=1), lane_token="dead-lane")
    db["whatsapp_campaign_rate_gates"].rows.append({
        "_id": "a", "lease_token": "dead-lane",
        "lease_until": Clock.now() + timedelta(minutes=10),
        "next_allowed_at": datetime(1970, 1, 1, tzinfo=timezone.utc)})
    db["whatsapp_campaign_jobs"].rows[0]["cancel_requested"] = True
    assert run(jobs.process_one()) is False
    assert item["status"] == "cancelled"
    assert "lease_token" not in db["whatsapp_campaign_rate_gates"].rows[0]
    assert sent == []


def test_cancel_requested_during_quota_reservation_refunds_once_without_send(queue):
    db, sent, reservations, releases = queue
    job, _ = run(jobs.enqueue("a", "waha", recipients(), "reserve-cancel-key-123"))
    original_reserve = jobs._handlers["reserve_quota"]
    async def reserve_then_cancel(branch, limit, amount):
        result = await original_reserve(branch, limit, amount)
        await jobs.cancel(job["id"], branch)
        return result
    jobs._handlers["reserve_quota"] = reserve_then_cancel
    assert run(jobs.process_one()) is False
    assert len(reservations) == 1
    assert releases == [("a:2026-01-01", 1)]
    assert db["whatsapp_campaign_job_items"].rows[0]["status"] == "cancelled"
    assert sent == []


def test_uncommitted_parent_never_dispatches_after_final_activation_failure(queue):
    db, sent, *_ = queue
    job, _ = run(jobs.enqueue("a", "meta_cloud", recipients(), "activation-key-123"))
    # Model a DB failure after item activation but before authoritative parent
    # commit: workers must check the parent and refuse the otherwise-pending row.
    db["whatsapp_campaign_jobs"].rows[0]["status"] = "initializing"
    assert run(jobs.process_one()) is False
    assert db["whatsapp_campaign_job_items"].rows[0]["status"] == "initializing"
    assert sent == []


def test_prior_day_quota_reservation_is_refunded_then_unknown_and_frozen(queue):
    db, sent, reservations, releases = queue
    run(jobs.enqueue("a", "waha", recipients(), "old-quota-key-123"))
    item = db["whatsapp_campaign_job_items"].rows[0]
    item.update(quota_reservation_id="a:2025-12-31",
                quota_reserved_at=Clock.now() - timedelta(days=1))
    assert run(jobs.process_one()) is False
    assert reservations == []
    assert releases == [("a:2025-12-31", 1)]
    assert item["status"] == "unknown"
    assert db["whatsapp_campaign_rate_gates"].rows[0]["frozen"] is True
    assert sent == []


def test_frozen_oldest_branch_does_not_starve_independent_branch(queue):
    db, sent, *_ = queue
    run(jobs.enqueue("a", "meta_cloud", recipients(), "frozen-head-key-123"))
    run(jobs.enqueue("b", "meta_cloud", recipients(), "healthy-head-key-123"))
    db["whatsapp_campaign_rate_gates"].rows.append({
        "_id": "a",
        "branch_id": "a",
        "frozen": True,
        "freeze_reason": "uncertain provider outcome",
        "next_allowed_at": Clock.now() - timedelta(seconds=1),
    })

    run(finish_tenant_tick())

    assert [entry[1] for entry in sent] == ["b"]
    assert db["whatsapp_campaign_job_items"].rows[0]["status"] == "pending"
    assert "next_attempt_at" not in db["whatsapp_campaign_job_items"].rows[0]


def test_slow_branch_provider_does_not_block_parallel_branch_tick(queue):
    db, sent, *_ = queue
    run(jobs.enqueue("a", "meta_cloud", recipients(), "slow-branch-key-123"))
    run(jobs.enqueue("b", "meta_cloud", recipients(), "fast-branch-key-123"))
    slow_started = asyncio.Event()
    fast_sent = asyncio.Event()
    release_slow = asyncio.Event()

    async def send(item, _config, assert_fence):
        await assert_fence()
        if item["branch_id"] == "a":
            slow_started.set()
            await release_slow.wait()
        sent.append((Clock.now(), item["branch_id"], item["id"]))
        if item["branch_id"] == "b":
            fast_sent.set()
        return True

    jobs._handlers["send"] = send

    async def exercise():
        assert await jobs._tenant_tick(None) is True
        await slow_started.wait()
        await fast_sent.wait()
        assert any(
            key[1] == "a" and not task.done()
            for key, task in jobs._inflight_branch_tasks.items()
        )
        release_slow.set()
        await asyncio.gather(*list(jobs._inflight_branch_tasks.values()))

    run(exercise())
    assert [entry[1] for entry in sent] == ["b", "a"]


def test_detached_branch_tasks_survive_later_ticks_with_global_bound_and_tenants(
    queue, monkeypatch
):
    db, sent, *_ = queue
    monkeypatch.setattr(jobs, "BRANCH_PARALLELISM", 2)
    run(jobs.enqueue("a", "meta_cloud", recipients(), "tenant-a-slow-key-123"))
    run(jobs.enqueue("b", "meta_cloud", recipients(2), "tenant-a-paced-key-123"))
    run(jobs.enqueue("c", "meta_cloud", recipients(), "tenant-b-key-123"))
    slow_started = asyncio.Event()
    first_b_started = asyncio.Event()
    first_b_sent = asyncio.Event()
    second_b_sent = asyncio.Event()
    c_started = asyncio.Event()
    release_slow = asyncio.Event()
    release_first_b = asyncio.Event()
    release_c = asyncio.Event()

    async def send(item, _config, assert_fence):
        await assert_fence()
        branch = item["branch_id"]
        if branch == "a":
            slow_started.set()
            await release_slow.wait()
        elif branch == "b" and item["recipient_index"] == 0:
            first_b_started.set()
            await release_first_b.wait()
        elif branch == "c":
            c_started.set()
            await release_c.wait()
        sent.append((Clock.now(), branch, item["id"]))
        if branch == "b" and item["recipient_index"] == 0:
            first_b_sent.set()
        elif branch == "b" and item["recipient_index"] == 1:
            second_b_sent.set()
        return True

    jobs._handlers["send"] = send

    async def exercise():
        try:
            assert await jobs._tenant_tick({"slug": "tenant-a"}) is True
            await slow_started.wait()
            await first_b_started.wait()
            assert len(jobs._inflight_branch_tasks) == 2

            # Both global slots are occupied, so another tenant's branch waits
            # without being confused with tenant-a's same process registry.
            assert await jobs._tenant_tick({"slug": "tenant-b"}) is False

            release_first_b.set()
            await first_b_sent.wait()
            while ("tenant-a", "b") in jobs._inflight_branch_tasks:
                await asyncio.sleep(0)
            Clock.set(Clock.now() + timedelta(seconds=181))

            # The slow a task remains held, but b's later item gets a new
            # branch task on a subsequent tick after its 180-second gate.
            assert await jobs._tenant_tick({"slug": "tenant-a"}) is True
            await second_b_sent.wait()
            while ("tenant-a", "b") in jobs._inflight_branch_tasks:
                await asyncio.sleep(0)

            # A later tenant can now use the freed global slot and its task key
            # remains isolated even though this test uses one mocked database.
            assert await jobs._tenant_tick({"slug": "tenant-b"}) is True
            await c_started.wait()
            assert ("tenant-b", "c") in jobs._inflight_branch_tasks
        finally:
            release_slow.set()
            release_first_b.set()
            release_c.set()
            tasks = list(jobs._inflight_branch_tasks.values())
            if tasks:
                await asyncio.gather(*tasks, return_exceptions=True)
            await jobs.stop_worker()

    run(exercise())
    assert [entry[1] for entry in sent[:2]] == ["b", "b"]
    assert {entry[1] for entry in sent[2:]} == {"a", "c"}


def test_future_deferred_head_preserves_branch_fifo_and_pacing(queue):
    db, sent, *_ = queue
    run(jobs.enqueue("a", "meta_cloud", recipients(), "fifo-first-key-123"))
    run(jobs.enqueue("a", "meta_cloud", recipients(), "fifo-second-key-123"))
    items = db["whatsapp_campaign_job_items"].rows
    deferred_until = Clock.now() + timedelta(seconds=30)
    items[0]["next_attempt_at"] = deferred_until

    assert run(jobs.process_one()) is False
    assert sent == []
    assert [item["status"] for item in items] == ["pending", "pending"]

    Clock.set(deferred_until)
    assert run(jobs.process_one()) is True
    assert sent[0][3] == items[0]["id"]

    Clock.set(Clock.now() + timedelta(seconds=179))
    assert run(jobs.process_one()) is False
    assert len(sent) == 1
    Clock.set(Clock.now() + timedelta(seconds=1))
    assert run(jobs.process_one()) is True
    assert [entry[3] for entry in sent] == [items[0]["id"], items[1]["id"]]


def test_inflight_oldest_head_cannot_be_skipped_by_another_worker(queue):
    db, sent, *_ = queue
    run(jobs.enqueue("a", "meta_cloud", recipients(2), "claimed-head-key-123"))
    items = db["whatsapp_campaign_job_items"].rows
    items[0].update(
        status="claimed",
        claim_token="another-worker",
        claim_until=Clock.now() + timedelta(minutes=5),
    )

    assert run(jobs.process_one()) is False
    assert sent == []
    assert items[1]["status"] == "pending"


def test_naive_mongo_queue_timestamps_are_normalized_before_comparison(queue):
    db, sent, *_ = queue
    run(jobs.enqueue("a", "meta_cloud", recipients(), "naive-defer-key-123"))
    item = db["whatsapp_campaign_job_items"].rows[0]
    item["next_attempt_at"] = (
        Clock.now().replace(tzinfo=None) + timedelta(seconds=30)
    )

    assert run(jobs.process_one()) is False
    assert sent == []
