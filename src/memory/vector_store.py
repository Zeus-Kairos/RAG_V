"""
sqlite-vec vec0: one virtual table per embedding_configure.id.
Row primary key chunk_pk = chunks.id; chunk_run_id metadata for scoped KNN.
Vector column uses distance_metric=cosine (KNN and fusion use cosine distance).
"""
from __future__ import annotations

import re
import sqlite3
from typing import List, Optional, Sequence, Tuple

import numpy as np

from src.utils.logging_config import get_logger

logger = get_logger(__name__)

_VEC0_TABLE_PREFIX = "vec_emb_"


def vec_table_name(embedding_config_id: str) -> str:
    safe = re.sub(r"[^0-9a-zA-Z_]", "_", embedding_config_id)
    safe = safe.strip("_") or "default"
    return f"{_VEC0_TABLE_PREFIX}{safe}"


def serialize_embedding(vec: Sequence[float] | np.ndarray) -> bytes:
    arr = np.asarray(vec, dtype=np.float32).reshape(-1)
    return arr.tobytes()


def _table_exists(conn: sqlite3.Connection, name: str) -> bool:
    cur = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type IN ('table','virtual') AND name = ?",
        (name,),
    )
    return cur.fetchone() is not None


def drop_vec_table(conn: sqlite3.Connection, embedding_config_id: str) -> None:
    tbl = vec_table_name(embedding_config_id)
    if _table_exists(conn, tbl):
        conn.execute(f'DROP TABLE IF EXISTS "{tbl}"')
        conn.commit()
        logger.info("Dropped vector table %s", tbl)


def ensure_vec_table(conn: sqlite3.Connection, embedding_config_id: str, dim: int) -> str:
    """Create vec0 table if missing. Recreate if dimension changed or metric is not cosine."""
    tbl = vec_table_name(embedding_config_id)
    cur = conn.cursor()
    cur.execute(
        "SELECT embedding_dim FROM embedding_configure WHERE id = ?",
        (embedding_config_id,),
    )
    row = cur.fetchone()
    stored_dim: Optional[int] = None
    if row is not None:
        raw = row["embedding_dim"] if hasattr(row, "keys") else row[0]
        if raw is not None:
            stored_dim = int(raw)

    exists = _table_exists(conn, tbl)

    def _drop_vec_table(reason: str) -> None:
        nonlocal exists
        logger.warning("%s — dropping %s", reason, tbl)
        conn.execute(f'DROP TABLE IF EXISTS "{tbl}"')
        conn.commit()
        exists = False

    if exists and stored_dim is not None and stored_dim != dim:
        _drop_vec_table(
            f"Embedding dimension changed for {embedding_config_id} ({stored_dim} -> {dim})"
        )

    if exists:
        cur.execute(
            "SELECT sql FROM sqlite_master WHERE type IN ('table','virtual') AND name = ?",
            (tbl,),
        )
        sql_row = cur.fetchone()
        create_sql = sql_row[0] if sql_row and sql_row[0] else ""
        if not re.search(r"distance_metric\s*=\s*cosine", create_sql, re.IGNORECASE):
            _drop_vec_table(f"Vector table {tbl} is not cosine (migrate from L2 or older schema)")

    if not exists:
        conn.execute(
            f'CREATE VIRTUAL TABLE "{tbl}" USING vec0(\n'
            f"  chunk_pk integer primary key,\n"
            f"  chunk_run_id integer,\n"
            f"  embedding float[{int(dim)}] distance_metric=cosine\n"
            f")"
        )
        conn.commit()
        logger.info("Created vector table %s dim=%s (cosine)", tbl, dim)

    cur.execute(
        "UPDATE embedding_configure SET embedding_dim = ? WHERE id = ?",
        (dim, embedding_config_id),
    )
    conn.commit()
    return tbl


def upsert_vectors(
    conn: sqlite3.Connection,
    embedding_config_id: str,
    dim: int,
    rows: Sequence[Tuple[int, int, Sequence[float] | np.ndarray]],
) -> None:
    """
    rows: (chunk_pk, chunk_run_id, embedding vector)
    """
    tbl = ensure_vec_table(conn, embedding_config_id, dim)
    for chunk_pk, chunk_run_id, emb in rows:
        conn.execute(f'DELETE FROM "{tbl}" WHERE chunk_pk = ?', (chunk_pk,))
        conn.execute(
            f'INSERT INTO "{tbl}" (chunk_pk, chunk_run_id, embedding) VALUES (?, ?, ?)',
            (chunk_pk, chunk_run_id, serialize_embedding(emb)),
        )
    conn.commit()


def delete_vectors_for_chunk_pks(
    conn: sqlite3.Connection,
    chunk_pks: Sequence[int],
) -> None:
    if not chunk_pks:
        return
    cur = conn.execute("SELECT id FROM embedding_configure")
    ids = [r[0] for r in cur.fetchall()]
    placeholders = ",".join("?" * len(chunk_pks))
    for cfg_id in ids:
        tbl = vec_table_name(str(cfg_id))
        if not _table_exists(conn, tbl):
            continue
        conn.execute(
            f'DELETE FROM "{tbl}" WHERE chunk_pk IN ({placeholders})',
            tuple(chunk_pks),
        )
    conn.commit()


def knn_search(
    conn: sqlite3.Connection,
    embedding_config_id: str,
    query_embedding: Sequence[float] | np.ndarray,
    chunk_run_id: int,
    k: int,
) -> List[Tuple[int, float]]:
    """Return (chunk_pk, distance) sorted by distance ascending (vec0 cosine distance)."""
    tbl = vec_table_name(embedding_config_id)
    if not _table_exists(conn, tbl):
        return []
    q = serialize_embedding(query_embedding)
    cur = conn.execute(
        f"""
        SELECT chunk_pk, distance
        FROM "{tbl}"
        WHERE embedding MATCH ?
          AND k = ?
          AND chunk_run_id = ?
        """,
        (q, int(k), int(chunk_run_id)),
    )
    return [(int(r[0]), float(r[1])) for r in cur.fetchall()]


def count_vectors_for_run(
    conn: sqlite3.Connection,
    embedding_config_id: str,
    chunk_run_id: int,
) -> int:
    tbl = vec_table_name(embedding_config_id)
    if not _table_exists(conn, tbl):
        return 0
    cur = conn.execute(
        f'SELECT COUNT(*) FROM "{tbl}" WHERE chunk_run_id = ?',
        (chunk_run_id,),
    )
    row = cur.fetchone()
    return int(row[0]) if row else 0


def fetch_embeddings_for_chunk_run(
    conn: sqlite3.Connection,
    embedding_config_id: str,
    chunk_run_id: int,
) -> Tuple[np.ndarray, List[int]]:
    """
    Rows ordered by chunk_pk ascending. Returns (matrix n x dim, chunk_pk list).
    """
    tbl = vec_table_name(embedding_config_id)
    if not _table_exists(conn, tbl):
        return np.zeros((0, 0), dtype=np.float32), []
    cur = conn.execute(
        f"""
        SELECT chunk_pk, embedding
        FROM "{tbl}"
        WHERE chunk_run_id = ?
        ORDER BY chunk_pk ASC
        """,
        (chunk_run_id,),
    )
    rows = cur.fetchall()
    if not rows:
        return np.zeros((0, 0), dtype=np.float32), []
    dim = len(np.frombuffer(rows[0][1], dtype=np.float32))
    mat = np.empty((len(rows), dim), dtype=np.float32)
    pks: List[int] = []
    for i, r in enumerate(rows):
        pks.append(int(r[0]))
        mat[i] = np.frombuffer(r[1], dtype=np.float32)
    return mat, pks


def _cosine_distance_row(mat: np.ndarray, q: np.ndarray) -> np.ndarray:
    """Cosine distance 1 - cos_sim per row; aligned with sqlite-vec vec0 cosine metric."""
    q = np.asarray(q, dtype=np.float32).reshape(-1)
    eps = np.float32(1e-12)
    qn = np.linalg.norm(q) + eps
    mn = np.linalg.norm(mat, axis=1) + eps
    cos_sim = (mat @ q) / (mn * qn)
    cos_sim = np.clip(cos_sim, -1.0, 1.0)
    return (1.0 - cos_sim).astype(np.float64)


def query_to_chunk_distances(
    conn: sqlite3.Connection,
    embedding_config_id: str,
    query_embedding: Sequence[float] | np.ndarray,
    chunk_run_id: int,
) -> List[Tuple[int, float]]:
    """
    Cosine distance from query to each stored vector, order by chunk_pk (stable vs chunks table).
    """
    mat, pks = fetch_embeddings_for_chunk_run(conn, embedding_config_id, chunk_run_id)
    if mat.size == 0:
        return []
    q = np.asarray(query_embedding, dtype=np.float32).reshape(-1)
    dists = _cosine_distance_row(mat, q)
    return [(pks[i], float(dists[i])) for i in range(len(pks))]
