"""
SQLite FTS5 full-text index on chunk bodies, using bm25() for lexical ranking.

FTS5 bm25() returns a value where smaller means more relevant; we expose
scores as -bm25() so higher is better (aligned with prior rank_bm25 usage).
"""
from __future__ import annotations

import re
import sqlite3
from typing import Any, List, Optional, Sequence, Tuple

import numpy as np

from src.memory.vector_store import _table_exists
from src.utils.logging_config import get_logger

logger = get_logger(__name__)

CHUNKS_FTS_TABLE = "chunks_fts"

# Whitespace / fullwidth space / common punctuation between “words”
_QUERY_SPLIT_RE = re.compile(r"[\s\u3000，。；;、,.．·]+")

# Pull ASCII-ish words and contiguous CJK runs out of one segment (e.g. SQLite数据库)
_TOKEN_EXTRACT_RE = re.compile(r"[a-zA-Z0-9][a-zA-Z0-9_.-]*|[\u4e00-\u9fff]+")

# FTS5 MATCH: cap OR branches to avoid huge expressions
_MAX_MATCH_TERMS = 64

# High-frequency English function words in OR queries add little signal; dropping them
# (ASCII letter tokens only) keeps similar phrasings equivalent. If the filter removes
# every token, we keep the original list so e.g. a lone "the" still searches.
_ENGLISH_STOPWORDS = frozenset(
    {
        "a",
        "an",
        "the",
        "is",
        "are",
        "was",
        "were",
        "be",
        "been",
        "being",
        "which",
        "what",
        "who",
        "whom",
        "whose",
        "this",
        "that",
        "these",
        "those",
        "i",
        "you",
        "he",
        "she",
        "it",
        "we",
        "they",
        "to",
        "of",
        "in",
        "for",
        "on",
        "with",
        "as",
        "at",
        "by",
        "from",
        "into",
        "or",
        "and",
        "not",
        "but",
        "if",
        "so",
        "than",
        "then",
        "there",
        "here",
        "can",
        "could",
        "may",
        "might",
        "must",
        "shall",
        "should",
        "will",
        "would",
        "do",
        "does",
        "did",
        "have",
        "has",
        "had",
        "having",
    }
)


def _is_ascii_alpha_token(t: str) -> bool:
    return bool(t) and t.isascii() and t.replace("-", "").isalpha()


def _is_all_cjk(s: str) -> bool:
    return bool(s) and all("\u4e00" <= c <= "\u9fff" for c in s)


def _query_terms_for_fts(query: str) -> List[str]:
    """
    Split user input into OR operands for FTS5.

    - Terms separated by spaces / ideographic space / common punctuation become separate
      OR branches (any hit matches).
    - Glued Latin+CJK (e.g. SQLite数据库) is split into SQLite and 数据库.
    - Long all-CJK runs (length >= 3) become OR of single characters so adding characters
      does not tighten the query into one long phrase that fails to match spaced text.
    - 1–2 character CJK blocks stay one phrase (e.g. 北京).
    - Common English function words are dropped for OR (ASCII letters only); if that removes
      everything, the pre-filter list is kept so queries like "the" still run.
    """
    q = query.strip()
    if not q:
        return []
    out: List[str] = []
    for seg in _QUERY_SPLIT_RE.split(q):
        if not seg:
            continue
        subs = _TOKEN_EXTRACT_RE.findall(seg)
        if not subs:
            out.append(seg)
            continue
        for s in subs:
            if _is_all_cjk(s) and len(s) >= 3:
                out.extend(list(s))
            else:
                out.append(s)
    seen: set[str] = set()
    uniq: List[str] = []
    for t in out:
        if len(t) > 128:
            t = t[:128]
        if t and t not in seen:
            seen.add(t)
            uniq.append(t)
        if len(uniq) >= _MAX_MATCH_TERMS:
            break
    filtered = [
        t
        for t in uniq
        if not (_is_ascii_alpha_token(t) and t.lower() in _ENGLISH_STOPWORDS)
    ]
    return filtered if filtered else uniq


def fts5_match_expression(query: str) -> Optional[str]:
    """Build an FTS5 MATCH string: OR of quoted tokens (phrase-safe per operand)."""
    terms = _query_terms_for_fts(query)
    if not terms:
        return None
    parts: List[str] = []
    for t in terms:
        escaped = t.replace('"', '""')
        parts.append(f'"{escaped}"')
    return " OR ".join(parts)


def ensure_chunks_fts(conn: sqlite3.Connection) -> None:
    """Create chunks_fts (external content on chunks.content) and sync triggers."""
    if _table_exists(conn, CHUNKS_FTS_TABLE):
        _ensure_fts_inverted_index_populated(conn)
        return

    conn.execute(
        f"""
        CREATE VIRTUAL TABLE IF NOT EXISTS {CHUNKS_FTS_TABLE} USING fts5(
            content,
            content='chunks',
            content_rowid='id'
        )
        """
    )
    conn.execute(
        f"""
        CREATE TRIGGER IF NOT EXISTS chunks_fts_ai AFTER INSERT ON chunks BEGIN
            INSERT INTO {CHUNKS_FTS_TABLE}(rowid, content)
            VALUES (new.id, new.content);
        END
        """
    )
    conn.execute(
        f"""
        CREATE TRIGGER IF NOT EXISTS chunks_fts_ad AFTER DELETE ON chunks BEGIN
            INSERT INTO {CHUNKS_FTS_TABLE}({CHUNKS_FTS_TABLE}, rowid)
            VALUES ('delete', old.id);
        END
        """
    )
    conn.execute(
        f"""
        CREATE TRIGGER IF NOT EXISTS chunks_fts_au AFTER UPDATE ON chunks BEGIN
            INSERT INTO {CHUNKS_FTS_TABLE}({CHUNKS_FTS_TABLE}, rowid)
            VALUES ('delete', old.id);
            INSERT INTO {CHUNKS_FTS_TABLE}(rowid, content)
            VALUES (new.id, new.content);
        END
        """
    )
    conn.commit()
    _rebuild_chunks_fts_index(conn)


def _rebuild_chunks_fts_index(conn: sqlite3.Connection) -> None:
    """Populate or refresh the FTS inverted index from the external chunks table."""
    n = int(conn.execute("SELECT COUNT(*) FROM chunks").fetchone()[0])
    if n == 0:
        return
    conn.execute(
        f"INSERT INTO {CHUNKS_FTS_TABLE}({CHUNKS_FTS_TABLE}) VALUES('rebuild')"
    )
    conn.commit()
    logger.info("Rebuilt FTS index %s from chunks (%s rows)", CHUNKS_FTS_TABLE, n)


def _ensure_fts_inverted_index_populated(conn: sqlite3.Connection) -> None:
    """
    External-content FTS5: COUNT on the virtual table follows `chunks`, not the
    inverted index. If the index was never built, MATCH returns nothing — rebuild.
    """
    n = int(conn.execute("SELECT COUNT(*) FROM chunks").fetchone()[0])
    if n == 0:
        return
    row = conn.execute(
        """
        SELECT content FROM chunks
        WHERE content IS NOT NULL AND length(trim(content)) > 0
        ORDER BY id LIMIT 1
        """
    ).fetchone()
    if not row:
        return
    text = row[0] or ""
    token_m = re.search(r"[\w\u0080-\uFFFF]{2,}", text)
    if not token_m:
        _rebuild_chunks_fts_index(conn)
        return
    token = token_m.group(0)
    match_expr = '"' + token.replace('"', '""') + '"'
    try:
        hit = conn.execute(
            f"""
            SELECT 1 FROM {CHUNKS_FTS_TABLE}
            WHERE {CHUNKS_FTS_TABLE} MATCH ?
            LIMIT 1
            """,
            (match_expr,),
        ).fetchone()
    except sqlite3.Error:
        hit = None
    if hit is None:
        logger.warning(
            "FTS index %s had no MATCH hits for corpus probe; rebuilding from chunks",
            CHUNKS_FTS_TABLE,
        )
        _rebuild_chunks_fts_index(conn)


def _bm25_sql() -> str:
    # fts5 bm25(table_name) — smaller is more relevant
    return f'bm25("{CHUNKS_FTS_TABLE}")'


def _relevance_from_bm25_value(raw: Any) -> Optional[float]:
    """Map bm25 column to higher-is-better score. None if SQLite returned NULL."""
    if raw is None:
        return None
    return float(-float(raw))


def bm25_top_k_for_run(
    conn: sqlite3.Connection,
    chunk_run_id: int,
    query: str,
    k: int,
) -> List[Tuple[int, float]]:
    """
    Top-k chunks by FTS5 BM25 for this chunk_run_id.
    Returns (chunk_pk, score) with higher score = more relevant.
    """
    if not _table_exists(conn, CHUNKS_FTS_TABLE):
        logger.warning("FTS table %s is missing; BM25 search skipped", CHUNKS_FTS_TABLE)
        return []
    match_expr = fts5_match_expression(query)
    if match_expr is None or k <= 0:
        return []
    bsql = _bm25_sql()
    # Over-fetch before Python-side filtering; cap avoids accidental megabyte scans.
    fetch_cap = min(max(k * 32, k + 64), 20000)
    try:
        cur = conn.execute(
            f"""
            SELECT c.id, {bsql} AS b
            FROM {CHUNKS_FTS_TABLE}
            JOIN chunks c ON c.id = {CHUNKS_FTS_TABLE}.rowid
            WHERE {CHUNKS_FTS_TABLE} MATCH ?
              AND c.chunk_run_id = ?
            ORDER BY (b IS NULL) ASC, b ASC
            LIMIT ?
            """,
            (match_expr, int(chunk_run_id), int(fetch_cap)),
        )
        rows = cur.fetchall()
        out: List[Tuple[int, float]] = []
        null_bm25: List[int] = []
        for r in rows:
            pk = int(r[0])
            score = _relevance_from_bm25_value(r[1])
            if score is None:
                null_bm25.append(pk)
                continue
            out.append((pk, score))
            if len(out) >= k:
                return out
        # Matched rows but bm25() was NULL for all (can happen with external-content FTS);
        # still return hits so small corpora do not get empty results.
        for pk in null_bm25:
            if len(out) >= k:
                break
            out.append((pk, 0.0))
        return out[:k]
    except sqlite3.OperationalError as e:
        logger.warning(
            "FTS5 MATCH/BM25 failed for chunk_run_id=%s query=%r: %s",
            chunk_run_id,
            query[:200] if query else "",
            e,
        )
        return []


def bm25_scores_for_ordered_pks(
    conn: sqlite3.Connection,
    chunk_run_id: int,
    query: str,
    ordered_chunk_pks: Sequence[int],
) -> np.ndarray:
    """
    Dense BM25-derived scores aligned with ordered_chunk_pks (non-matches = 0.0).
    Higher is better.
    """
    n = len(ordered_chunk_pks)
    out = np.zeros(n, dtype=float)
    if n == 0:
        return out
    match_expr = fts5_match_expression(query)
    if match_expr is None:
        return out
    if not _table_exists(conn, CHUNKS_FTS_TABLE):
        logger.warning("FTS table %s is missing; BM25 scores skipped", CHUNKS_FTS_TABLE)
        return out
    pk_to_i = {int(pk): i for i, pk in enumerate(ordered_chunk_pks)}
    bsql = _bm25_sql()
    try:
        cur = conn.execute(
            f"""
            SELECT c.id, {bsql} AS b
            FROM {CHUNKS_FTS_TABLE}
            JOIN chunks c ON c.id = {CHUNKS_FTS_TABLE}.rowid
            WHERE {CHUNKS_FTS_TABLE} MATCH ?
              AND c.chunk_run_id = ?
            ORDER BY (b IS NULL) ASC, b ASC
            """,
            (match_expr, int(chunk_run_id)),
        )
        for r in cur.fetchall():
            score = _relevance_from_bm25_value(r[1])
            if score is None:
                score = 0.0
            pk = int(r[0])
            idx = pk_to_i.get(pk)
            if idx is not None:
                out[idx] = score
    except sqlite3.OperationalError as e:
        logger.warning(
            "FTS5 MATCH/BM25 failed for chunk_run_id=%s query=%r: %s",
            chunk_run_id,
            query[:200] if query else "",
            e,
        )
    return out
