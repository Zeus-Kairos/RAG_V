from __future__ import annotations

import json
import os
import re
from typing import Any, Optional

import requests

from src.utils.llm_helpers import complete_chat, llm_env_configured_general_preferred, resolve_llm_general_preferred
from src.utils.logging_config import get_logger

logger = get_logger(__name__)


def _extract_lines_as_items(text: str) -> list[str]:
    """Extract list items from an LLM response.

    Accepts formats like:
    - JSON list: ["a", "b"]
    - Numbered / bulleted list
    - Plain lines
    """

    s = (text or "").strip()
    if not s:
        return []

    # Try JSON first
    try:
        data = json.loads(s)
        if isinstance(data, list):
            out = [str(x).strip() for x in data if str(x).strip()]
            return out
    except Exception:
        pass

    # Fallback: parse lines; strip common bullets / numbering
    out: list[str] = []
    for raw in s.splitlines():
        line = raw.strip()
        if not line:
            continue
        line = re.sub(r"^\s*[\-\*\u2022]\s+", "", line)  # bullets
        line = re.sub(r"^\s*\(?\d+[\)\.\:]\s+", "", line)  # 1) 1. 1:
        line = line.strip()
        if line:
            out.append(line)
    return out


def _ollama_generate(prompt: str, *, timeout: float = 120.0) -> Optional[str]:
    base_url = (os.getenv("OLLAMA_BASE_URL") or "http://127.0.0.1:11434").rstrip("/")
    model = (os.getenv("OLLAMA_MODEL") or "").strip()
    api_key = (os.getenv("OLLAMA_API_KEY") or "").strip()
    if not model:
        return None
    headers: dict[str, str] = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
        headers["X-API-Key"] = api_key
    try:
        resp = requests.post(
            f"{base_url}/api/generate",
            headers=headers,
            json={"model": model, "prompt": prompt, "stream": False, "options": {"temperature": 0}},
            timeout=timeout,
        )
        data: Any
        try:
            data = resp.json()
        except Exception:
            logger.warning("Ollama generate non-JSON response: %s", resp.text[:500])
            return None
        if not resp.ok:
            logger.warning("Ollama generate error: %s", data)
            return None
        out = data.get("response")
        if isinstance(out, str):
            return out.strip() or None
        return None
    except Exception as exc:
        logger.warning("Ollama generate failed: %s", exc)
        return None


def generate_text_prefer_llm_fallback_ollama(
    *,
    system: str,
    user: str,
    timeout: float = 120.0,
) -> Optional[str]:
    """Generate text using preferred LLM config; fallback to Ollama.

    Preferred: OpenAI-compatible chat completions using `LLM_*` (or multimodal fallback handled by llm_helpers).
    Fallback: Ollama `/api/generate` using `OLLAMA_*`.
    """

    if llm_env_configured_general_preferred():
        base, key, model = resolve_llm_general_preferred()
        txt = complete_chat(
            base_url=base,
            api_key=key,
            model=model,
            messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
            timeout=timeout,
        )
        if txt:
            return txt
    return _ollama_generate(f"{system}\n\n{user}".strip(), timeout=timeout)


def generate_list_items_prefer_llm_fallback_ollama(
    *,
    system: str,
    user: str,
    timeout: float = 120.0,
) -> list[str]:
    txt = generate_text_prefer_llm_fallback_ollama(system=system, user=user, timeout=timeout)
    if not txt:
        return []
    return _extract_lines_as_items(txt)

