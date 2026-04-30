"""Token estimation utilities."""

from __future__ import annotations

from collections import OrderedDict
from functools import lru_cache
from hashlib import sha1
from typing import Any


_DEFAULT_ENCODING = "o200k_base"
_LEGACY_OPENAI_ENCODING = "cl100k_base"
_TOKEN_COUNT_CACHE_MAX = 4096
_TOKEN_COUNT_CACHE: OrderedDict[tuple[str, int, str], int] = OrderedDict()


def _heuristic_token_count(text: str) -> int:
    return max(1, (len(text) + 3) // 4)


@lru_cache(maxsize=8)
def _get_encoding(encoding_name: str) -> Any | None:
    try:
        import tiktoken
    except Exception:
        return None
    try:
        return tiktoken.get_encoding(encoding_name)
    except Exception:
        return None


def _encoding_name_for_model(model: str | None) -> str:
    normalized = (model or "").strip().lower()
    if not normalized:
        return _DEFAULT_ENCODING
    if "/" in normalized:
        normalized = normalized.rsplit("/", 1)[-1]
    if normalized.startswith(("gpt-3.5", "gpt-4-", "gpt-4-turbo")):
        return _LEGACY_OPENAI_ENCODING
    return _DEFAULT_ENCODING


def _count_with_tiktoken(text: str, encoding_name: str) -> int | None:
    encoding = _get_encoding(encoding_name)
    if encoding is None:
        return None
    try:
        return max(1, len(encoding.encode(text)))
    except Exception:
        return None


def _count_cached_text(text: str, encoding_name: str) -> int:
    key = (sha1(text.encode("utf-8", errors="ignore")).hexdigest(), len(text), encoding_name)
    cached = _TOKEN_COUNT_CACHE.get(key)
    if cached is not None:
        _TOKEN_COUNT_CACHE.move_to_end(key)
        return cached
    counted = _count_with_tiktoken(text, encoding_name)
    if counted is None:
        counted = _heuristic_token_count(text)
    _TOKEN_COUNT_CACHE[key] = counted
    if len(_TOKEN_COUNT_CACHE) > _TOKEN_COUNT_CACHE_MAX:
        _TOKEN_COUNT_CACHE.popitem(last=False)
    return counted


def estimate_tokens(text: str, *, model: str | None = None) -> int:
    """Estimate tokens from plain text using tiktoken when available."""
    if not text:
        return 0
    encoding_name = _encoding_name_for_model(model)
    return _count_cached_text(text, encoding_name)


def estimate_message_tokens(messages: list[str], *, model: str | None = None) -> int:
    """Estimate tokens for a collection of message strings."""
    return sum(estimate_tokens(message, model=model) for message in messages)
