import json
import sqlite3
import threading
from typing import Any, Dict, List, Optional, Tuple, Union, TYPE_CHECKING

import numpy as np
from langchain_core.documents import Document

from src.memory.vector_store import (
    fetch_embeddings_for_chunk_run,
    knn_search,
    query_to_chunk_distances,
    upsert_vectors,
    vec_table_name,
    _table_exists,
)
from src.utils.embeddings import get_embedding_runner
from src.utils.logging_config import get_logger

if TYPE_CHECKING:
    from src.memory.chunks import ChunkingManager

logger = get_logger(__name__)


def _l2_to_score(distance: float) -> float:
    return 1.0 / (1.0 + float(distance))


class Indexer:
    """Chunk embeddings in sqlite-vec (one vec0 table per embedding configuration)."""

    def __init__(
        self,
        embedding_config_id: str,
        conn: sqlite3.Connection,
        chunk_run_id: int,
        chunking_manager: "ChunkingManager",
    ):
        self.embedding_config_id = embedding_config_id
        self.conn = conn
        self.chunk_run_id = chunk_run_id
        self.chunking_manager = chunking_manager
        self._embeddings = get_embedding_runner(embedding_config_id).embedding_model
        self._lock = threading.RLock()
        self._all_docs_cache: Optional[List[Document]] = None

    def _invalidate_docs_cache(self) -> None:
        self._all_docs_cache = None

    def _load_docs_ordered(self) -> List[Document]:
        rows = self.chunking_manager.get_chunks_by_chunk_run_id(self.chunk_run_id)
        out: List[Document] = []
        for r in rows:
            meta = dict(r["metadata"])
            meta["chunk_pk"] = r["id"]
            out.append(
                Document(
                    page_content=r["content"],
                    id=str(r["chunk_id"]),
                    metadata=meta,
                )
            )
        return out

    @property
    def all_docs(self) -> List[Document]:
        with self._lock:
            if self._all_docs_cache is None:
                self._all_docs_cache = self._load_docs_ordered()
            return self._all_docs_cache

    def _doc_for_chunk_pk(self, chunk_pk: int) -> Optional[Document]:
        cur = self.conn.execute(
            "SELECT chunk_id, content, metadata FROM chunks WHERE id = ? AND chunk_run_id = ?",
            (chunk_pk, self.chunk_run_id),
        )
        row = cur.fetchone()
        if row is None:
            return None
        meta_raw = row["metadata"] if hasattr(row, "keys") else row[2]
        meta: Dict[str, Any] = {}
        if meta_raw:
            try:
                meta = json.loads(meta_raw) if isinstance(meta_raw, str) else dict(meta_raw)
            except (json.JSONDecodeError, TypeError):
                meta = {}
        meta["chunk_pk"] = chunk_pk
        cid = row["chunk_id"] if hasattr(row, "keys") else row[0]
        content = row["content"] if hasattr(row, "keys") else row[1]
        return Document(page_content=content or "", id=str(cid), metadata=meta)

    def index_chunks(
        self,
        chunks: Dict[int, List[Document]] | List[Document],
        save: bool = False,
    ) -> None:
        if isinstance(chunks, dict):
            file_ids = list(chunks.keys())
            with self._lock:
                self.delete_file_chunks(file_ids)
            all_chunks = [c for lst in chunks.values() for c in lst]
        else:
            file_ids = None
            all_chunks = chunks

        if not all_chunks:
            logger.info("No chunks to index")
            return

        texts = [c.page_content for c in all_chunks]
        metas = [c.metadata or {} for c in all_chunks]
        chunk_pks: List[int] = []
        for m in metas:
            pk = m.get("chunk_pk")
            if pk is None:
                raise ValueError("Each chunk Document.metadata must include chunk_pk (chunks.id)")
            chunk_pks.append(int(pk))

        embeddings = self._embeddings.embed_documents(texts)
        dim = len(embeddings[0])
        rows = [
            (chunk_pks[i], self.chunk_run_id, embeddings[i])
            for i in range(len(all_chunks))
        ]
        with self._lock:
            upsert_vectors(self.conn, self.embedding_config_id, dim, rows)
            self._invalidate_docs_cache()
            if file_ids:
                logger.info("Indexed %s chunks for file_ids %s", len(all_chunks), file_ids)
            else:
                logger.info("Indexed %s chunks", len(all_chunks))
            if save:
                self.conn.commit()

    def delete_file_chunks(
        self, file_ids: Optional[List[int]] = None, save: bool = False
    ) -> None:
        tbl = vec_table_name(self.embedding_config_id)
        with self._lock:
            if not _table_exists(self.conn, tbl):
                self._invalidate_docs_cache()
                return
            if file_ids is None:
                self.conn.execute(
                    f'DELETE FROM "{tbl}" WHERE chunk_run_id = ?',
                    (self.chunk_run_id,),
                )
                logger.info(
                    "Deleted all vectors for chunk_run_id=%s in %s",
                    self.chunk_run_id,
                    tbl,
                )
            else:
                if not file_ids:
                    self._invalidate_docs_cache()
                    return
                placeholders = ",".join("?" * len(file_ids))
                cur = self.conn.execute(
                    f"SELECT id FROM chunks WHERE chunk_run_id = ? AND file_id IN ({placeholders})",
                    (self.chunk_run_id, *file_ids),
                )
                pks = [int(r[0]) for r in cur.fetchall()]
                if pks:
                    ph2 = ",".join("?" * len(pks))
                    self.conn.execute(
                        f'DELETE FROM "{tbl}" WHERE chunk_pk IN ({ph2})',
                        tuple(pks),
                    )
                    logger.info(
                        "Deleted %s vectors for file_ids %s",
                        len(pks),
                        file_ids,
                    )
            self.conn.commit()
            self._invalidate_docs_cache()

    def save_index(self) -> None:
        with self._lock:
            self.conn.commit()
        logger.info("Committed database (sqlite-vec)")

    def similarity_search(self, query: str, k: int = 5, **kwargs: Any) -> List[Document]:
        scored = self.similarity_search_with_relevance_scores(query, k=k, **kwargs)
        return [d for d, _ in scored]

    def similarity_search_with_relevance_scores(
        self, query: str, k: int = 5, **kwargs: Any
    ) -> List[Tuple[Document, float]]:
        q = str(query).strip()
        if not q:
            return []
        qv = self._embeddings.embed_query(q)
        with self._lock:
            hits = knn_search(
                self.conn,
                self.embedding_config_id,
                qv,
                self.chunk_run_id,
                k,
            )
        out: List[Tuple[Document, float]] = []
        for chunk_pk, dist in hits:
            doc = self._doc_for_chunk_pk(chunk_pk)
            if doc:
                out.append((doc, _l2_to_score(dist)))
        return out

    def vector_distances_for_query_ordered(self, query: str) -> np.ndarray:
        """L2 distances aligned with ``all_docs`` / get_chunks_by_chunk_run_id order."""
        rows = self.chunking_manager.get_chunks_by_chunk_run_id(self.chunk_run_id)
        pks_ordered = [int(r["id"]) for r in rows]
        if not pks_ordered:
            return np.array([], dtype=float)
        q = str(query).strip()
        if not q:
            return np.full(len(pks_ordered), np.inf, dtype=float)
        qv = self._embeddings.embed_query(q)
        with self._lock:
            dist_pairs = query_to_chunk_distances(
                self.conn,
                self.embedding_config_id,
                qv,
                self.chunk_run_id,
            )
        dist_map = {pk: d for pk, d in dist_pairs}
        return np.array(
            [dist_map.get(pk, np.inf) for pk in pks_ordered],
            dtype=float,
        )

    def get_all_embeddings_with_ids(self) -> Tuple[np.ndarray, List[str]]:
        """Matrix rows match chunk_id strings in order of increasing chunks.id among indexed rows."""
        with self._lock:
            mat, pks = fetch_embeddings_for_chunk_run(
                self.conn,
                self.embedding_config_id,
                self.chunk_run_id,
            )
        if mat.size == 0:
            return np.array([], dtype=np.float32).reshape(0, 0), []
        id_to_chunk_id: Dict[int, str] = {}
        for r in self.chunking_manager.get_chunks_by_chunk_run_id(self.chunk_run_id):
            id_to_chunk_id[int(r["id"])] = str(r["chunk_id"])
        chunk_ids = [id_to_chunk_id.get(pk, str(pk)) for pk in pks]
        return mat, chunk_ids

    @staticmethod
    def _truncate_preview(text: str, max_len: int) -> str:
        if not text:
            return ""
        one_line = " ".join(str(text).split())
        if len(one_line) <= max_len:
            return one_line
        return one_line[: max_len - 1] + "…"

    def get_chunk_filename(self, chunk_id: str) -> str:
        rec = self.chunking_manager.get_chunk_record_by_run_and_id(
            self.chunk_run_id, chunk_id
        )
        if not rec:
            return ""
        meta = rec.get("metadata") or {}
        return str(meta.get("filename") or meta.get("filepath") or "")

    def get_chunk_text_preview(self, chunk_id: str, max_len: int = 96) -> str:
        rec = self.chunking_manager.get_chunk_record_by_run_and_id(
            self.chunk_run_id, chunk_id
        )
        if rec and (rec.get("content") or "").strip():
            return self._truncate_preview(rec["content"], max_len)
        return ""

    def get_chunk_detail_from_index(self, chunk_id: str) -> Optional[Dict[str, Any]]:
        rec = self.chunking_manager.get_chunk_record_by_run_and_id(
            self.chunk_run_id, chunk_id
        )
        if not rec:
            return None
        meta = dict(rec.get("metadata") or {})
        return {
            "content": rec.get("content") or "",
            "metadata": meta,
            "document_name": str(
                meta.get("filename") or meta.get("filepath") or ""
            ),
        }
