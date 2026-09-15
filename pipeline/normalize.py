"""Text and unit normalization shared by the estimate pipeline."""

from __future__ import annotations

import re
import unicodedata

from data.units_dictionary import UNIT_DICTIONARY

PHRASE_SYNONYMS = {
    "укладка кабельной силовой линии по лоткам": "монтаж силовой кабель лоток",
    "прокладка силового кабеля в лотке": "монтаж силовой кабель лоток",
    "монтаж оптического кабеля внутри здания": "монтаж оптический кабель помещение",
    "прокладка волоконно оптической линии в помещении": "монтаж оптический кабель помещение",
    "устройство бетонной стяжки пола": "бетон стяжка пол устройство",
    "еденге бетон тегістеу қабатын жасау": "бетон стяжка пол устройство",
    "окраска металлических конструкций": "окраска металл конструкция",
    "металл құрылымдарды сырлау": "окраска металл конструкция",
    "монтаж стальных радиаторов отопления": "монтаж радиатор отопление",
    "жылыту радиаторларын орнату": "монтаж радиатор отопление",
    "установка светодиодных светильников": "монтаж led светильник",
    "монтаж led светильников потолочных": "монтаж led светильник",
}

WORD_SYNONYMS = {
    "установка": "монтаж",
    "устройство": "монтаж",
    "укладка": "монтаж",
    "прокладка": "монтаж",
    "светодиодных": "led",
    "светильников": "светильник",
    "конструкций": "конструкция",
}


def normalize_text(value: object) -> str:
    text = unicodedata.normalize("NFKC", str(value or "")).lower().replace("ё", "е")
    text = re.sub(r"[^0-9a-zа-яәіңғүұқөһ²³]+", " ", text, flags=re.IGNORECASE)
    text = re.sub(r"\s+", " ", text).strip()
    if text in PHRASE_SYNONYMS:
        return PHRASE_SYNONYMS[text]
    return " ".join(WORD_SYNONYMS.get(word, word) for word in text.split())


def normalize_unit(value: object) -> tuple[str, str]:
    unit = normalize_text(value).replace(" ", "")
    for category, definition in UNIT_DICTIONARY.items():
        aliases = {normalize_text(alias).replace(" ", "") for alias in definition["aliases"]}
        if unit in aliases:
            return category, definition["canonical"]
    return "unknown", unit or "—"


def add_normalized_columns(df):
    result = df.copy()
    result["normalized_description"] = result["work_description"].map(normalize_text)
    units = result["unit"].map(normalize_unit)
    result["unit_category"] = units.map(lambda item: item[0])
    result["canonical_unit"] = units.map(lambda item: item[1])
    return result

