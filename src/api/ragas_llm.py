from __future__ import annotations

import os
from dataclasses import dataclass
from typing import List, Optional

import httpx
import requests
from langchain_core.outputs import Generation, LLMResult
from langchain_core.prompt_values import PromptValue
from ragas.llms.base import BaseRagasLLM

from src.utils.llm_helpers import resolve_llm_general_preferred


def _prompt_to_text(prompt: PromptValue) -> str:
    if hasattr(prompt, "to_string"):
        return str(prompt.to_string())
    return str(prompt)


@dataclass
class OllamaGenerateRagasLLM(BaseRagasLLM):
    """RAGAS LLM adapter that calls Ollama `/api/generate` using `OLLAMA_*` env vars.

    Kept for compatibility with environments that use Ollama for judge models, but the
    evaluation pipeline can use other providers as well.
    """

    def _resolve(self) -> tuple[str, str, str]:
        base_url = (os.getenv("OLLAMA_BASE_URL") or "http://127.0.0.1:11434").strip().rstrip("/")
        model = (os.getenv("OLLAMA_MODEL") or "").strip()
        api_key = (os.getenv("OLLAMA_API_KEY") or "").strip()
        return base_url, model, api_key

    def _headers(self, api_key: str) -> dict:
        headers = {"Content-Type": "application/json"}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"
            headers["X-API-Key"] = api_key
        return headers

    def _call_ollama_generate(self, prompt_text: str, *, temperature: float, stop: Optional[List[str]]) -> str:
        base_url, model, api_key = self._resolve()
        if not model:
            raise ValueError("OLLAMA_MODEL is required for evaluation (set it in .env)")
        url = f"{base_url}/api/generate"
        payload = {
            "model": model,
            "prompt": prompt_text,
            "stream": False,
            "options": {"temperature": float(temperature)},
        }
        resp = requests.post(url, headers=self._headers(api_key), json=payload, timeout=180)
        data = resp.json()
        if not resp.ok:
            raise RuntimeError(f"Ollama error: {resp.status_code}: {data}")
        out = data.get("response") or ""
        if stop:
            for s in stop:
                if not s:
                    continue
                idx = out.find(s)
                if idx >= 0:
                    out = out[:idx]
        return str(out)

    async def _acall_ollama_generate(self, prompt_text: str, *, temperature: float, stop: Optional[List[str]]) -> str:
        base_url, model, api_key = self._resolve()
        if not model:
            raise ValueError("OLLAMA_MODEL is required for evaluation (set it in .env)")
        url = f"{base_url}/api/generate"
        payload = {
            "model": model,
            "prompt": prompt_text,
            "stream": False,
            "options": {"temperature": float(temperature)},
        }
        async with httpx.AsyncClient(timeout=180) as client:
            resp = await client.post(url, headers=self._headers(api_key), json=payload)
            data = resp.json()
            if resp.status_code >= 400:
                raise RuntimeError(f"Ollama error: {resp.status_code}: {data}")
        out = data.get("response") or ""
        if stop:
            for s in stop:
                if not s:
                    continue
                idx = out.find(s)
                if idx >= 0:
                    out = out[:idx]
        return str(out)

    def generate_text(
        self,
        prompt: PromptValue,
        n: int = 1,
        temperature: float = 0.01,
        stop: Optional[List[str]] = None,
        callbacks=None,
    ) -> LLMResult:
        prompt_text = _prompt_to_text(prompt)
        nn = max(1, int(n))
        gens = []
        for _ in range(nn):
            txt = self._call_ollama_generate(prompt_text, temperature=temperature, stop=stop)
            gens.append(Generation(text=txt))
        return LLMResult(generations=[gens], llm_output={})

    async def agenerate_text(
        self,
        prompt: PromptValue,
        n: int = 1,
        temperature: float = 0.01,
        stop: Optional[List[str]] = None,
        callbacks=None,
    ) -> LLMResult:
        prompt_text = _prompt_to_text(prompt)
        nn = max(1, int(n))
        if nn == 1:
            txt = await self._acall_ollama_generate(prompt_text, temperature=temperature, stop=stop)
            return LLMResult(generations=[[Generation(text=txt)]], llm_output={})
        gens = []
        for _ in range(nn):
            txt = await self._acall_ollama_generate(prompt_text, temperature=temperature, stop=stop)
            gens.append(Generation(text=txt))
        return LLMResult(generations=[gens], llm_output={})

    def is_finished(self, response: LLMResult) -> bool:
        try:
            return bool(response.generations and response.generations[0] and response.generations[0][0].text is not None)
        except Exception:
            return False


@dataclass
class EvaluationJudgeRagasLLM(BaseRagasLLM):
    """RAGAS judge LLM adapter for evaluation metrics.

    Uses a dedicated config:
      - EVAL_LLM_BASE_URL / EVAL_LLM_API_KEY / EVAL_LLM_MODEL
    Fallback:
      - LLM_BASE_URL / LLM_API_KEY / LLM_MODEL (via existing helpers)

    Expects an OpenAI-compatible Chat Completions endpoint.
    """

    def _resolve(self) -> tuple[str, str, str]:
        b = (os.getenv("EVAL_LLM_BASE_URL") or "").strip()
        k = (os.getenv("EVAL_LLM_API_KEY") or "").strip()
        m = (os.getenv("EVAL_LLM_MODEL") or "").strip()
        if b and m:
            return b, k, m
        return resolve_llm_general_preferred()

    def _headers(self, api_key: str) -> dict:
        headers = {"Content-Type": "application/json"}
        if (api_key or "").strip():
            headers["Authorization"] = f"Bearer {api_key.strip()}"
        return headers

    def _chat_completions_url(self, base_url: str) -> str:
        u = (base_url or "").strip().rstrip("/")
        if not u:
            return ""
        if u.endswith("/chat/completions"):
            return u
        return f"{u}/chat/completions"

    def _call_chat(
        self,
        prompt_text: str,
        *,
        temperature: float,
        stop: Optional[List[str]],
    ) -> str:
        base_url, api_key, model = self._resolve()
        url = self._chat_completions_url(base_url)
        if not (url and model):
            raise ValueError("Evaluation LLM is not configured. Set EVAL_LLM_* or LLM_* env vars.")

        payload = {
            "model": model,
            "messages": [{"role": "user", "content": prompt_text}],
            "temperature": float(temperature),
        }
        if stop:
            payload["stop"] = [s for s in stop if s]

        with httpx.Client(timeout=180) as client:
            r = client.post(url, headers=self._headers(api_key), json=payload)
            r.raise_for_status()
            data = r.json()

        choices = data.get("choices") or []
        if not choices:
            return ""
        msg = choices[0].get("message") or {}
        content = msg.get("content")
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            parts = []
            for block in content:
                if isinstance(block, dict) and block.get("type") == "text":
                    parts.append(block.get("text") or "")
            return "".join(parts)
        return ""

    async def _acall_chat(
        self,
        prompt_text: str,
        *,
        temperature: float,
        stop: Optional[List[str]],
    ) -> str:
        base_url, api_key, model = self._resolve()
        url = self._chat_completions_url(base_url)
        if not (url and model):
            raise ValueError("Evaluation LLM is not configured. Set EVAL_LLM_* or LLM_* env vars.")

        payload = {
            "model": model,
            "messages": [{"role": "user", "content": prompt_text}],
            "temperature": float(temperature),
        }
        if stop:
            payload["stop"] = [s for s in stop if s]

        async with httpx.AsyncClient(timeout=180) as client:
            r = await client.post(url, headers=self._headers(api_key), json=payload)
            r.raise_for_status()
            data = r.json()

        choices = data.get("choices") or []
        if not choices:
            return ""
        msg = choices[0].get("message") or {}
        content = msg.get("content")
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            parts = []
            for block in content:
                if isinstance(block, dict) and block.get("type") == "text":
                    parts.append(block.get("text") or "")
            return "".join(parts)
        return ""

    def generate_text(
        self,
        prompt: PromptValue,
        n: int = 1,
        temperature: float = 0.01,
        stop: Optional[List[str]] = None,
        callbacks=None,
    ) -> LLMResult:
        prompt_text = _prompt_to_text(prompt)
        nn = max(1, int(n))
        gens = []
        for _ in range(nn):
            txt = self._call_chat(prompt_text, temperature=temperature, stop=stop)
            gens.append(Generation(text=str(txt)))
        return LLMResult(generations=[gens], llm_output={})

    async def agenerate_text(
        self,
        prompt: PromptValue,
        n: int = 1,
        temperature: float = 0.01,
        stop: Optional[List[str]] = None,
        callbacks=None,
    ) -> LLMResult:
        prompt_text = _prompt_to_text(prompt)
        nn = max(1, int(n))
        if nn == 1:
            txt = await self._acall_chat(prompt_text, temperature=temperature, stop=stop)
            return LLMResult(generations=[[Generation(text=str(txt))]], llm_output={})

        gens = []
        for _ in range(nn):
            txt = await self._acall_chat(prompt_text, temperature=temperature, stop=stop)
            gens.append(Generation(text=str(txt)))
        return LLMResult(generations=[gens], llm_output={})

    def is_finished(self, response: LLMResult) -> bool:
        try:
            return bool(response.generations and response.generations[0] and response.generations[0][0].text is not None)
        except Exception:
            return False


def get_evaluation_judge_llm_info() -> dict:
    """Resolve the effective judge LLM config used by ``EvaluationJudgeRagasLLM`` (non-secret fields only)."""
    try:
        base_url, _api_key, model = EvaluationJudgeRagasLLM()._resolve()
    except Exception:
        base_url, model = "", ""
    return {
        "provider": "openai-compatible",
        "base_url": (base_url or "").strip().rstrip("/") or None,
        "model": (model or "").strip() or None,
    }

