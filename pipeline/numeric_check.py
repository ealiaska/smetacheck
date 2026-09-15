"""Numeric conflict metrics for candidate estimate pairs."""

from __future__ import annotations

NUMERIC_DIFF_THRESHOLD = 0.15


def percent_difference(left: float, right: float) -> float:
    denominator = max(abs(float(left)), abs(float(right)), 1e-12)
    return abs(float(left) - float(right)) / denominator


def compare_numeric(left, right) -> dict[str, object]:
    quantity_diff = percent_difference(left["quantity"], right["quantity"])
    price_diff = percent_difference(left["unit_price"], right["unit_price"])
    left_category = left["unit_category"]
    right_category = right["unit_category"]
    unit_mismatch = left_category != right_category or "unknown" in {left_category, right_category}
    return {
        "unit_mismatch": unit_mismatch,
        "quantity_diff_pct": quantity_diff,
        "price_diff_pct": price_diff,
        "has_numeric_conflict": unit_mismatch
        or quantity_diff > NUMERIC_DIFF_THRESHOLD
        or price_diff > NUMERIC_DIFF_THRESHOLD,
    }

