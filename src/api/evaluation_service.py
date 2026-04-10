from __future__ import annotations

import json
import math
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from uuid import uuid4

from fastapi import HTTPException

from src.api.chat_service import playground_chat_answer
from src.api.ragas_llm import EvaluationJudgeRagasLLM


def _get_ragas_embeddings_for_eval():
    """Embeddings for RAGAS legacy metrics (e.g. answer_relevancy). Passed to ``evaluate(embeddings=...)``."""
    from ragas.embeddings import HuggingFaceEmbeddings, LangchainEmbeddingsWrapper

    embed_model = (os.getenv("EMBED_MODEL") or "").strip()
    embed_base = (os.getenv("EMBED_BASE_URL") or "").strip().rstrip("/")
    embed_provider = (os.getenv("EMBED_PROVIDER") or "").strip().lower()
    embed_api_key = (os.getenv("EMBED_API_KEY") or "").strip()

    def _ollama_embeddings(*, base: str, model: str) -> Any:
        from langchain_community.embeddings import OllamaEmbeddings

        kwargs: Dict[str, Any] = {"base_url": base, "model": model}
        if embed_api_key:
            kwargs["headers"] = {"Authorization": f"Bearer {embed_api_key}"}
        return LangchainEmbeddingsWrapper(OllamaEmbeddings(**kwargs))

    # 1) Prefer .env EMBED_MODEL (and EMBED_PROVIDER / EMBED_BASE_URL)
    if embed_model:
        if embed_provider in ("huggingface", "hf", "sentence-transformers"):
            try:
                return HuggingFaceEmbeddings(model=embed_model)
            except Exception as e:
                raise HTTPException(
                    status_code=503,
                    detail=f"RAGAS embeddings: HuggingFace model {embed_model!r} failed: {e}",
                ) from e

        # Default / ollama: use same embedding stack as the rest of the app
        if embed_provider in ("", "ollama"):
            base = embed_base or (os.getenv("OLLAMA_BASE_URL") or "http://127.0.0.1:11434").strip().rstrip("/")
            try:
                return _ollama_embeddings(base=base, model=embed_model)
            except Exception as e:
                raise HTTPException(
                    status_code=503,
                    detail=(
                        f"RAGAS embeddings (Ollama): base={base!r}, model={embed_model!r}. "
                        f"Check EMBED_BASE_URL / EMBED_MODEL and that the model is pulled. Error: {e}"
                    ),
                ) from e

        raise HTTPException(
            status_code=503,
            detail=f"Unsupported EMBED_PROVIDER for RAGAS: {embed_provider!r}. Use ollama or huggingface.",
        )

    # 2) Fallback: small local HF model
    try:
        return HuggingFaceEmbeddings(model="sentence-transformers/all-MiniLM-L6-v2")
    except Exception:
        pass

    # 3) Legacy env names only when EMBED_MODEL is unset
    try:
        base = (os.getenv("OLLAMA_BASE_URL") or "http://127.0.0.1:11434").strip().rstrip("/")
        model = (os.getenv("OLLAMA_EMBED_MODEL") or "nomic-embed-text").strip()
        return _ollama_embeddings(base=base, model=model)
    except Exception as e:
        raise HTTPException(
            status_code=503,
            detail=(
                "RAGAS answer relevancy needs embeddings: set EMBED_MODEL (and EMBED_BASE_URL for Ollama), "
                "or install sentence-transformers, or set OLLAMA_EMBED_MODEL + OLLAMA_BASE_URL. "
                f"Error: {e}"
            ),
        ) from e


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _repo_root() -> Path:
    # this file lives at `<repo>/src/api/evaluation_service.py`
    return Path(__file__).resolve().parents[2]


def _evaluation_runs_root() -> Path:
    return _repo_root() / "data" / "evaluation_runs"


def _ensure_runs_root() -> Path:
    root = _evaluation_runs_root()
    root.mkdir(parents=True, exist_ok=True)
    return root


def _run_path(run_id: str) -> Path:
    return _evaluation_runs_root() / f"{run_id}.json"


def _run_meta_path(run_id: str) -> Path:
    return _evaluation_runs_root() / f"{run_id}.meta.json"


def save_evaluation_run(
    *,
    request_params: Dict[str, Any],
    summary: Dict[str, Any],
    rows: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """
    Persist one evaluation run to disk and return its metadata.
    Stored under `<repo>/data/evaluation_runs/` as:
      - `<run_id>.json` (full payload)
      - `<run_id>.meta.json` (small index record for listing)
    """
    _ensure_runs_root()

    run_id = uuid4().hex
    created_at = _utc_now_iso()

    dataset = summary.get("dataset") if isinstance(summary, dict) else None
    dataset_id = dataset.get("dataset_id") if isinstance(dataset, dict) else None
    dataset_name = dataset.get("name") if isinstance(dataset, dict) else None

    payload = {
        "run_id": run_id,
        "created_at": created_at,
        "request": dict(request_params or {}),
        "summary": summary,
        "rows": rows,
    }

    meta = {
        "run_id": run_id,
        "created_at": created_at,
        "kb_name": request_params.get("kb_name"),
        "title": None,
        "note": None,
        "dataset_id": request_params.get("dataset_id") or dataset_id,
        "dataset_name": dataset_name,
        "index_run_id": request_params.get("index_run_id"),
        "chunk_run_id": request_params.get("chunk_run_id"),
        "retriever_type": request_params.get("retriever_type"),
        "query_enhancement": request_params.get("query_enhancement"),
        "k": request_params.get("k"),
        "max_rows": request_params.get("max_rows"),
        "row_count_scored": summary.get("row_count_scored") if isinstance(summary, dict) else None,
        "metrics_mean": summary.get("metrics_mean") if isinstance(summary, dict) else None,
        "notes": summary.get("notes") if isinstance(summary, dict) else None,
    }

    _write_json_file(_run_path(run_id), payload)
    _write_json_file(_run_meta_path(run_id), meta)

    return meta


def list_evaluation_runs(
    *,
    kb_name: Optional[str] = None,
    dataset_id: Optional[str] = None,
    limit: int = 50,
) -> List[Dict[str, Any]]:
    root = _ensure_runs_root()
    lim = max(1, min(500, int(limit)))
    out: List[Dict[str, Any]] = []
    for p in sorted(root.glob("*.meta.json"), key=lambda x: x.stat().st_mtime, reverse=True):
        try:
            m = _read_json_file(p)
        except HTTPException:
            continue
        if not isinstance(m, dict):
            continue
        if kb_name and str(m.get("kb_name") or "") != str(kb_name):
            continue
        if dataset_id and str(m.get("dataset_id") or "") != str(dataset_id):
            continue
        out.append(m)
        if len(out) >= lim:
            break
    return out


def get_evaluation_run(run_id: str) -> Dict[str, Any]:
    _ensure_runs_root()
    p = _run_path(run_id)
    if not p.exists():
        raise HTTPException(status_code=404, detail="Evaluation run not found")
    payload = _read_json_file(p)
    if not isinstance(payload, dict):
        raise HTTPException(status_code=500, detail="Corrupted evaluation run file")
    return payload


def update_evaluation_run_meta(
    run_id: str,
    *,
    title: Optional[str] = None,
    note: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Update the `.meta.json` record and (best-effort) mirror into the full run payload.
    """
    _ensure_runs_root()
    mp = _run_meta_path(run_id)
    if not mp.exists():
        raise HTTPException(status_code=404, detail="Evaluation run not found")
    meta = _read_json_file(mp)
    if not isinstance(meta, dict):
        raise HTTPException(status_code=500, detail="Corrupted evaluation run meta file")

    def _norm(v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        s = str(v).strip()
        return s if s else None

    if title is not None:
        meta["title"] = _norm(title)
    if note is not None:
        meta["note"] = _norm(note)

    _write_json_file(mp, meta)

    # Mirror into the full payload if present (non-critical)
    rp = _run_path(run_id)
    if rp.exists():
        try:
            payload = _read_json_file(rp)
            if isinstance(payload, dict):
                if title is not None:
                    payload["title"] = meta.get("title")
                if note is not None:
                    payload["note"] = meta.get("note")
                _write_json_file(rp, payload)
        except HTTPException:
            pass

    return meta


def delete_evaluation_run(run_id: str) -> None:
    _ensure_runs_root()
    rp = _run_path(run_id)
    mp = _run_meta_path(run_id)
    if not rp.exists() and not mp.exists():
        raise HTTPException(status_code=404, detail="Evaluation run not found")
    try:
        if rp.exists():
            rp.unlink()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete run payload: {e}") from e
    try:
        if mp.exists():
            mp.unlink()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete run meta: {e}") from e


def _datasets_root() -> Path:
    # repo root is `c:\Apps\RAG_V`; this file is in `src/api/`
    # Use a stable relative path: `<repo>/data/evaluation_datasets`
    return Path(__file__).resolve().parents[2] / "data" / "evaluation_datasets"


def _ensure_root() -> Path:
    root = _datasets_root()
    root.mkdir(parents=True, exist_ok=True)
    return root


def _meta_path(dataset_id: str) -> Path:
    return _datasets_root() / f"{dataset_id}.meta.json"


def _data_path(dataset_id: str) -> Path:
    return _datasets_root() / f"{dataset_id}.json"


def _read_json_file(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read {path.name}: {e}") from e


def _write_json_file(path: Path, obj: Any) -> None:
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")


def _normalize_dataset_payload(payload: Any) -> Tuple[Dict[str, Any], List[Dict[str, Any]]]:
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Dataset JSON must be an object")
    name = payload.get("name")
    if not isinstance(name, str) or not name.strip():
        raise HTTPException(status_code=400, detail="Dataset `name` is required")
    version = payload.get("version", None)
    data = payload.get("data")
    if not isinstance(data, list) or len(data) == 0:
        raise HTTPException(status_code=400, detail="Dataset `data` must be a non-empty array")

    rows: List[Dict[str, Any]] = []
    for i, row in enumerate(data):
        if not isinstance(row, dict):
            raise HTTPException(status_code=400, detail=f"Row {i} must be an object")
        if "query" not in row:
            raise HTTPException(status_code=400, detail=f"Row {i} missing required field `query`")
        if "answer" not in row:
            raise HTTPException(status_code=400, detail=f"Row {i} missing required field `answer`")
        rows.append(row)

    meta = {"name": name.strip(), "version": version}
    return meta, rows


def save_uploaded_dataset_bytes(file_bytes: bytes) -> Dict[str, Any]:
    _ensure_root()
    try:
        payload = json.loads(file_bytes.decode("utf-8"))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid JSON: {e}") from e

    meta_in, rows = _normalize_dataset_payload(payload)

    columns = sorted({k for r in rows for k in r.keys()})
    dataset_id = uuid4().hex

    normalized = {"name": meta_in["name"], "version": meta_in.get("version"), "data": rows}
    meta = {
        "dataset_id": dataset_id,
        "name": meta_in["name"],
        "version": meta_in.get("version"),
        "row_count": len(rows),
        "columns": columns,
        "created_at": _utc_now_iso(),
    }

    _write_json_file(_data_path(dataset_id), normalized)
    _write_json_file(_meta_path(dataset_id), meta)

    return meta


def list_datasets() -> List[Dict[str, Any]]:
    root = _ensure_root()
    out: List[Dict[str, Any]] = []
    for p in sorted(root.glob("*.meta.json"), key=lambda x: x.stat().st_mtime, reverse=True):
        try:
            out.append(_read_json_file(p))
        except HTTPException:
            continue
    return out


def get_dataset(dataset_id: str, *, offset: int, limit: int) -> Tuple[Dict[str, Any], List[Dict[str, Any]], int]:
    _ensure_root()
    mp = _meta_path(dataset_id)
    dp = _data_path(dataset_id)
    if not mp.exists() or not dp.exists():
        raise HTTPException(status_code=404, detail="Dataset not found")
    meta = _read_json_file(mp)
    payload = _read_json_file(dp)
    rows = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(rows, list):
        raise HTTPException(status_code=500, detail="Corrupted dataset file")

    total = len(rows)
    o = max(0, int(offset))
    l = max(1, min(500, int(limit)))
    return meta, rows[o : o + l], total


def _string_or_empty(x: Any) -> str:
    if x is None:
        return ""
    if isinstance(x, str):
        return x
    return str(x)


def _reference_present(ans: Any) -> bool:
    s = _string_or_empty(ans).strip()
    return bool(s)


def _merge_chunk_detail(from_index: Optional[dict], db_rec: Optional[dict]) -> Tuple[str, Dict[str, Any]]:
    content = ""
    metadata: Dict[str, Any] = {}
    if isinstance(from_index, dict):
        content = from_index.get("content") or ""
        metadata = dict(from_index.get("metadata") or {})
    if isinstance(db_rec, dict):
        db_content = db_rec.get("content") or ""
        db_meta = dict(db_rec.get("metadata") or {})
        if not content.strip() and db_content.strip():
            content = db_content
        metadata = {**db_meta, **metadata}
    return content, metadata


def _context_text_from_chunk(content: str, metadata: Dict[str, Any]) -> str:
    chunk_type = str(metadata.get("chunk_type") or "")
    if chunk_type == "augment":
        src = metadata.get("source_chunk_content")
        if isinstance(src, str) and src.strip():
            return src
    return content or ""


@dataclass
class EvalRowResult:
    query: str
    answer: str
    response: str
    retrieved_chunk_ids: List[str]
    retrieved_contexts: List[str]
    metrics: Dict[str, Any]


def run_evaluation(
    *,
    memory_manager: Any,
    get_indexer_fn: Any,
    dataset_id: str,
    kb_name: str,
    index_run_id: int,
    retriever_type: str,
    query_enhancement: str,
    k: int,
    max_rows: Optional[int] = None,
) -> Tuple[List[EvalRowResult], Dict[str, Any]]:
    """
    Executes retrieval + LLM response + ragas scoring.
    """
    meta, rows, total = get_dataset(dataset_id, offset=0, limit=10**9)
    if max_rows is not None and int(max_rows) > 0:
        rows = rows[: int(max_rows)]

    # resolve indexer for this index_run_id
    index_run = memory_manager.index_manager.get_index_run_by_id(int(index_run_id))
    if not index_run:
        raise HTTPException(status_code=404, detail="Index run not found")
    chunk_run_id = index_run["chunk_run_id"]
    embedding_config_id = index_run["embedding_configure_id"]
    indexer = get_indexer_fn(kb_name, chunk_run_id, embedding_config_id)
    if not indexer:
        raise HTTPException(status_code=400, detail="Failed to initialize indexer")

    # Lazy imports: keep module import light so the API can start even if optional
    # retrieval dependencies are not available in the current Python environment.
    from src.retriever.retriever_wrapper import RetrieverWrapper
    from src.retriever.retrievers import BaseRetriever

    try:
        retriever = BaseRetriever.create(str(retriever_type), indexer)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    wrapper = RetrieverWrapper()

    # Step 1: build per-row contexts + LLM responses (grounded only on retrieved contexts)
    prepared: List[Dict[str, Any]] = []
    per_row_detail: List[Dict[str, Any]] = []

    for row in rows:
        q = _string_or_empty(row.get("query")).strip()
        a = _string_or_empty(row.get("answer")).strip()
        if not q:
            continue

        queries_used = wrapper.preprocess(q, str(query_enhancement))
        if not queries_used:
            queries_used = [q]

        per_query_formatted: List[List[Dict[str, Any]]] = []
        for qq in queries_used:
            pairs = retriever.retrieve(str(qq), k=int(k))
            formatted = []
            for doc, score in pairs:
                formatted.append(
                    {
                        "id": doc.metadata.get("chunk_id"),
                        "relevance_score": float(score),
                    }
                )
            per_query_formatted.append(formatted)

        final_results = wrapper.postprocess(str(query_enhancement), per_query_formatted, k=int(k))
        chunk_ids = [str(x.get("id")) for x in (final_results or []) if x.get("id") is not None]

        contexts: List[str] = []
        for cid in chunk_ids:
            from_index = indexer.get_chunk_detail_from_index(cid)
            db_rec = memory_manager.chunking_manager.get_chunk_record_by_run_and_id(chunk_run_id, cid)
            content, meta2 = _merge_chunk_detail(from_index, db_rec)
            contexts.append(_context_text_from_chunk(content, meta2))

        chunks_for_chat = [{"index": i + 1, "content": contexts[i]} for i in range(len(contexts))]
        chat = playground_chat_answer(query=q, chunks=chunks_for_chat)
        resp = _string_or_empty(chat.get("answer")).strip()

        prepared.append(
            {
                "user_input": q,
                "reference": a if _reference_present(a) else None,
                "retrieved_contexts": contexts,
                "retrieved_context_ids": chunk_ids,
                "response": resp,
            }
        )
        per_row_detail.append(
            {
                "query": q,
                "answer": a,
                "response": resp,
                "retrieved_chunk_ids": chunk_ids,
                "retrieved_contexts": contexts,
            }
        )

    # Step 2: run RAGAS scoring in two groups based on reference availability
    #
    # RAGAS 0.4.x: ``from ragas.metrics.collections import context_precision`` imports
    # *submodules*, not Metric instances — that triggers ``All metrics must be initialised metric objects``.
    # Collections v2 metrics also require ``InstructorBaseRagasLLM``, which rejects our
    # ``EvaluationRagasLLM``. Use **legacy** metric objects from ``ragas.metrics`` (singletons
    # with ``llm=None`` injected by ``evaluate``).
    from ragas import evaluate
    from ragas.dataset_schema import EvaluationDataset
    from ragas.metrics import (
        answer_relevancy,
        context_entity_recall,
        context_precision,
        context_recall,
        faithfulness,
    )

    llm = EvaluationJudgeRagasLLM()

    with_ref_idx: List[int] = []
    without_ref_idx: List[int] = []
    for i, s in enumerate(prepared):
        if s.get("reference") is None or str(s.get("reference") or "").strip() == "":
            without_ref_idx.append(i)
        else:
            with_ref_idx.append(i)

    embeddings = None
    if with_ref_idx or without_ref_idx:
        embeddings = _get_ragas_embeddings_for_eval()

    per_row_metrics: List[Dict[str, Any]] = [{} for _ in prepared]
    errors: List[str] = []

    def _run_group(indices: List[int], metrics: List[Any]) -> None:
        if not indices:
            return
        samples = [prepared[i] for i in indices]
        ds = EvaluationDataset.from_list(samples)
        try:
            result = evaluate(
                ds,
                metrics=metrics,
                llm=llm,
                embeddings=embeddings,
                show_progress=False,
                raise_exceptions=False,
            )
            score_rows = result.scores  # list[dict]
            for local_i, score in enumerate(score_rows):
                gi = indices[local_i]
                per_row_metrics[gi] = dict(score or {})
        except Exception as e:
            errors.append(str(e))

    _run_group(
        with_ref_idx,
        [
            context_precision,
            context_recall,
            context_entity_recall,
            answer_relevancy,
            faithfulness,
        ],
    )
    _run_group(without_ref_idx, [answer_relevancy, faithfulness])

    # Step 3: build final rows with requested metric key names
    out_rows: List[EvalRowResult] = []
    for i, d in enumerate(per_row_detail):
        m = dict(per_row_metrics[i] or {})

        # Rename to user-requested names
        if "answer_relevancy" in m and "response_relevancy" not in m:
            m["response_relevancy"] = m.pop("answer_relevancy")
        if "context_entity_recall" in m and "context_entities_recall" not in m:
            m["context_entities_recall"] = m.pop("context_entity_recall")

        out_rows.append(
            EvalRowResult(
                query=d["query"],
                answer=d["answer"],
                response=d["response"],
                retrieved_chunk_ids=d["retrieved_chunk_ids"],
                retrieved_contexts=d["retrieved_contexts"],
                metrics=m,
            )
        )

    # Step 4: summary means
    def _mean(vals: List[float]) -> Optional[float]:
        clean: List[float] = []
        for x in vals:
            if x is None:
                continue
            try:
                fx = float(x)
            except Exception:
                continue
            if not math.isfinite(fx):
                continue
            clean.append(fx)
        if not clean:
            return None
        return sum(clean) / len(clean)

    metric_names = [
        "context_precision",
        "context_recall",
        "context_entities_recall",
        "response_relevancy",
        "faithfulness",
    ]
    metrics_mean: Dict[str, Any] = {}
    for mn in metric_names:
        vals = []
        for r in out_rows:
            v = r.metrics.get(mn)
            try:
                fv = float(v)
                if math.isfinite(fv):
                    vals.append(fv)
            except Exception:
                continue
        mv = _mean(vals)
        if mv is not None:
            metrics_mean[mn] = mv

    notes = None
    if errors:
        notes = " ; ".join(errors[:3])

    summary = {
        "dataset": {"dataset_id": meta.get("dataset_id"), "name": meta.get("name"), "version": meta.get("version")},
        "row_count_total": total,
        "row_count_scored": len(out_rows),
        "metrics_mean": metrics_mean,
        "notes": notes,
    }
    return out_rows, summary

