"""OpenAI-compatible chat completions and LLM credential loading from environment.

Other modules should import from here for HTTP calls and env-based config resolution.
"""

from __future__ import annotations

import logging
import os
from typing import Any

import httpx

try:
    from dotenv import load_dotenv

    load_dotenv()
except ImportError:
    pass

logger = logging.getLogger(__name__)


def _resolve_chat_completions_url(base_url: str) -> str:
    u = (base_url or "").strip().rstrip("/")
    if not u:
        return ""
    if u.endswith("/chat/completions"):
        return u
    return f"{u}/chat/completions"


def complete_chat(
    base_url: str,
    api_key: str,
    model: str,
    messages: list[dict[str, Any]],
    *,
    timeout: float = 120.0,
) -> str | None:
    """POST to an OpenAI-compatible ``/chat/completions`` endpoint; return assistant text or None."""

    url = _resolve_chat_completions_url(base_url)
    if not url:
        return None
    headers: dict[str, str] = {"Content-Type": "application/json"}
    if (api_key or "").strip():
        headers["Authorization"] = f"Bearer {api_key.strip()}"
    payload: dict[str, Any] = {"model": model, "messages": messages}
    try:
        with httpx.Client(timeout=timeout) as client:
            r = client.post(url, headers=headers, json=payload)
            r.raise_for_status()
            data = r.json()
        choices = data.get("choices") or []
        if not choices:
            return None
        msg = choices[0].get("message") or {}
        content = msg.get("content")
        if isinstance(content, str):
            return content.strip() or None
        if isinstance(content, list):
            parts = []
            for block in content:
                if isinstance(block, dict) and block.get("type") == "text":
                    parts.append(block.get("text") or "")
            joined = "".join(parts).strip()
            return joined or None
        return None
    except Exception as exc:
        logger.warning("Chat completion request failed: %s", exc)
        return None


def read_llm_env_general() -> tuple[str, str, str]:
    """``LLM_BASE_URL``, ``LLM_API_KEY``, ``LLM_MODEL`` (API key optional)."""

    base = (os.getenv("LLM_BASE_URL") or "").strip()
    key = (os.getenv("LLM_API_KEY") or "").strip()
    model = (os.getenv("LLM_MODEL") or "").strip()
    return base, key, model


def read_llm_env_multimodal() -> tuple[str, str, str]:
    """``MULTIMODAL_LLM_BASE_URL``, ``MULTIMODAL_LLM_API_KEY``, ``MULTIMODAL_LLM_MODEL`` only."""

    base = (os.getenv("MULTIMODAL_LLM_BASE_URL") or "").strip()
    key = (os.getenv("MULTIMODAL_LLM_API_KEY") or "").strip()
    model = (os.getenv("MULTIMODAL_LLM_MODEL") or "").strip()
    return base, key, model


def resolve_llm_multimodal_preferred() -> tuple[str, str, str]:
    """Prefer dedicated multimodal env when base URL and model are both set; else general ``LLM_*``."""

    b, k, m = read_llm_env_multimodal()
    if b and m:
        return b, k, m
    return read_llm_env_general()


def llm_env_configured_multimodal_preferred() -> bool:
    base, _key, model = resolve_llm_multimodal_preferred()
    return bool(base and model)


def resolve_llm_general_preferred() -> tuple[str, str, str]:
    """Prefer general ``LLM_*``; fall back to ``MULTIMODAL_LLM_*`` (e.g. doc augmentation)."""

    gb, gk, gm = read_llm_env_general()
    if gb and gm:
        return gb, gk, gm
    return read_llm_env_multimodal()


def llm_env_configured_general_preferred() -> bool:
    base, _key, model = resolve_llm_general_preferred()
    return bool(base and model)
