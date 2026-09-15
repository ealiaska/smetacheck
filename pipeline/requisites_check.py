"""Pairwise conflict checks for structured counterparty requisites."""

from __future__ import annotations

from itertools import combinations
import re
import unicodedata

import pandas as pd
from rapidfuzz.fuzz import ratio

from pipeline.requisites_explain import explain_requisite_flag

NAME_FUZZY_THRESHOLD = 88
ORG_PREFIXES = re.compile(r"\b(?:тоо|too|ао|ao|ип|жшс)\b", re.IGNORECASE)


def normalize_name(value: object) -> str:
    text = unicodedata.normalize("NFKC", str(value or "")).lower().replace("ё", "е")
    text = text.translate(str.maketrans({"қ": "к", "ұ": "у", "ү": "у", "ө": "о", "ғ": "г", "ә": "а", "і": "и", "ң": "н"}))
    text = ORG_PREFIXES.sub(" ", text)
    return re.sub(r"[^0-9a-zа-я]+", "", text)


def normalize_compact(value: object) -> str:
    return re.sub(r"[\s\-–—]+", "", str(value or "")).upper()


def normalize_words(value: object) -> str:
    text = unicodedata.normalize("NFKC", str(value or "")).lower().replace("ё", "е")
    return re.sub(r"\s+", " ", re.sub(r"[^0-9a-zа-яәіңғүұқөһ]+", " ", text)).strip()


def _prepared(df: pd.DataFrame) -> pd.DataFrame:
    result = df.copy().reset_index(drop=True)
    result["_name"] = result["entity_name"].map(normalize_name)
    result["_bin"] = result["bin"].map(normalize_compact)
    result["_address"] = result["legal_address"].map(normalize_words)
    result["_bank"] = result["bank_name"].map(normalize_words)
    result["_bik"] = result["bik"].map(normalize_compact)
    result["_account"] = result["account_number"].map(normalize_compact)
    return result


def find_requisite_conflicts(df: pd.DataFrame, include_info: bool = False) -> pd.DataFrame:
    data = _prepared(df)
    flags: list[dict[str, object]] = []
    for left_idx, right_idx in combinations(range(len(data)), 2):
        left = data.iloc[left_idx]
        right = data.iloc[right_idx]
        exact_name = left["_name"] == right["_name"]
        name_score = float(ratio(left["_name"], right["_name"]))
        same_bin = left["_bin"] == right["_bin"]

        # Similar names with different BINs are deliberately not merged. Only exact
        # normalized names can produce the requested identifier-mismatch alert.
        comparable = exact_name or (same_bin and name_score >= NAME_FUZZY_THRESHOLD)
        if not comparable:
            continue

        changed: list[str] = []
        for field, normalized_field in (
            ("bin", "_bin"),
            ("legal_address", "_address"),
            ("bank_name", "_bank"),
            ("bik", "_bik"),
            ("account_number", "_account"),
        ):
            if left[normalized_field] != right[normalized_field]:
                changed.append(field)

        if not changed:
            if include_info and left["entity_name"] != right["entity_name"]:
                changed = ["entity_name"]
                severity = "info"
            else:
                continue
        elif "bin" in changed:
            severity = "high"
        elif any(field in changed for field in ("account_number", "bank_name", "bik")) and same_bin:
            severity = "critical"
        elif "legal_address" in changed and same_bin:
            severity = "medium"
        else:
            severity = "high"

        flag = {
            "flag_id": f"{left['document_id']} ↔ {right['document_id']}",
            "left_index": left_idx,
            "right_index": right_idx,
            "left_document_id": left["document_id"],
            "right_document_id": right["document_id"],
            "entity_name": left["entity_name"],
            "name_similarity": name_score,
            "severity": severity,
            "changed_fields": changed,
        }
        flag["explanation"] = explain_requisite_flag(flag)
        flags.append(flag)

    severity_order = {"critical": 0, "high": 1, "medium": 2, "info": 3}
    flags.sort(key=lambda item: (severity_order[item["severity"]], item["flag_id"]))
    return pd.DataFrame(flags)

