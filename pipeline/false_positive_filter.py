"""Candidate generation plus domain-aware false-positive suppression."""

from __future__ import annotations

from itertools import combinations

import pandas as pd
from rapidfuzz.fuzz import token_set_ratio

from pipeline.embeddings import SIMILARITY_THRESHOLD, get_embeddings, pairwise_similarity
from pipeline.normalize import add_normalized_columns
from pipeline.numeric_check import compare_numeric

FUZZY_THRESHOLD = 82

TECHNICAL_QUALIFIERS = [
    {"силов", "оптическ", "слаботочн"},
    {"холодн", "горяч"},
    {"металлическ", "деревянн"},
    {"газоблок", "кирпичн"},
    {"прямоугольн", "кругл"},
]

OVERLAP_STOPWORDS = {"в", "на", "по", "из", "для", "и", "внутри", "внутренний"}


def _present_stems(text: str, stems: set[str]) -> set[str]:
    return {stem for stem in stems if stem in text}


def technical_conflict(left_text: str, right_text: str) -> str | None:
    left = left_text.lower()
    right = right_text.lower()
    for family in TECHNICAL_QUALIFIERS:
        left_terms = _present_stems(left, family)
        right_terms = _present_stems(right, family)
        if left_terms and right_terms and left_terms != right_terms:
            return f"несовместимые технические признаки: {', '.join(sorted(left_terms | right_terms))}"
    return None


def _meaningful_overlap(left_text: str, right_text: str) -> int:
    left_tokens = set(left_text.split()) - OVERLAP_STOPWORDS
    right_tokens = set(right_text.split()) - OVERLAP_STOPWORDS
    return len(left_tokens & right_tokens)


def find_candidate_pairs(df: pd.DataFrame, include_excluded: bool = True) -> pd.DataFrame:
    normalized = add_normalized_columns(df).reset_index(drop=True)
    embeddings = get_embeddings(normalized["normalized_description"].tolist())
    scores = pairwise_similarity(embeddings)
    rows: list[dict[str, object]] = []

    for left_idx, right_idx in combinations(range(len(normalized)), 2):
        left = normalized.iloc[left_idx]
        right = normalized.iloc[right_idx]
        if left["document_id"] == right["document_id"] and left["position_id"] == right["position_id"]:
            continue
        embedding_score = float(scores[left_idx, right_idx])
        fuzzy_score = float(token_set_ratio(left["normalized_description"], right["normalized_description"]))
        conflict_reason = technical_conflict(left["work_description"], right["work_description"])
        audit_worthy_conflict = bool(conflict_reason) and _meaningful_overlap(
            left["normalized_description"], right["normalized_description"]
        ) >= 2
        text_candidate = (
            embedding_score >= SIMILARITY_THRESHOLD
            or fuzzy_score >= FUZZY_THRESHOLD
            or audit_worthy_conflict
        )
        if not text_candidate:
            continue

        numeric = compare_numeric(left, right)
        compatible_units = left["unit_category"] == right["unit_category"] != "unknown"
        proposed = compatible_units and not conflict_reason
        if not proposed and not include_excluded:
            continue

        flag_type = "both" if numeric["has_numeric_conflict"] else "semantic"
        if embedding_score < SIMILARITY_THRESHOLD and fuzzy_score >= FUZZY_THRESHOLD:
            flag_type = "numeric" if numeric["has_numeric_conflict"] else "semantic"
        rows.append(
            {
                "pair_id": f"{left['document_id']}:{left['position_id']} ↔ {right['document_id']}:{right['position_id']}",
                "left_index": left_idx,
                "right_index": right_idx,
                "left_document_id": left["document_id"],
                "right_document_id": right["document_id"],
                "left_position_id": left["position_id"],
                "right_position_id": right["position_id"],
                "left_description": left["work_description"],
                "right_description": right["work_description"],
                "embedding_score": embedding_score,
                "fuzzy_score": fuzzy_score,
                "flag_type": flag_type,
                "status": "proposed" if proposed else "excluded",
                "filter_reason": conflict_reason
                or (None if compatible_units else "несовместимые категории единиц измерения"),
                **numeric,
            }
        )

    columns = [
        "pair_id", "left_index", "right_index", "left_document_id", "right_document_id",
        "left_position_id", "right_position_id", "left_description", "right_description",
        "embedding_score", "fuzzy_score", "flag_type", "status", "filter_reason",
        "unit_mismatch", "quantity_diff_pct", "price_diff_pct", "has_numeric_conflict",
    ]
    return pd.DataFrame(rows, columns=columns).sort_values(
        ["status", "embedding_score", "fuzzy_score"], ascending=[False, False, False]
    ).reset_index(drop=True)
