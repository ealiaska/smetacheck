from __future__ import annotations

from io import BytesIO
from pathlib import Path

import pandas as pd

from pipeline.false_positive_filter import find_candidate_pairs
from pipeline.ingest import ESTIMATE_COLUMNS, SchemaError, read_estimate, read_requisites
from pipeline.requisites_check import find_requisite_conflicts

ROOT = Path(__file__).resolve().parents[1]


def estimates() -> pd.DataFrame:
    return pd.concat(
        [read_estimate(ROOT / "data" / "est_01.csv"), read_estimate(ROOT / "data" / "est_02.csv")],
        ignore_index=True,
    )


def test_synthetic_data_shape_and_schema():
    data = estimates()
    assert 40 <= len(data) <= 60
    assert list(data.columns) == ESTIMATE_COLUMNS


def test_estimate_pipeline_finds_semantic_and_numeric_pairs(monkeypatch):
    monkeypatch.setenv("ESTIMATE_EMBEDDING_BACKEND", "tfidf")
    pairs = find_candidate_pairs(estimates(), include_excluded=True)
    proposed = pairs[pairs["status"] == "proposed"]
    assert len(proposed) >= 2
    assert proposed["has_numeric_conflict"].any()
    seen_documents = set(proposed["left_document_id"]) | set(proposed["right_document_id"])
    assert seen_documents == {"EST-01", "EST-02"}


def test_power_vs_optical_cable_trap_is_not_proposed(monkeypatch):
    monkeypatch.setenv("ESTIMATE_EMBEDDING_BACKEND", "tfidf")
    pairs = find_candidate_pairs(estimates(), include_excluded=True)
    trap = pairs[
        pairs["left_description"].str.contains("силов", case=False)
        & pairs["right_description"].str.contains("оптичес", case=False)
    ]
    assert not trap.empty
    assert (trap["status"] == "excluded").all()


def test_xlsx_ingestion():
    source = pd.read_csv(ROOT / "data" / "est_01.csv", dtype=str)
    buffer = BytesIO()
    source.to_excel(buffer, index=False)
    buffer.seek(0)
    loaded = read_estimate(buffer, "estimate.xlsx")
    assert len(loaded) == len(source)


def test_missing_schema_is_rejected():
    buffer = BytesIO(b"document_id,position_id\nA,1\n")
    try:
        read_estimate(buffer, "bad.csv")
    except SchemaError as exc:
        assert "отсутствуют поля" in str(exc)
    else:
        raise AssertionError("Invalid schema was accepted")


def test_requisite_conflicts_and_similar_name_trap():
    data = read_requisites(ROOT / "data" / "counterparties.csv")
    assert 15 <= len(data) <= 25
    flags = find_requisite_conflicts(data, include_info=True)
    assert "critical" in set(flags["severity"])
    assert "high" in set(flags["severity"])
    assert "medium" in set(flags["severity"])
    trap = flags[
        flags["left_document_id"].isin({"DOC-601", "DOC-602", "DOC-701", "DOC-702"})
        & flags["right_document_id"].isin({"DOC-601", "DOC-602", "DOC-701", "DOC-702"})
    ]
    cross_company = trap[
        trap["flag_id"].str.contains("DOC-6") & trap["flag_id"].str.contains("DOC-7")
    ]
    assert cross_company.empty
