"""Registry-provider boundary. Network providers are disabled unless explicitly configured."""

from __future__ import annotations

from dataclasses import asdict, dataclass
import os
from typing import Protocol

import pandas as pd
import requests


class RegistryUnavailable(RuntimeError):
    pass


@dataclass(frozen=True)
class LegalEntityRecord:
    bin: str
    entity_name: str
    legal_address: str
    bank_name: str | None = None
    bik: str | None = None
    account_number: str | None = None
    source: str = "unknown"

    def to_dict(self) -> dict[str, str | None]:
        return asdict(self)


class RegistryProvider(Protocol):
    name: str

    def lookup(self, bin_value: str) -> LegalEntityRecord | None:
        ...


class DisabledRegistryProvider:
    """Safe default: documents are never transmitted without configured access."""

    name = "Отключено"

    def lookup(self, bin_value: str) -> LegalEntityRecord | None:
        raise RegistryUnavailable(
            "Внешний реестр отключён. Настройте одобренный endpoint и токен в защищённом окружении."
        )


class SyntheticRegistryProvider:
    """Deterministic provider backed only by the supplied synthetic demo registry."""

    name = "Синтетический mock"

    def __init__(self, data: pd.DataFrame):
        self.data = data.copy()

    def lookup(self, bin_value: str) -> LegalEntityRecord | None:
        matches = self.data[self.data["bin"].astype(str) == str(bin_value)]
        if matches.empty:
            return None
        row = matches.iloc[0]
        return LegalEntityRecord(
            bin=str(row["bin"]),
            entity_name=str(row["entity_name"]),
            legal_address=str(row["legal_address"]),
            bank_name=str(row["bank_name"]),
            bik=str(row["bik"]),
            account_number=str(row["account_number"]),
            source=self.name,
        )


class ConfiguredHttpRegistryProvider:
    """Adapter for an approved Smart Bridge/eGov gateway.

    The exact endpoint and response mapping belong to the access agreement, so
    this adapter requires explicit environment configuration and never guesses
    a public URL.
    """

    name = "Корпоративный шлюз реестров"

    def __init__(self, base_url: str | None = None, token: str | None = None):
        self.base_url = (base_url or os.getenv("REGISTRY_BASE_URL", "")).rstrip("/")
        self.token = token or os.getenv("REGISTRY_TOKEN", "")

    @property
    def configured(self) -> bool:
        return self.base_url.startswith("https://") and bool(self.token)

    def lookup(self, bin_value: str) -> LegalEntityRecord | None:
        if not self.configured:
            raise RegistryUnavailable("REGISTRY_BASE_URL/REGISTRY_TOKEN не настроены.")
        response = requests.get(
            f"{self.base_url}/legal-entities/{bin_value}",
            headers={"Authorization": f"Bearer {self.token}", "Accept": "application/json"},
            timeout=(3.05, 10),
        )
        if response.status_code == 404:
            return None
        response.raise_for_status()
        payload = response.json()
        required = {"bin", "entity_name", "legal_address"}
        if not required.issubset(payload):
            raise RegistryUnavailable("Шлюз вернул ответ неизвестной схемы.")
        return LegalEntityRecord(
            bin=str(payload["bin"]),
            entity_name=str(payload["entity_name"]),
            legal_address=str(payload["legal_address"]),
            bank_name=payload.get("bank_name"),
            bik=payload.get("bik"),
            account_number=payload.get("account_number"),
            source=self.name,
        )

