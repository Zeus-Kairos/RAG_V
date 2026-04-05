"""HTTP / vision helpers for :class:`MultiModalSplitter` in ``file_splitter``."""

from __future__ import annotations

import base64
import logging
import mimetypes
import os
import re
from typing import Any

import httpx

try:
    from dotenv import load_dotenv

    load_dotenv()
except ImportError:
    pass

logger = logging.getLogger(__name__)


def _chat_completions_url(api_url: str) -> str:
    u = (api_url or "").strip().rstrip("/")
    if not u:
        return ""
    if u.endswith("/chat/completions"):
        return u
    return f"{u}/chat/completions"


def openai_compatible_chat(
    api_url: str,
    api_key: str,
    model: str,
    messages: list[dict[str, Any]],
    *,
    timeout: float = 120.0,
) -> str | None:
    url = _chat_completions_url(api_url)
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
        logger.warning("OpenAI-compatible chat request failed: %s", exc)
        return None


def markdown_image_target(markdown_line: str) -> str | None:
    m = re.search(r"!\[([^\]]*)\]\(([^)]+)\)", markdown_line or "")
    if not m:
        return None
    return m.group(2).strip()


def _resolve_image_path_or_url(target: str, file_path: str | None) -> tuple[str | None, bool]:
    """Returns (resolved, is_http). For local files, returns absolute path; for http, returns URL string."""
    raw = (target or "").strip()
    if not raw:
        return None, False
    if raw.startswith(("http://", "https://")):
        return raw, True
    path = raw.split("?")[0].strip()
    if os.path.isabs(path) and os.path.isfile(path):
        return path, False
    if file_path:
        base = os.path.dirname(file_path)
        cand = os.path.normpath(os.path.join(base, path))
        if os.path.isfile(cand):
            return cand, False
    return None, False


def image_url_for_vision(target: str, file_path: str | None) -> str | None:
    resolved, is_http = _resolve_image_path_or_url(target, file_path)
    if is_http and resolved:
        return resolved
    if resolved and os.path.isfile(resolved):
        mime, _ = mimetypes.guess_type(resolved)
        mime = mime or "application/octet-stream"
        try:
            with open(resolved, "rb") as f:
                b64 = base64.standard_b64encode(f.read()).decode("ascii")
            return f"data:{mime};base64,{b64}"
        except OSError as exc:
            logger.warning("Could not read image file %s: %s", resolved, exc)
            return None
    return None


def multimodal_llm_config_from_env() -> tuple[str, str, str]:
    """(base_url, api_key, model) for MultiModalSplitter; from environment only."""

    base = (os.getenv("MULTIMODAL_LLM_BASE_URL") or "").strip()
    key = (os.getenv("MULTIMODAL_LLM_API_KEY") or "").strip()
    model = (os.getenv("MULTIMODAL_LLM_MODEL") or "").strip()
    return base, key, model


def multimodal_llm_credentials_sufficient() -> bool:
    base, _key, model = multimodal_llm_config_from_env()
    return bool(base and model)


def multimodal_chunk_run_warning(chunk_parameters: dict[str, Any] | None) -> str | None:
    """When table/image LLM is requested but .env is incomplete, return a user-facing warning."""

    if not chunk_parameters:
        return None
    table_on = bool(chunk_parameters.get("table_llm_enabled"))
    image_on = bool(chunk_parameters.get("image_vlm_enabled"))
    if not table_on and not image_on:
        return None
    if multimodal_llm_credentials_sufficient():
        return None
    return (
        "Table LLM and/or image VLM is enabled, but MULTIMODAL_LLM_BASE_URL and "
        "MULTIMODAL_LLM_MODEL must both be set in .env. Tables and images were "
        "chunked as raw markdown only."
    )
