import json
from typing import Any, Dict, List

from fastapi import HTTPException


def build_knowledgebase_graph(*, memory_manager, kb_id: int) -> Dict[str, Any]:
    """
    Build a graph view of document->parser, parser->chunker, and chunker->embedding.

    This is backend business logic; the FastAPI route should call this.
    """
    try:
        cur = memory_manager.conn.cursor()

        # ---- Parse edges: file -> parser (one edge per parsed row) ----
        cur.execute(
            """
            SELECT
                p.parse_id,
                p.file_id,
                f.filename,
                f.filepath,
                p.parse_run_id,
                p.parser,
                p.parameters,
                p.time_usage,
                p.time,
                p.is_active
            FROM parsed p
            JOIN files f ON f.file_id = p.file_id
            WHERE f.knowledgebase_id = ?
              AND f.type = 'file'
            ORDER BY p.time DESC, p.parse_id DESC
            """,
            (kb_id,),
        )
        parse_rows = cur.fetchall()

        # ---- Chunk edges: parser -> chunker (derive from chunks + chunk_run) ----
        cur.execute(
            """
            SELECT
                p.parse_id,
                c.file_id,
                f.filename,
                f.filepath,
                c.parse_run_id,
                p.parser,
                p.parameters AS parser_parameters,
                p.time_usage AS parse_time_usage,
                p.time AS parse_time,
                p.is_active AS parse_is_active,
                c.chunk_run_id,
                cr.framework,
                cr.parameters AS chunk_parameters,
                cr.is_active AS chunk_run_is_active,
                cr.in_sync AS chunk_run_in_sync,
                cr.run_time,
                COUNT(*) AS chunks_count
            FROM chunks c
            JOIN files f ON f.file_id = c.file_id
            JOIN parsed p
              ON p.file_id = c.file_id
             AND p.parse_run_id = c.parse_run_id
            JOIN chunk_run cr ON cr.id = c.chunk_run_id
            WHERE f.knowledgebase_id = ?
              AND f.type = 'file'
            GROUP BY
                p.parse_id,
                c.file_id,
                f.filename,
                f.filepath,
                c.parse_run_id,
                p.parser,
                p.parameters,
                p.time_usage,
                p.time,
                p.is_active,
                c.chunk_run_id,
                cr.framework,
                cr.parameters,
                cr.is_active,
                cr.in_sync,
                cr.run_time
            ORDER BY cr.run_time DESC, c.chunk_run_id DESC
            """,
            (kb_id,),
        )
        chunk_groups = cur.fetchall()

        nodes_by_id: Dict[str, Dict[str, Any]] = {}
        edges: List[Dict[str, Any]] = []

        def upsert_node(node_id: str, node_type: str, label: str, extra: Dict[str, Any] | None = None) -> None:
            if node_id in nodes_by_id:
                return
            node = {"id": node_id, "type": node_type, "label": label}
            if extra:
                node.update(extra)
            nodes_by_id[node_id] = node

        def loads_maybe_json(value: Any) -> Any:
            if value is None:
                return {}
            if isinstance(value, (dict, list)):
                return value
            if isinstance(value, (bytes, bytearray)):
                try:
                    value = value.decode("utf-8")
                except Exception:
                    return {}
            if isinstance(value, str):
                s = value.strip()
                if s == "":
                    return {}
                try:
                    return json.loads(s)
                except Exception:
                    return {"_raw": value}
            return {"_raw": value}

        # Parse edges (document -> parser)
        for r in parse_rows:
            parse_id = int(r[0])
            file_id = int(r[1])
            filename = r[2]
            filepath = r[3]
            parse_run_id = int(r[4])
            parser = r[5] or "unknown"
            parameters = loads_maybe_json(r[6])
            time_usage = r[7]
            time_value = r[8]
            is_active = bool(r[9])

            doc_node_id = f"doc:{file_id}"
            parser_node_id = f"parser:{parser}"

            upsert_node(doc_node_id, "document", filename, {"file_id": file_id, "filepath": filepath})
            upsert_node(parser_node_id, "parser", parser)

            edges.append(
                {
                    "id": f"parse:{parse_id}",
                    "type": "parse",
                    "source": doc_node_id,
                    "target": parser_node_id,
                    "attributes": {
                        "parse_id": parse_id,
                        "file_id": file_id,
                        "filename": filename,
                        "filepath": filepath,
                        "parse_run_id": parse_run_id,
                        "parser": parser,
                        "parameters": parameters,
                        "time_usage": time_usage,
                        "time": time_value,
                        "is_active": is_active,
                    },
                }
            )

        # Chunk edges: one parser→chunker edge per chunk_run_id (i.e. each chunking run draws its own line).
        #
        # NOTE: We intentionally do NOT collapse multiple runs into a single edge; otherwise the UI will
        # always show only one parser→chunker link and lose run-by-run visibility.
        for r in chunk_groups:
            parse_id = int(r[0])
            file_id = int(r[1])
            filename = r[2]
            filepath = r[3]
            parse_run_id = int(r[4])
            parser = r[5] or "unknown"
            parser_parameters = loads_maybe_json(r[6])
            parse_time_usage = r[7]
            parse_time = r[8]
            parse_is_active = bool(r[9])
            chunk_run_id = int(r[10])
            framework = r[11] or "unknown"
            chunk_parameters = loads_maybe_json(r[12])
            chunk_run_is_active = bool(r[13])
            chunk_run_in_sync = bool(r[14])
            run_time = r[15]
            chunks_count = int(r[16]) if r[16] is not None else None

            parser_node_id = f"parser:{parser}"
            upsert_node(parser_node_id, "parser", parser)

            chunker_node_id = "chunker:langchain" if framework == "langchain" else f"chunker:{framework}"
            upsert_node(
                chunker_node_id,
                "chunker",
                "langchain" if framework == "langchain" else framework,
                {"framework": framework},
            )

            # Keep edge ids unique across runs so frontend graph libs never collapse/dedupe them.
            chunk_edge_id = f"chunk:{file_id}:{parse_run_id}:{chunk_run_id}"
            edges.append(
                {
                    "id": chunk_edge_id,
                    "type": "chunk",
                    "source": parser_node_id,
                    "target": chunker_node_id,
                    "attributes": {
                        "parse_id": parse_id,
                        "file_id": file_id,
                        "filename": filename,
                        "filepath": filepath,
                        "parse_run_id": parse_run_id,
                        "parser": parser,
                        "parser_parameters": parser_parameters,
                        "parse_time_usage": parse_time_usage,
                        "parse_time": parse_time,
                        "parse_is_active": parse_is_active,
                        "chunk_run_id": chunk_run_id,
                        "framework": framework,
                        "chunk_run_is_active": chunk_run_is_active,
                        "chunk_run_in_sync": chunk_run_in_sync,
                        "run_parameters": chunk_parameters,
                        "run_time": run_time,
                        "chunks_count": chunks_count,
                        # Backwards-compatible field: when multiple runs were collapsed, this listed all runs.
                        # Now each edge represents exactly one run.
                        "file_parse_links": [
                            {
                                "chunk_run_id": chunk_run_id,
                                "run_time": run_time,
                                "chunks_count": chunks_count or 0,
                                "chunk_run_is_active": chunk_run_is_active,
                                "chunk_run_in_sync": chunk_run_in_sync,
                            }
                        ],
                    },
                }
            )

        # ---- Embed edges: chunker -> embedding (from index runs for this KB) ----
        def chunker_node_ids_for_run(framework: str, chunk_parameters: dict) -> List[str]:
            fw = framework or "unknown"
            if fw == "langchain":
                return ["chunker:langchain"]
            return [f"chunker:{fw}"]

        def ensure_chunker_node(chunker_node_id: str, framework: str) -> None:
            if chunker_node_id in nodes_by_id:
                return
            if chunker_node_id == "chunker:langchain":
                upsert_node(chunker_node_id, "chunker", "langchain", {"framework": "langchain"})
                return
            fw = chunker_node_id.replace("chunker:", "", 1) if chunker_node_id.startswith("chunker:") else framework
            upsert_node(chunker_node_id, "chunker", fw or framework, {"framework": fw or framework})

        try:
            index_runs = memory_manager.index_manager.get_index_runs_by_knowledgebase_id(kb_id)
        except Exception:
            index_runs = []

        for ir in index_runs:
            idx_id = ir.get("id")
            chunk_run_id = ir.get("chunk_run_id")
            emb_config_id = ir.get("embedding_configure_id")
            run_time = ir.get("run_time")
            if idx_id is None or chunk_run_id is None or not emb_config_id:
                continue

            emb_key = str(emb_config_id)

            cr_conf = memory_manager.chunking_manager.get_chunk_run_config(int(chunk_run_id))
            if not cr_conf or int(cr_conf.get("knowledgebase_id") or -1) != int(kb_id):
                continue

            framework = cr_conf.get("framework") or "unknown"
            chunk_params = cr_conf.get("parameters") or {}
            if isinstance(chunk_params, str):
                chunk_params = loads_maybe_json(chunk_params)
            cr_is_active = bool(cr_conf.get("is_active"))
            cr_in_sync = bool(cr_conf.get("in_sync"))

            emb = memory_manager.embedding_manager.get_embedding_configuration(emb_key)
            if not emb:
                continue
            cur.execute("SELECT is_active FROM embedding_configure WHERE id = ?", (emb_key,))
            emb_row = cur.fetchone()
            emb_is_active = bool(emb_row[0]) if emb_row else False

            prov = emb.get("embedding_provider") or "?"
            model = emb.get("embedding_model") or "?"
            emb_label = f"{prov}/{model}"
            emb_node_id = f"embedding:{emb_key}"
            upsert_node(
                emb_node_id,
                "embedding",
                emb_label,
                {
                    "embedding_config_id": emb_key,
                    "embedding_provider": emb.get("embedding_provider"),
                    "embedding_model": emb.get("embedding_model"),
                },
            )

            for tgt in chunker_node_ids_for_run(framework, chunk_params):
                ensure_chunker_node(tgt, framework)
                edges.append(
                    {
                        "id": f"embed:{idx_id}:{tgt}",
                        "type": "embed",
                        "source": tgt,
                        "target": emb_node_id,
                        "attributes": {
                            "index_run_id": idx_id,
                            "chunk_run_id": int(chunk_run_id),
                            "embedding_configure_id": emb_key,
                            "run_time": run_time,
                            "chunk_run_is_active": cr_is_active,
                            "chunk_run_in_sync": cr_in_sync,
                            "embedding_is_active": emb_is_active,
                        },
                    }
                )

        return {
            "success": True,
            "graph": {
                "nodes": list(nodes_by_id.values()),
                "edges": edges,
            },
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

