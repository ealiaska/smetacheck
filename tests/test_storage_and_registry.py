from __future__ import annotations

from pathlib import Path

import pandas as pd
import pytest

from pipeline.registry_providers import (
    ConfiguredHttpRegistryProvider,
    DisabledRegistryProvider,
    RegistryUnavailable,
    SyntheticRegistryProvider,
)
from pipeline.storage import DecisionConflict, DecisionStore

ROOT = Path(__file__).resolve().parents[1]


def test_critical_decision_requires_two_roles(tmp_path):
    store = DecisionStore(tmp_path / "review.db")
    item = "DOC-A ↔ DOC-B"
    version = store.version("requisite", item)
    store.record(
        track="requisite", item_id=item, decision="accepted", role="expert",
        actor="expert-1", expected_version=version, severity="critical",
    )
    pending = store.state("requisite", item, "critical")
    assert pending.status == "second_approval"
    store.record(
        track="requisite", item_id=item, decision="accepted", role="controller",
        actor="controller-1", expected_version=pending.version, severity="critical",
    )
    assert store.state("requisite", item, "critical").status == "accepted"


def test_decision_history_is_immutable_and_persistent(tmp_path):
    path = tmp_path / "review.db"
    store = DecisionStore(path)
    store.record(
        track="estimate", item_id="PAIR-1", decision="accepted", role="expert",
        actor="expert-1", expected_version=0, evidence={"score": 0.91},
    )
    reopened = DecisionStore(path)
    history = reopened.history("estimate", "PAIR-1")
    assert len(history) == 1
    assert history[0]["actor"] == "expert-1"
    assert reopened.state("estimate", "PAIR-1").status == "accepted"


def test_optimistic_lock_rejects_stale_write(tmp_path):
    store = DecisionStore(tmp_path / "review.db")
    store.record(
        track="estimate", item_id="PAIR-1", decision="accepted", role="expert",
        actor="expert-1", expected_version=0,
    )
    with pytest.raises(DecisionConflict):
        store.record(
            track="estimate", item_id="PAIR-1", decision="rejected", role="controller",
            actor="controller-1", expected_version=0,
        )


def test_registry_is_disabled_by_default():
    with pytest.raises(RegistryUnavailable):
        DisabledRegistryProvider().lookup("260101900111")
    assert not ConfiguredHttpRegistryProvider().configured


def test_synthetic_registry_never_needs_network():
    frame = pd.read_csv(ROOT / "data" / "counterparties.csv", dtype=str)
    record = SyntheticRegistryProvider(frame).lookup("260101900111")
    assert record is not None
    assert record.source == "Синтетический mock"
    assert record.bin == "260101900111"
