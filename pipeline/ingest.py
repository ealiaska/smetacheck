"""Read CSV/XLSX tabular documents and validate their schemas."""

from __future__ import annotations

from pathlib import Path
from typing import BinaryIO

import pandas as pd

ESTIMATE_COLUMNS = [
    "document_id",
    "position_id",
    "page_or_sheet",
    "work_description",
    "unit",
    "quantity",
    "unit_price",
    "norm_ref",
]

REQUISITE_COLUMNS = [
    "document_id",
    "page_or_sheet",
    "entity_name",
    "bin",
    "legal_address",
    "bank_name",
    "bik",
    "account_number",
]


class SchemaError(ValueError):
    """Raised when an uploaded document does not match the expected schema."""


def _read_table(source: str | Path | BinaryIO, filename: str | None = None) -> pd.DataFrame:
    name = filename or getattr(source, "name", str(source))
    suffix = Path(name).suffix.lower()
    if suffix == ".csv":
        return pd.read_csv(source, dtype=str, keep_default_na=False)
    if suffix in {".xlsx", ".xlsm"}:
        return pd.read_excel(source, dtype=str, keep_default_na=False, engine="openpyxl")
    raise SchemaError("Поддерживаются только файлы CSV и XLSX.")


def _validate(df: pd.DataFrame, required: list[str], kind: str) -> pd.DataFrame:
    missing = [column for column in required if column not in df.columns]
    if missing:
        raise SchemaError(f"В документе «{kind}» отсутствуют поля: {', '.join(missing)}")
    clean = df[required].copy()
    if clean.empty:
        raise SchemaError(f"Документ «{kind}» не содержит строк данных.")
    for column in required:
        clean[column] = clean[column].astype(str).str.strip()
    return clean


def read_estimate(source: str | Path | BinaryIO, filename: str | None = None) -> pd.DataFrame:
    df = _validate(_read_table(source, filename), ESTIMATE_COLUMNS, "позиции работ")
    for column in ("quantity", "unit_price"):
        normalized = df[column].str.replace(" ", "", regex=False).str.replace(",", ".", regex=False)
        df[column] = pd.to_numeric(normalized, errors="coerce")
        if df[column].isna().any():
            rows = (df.index[df[column].isna()] + 2).tolist()
            raise SchemaError(f"Поле {column} должно быть числом; ошибки в строках {rows}.")
    return df


def read_requisites(source: str | Path | BinaryIO, filename: str | None = None) -> pd.DataFrame:
    df = _validate(_read_table(source, filename), REQUISITE_COLUMNS, "реквизиты")
    invalid_bin = ~df["bin"].str.replace(r"\D", "", regex=True).str.fullmatch(r"\d{12}")
    invalid_bik = ~df["bik"].str.replace(r"[\s-]", "", regex=True).str.fullmatch(r"[A-Za-z0-9]{8}")
    invalid_account = ~df["account_number"].str.replace(r"[\s-]", "", regex=True).str.fullmatch(
        r"(?:KZ)?[A-Za-z0-9]{18,20}", case=False
    )
    problems: list[str] = []
    if invalid_bin.any():
        problems.append("БИН должен содержать 12 цифр")
    if invalid_bik.any():
        problems.append("БИК должен содержать 8 букв/цифр")
    if invalid_account.any():
        problems.append("ИИК должен быть 20-символьным KZ-форматом")
    if problems:
        raise SchemaError("; ".join(problems) + ".")
    return df

