"""Vision / Markdown helpers for :class:`MultiModalSplitter` in ``file_splitter``.

LLM HTTP calls and env-based credential resolution live in ``src.utils.llm_helpers``.
"""

from __future__ import annotations

import base64
import logging
import mimetypes
import os
import re
from typing import Any

from src.utils.llm_helpers import (
    llm_env_configured_general_preferred,
    llm_env_configured_multimodal_preferred,
)

logger = logging.getLogger(__name__)


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


def multimodal_chunk_run_warning(chunk_parameters: dict[str, Any] | None) -> str | None:
    """When table/image LLM is requested but .env is incomplete, return a user-facing warning."""

    if not chunk_parameters:
        return None
    table_on = bool(chunk_parameters.get("table_llm_enabled"))
    image_on = bool(chunk_parameters.get("image_vlm_enabled"))
    if not table_on and not image_on:
        return None
    if llm_env_configured_multimodal_preferred():
        return None
    return (
        "Table LLM and/or image VLM is enabled, but no LLM is configured. Set "
        "LLM_BASE_URL and LLM_MODEL in .env, or set MULTIMODAL_LLM_BASE_URL and "
        "MULTIMODAL_LLM_MODEL (optional API keys). Tables and images were chunked as raw markdown only."
    )


def doc_augmentation_chunk_run_warning(chunk_parameters: dict[str, Any] | None) -> str | None:
    """When doc augmentation is requested but .env is incomplete, return a user-facing warning."""

    if not chunk_parameters:
        return None
    doc_aug = bool(chunk_parameters.get("doc_augmentation"))
    if not doc_aug:
        return None
    if llm_env_configured_general_preferred():
        return None
    return (
        "Doc augmentation is enabled, but no LLM is configured. Set LLM_BASE_URL and LLM_MODEL "
        "in .env (optional LLM_API_KEY), or set MULTIMODAL_LLM_BASE_URL and MULTIMODAL_LLM_MODEL. "
        "No augment questions were generated."
    )
