from __future__ import annotations

from typing import Any, Iterable, List

import numpy as np

from src.memory.chunks_fts import bm25_scores_for_ordered_pks


class BM25Scorer:
    """Lexical scores from SQLite FTS5 bm25() over chunks_fts."""

    def __init__(
        self,
        conn: Any,
        chunk_run_id: int,
        ordered_chunk_pks: List[int],
    ) -> None:
        self.conn = conn
        self.chunk_run_id = chunk_run_id
        self.ordered_chunk_pks = ordered_chunk_pks

    @classmethod
    def from_documents(
        cls,
        documents: Iterable[Any],
    ) -> "BM25Scorer":
        raise TypeError(
            "BM25Scorer.from_documents is removed; use BM25Scorer.from_indexer(indexer)"
        )

    @classmethod
    def from_indexer(cls, indexer: Any) -> "BM25Scorer":
        rows = indexer.chunking_manager.get_chunks_by_chunk_run_id(indexer.chunk_run_id)
        pks = [int(r["id"]) for r in rows]
        return cls(indexer.conn, int(indexer.chunk_run_id), pks)

    def get_scores(self, query: str) -> List[float]:
        arr = bm25_scores_for_ordered_pks(
            self.conn,
            self.chunk_run_id,
            query,
            self.ordered_chunk_pks,
        )
        return np.asarray(arr, dtype=float).tolist()
