"""Human-readable explanations for proposed estimate matches."""

from __future__ import annotations


def explain_pair(pair, left, right) -> str:
    if pair["status"] == "excluded":
        return (
            f"Текстовое сходство {pair['embedding_score']:.2f}, но пара исключена фильтром: "
            f"{pair['filter_reason']}. Это не предложение дубля."
        )
    category = {
        "length": "длина", "weight": "масса", "count": "количество",
        "area": "площадь", "volume": "объём", "unknown": "не определена",
    }.get(left["unit_category"], left["unit_category"])
    quantity = pair["quantity_diff_pct"] * 100
    price = pair["price_diff_pct"] * 100
    return (
        f"Сходство описаний {pair['embedding_score']:.2f}; единицы совместимы ({category}). "
        f"Объём расходится на {quantity:.1f}%, цена — на {price:.1f}%. "
        "Система только предлагает проверить пару; итоговое решение принимает эксперт."
    )
