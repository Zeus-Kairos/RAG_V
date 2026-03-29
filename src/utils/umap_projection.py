"""2D embedding layout with UMAP (PCA fallback for very small sample sizes)."""
from __future__ import annotations

import random
from typing import Dict, List, Optional, Tuple

import numpy as np

MAX_UMAP_POINTS = 5000


def _as_str_ids(ids: List[str]) -> List[str]:
    return [str(x) for x in ids]


def subsample_for_projection(
    embeddings: np.ndarray,
    ids: List[str],
    must_include_ids: Optional[List[str]] = None,
    max_points: int = MAX_UMAP_POINTS,
) -> Tuple[np.ndarray, List[str], Dict[str, int]]:
    """
    Subsample rows while keeping all must_include ids when possible.

    Returns (subset_embeddings, subset_ids, id_to_subset_row_index).
    """
    n = embeddings.shape[0]
    id_list = _as_str_ids(ids)
    if n == 0:
        return embeddings, id_list, {}

    must: set[str] = set(_as_str_ids(must_include_ids or []))
    id_to_row = {id_list[i]: i for i in range(n)}
    must_indices = sorted({id_to_row[cid] for cid in must if cid in id_to_row})

    if n <= max_points:
        selected = list(range(n))
    else:
        remaining = [i for i in range(n) if i not in must_indices]
        rng = random.Random(42)
        need = max_points - len(must_indices)
        if need <= 0:
            selected = sorted(must_indices[:max_points])
        else:
            sampled = rng.sample(remaining, min(need, len(remaining)))
            selected = sorted(set(must_indices + sampled))

    sub = embeddings[selected]
    sub_ids = [id_list[i] for i in selected]
    id_to_sub = {sub_ids[i]: i for i in range(len(sub_ids))}
    return sub, sub_ids, id_to_sub


def project_2d(
    embeddings: np.ndarray,
    query_embedding: Optional[np.ndarray] = None,
) -> Tuple[np.ndarray, Optional[np.ndarray], str]:
    """
    Fit 2D projection on embedding rows; optionally map the query vector.

    Returns (xy Nx2, query_xy shape (2,) or None, method name).
    """
    if embeddings.size == 0 or embeddings.shape[0] == 0:
        return np.zeros((0, 2), dtype=float), None, "none"

    n, d = embeddings.shape
    x = np.asarray(embeddings, dtype=np.float64)

    if n < 5 or min(n, d) < 2:
        from sklearn.decomposition import PCA

        n_comp = min(2, n, d)
        pca = PCA(n_components=n_comp, random_state=42)
        xy = pca.fit_transform(x)
        if n_comp == 1:
            xy = np.column_stack([xy, np.zeros(n, dtype=float)])
        qxy: Optional[np.ndarray] = None
        if query_embedding is not None:
            q = np.asarray(query_embedding, dtype=np.float64).reshape(1, -1)
            t = pca.transform(q)
            if n_comp == 1:
                t = np.column_stack([t, np.zeros(1, dtype=float)])
            qxy = t[0]
        return xy.astype(float), qxy, "pca"

    import umap

    n_neighbors = min(15, max(2, n - 1))
    reducer = umap.UMAP(
        n_components=2,
        n_neighbors=n_neighbors,
        min_dist=0.1,
        metric="cosine",
        random_state=42,
        n_jobs=1,
    )
    xy = reducer.fit_transform(x)
    qxy = None
    if query_embedding is not None:
        q = np.asarray(query_embedding, dtype=np.float64).reshape(1, -1)
        qxy = reducer.transform(q)[0]
    return xy.astype(float), qxy, "umap"
