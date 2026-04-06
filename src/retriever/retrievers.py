from typing import List, Tuple

import numpy as np
from langchain_core.documents import Document

from src.memory.chunks_fts import bm25_top_k_for_run
from src.retriever.bm25_scores import BM25Scorer
from src.file_process.indexer import Indexer
from src.utils.logging_config import get_logger

logger = get_logger(__name__)


class BaseRetriever:
    """Base retriever class that uses an Indexer to retrieve documents."""

    _retriever_registry = {}

    def __init_subclass__(cls, retriever_name: str, **kwargs):
        super().__init_subclass__(**kwargs)
        BaseRetriever._retriever_registry[retriever_name] = cls

    def __init__(self, indexer: Indexer):
        self.indexer = indexer
        self._retrievers = {}

    def retrieve(self, query: str, k: int = 5, **kwargs) -> List[Tuple[Document, float]]:
        retriever_type = kwargs.get("retriever_type", "vector")
        if retriever_type not in self._retrievers:
            self._retrievers[retriever_type] = BaseRetriever.create(
                retriever_type, self.indexer
            )
        return self._retrievers[retriever_type].retrieve(query, k, **kwargs)

    @classmethod
    def register_retriever(cls, name: str):
        def decorator(retriever_class):
            cls._retriever_registry[name] = retriever_class
            return retriever_class

        return decorator

    @classmethod
    def create(cls, retriever_type: str, indexer: Indexer) -> "BaseRetriever":
        if retriever_type in cls._retriever_registry:
            return cls._retriever_registry[retriever_type](indexer)
        raise ValueError(f"Unknown retriever type: {retriever_type}")

    @classmethod
    def get_retriever_names(cls) -> List[str]:
        return list(cls._retriever_registry.keys())


class VectorRetriever(BaseRetriever, retriever_name="vector"):
    """Retriever that uses sqlite-vec KNN."""

    def retrieve(self, query: str, k: int = 5, **kwargs) -> List[Tuple[Document, float]]:
        return self.indexer.similarity_search_with_relevance_scores(query, k=k, **kwargs)


class BM25BasedRetriever(BaseRetriever, retriever_name="bm25"):
    def __init__(self, indexer: Indexer):
        super().__init__(indexer)

    def retrieve(self, query: str, k: int = 5, **kwargs) -> List[Tuple[Document, float]]:
        q = str(query).strip()
        if not q:
            return []
        hits = bm25_top_k_for_run(
            self.indexer.conn,
            self.indexer.chunk_run_id,
            q,
            k,
        )
        out: List[Tuple[Document, float]] = []
        for chunk_pk, score in hits:
            doc = self.indexer._doc_for_chunk_pk(chunk_pk)
            if doc:
                out.append((doc, float(score)))
        return out


class FusionRetriever(BaseRetriever, retriever_name="fusion"):
    def retrieve(self, query: str, k: int = 5, **kwargs) -> List[Tuple[Document, float]]:
        all_docs = self.indexer.all_docs
        if not all_docs:
            return []

        dists = self.indexer.vector_distances_for_query_ordered(query)
        if dists.size != len(all_docs):
            dists = np.full(len(all_docs), np.inf, dtype=float)
        dists_safe = np.where(np.isfinite(dists), dists, 1e12)
        vector_scores = 1.0 / (1.0 + dists_safe)

        bm25_scorer = BM25Scorer.from_indexer(self.indexer)
        bm25_scores = np.asarray(bm25_scorer.get_scores(query), dtype=float)

        epsilon = 1e-6
        alpha = 0.5

        v_min, v_max = np.min(vector_scores), np.max(vector_scores)
        vector_norm = 1 - (vector_scores - v_min) / (v_max - v_min + epsilon)

        b_min, b_max = np.min(bm25_scores), np.max(bm25_scores)
        bm25_norm = (bm25_scores - b_min) / (b_max - b_min + epsilon)

        combined_scores = alpha * vector_norm + (1 - alpha) * bm25_norm
        sorted_indices = np.argsort(combined_scores)[::-1]

        return [
            (all_docs[i], float(combined_scores[i]))
            for i in sorted_indices[:k]
        ]


class RerankRetriever(BaseRetriever, retriever_name="rerank"):
    def retrieve(self, query: str, k: int = 5, **kwargs) -> List[Tuple[Document, float]]:
        results = self.indexer.similarity_search(query, k=k * 2)

        from src.retriever.reranker import JinaReRanker

        reranker = JinaReRanker()
        reranked_results = reranker.rerank(query, results)
        reranked_results = reranked_results[:k]

        return reranked_results
