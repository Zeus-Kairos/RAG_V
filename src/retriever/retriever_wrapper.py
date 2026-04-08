from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Tuple

from src.utils.logging_config import get_logger
from src.utils.query_enhancement_llm import (
    generate_list_items_prefer_llm_fallback_ollama,
    generate_text_prefer_llm_fallback_ollama,
)

logger = get_logger(__name__)


def _normalize_enhancement(value: str | None) -> str:
    s = (value or "none").strip().lower()
    s = s.replace("_", "-").replace(" ", "-")
    if s in {"", "none", "null"}:
        return "none"
    return s


def _dedupe_keep_order(items: Iterable[str]) -> List[str]:
    seen = set()
    out: List[str] = []
    for it in items:
        s = str(it or "").strip()
        if not s:
            continue
        key = s.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(s)
    return out


@dataclass(frozen=True)
class RetrieverWrapperResult:
    results: List[Dict[str, Any]]
    queries_used: List[str]


class RetrieverWrapper:
    """Query enhancement wrapper around retrieval + (optional) RRF merge."""

    def __init__(self, *, rrf_k0: int = 60):
        self.rrf_k0 = int(rrf_k0) if int(rrf_k0) > 0 else 60

    def preprocess(self, query: str, enhancement: str) -> List[str]:
        enh = _normalize_enhancement(enhancement)
        q = (query or "").strip()
        if not q:
            return []
        if enh == "none":
            return [q]

        if enh == "multi-query":
            system = "You generate search queries for retrieval."
            user = (
                "Rewrite the user's question into 3 diverse search queries that retrieve different relevant passages.\n"
                "Return ONLY the queries, one per line. Do not add explanations.\n\n"
                f"USER_QUESTION:\n{q}"
            )
            items = generate_list_items_prefer_llm_fallback_ollama(system=system, user=user)
            items = items[:3]
            return _dedupe_keep_order([q, *items])

        if enh == "decomposition":
            system = "You decompose questions into sub-questions for retrieval."
            user = (
                "Decompose the user's question into a small set of sub-questions useful for retrieval.\n"
                "Choose the number of sub-questions yourself, but output at most 5.\n"
                "Return ONLY the sub-questions, one per line. Do not add explanations.\n\n"
                f"USER_QUESTION:\n{q}"
            )
            items = generate_list_items_prefer_llm_fallback_ollama(system=system, user=user)
            items = items[:5]
            return _dedupe_keep_order([q, *items])

        if enh == "step-back":
            system = "You generate a broader, more general step-back question for retrieval."
            user = (
                "Write ONE step-back question that is more general than the user's question, to retrieve background context.\n"
                "Return ONLY the question.\n\n"
                f"USER_QUESTION:\n{q}"
            )
            txt = generate_text_prefer_llm_fallback_ollama(system=system, user=user)
            out = (txt or "").strip()
            return [out] if out else [q]

        if enh == "hyde":
            system = "You create a hypothetical document that would answer the user's question."
            user = (
                "Write a concise hypothetical passage (150-250 words) that would directly answer the user's question.\n"
                "Return ONLY the passage.\n\n"
                f"USER_QUESTION:\n{q}"
            )
            passage = generate_text_prefer_llm_fallback_ollama(system=system, user=user) or ""
            passage = passage.strip()
            if not passage:
                return [q]
            return [f"{q}\n\nHypothetical_document:\n{passage}"]

        if enh == "hype":
            system = "You expand queries for better retrieval."
            user = (
                "Expand the user's query into a retrieval-optimized query with key terms, synonyms, and context.\n"
                "Return ONLY the expanded query.\n\n"
                f"USER_QUERY:\n{q}"
            )
            txt = generate_text_prefer_llm_fallback_ollama(system=system, user=user)
            out = (txt or "").strip()
            return [out] if out else [q]

        logger.info("Unknown query enhancement '%s'; fallback to none.", enh)
        return [q]

    def postprocess(
        self,
        enhancement: str,
        per_query_results: List[List[Dict[str, Any]]],
        *,
        k: int,
    ) -> List[Dict[str, Any]]:
        enh = _normalize_enhancement(enhancement)
        kk = int(k) if int(k) > 0 else 1

        if enh not in {"multi-query", "decomposition"}:
            # Single query enhancements; return first list
            if not per_query_results:
                return []
            return (per_query_results[0] or [])[:kk]

        return self._rrf_merge(per_query_results, k=kk)

    def _rrf_merge(self, per_query_results: List[List[Dict[str, Any]]], *, k: int) -> List[Dict[str, Any]]:
        scores: Dict[str, float] = {}
        best_payload: Dict[str, Dict[str, Any]] = {}
        best_raw_score: Dict[str, float] = {}

        for res_list in per_query_results:
            if not res_list:
                continue
            for idx, item in enumerate(res_list):
                doc_id = str(item.get("id") or "")
                if not doc_id:
                    continue
                rank = idx + 1
                scores[doc_id] = scores.get(doc_id, 0.0) + 1.0 / (self.rrf_k0 + rank)

                raw = item.get("relevance_score")
                try:
                    raw_f = float(raw)
                except Exception:
                    raw_f = float("-inf")
                prev_best = best_raw_score.get(doc_id, float("-inf"))
                if doc_id not in best_payload or raw_f > prev_best:
                    best_payload[doc_id] = item
                    best_raw_score[doc_id] = raw_f

        ranked: List[Tuple[str, float]] = sorted(scores.items(), key=lambda x: x[1], reverse=True)
        out: List[Dict[str, Any]] = []
        for doc_id, rrf_score in ranked[:k]:
            payload = dict(best_payload.get(doc_id) or {"id": doc_id})
            payload["rrf_score"] = float(rrf_score)
            out.append(payload)
        return out

