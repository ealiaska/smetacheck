"""Local multilingual embeddings with an explicit offline TF-IDF fallback."""

from __future__ import annotations

import os
import warnings

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

MODEL_NAME = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
MODEL_REVISION = os.getenv("EMBEDDING_MODEL_REVISION", "local-cache")
SIMILARITY_THRESHOLD = 0.75
_LAST_BACKEND = "not-initialized"
_LAST_DIMENSION = 0
_FALLBACK_USED = False


def get_embeddings(texts: list[str]) -> np.ndarray:
    """Return document vectors without sending text to any external service.

    In ``auto`` mode an already cached sentence-transformers model is preferred.
    When unavailable, a deterministic word+character TF-IDF representation is used.
    """

    global _LAST_BACKEND, _LAST_DIMENSION, _FALLBACK_USED
    if not texts:
        return np.empty((0, 0), dtype=float)

    backend = os.getenv("ESTIMATE_EMBEDDING_BACKEND", "auto").lower()
    if backend not in {"auto", "sentence-transformers", "tfidf"}:
        raise ValueError("ESTIMATE_EMBEDDING_BACKEND: use auto, sentence-transformers or tfidf")

    if backend != "tfidf":
        try:
            from sentence_transformers import SentenceTransformer

            model = SentenceTransformer(
                MODEL_NAME,
                revision=None if MODEL_REVISION == "local-cache" else MODEL_REVISION,
                local_files_only=(backend == "auto"),
            )
            _LAST_BACKEND = MODEL_NAME
            _FALLBACK_USED = False
            result = np.asarray(model.encode(texts, normalize_embeddings=True, show_progress_bar=False))
            _LAST_DIMENSION = int(result.shape[1])
            return result
        except Exception as exc:
            if backend == "sentence-transformers":
                raise RuntimeError(f"Не удалось загрузить локальную модель {MODEL_NAME}") from exc
            warnings.warn("Локальная модель не найдена; используется TF-IDF fallback.", RuntimeWarning)

    word = TfidfVectorizer(ngram_range=(1, 2), analyzer="word", sublinear_tf=True)
    char = TfidfVectorizer(ngram_range=(3, 5), analyzer="char_wb", sublinear_tf=True, max_features=6000)
    word_matrix = word.fit_transform(texts).toarray()
    char_matrix = char.fit_transform(texts).toarray()
    _LAST_BACKEND = "tfidf-word-char"
    _FALLBACK_USED = True
    result = np.hstack((word_matrix, char_matrix))
    _LAST_DIMENSION = int(result.shape[1])
    return result


def pairwise_similarity(embeddings: np.ndarray) -> np.ndarray:
    if embeddings.size == 0:
        return np.empty((0, 0), dtype=float)
    return cosine_similarity(embeddings)


def active_backend() -> str:
    return _LAST_BACKEND


def backend_metadata() -> dict[str, object]:
    return {
        "backend": _LAST_BACKEND,
        "model_name": MODEL_NAME,
        "model_revision": MODEL_REVISION,
        "fallback_used": _FALLBACK_USED,
        "dimension": _LAST_DIMENSION,
        "similarity_threshold": SIMILARITY_THRESHOLD,
    }
