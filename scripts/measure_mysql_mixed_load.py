"""Bounded multi-account reads, writes and correlated SSE in isolated MySQL.

Runs beside the test app in its container; not a browser/public-network test.
Uses verify_mysql_http_concurrency's non-configurable target and DB guard.
"""

import argparse
from collections import Counter, defaultdict, deque
from concurrent.futures import ThreadPoolExecutor
from http.client import HTTPConnection
import json
import math
import os
import signal
import socket
from threading import Condition, Event, Lock, Thread
from time import monotonic

from verify_mysql_http_concurrency import Harness


def distribution(values):
    ordered = sorted(values)
    return {"count": len(values), **{
        name: round(ordered[max(0, math.ceil(len(values) * p) - 1)], 1) if values else None
        for name, p in (("p50_ms", .5), ("p95_ms", .95), ("p99_ms", .99), ("max_ms", 1))}}


class Measurements:
    def __init__(self, duration):
        self.guard = Lock()
        self.stop = Event()
        self.started = None
        self.duration = duration
        self.samples = defaultdict(list)
        self.recent_queries = deque(maxlen=100)
        self.errors = Counter()
        self.cycles = 0

    def add(self, kind, started, elapsed):
        with self.guard:
            if self.started is not None and self.started <= started < self.started + self.duration:
                self.samples[kind].append(elapsed)
                if kind.startswith("query_"):
                    self.recent_queries.append(elapsed)

    def fail(self, message):
        with self.guard:
            self.errors[message] += 1
        self.stop.set()

    def timed(self, kind, operation):
        started = monotonic()
        result = operation()
        self.add(kind, started, (monotonic() - started) * 1000)
        return result

    def report(self):
        with self.guard:
            return {"steady_seconds_elapsed": round(monotonic() - self.started, 1) if self.started else 0,
                    "completed_cycles": self.cycles, "errors": dict(self.errors),
                    "metrics": {key: distribution(values) for key, values in self.samples.items()}}


class Observer:
    def __init__(self, actor, index, metrics, changed):
        self.actor, self.index, self.metrics, self.changed = actor, index, metrics, changed
        self.ready, self.stopping = Event(), Event()
        self.condition = Condition()
        self.seen = {}
        self.socket = None
        self.frames = 0
        self.thread = Thread(target=self.run, daemon=True)

    def run(self):
        connection = HTTPConnection("127.0.0.1", 8000, timeout=25)
        suffix = "/stream" if self.index == 0 else "/live/stream" if self.index == 1 else "/changes"
        expected = "inventory" if self.index == 0 else "factory-live" if self.index == 1 else "inventory-changed"
        try:
            connection.connect()
            self.socket = connection.sock
            connection.request("GET", "/api/factory-overview" + suffix,
                               headers={"Authorization": "Bearer " + self.actor["token"]})
            response = connection.getresponse()
            assert response.status == 200, "SSE HTTP rejected"
            event = None
            while not self.stopping.is_set():
                raw = response.readline()
                if not raw:
                    raise RuntimeError("SSE unexpected EOF")
                line = raw.decode().strip()
                if line.startswith("event: "):
                    event = line[7:]
                elif line.startswith("data: "):
                    assert event == expected, "Unexpected SSE event"
                    data = json.loads(line[6:])
                    now = monotonic()
                    self.frames += 1
                    self.ready.set()
                    if self.index == 1:
                        with self.condition:
                            for row in data["recent_batches"]:
                                self.seen.setdefault((row["batch_no"], row["status"]), now)
                            self.condition.notify_all()
                    elif self.index > 1:
                        if data.get("team_ids") is None or self.actor["team"] in data["team_ids"]:
                            self.changed.set()
        except Exception as exc:
            if not self.stopping.is_set():
                self.metrics.fail("SSE " + type(exc).__name__)
        finally:
            connection.close()

    def wait_for(self, batch, status, started):
        key = (batch, status)
        with self.condition:
            if not self.condition.wait_for(lambda: key in self.seen, timeout=5):
                raise RuntimeError("SSE batch visibility timeout")
            elapsed = (self.seen[key] - started) * 1000
        # This includes HTTP write time. No precision claim about the DB commit instant.
        self.metrics.add("submit_to_sse_visible", started, elapsed)

    def close(self):
        self.stopping.set()
        if self.socket is not None:
            try:
                self.socket.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
        self.thread.join(timeout=3)
        assert not self.thread.is_alive(), "SSE reader did not stop"


def run(qa, duration):
    metrics = Measurements(duration)
    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, lambda *_: metrics.fail("external_stop"))
    changes = [Event() for _ in qa.actors]
    observers = [Observer(actor, i, metrics, changes[i]) for i, actor in enumerate(qa.actors)]
    initial = qa.reconcile()
    cycles_before = qa.initial_records
    locks_before = lock_counters(qa)

    def reader(index):
        actor, iteration = qa.actors[index], 0
        metrics.stop.wait(index * .04)
        try:
            while not metrics.stop.is_set():
                changes[index].clear()
                team = actor["team"]
                for view in ("overview", "inventory"):
                    query = f"?page={1 + iteration % 2}&page_size=10" if view == "inventory" else ""
                    metrics.timed("query_" + view, lambda view=view, query=query: qa.request(
                        actor, f"/api/team-materials/{team}/{view}{query}"))
                iteration += 1
                changes[index].wait(timeout=5)
        except Exception as exc:
            metrics.fail("query " + type(exc).__name__)

    def writer(lane):
        iteration = 0
        try:
            # Separate source and receiving accounts per lane; unique source batches.
            source, target = qa.warehouse[lane], qa.receivers[lane]
            while not metrics.stop.is_set():
                key = f"soak-{lane}-{iteration}"
                lot = metrics.timed("write_receipt", lambda: qa.receipt(key, 10, actor=source))
                started = monotonic()
                status, dispatched = metrics.timed("write_dispatch", lambda: qa.dispatch(source, lot, key + "-out", 8))
                assert status == 201, f"Unexpected write contention on a distinct source: {dispatched.get('detail')}"
                line = dispatched["items"][0]
                observers[1].wait_for(line["batch_no"], "pending", started)
                started = monotonic()
                status, _ = metrics.timed("write_confirm", lambda: qa.confirm(target, line, key + "-in"))
                assert status == 200, "Unexpected confirmation conflict"
                observers[1].wait_for(line["batch_no"], "received", started)
                status, _ = metrics.timed("write_loss", lambda: qa.loss(source, lot, key + "-loss", 2))
                assert status == 201, "Unexpected loss conflict"
                with metrics.guard:
                    metrics.cycles += 1
                iteration += 1
                metrics.stop.wait(8)
        except Exception as exc:
            metrics.fail("write " + type(exc).__name__ + ": " + str(exc))

    try:
        for observer in observers:
            observer.thread.start()
        assert all(observer.ready.wait(timeout=10) for observer in observers), "SSE startup failed"
        with ThreadPoolExecutor(max_workers=25) as pool:
            jobs = [pool.submit(reader, i) for i in range(2, 25)]
            metrics.stop.wait(5)  # Warm reads and all SSE first frames are excluded.
            metrics.started = monotonic()
            jobs.extend(pool.submit(writer, lane) for lane in range(2))
            try:
                while monotonic() - metrics.started < duration and not metrics.stop.is_set():
                    if metrics.stop.wait(min(15, duration - (monotonic() - metrics.started))):
                        break
                    report = metrics.report()
                    print(json.dumps({"mixed_progress": report}), flush=True)
                    with metrics.guard:
                        recent = list(metrics.recent_queries)
                    if len(recent) >= 20 and distribution(recent)["p95_ms"] > 3000:
                        metrics.fail("query_p95_above_3_seconds")
            finally:
                metrics.stop.set()
                for changed in changes:
                    changed.set()
                for job in jobs:
                    job.result(timeout=20)
        result = metrics.report()
        result["requested_steady_seconds"] = duration
        result["independent_accounts"] = len(qa.actors)
        result["starting_material_records"] = cycles_before
        result["sse_frames"] = [o.frames for o in observers]
        final = qa.reconcile()
        result["reconciled_final"] = final
        if not result["errors"]:
            assert final["quantity"] == initial["quantity"] + metrics.cycles * 8
            assert round(final["weight"] - initial["weight"], 3) == round(metrics.cycles * .8, 3)
        after = lock_counters(qa)
        result["mysql_lock_counter_delta"] = {key: after[key] - value for key, value in locks_before.items()}
        print(json.dumps({"mixed_result": result, "production_business_writes": 0}), flush=True)
        assert not result["errors"], "Mixed load stopped on a protection condition"
    finally:
        for observer in observers:
            observer.close()


def lock_counters(qa):
    from sqlalchemy import text
    with qa.Session() as db:
        return {name: int(value) for name, value in db.execute(text(
            "SHOW GLOBAL STATUS WHERE Variable_name IN ('Innodb_row_lock_waits', 'Innodb_row_lock_time', 'Innodb_deadlocks')"))}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--confirm-disposable", action="store_true", required=True)
    parser.add_argument("--seconds", type=int, choices=(60, 300), default=300)
    arguments = parser.parse_args()
    harness = Harness()
    try:
        print(json.dumps({"probe_pid": os.getpid(), "test": "isolated mixed HTTP/SSE",
                          "steady_seconds": arguments.seconds, "accounts": len(harness.actors)}), flush=True)
        run(harness, arguments.seconds)
    finally:
        harness.close()
