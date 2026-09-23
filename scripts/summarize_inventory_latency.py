"""Summarize safe application stage logs; never print IDs or business data."""

import argparse
from collections import defaultdict
from datetime import datetime
import json
from pathlib import Path

from measure_mysql_mixed_load import distribution


def summarize(path):
    rows = []
    for line in Path(path).read_text().splitlines():
        try:
            row = json.loads(line)
        except ValueError:
            continue
        if isinstance(row, dict) and "event" in row and "time" in row:
            rows.append(row)
    commits = {
        row["request_id"]: row
        for row in rows
        if row["event"] == "notification.transaction_committed" and row.get("request_id")
    }
    staged = {
        row["message_id"]: row.get("request_id")
        for row in rows
        if row["event"] == "notification.staged"
    }
    samples = defaultdict(list)
    for row in rows:
        event = row["event"]
        if event == "request.completed" and row.get("route", "").startswith(
            ("/api/team-materials", "/api/material-transfers")
        ):
            name = f"{row['method']} {row['route']}"
            for field in ("duration_ms", "sql_ms", "sql_count"):
                if field in row:
                    samples[name + " " + field].append(row[field])
        elif event == "inventory.snapshot.built":
            for field in ("duration_ms", "sql_ms", "sql_count"):
                samples[f"snapshot {row['view']} {field}"].append(row[field])
        elif event == "inventory.snapshot.encoded":
            samples[f"encode {row['view']} ms"].append(row["duration_ms"])
        elif event == "notification.publish_finished" and row["success"]:
            samples["broker_publish_round_trip_ms"].append(row["duration_ms"])
        if event in ("notification.claimed", "notification.consumed"):
            commit = commits.get(staged.get(row.get("message_id")))
            if commit:
                elapsed = (
                    datetime.fromisoformat(row["time"]) - datetime.fromisoformat(commit["time"])
                ).total_seconds() * 1000
                samples["commit_to_" + event.split(".")[1] + "_ms"].append(elapsed)
    return {
        name: {key.removesuffix("_ms"): value for key, value in distribution(values).items()}
        for name, values in sorted(samples.items())
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("log", type=Path)
    print(json.dumps(summarize(parser.parse_args().log), ensure_ascii=False, indent=2))
