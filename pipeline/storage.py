"""Persistent expert decisions and an immutable audit trail."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import sqlite3
from typing import Any


VALID_TRACKS = {"estimate", "requisite"}
VALID_ROLES = {"expert", "controller"}
VALID_DECISIONS = {"accepted", "rejected"}


class DecisionConflict(RuntimeError):
    """Raised when another reviewer changed an item before this write."""


@dataclass(frozen=True)
class ReviewState:
    status: str
    label: str
    version: int
    accepted_roles: tuple[str, ...]
    last_actor: str | None = None
    last_updated_at: str | None = None


class DecisionStore:
    def __init__(self, path: str | Path | None = None):
        default_path = Path(__file__).resolve().parents[1] / ".data" / "review.db"
        self.path = Path(path or os.getenv("REVIEW_DB_PATH", default_path))
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path, timeout=10)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA journal_mode = WAL")
        return connection

    def _initialize(self) -> None:
        with self._connect() as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS decisions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    track TEXT NOT NULL,
                    item_id TEXT NOT NULL,
                    decision TEXT NOT NULL,
                    role TEXT NOT NULL,
                    actor TEXT NOT NULL,
                    comment TEXT NOT NULL DEFAULT '',
                    severity TEXT,
                    evidence_json TEXT NOT NULL DEFAULT '{}',
                    model_metadata_json TEXT NOT NULL DEFAULT '{}',
                    created_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_decisions_item
                    ON decisions(track, item_id, id);
                CREATE TABLE IF NOT EXISTS audit_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    event_type TEXT NOT NULL,
                    track TEXT NOT NULL,
                    item_id TEXT NOT NULL,
                    actor TEXT NOT NULL,
                    role TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_audit_item
                    ON audit_events(track, item_id, id);
                """
            )

    def version(self, track: str, item_id: str) -> int:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT COALESCE(MAX(id), 0) AS version FROM decisions WHERE track=? AND item_id=?",
                (track, item_id),
            ).fetchone()
        return int(row["version"])

    def record(
        self,
        *,
        track: str,
        item_id: str,
        decision: str,
        role: str,
        actor: str,
        expected_version: int,
        severity: str | None = None,
        comment: str = "",
        evidence: dict[str, Any] | None = None,
        model_metadata: dict[str, Any] | None = None,
    ) -> int:
        if track not in VALID_TRACKS:
            raise ValueError(f"Unknown track: {track}")
        if role not in VALID_ROLES:
            raise ValueError(f"Unknown role: {role}")
        if decision not in VALID_DECISIONS:
            raise ValueError(f"Unknown decision: {decision}")
        actor = actor.strip()
        if not actor:
            raise ValueError("Reviewer name must not be empty")

        now = datetime.now(timezone.utc).isoformat()
        payload = {
            "decision": decision,
            "severity": severity,
            "comment": comment,
            "expected_version": expected_version,
        }
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            current = connection.execute(
                "SELECT COALESCE(MAX(id), 0) AS version FROM decisions WHERE track=? AND item_id=?",
                (track, item_id),
            ).fetchone()["version"]
            if int(current) != int(expected_version):
                raise DecisionConflict("Результат уже изменён другим пользователем. Обновите страницу.")
            cursor = connection.execute(
                """
                INSERT INTO decisions(
                    track,item_id,decision,role,actor,comment,severity,
                    evidence_json,model_metadata_json,created_at
                ) VALUES(?,?,?,?,?,?,?,?,?,?)
                """,
                (
                    track,
                    item_id,
                    decision,
                    role,
                    actor,
                    comment.strip(),
                    severity,
                    json.dumps(evidence or {}, ensure_ascii=False, sort_keys=True),
                    json.dumps(model_metadata or {}, ensure_ascii=False, sort_keys=True),
                    now,
                ),
            )
            decision_id = int(cursor.lastrowid)
            payload["decision_id"] = decision_id
            connection.execute(
                """
                INSERT INTO audit_events(event_type,track,item_id,actor,role,payload_json,created_at)
                VALUES('review_decision',?,?,?,?,?,?)
                """,
                (track, item_id, actor, role, json.dumps(payload, ensure_ascii=False, sort_keys=True), now),
            )
        return decision_id

    def history(self, track: str, item_id: str) -> list[dict[str, Any]]:
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT id,decision,role,actor,comment,severity,created_at
                FROM decisions WHERE track=? AND item_id=? ORDER BY id DESC
                """,
                (track, item_id),
            ).fetchall()
        return [dict(row) for row in rows]

    def state(self, track: str, item_id: str, severity: str | None = None) -> ReviewState:
        history = self.history(track, item_id)
        if not history:
            return ReviewState("pending", "На проверке", 0, ())

        latest_by_role: dict[str, dict[str, Any]] = {}
        for entry in history:
            latest_by_role.setdefault(entry["role"], entry)
        accepted_roles = tuple(sorted(role for role, entry in latest_by_role.items() if entry["decision"] == "accepted"))
        rejected = [entry for entry in latest_by_role.values() if entry["decision"] == "rejected"]
        latest = history[0]

        if rejected:
            status, label = "rejected", "Отклонено экспертом"
        elif severity == "critical" and not {"expert", "controller"}.issubset(accepted_roles):
            missing = "контролёра" if "expert" in accepted_roles else "эксперта"
            status, label = "second_approval", f"Ожидает подтверждения {missing}"
        elif accepted_roles:
            status, label = "accepted", "Подтверждено"
        else:
            status, label = "pending", "На проверке"
        return ReviewState(
            status,
            label,
            int(history[0]["id"]),
            accepted_roles,
            latest["actor"],
            latest["created_at"],
        )

