"""Explanations for counterparty requisite conflicts."""

from __future__ import annotations


FIELD_LABELS = {
    "bin": "БИН",
    "legal_address": "юридический адрес",
    "bank_name": "банк",
    "bik": "БИК",
    "account_number": "расчётный счёт",
    "entity_name": "написание наименования",
}


def explain_requisite_flag(flag) -> str:
    changed = [FIELD_LABELS.get(field, field) for field in flag["changed_fields"]]
    if flag["severity"] == "critical":
        suffix = "Проверить реквизиты до оплаты: возможна подмена платёжных данных."
    elif flag["severity"] == "high":
        suffix = "Проверить, является ли это опечаткой или другим юридическим лицом."
    elif flag["severity"] == "medium":
        suffix = "Изменение может быть законным, но требует подтверждающего документа."
    else:
        suffix = "Расхождений реквизитов нет; это информационное примечание."
    return f"Потенциально один контрагент; различаются: {', '.join(changed)}. {suffix}"

