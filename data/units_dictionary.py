"""Canonical unit forms and measurement categories used by the estimates pipeline."""

UNIT_DICTIONARY = {
    "length": {"canonical": "м", "aliases": {"м", "метр", "метра", "метров", "m", "п.м", "пог.м"}},
    "weight": {"canonical": "кг", "aliases": {"кг", "килограмм", "килограмма", "килограммов", "kg"}},
    "count": {"canonical": "шт", "aliases": {"шт", "штука", "штуки", "штук", "дана", "дана."}},
    "area": {"canonical": "м2", "aliases": {"м2", "м²", "кв.м", "кв м", "квадратный метр", "m2"}},
    "volume": {"canonical": "м3", "aliases": {"м3", "м³", "куб.м", "куб м", "кубический метр", "m3"}},
}

