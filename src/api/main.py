import os
import shutil
import json
from datetime import datetime, timedelta, timezone

from typing import List, Optional, Dict, Any

from fastapi import FastAPI, File, UploadFile, Form, HTTPException, Body, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from contextlib import asynccontextmanager

from src.file_process.indexer import Indexer
from src.utils.paths import get_index_path, get_upload_dir
from src.file_process.parallel_pipeline import ParallelFileProcessingPipeline
from src.memory.memory import MemoryManager
from src.retriever.retrievers import BaseRetriever
from src.utils.logging_config import get_logger

logger = get_logger(__name__)

# Default user ID (since we don't have authentication)
DEFAULT_USER_ID = 1

# Pydantic model for configuration update
class ConfigUpdate(BaseModel):
    id: str
    embedding_provider: str
    embedding_model: str
    embedding_api_key: Optional[str] = None 
    embedding_base_url: Optional[str] = None

# Initialize MemoryManager
memory_manager = MemoryManager()

indexers = {}

def get_indexer(knowledge_base: str, chunk_run_id: int = None, embedding_config_id: str = None) -> Indexer:
    """Get or create an Indexer for the given knowledge base."""
    if embedding_config_id is None:
        # Get active config if none specified
        active_config = memory_manager.embedding_manager.get_active_embedding_configuration()
        if active_config:
            embedding_config_id = active_config['id']
        else:
            raise HTTPException(status_code=400, detail="No active embedding configuration found")
    if chunk_run_id is None:
        active_chunk_run = memory_manager.chunking_manager.get_active_chunk_run_config(knowledge_base)
        if active_chunk_run:
            chunk_run_id = active_chunk_run['id']
        else:
            return None

    indexer_key = f"{knowledge_base}_{chunk_run_id}_{embedding_config_id}"
    if indexer_key not in indexers:
        indexers[indexer_key] = Indexer(embedding_config_id, get_index_path(knowledge_base, chunk_run_id, embedding_config_id))
    return indexers[indexer_key]

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Clean up resources when the application shuts down."""
    import logging
    logger = logging.getLogger(__name__)
    yield
    logger.info("Shutting down MemoryManager...")
    if hasattr(memory_manager, 'conn'):
        try:
            memory_manager.conn.close()
            logger.info("Database connection closed successfully")
        except Exception as e:
            logger.error(f"Error closing database connection: {e}")

app = FastAPI(title="RAG_V API", version="1.0.0", lifespan=lifespan)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, replace with specific origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Add security headers middleware
@app.middleware("http")
async def add_security_headers(request, call_next):
    response = await call_next(request)
    # Security headers to prevent various attacks and improve Chrome security
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Content-Security-Policy"] = "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'"
    return response


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Clean up resources when the application shuts down."""
    yield
    logger.info("Shutting down MemoryManager...")
    if hasattr(memory_manager, 'conn'):
        try:
            memory_manager.conn.close()
            logger.info("Database connection closed successfully")
        except Exception as e:
            logger.error(f"Error closing database connection: {e}")

# API endpoint for updating configuration
@app.patch("/api/embedding_config")
async def update_embedding_configuration(config_data: ConfigUpdate):
    """Update embedding configuration settings."""
    try:
        updated_config = memory_manager.embedding_manager.update_embedding_configuration(
            id=config_data.id,
            embedding_base_url=config_data.embedding_base_url,
            embedding_provider=config_data.embedding_provider,
            embedding_api_key=config_data.embedding_api_key,
            embedding_model=config_data.embedding_model,                      
        )       
        
        return {
            "success": True,
            "message": "Embedding configuration updated successfully",
            "config": updated_config
        }
    except Exception as e:
        logger.error(f"Error updating embedding configuration: {e}")    
        raise HTTPException(status_code=400, detail=str(e))

# API endpoint for getting configuration
@app.get("/api/embedding_config")
async def get_embedding_configuration():
    """Get embedding configuration settings."""
    try:
        # Get all embedding configurations
        all_configs = memory_manager.embedding_manager.get_all_embedding_configurations()
        # Find the active config from the list using the is_active flag
        active_config = next((config for config in all_configs if config['is_active'] == 1), None)
        
        return {
            "success": True,
            "configs": all_configs,
            "active_config": active_config
        }
    except Exception as e:
        logger.error(f"Error getting embedding configuration: {e}")
        raise HTTPException(status_code=400, detail=str(e))

# API endpoint to set active embedding configuration
@app.patch("/api/embedding_config/{config_id:path}/active")
async def set_active_embedding_configuration(config_id: str):
    """Set an embedding configuration as active, deactivating all others."""
    try:
        updated_config = memory_manager.embedding_manager.set_active_embedding_configuration(config_id)
        return {
            "success": True,
            "message": "Embedding configuration set as active successfully",
            "config": updated_config
        }
    except Exception as e:
        logger.error(f"Error setting active embedding configuration: {e}")
        raise HTTPException(status_code=400, detail=str(e))

# API endpoint for deleting an embedding configuration
@app.delete("/api/embedding_config/{config_id:path}")
async def delete_embedding_configuration(config_id: str):
    """Delete an embedding configuration by ID."""
    try:
        success = memory_manager.embedding_manager.delete_embedding_configuration(config_id)
        if success:
            return {
                "success": True,
                "message": "Embedding configuration deleted successfully"
            }
        return {
            "success": False,
            "message": "Embedding configuration not found"
        }
    except Exception as e:
        logger.error(f"Error deleting embedding configuration: {e}")
        raise HTTPException(status_code=400, detail=str(e))

# API endpoint to get all retriever names
@app.get("/api/retrievers")
async def get_retrievers():
    """Get all available retriever names."""
    try:
        retriever_names = BaseRetriever.get_retriever_names()
        return {
            "success": True,
            "retrievers": retriever_names
        }
    except Exception as e:
        logger.error(f"Error getting retrievers: {e}")
        raise HTTPException(status_code=400, detail=str(e))

# API endpoint for creating a knowledge base
@app.post("/api/knowledgebase")
async def create_knowledgebase(
    name: str = Body(..., description="Knowledge base name"),
    description: Optional[str] = Body(None, description="Knowledge base description"),
):
    """Create a new knowledge base."""
    try:
        root_path = get_upload_dir(DEFAULT_USER_ID, name, "")
        knowledgebase_id = memory_manager.knowledgebase_manager.create_knowledgebase(name, root_path, description)
        return {
            "success": True,
            "knowledgebase_id": knowledgebase_id,
            "message": "Knowledge base created successfully"
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

# API endpoint to list all knowledgebases
@app.get("/api/knowledgebase")
async def list_knowledgebases():
    """List all knowledgebases."""
    try:
        knowledgebases = memory_manager.knowledgebase_manager.get_all_knowledgebases()
        return {
            "success": True,
            "knowledgebases": knowledgebases
        }
    except Exception as e:
        logger.error(f"Error listing knowledgebases: {e}")
        raise HTTPException(status_code=400, detail=str(e))

# API endpoint to get parse duration table for all parsed files in a knowledgebase
@app.get("/api/knowledgebase/{kb_id}/parse-duration")
async def get_parse_duration_table(kb_id: int):
    """Get parse duration for all parsed files in the knowledgebase."""
    try:
        rows = memory_manager.parser_manager.get_parse_duration_by_knowledgebase(kb_id)
        return {
            "success": True,
            "parse_duration": rows
        }
    except Exception as e:
        logger.error(f"Error getting parse duration table: {e}")
        raise HTTPException(status_code=400, detail=str(e))


# API endpoint to get parsing/chunking graph for a knowledgebase
@app.get("/api/knowledgebase/{kb_id}/graph")
async def get_knowledgebase_graph(kb_id: int):
    """Get a graph view of document->parser, parser->chunker, and chunker->embedding.

    Nodes:
      - documents: each file (type='file')
      - parsers: each parser name observed in parse runs
      - chunkers: each chunker observed in chunk runs (may be framework-level for some splitters)
      - embeddings: each embedding config used by an index run for this knowledgebase

    Edges (multi-edges allowed):
      - parse edges: document -> parser, with parse parameters + time_usage + timestamps
      - chunk edges: parser -> chunker, with chunk parameters + run_time (+ chunks_count)
      - embed edges: chunker -> embedding (from index_run: chunk_run + embedding config)
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

        # ---- Build nodes & edges ----
        nodes_by_id = {}

        def upsert_node(node_id: str, node_type: str, label: str, extra: Dict[str, Any] | None = None):
            if node_id in nodes_by_id:
                return
            node = {"id": node_id, "type": node_type, "label": label}
            if extra:
                node.update(extra)
            nodes_by_id[node_id] = node

        edges = []

        # Helper to safely load JSON fields stored as TEXT
        def _loads_maybe_json(value: Any) -> Any:
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
            parameters = _loads_maybe_json(r[6])
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

        # Chunk edges (parser -> chunker), expanded by chunkers pipeline if present
        for r in chunk_groups:
            parse_id = int(r[0])
            file_id = int(r[1])
            filename = r[2]
            filepath = r[3]
            parse_run_id = int(r[4])
            parser = r[5] or "unknown"
            parser_parameters = _loads_maybe_json(r[6])
            parse_time_usage = r[7]
            parse_time = r[8]
            parse_is_active = bool(r[9])
            chunk_run_id = int(r[10])
            framework = r[11] or "unknown"
            chunk_parameters = _loads_maybe_json(r[12])
            chunk_run_is_active = bool(r[13])
            chunk_run_in_sync = bool(r[14])
            run_time = r[15]
            chunks_count = int(r[16]) if r[16] is not None else None

            parser_node_id = f"parser:{parser}"
            upsert_node(parser_node_id, "parser", parser)

            chunkers = chunk_parameters.get("chunkers")
            # Special rule: langchain should be a single node (do not expand inner chunkers)
            if framework == "langchain":
                chunker_node_id = "chunker:langchain"
                upsert_node(chunker_node_id, "chunker", "langchain", {"framework": "langchain"})

                edges.append(
                    {
                        "id": f"chunk:{chunk_run_id}:{file_id}:{parse_run_id}:langchain",
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
                        },
                    }
                )
            elif isinstance(chunkers, list) and len(chunkers) > 0:
                for idx, ch in enumerate(chunkers):
                    chunker_name = (ch or {}).get("chunker") or "unknown"
                    chunker_params = (ch or {}).get("params") or {}
                    chunker_node_id = f"chunker:{framework}:{chunker_name}"
                    upsert_node(chunker_node_id, "chunker", f"{framework}/{chunker_name}", {"framework": framework, "chunker": chunker_name})

                    edges.append(
                        {
                            "id": f"chunk:{chunk_run_id}:{file_id}:{parse_run_id}:{chunker_name}:{idx}",
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
                                "chunker": chunker_name,
                                "chunker_parameters": chunker_params,
                                "run_parameters": chunk_parameters,
                                "run_time": run_time,
                                "chunks_count": chunks_count,
                            },
                        }
                    )
            else:
                # Framework-only chunker
                chunker_node_id = f"chunker:{framework}"
                upsert_node(chunker_node_id, "chunker", framework, {"framework": framework})

                edges.append(
                    {
                        "id": f"chunk:{chunk_run_id}:{file_id}:{parse_run_id}",
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
                        },
                    }
                )

        # ---- Embed edges: chunker -> embedding (from index runs for this KB) ----
        def _chunker_node_ids_for_run(framework: str, chunk_parameters: dict) -> List[str]:
            fw = framework or "unknown"
            chunkers = (chunk_parameters or {}).get("chunkers")
            if fw == "langchain":
                return ["chunker:langchain"]
            if isinstance(chunkers, list) and len(chunkers) > 0:
                out = []
                for ch in chunkers:
                    chunker_name = (ch or {}).get("chunker") or "unknown"
                    out.append(f"chunker:{fw}:{chunker_name}")
                return out
            return [f"chunker:{fw}"]

        def _ensure_chunker_node(chunker_node_id: str, framework: str) -> None:
            if chunker_node_id in nodes_by_id:
                return
            if chunker_node_id == "chunker:langchain":
                upsert_node(chunker_node_id, "chunker", "langchain", {"framework": "langchain"})
                return
            parts = chunker_node_id.split(":", 2)
            if len(parts) == 3 and parts[0] == "chunker":
                _, fw, nm = parts
                upsert_node(chunker_node_id, "chunker", f"{fw}/{nm}", {"framework": fw, "chunker": nm})
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
                chunk_params = _loads_maybe_json(chunk_params)
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

            for tgt in _chunker_node_ids_for_run(framework, chunk_params):
                _ensure_chunker_node(tgt, framework)
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
    except Exception as e:
        logger.error(f"Error building knowledgebase graph: {e}")
        raise HTTPException(status_code=400, detail=str(e))

# API endpoint to get root directory info with parse runs
@app.get("/api/knowledgebase/{kb_id}/root-info")
async def get_root_directory_info(kb_id: int, knowledge_base: str = "default"):
    """Get root directory information with parse runs"""
    try:
        # Get knowledgebase root path
        root_path = get_upload_dir(DEFAULT_USER_ID, knowledge_base, "")
        
        root_info = memory_manager.knowledgebase_manager.get_file_by_path(root_path)
        
        if not root_info:
            raise HTTPException(status_code=404, detail="Root directory not found")
        
        file_id = root_info[0]
        filename = root_info[1]
        uploaded_time = root_info[2]
        description = root_info[6]
        
        # Get parse runs for the root directory
        parse_runs = memory_manager.parser_manager.get_parse_runs_by_file_id(file_id)
        
        # Create root directory object with parse runs
        root_directory = {
            "id": file_id,
            "name": filename,
            "uploaded_time": uploaded_time if uploaded_time else None,
            "description": description,
            "parse_runs": parse_runs
        }
        
        return {
            "success": True,
            "root": root_directory
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting root directory info: {e}")
        raise HTTPException(status_code=400, detail=str(e))

# API endpoint to update knowledgebase description
@app.put("/api/knowledgebase/{kb_id}/description")
async def update_knowledgebase_description(kb_id: int, description_data: dict):
    """Update knowledgebase description."""
    try:
        if "description" not in description_data:
            return {
                "success": False,
                "message": "Description field is required"
            }
        
        new_description = description_data["description"]
        success = memory_manager.knowledgebase_manager.update_knowledgebase_description(kb_id, new_description)
        if success:
            return {
                "success": True,
                "message": "Knowledgebase description updated successfully"
            }
        return {
            "success": False,
            "message": "Failed to update knowledgebase description"
        }
    except Exception as e:
        logger.error(f"Error updating knowledgebase description: {e}")
        raise HTTPException(status_code=400, detail=str(e))

# API endpoint to set a knowledgebase as active
@app.patch("/api/knowledgebase/{kb_id}/active")
async def set_active_knowledgebase(kb_id: int):
    """Set a knowledgebase as active, deactivating all other knowledgebases."""
    try:
        success = memory_manager.knowledgebase_manager.set_active_knowledgebase(kb_id)
        if success:
            return {
                "success": True,
                "message": "Knowledgebase set as active successfully"
            }
        return {
            "success": False,
            "message": "Failed to set knowledgebase as active"
        }
    except Exception as e:
        logger.error(f"Error setting active knowledgebase: {e}")
        raise HTTPException(status_code=400, detail=str(e))

# Knowledgebase endpoints
@app.get("/api/knowledgebase/{kb_id}/list")
async def list_directory(
    kb_id: int,
    path: str = "",
    knowledge_base: str = "default"
):
    """List directory contents for a knowledgebase"""
    try:                
        parent_folder = get_upload_dir(DEFAULT_USER_ID, knowledge_base, path)
        items = memory_manager.knowledgebase_manager.get_files_by_parent(kb_id, parent_folder)
        
        folders = []
        files = []
        
        for item in items:
            file_id = item[0]
            filename = item[1]
            uploaded_time = item[2]
            file_size = item[3]
            description = item[4]
            type = item[5]
            
            # Get parse runs for both files and folders
            parse_runs = memory_manager.parser_manager.get_parse_runs_by_file_id(file_id)

            if type == 'folder':
                folders.append({
                    "id": file_id,
                    "name": filename,
                    "uploaded_time": uploaded_time if uploaded_time else None,
                    "description": description,
                    "parse_runs": parse_runs
                })
            else:
                files.append({
                    "id": file_id,
                    "name": filename,
                    "uploaded_time": uploaded_time if uploaded_time else None,
                    "file_size": file_size,
                    "description": description,
                    "parse_runs": parse_runs
                })
        
        return {
            "success": True,
            "folders": folders,
            "files": files
        }
    except Exception as e:
        logger.exception(f"Error listing directory: {e}", stack_info=True)
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/knowledgebase/{kb_id}/folder")
async def create_folder(
    kb_id: int,
    name: str = Body(..., description="Folder name"),
    parentPath: str = Body("", description="Parent path"),
    knowledge_base: str = Body("default", description="Knowledge base name")
):
    """Create a new folder in knowledgebase (idempotent - returns success if folder already exists)"""
    try:       
        if not name or name.strip() == "":
            raise HTTPException(status_code=400, detail="Folder name cannot be empty")
        
        parent_dir = get_upload_dir(DEFAULT_USER_ID, knowledge_base, parentPath)
        new_folder_path = os.path.join(parent_dir, name)
        folder_exists_on_disk = os.path.exists(new_folder_path)
        
        if not folder_exists_on_disk:
            os.makedirs(new_folder_path, exist_ok=True)

        try:
            memory_manager.knowledgebase_manager.add_file_by_knowledgebase_name(
                name, new_folder_path, knowledge_base, type="folder", parentFolder=parent_dir, description="")
        except Exception as db_error:
            logger.debug(f"Folder may already exist in database: {db_error}")
        
        return {
            "success": True,
            "message": f"Folder '{name}' created successfully" if not folder_exists_on_disk else f"Folder '{name}' already exists",
            "path": f"{parentPath}/{name}" if parentPath else name
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error creating folder: {e}")
        raise HTTPException(status_code=400, detail=str(e))

@app.delete("/api/knowledgebase/{kb_id}/folder")
async def delete_folder(
    kb_id: int,
    path: str = Body(..., description="Folder path"),
    knowledge_base: str = Body("default", description="Knowledge base name")
):
    """Delete a folder from knowledgebase"""
    try:        
        normalized_path = path.lstrip('/')
        folder_path = get_upload_dir(DEFAULT_USER_ID, knowledge_base, normalized_path)      
        
        if not os.path.exists(folder_path):
            raise HTTPException(status_code=404, detail=f"Folder '{path}' not found")

        shutil.rmtree(folder_path)
        
        # file_ids = memory_manager.knowledgebase_manager.get_files_by_path_prefix(folder_path)
        # indexer = get_indexer(knowledge_base)
        # indexer.delete_file_chunks(file_ids, save=True)
        memory_manager.knowledgebase_manager.delete_file_by_path(folder_path)
        
        return {
            "success": True,
            "message": f"Folder '{path}' deleted successfully"
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting folder: {e}")
        raise HTTPException(status_code=400, detail=str(e))

@app.delete("/api/knowledgebase/{kb_id}/file")
async def delete_file(
    kb_id: int,
    path: str = Body(..., description="File path"),
    knowledge_base: str = Body("default", description="Knowledge base name")
):
    """Delete a file from knowledgebase"""
    try:        
        normalized_path = path.lstrip('/')
        directory = os.path.dirname(normalized_path)
        filename = os.path.basename(normalized_path)
        
        file_path = get_upload_dir(DEFAULT_USER_ID, knowledge_base, directory)
        full_file_path = os.path.join(file_path, filename)
        
        if not os.path.exists(full_file_path):
            raise HTTPException(status_code=404, detail=f"File '{path}' not found")
        
        os.remove(full_file_path)
        
        memory_manager.knowledgebase_manager.delete_file_by_path(full_file_path)
        # indexer = get_indexer(knowledge_base)
        # indexer.delete_file_chunks([file_id], save=True)
        
        return {
            "success": True,
            "message": f"File '{path}' deleted successfully"
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting file: {e}")
        raise HTTPException(status_code=400, detail=str(e))

# API endpoint to delete a knowledgebase
@app.delete("/api/knowledgebase/{kb_id}")
async def delete_knowledgebase(kb_id: int):
    """Delete a knowledgebase."""
    try:
        success = memory_manager.knowledgebase_manager.delete_knowledgebase(kb_id)
        if success:
            return {
                "success": True,
                "message": "Knowledgebase deleted successfully"
            }
        return {
            "success": False,
            "message": "Failed to delete knowledgebase"
        }
    except Exception as e:
        logger.error(f"Error deleting knowledgebase: {e}")
        raise HTTPException(status_code=400, detail=str(e))

# API endpoint to update multiple file/folder descriptions
@app.put("/api/knowledgebase/{kb_id}/descriptions")
async def update_multiple_descriptions(
    kb_id: int,  
    updates: List[Dict[str, Any]] = Body(...),
):
    """Update descriptions for multiple files and folders in a knowledgebase."""
    try:
        success = memory_manager.knowledgebase_manager.update_multiple_descriptions(kb_id, updates)
        if success:
            return {
                "success": True,
                "message": "Descriptions updated successfully"
            }
        return {
            "success": False,
            "message": "Failed to update descriptions"
        }
    except Exception as e:
        logger.error(f"Error updating multiple descriptions: {e}")
        raise HTTPException(status_code=400, detail=str(e))

# API endpoint for streaming file uploads
@app.post("/api/stream-upload")
async def stream_upload_files(
    knowledge_base: str = Form(...),
    directory: str = Form(""),
    files: List[UploadFile] = File(...)
):
    """Upload one or more files to a knowledge base and stream results as they complete."""
    try:        
        pipeline = ParallelFileProcessingPipeline(memory_manager=memory_manager)
        
        async def generate():
            async for result in pipeline.upload_files(DEFAULT_USER_ID, knowledge_base, files, directory):
                yield json.dumps(result) + "\n"
        
        return StreamingResponse(generate(), media_type="application/x-ndjson")
    except Exception as e:
        logger.exception(f"Error in stream uploading: {e}", stack_info=True)
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/index-files/{kb_name}/{chunk_run_id}/{embedding_config_id}")
async def index_files(kb_name: str, chunk_run_id: int, embedding_config_id: str):
    """Index files in a knowledgebase."""
    try:
        indexer = get_indexer(kb_name, chunk_run_id, embedding_config_id)
        pipeline = ParallelFileProcessingPipeline(memory_manager=memory_manager)
        async def generate():
            async for result in pipeline.index_all_chunks(indexer, chunk_run_id, embedding_config_id):
                yield json.dumps(result) + "\n"

        return StreamingResponse(generate(), media_type="application/x-ndjson")
    except Exception as e:
        logger.exception(f"Error indexing chunks: {e}", stack_info=True)
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/index-runs/{kb_id}")
async def get_index_runs(kb_id: int):
    """Get index runs for a knowledgebase."""
    try:
        index_runs = memory_manager.index_manager.get_index_runs_by_knowledgebase_id(kb_id)
        logger.info(f"{len(index_runs)} index runs for knowledgebase {kb_id}")
        return {
            "success": True,
            "index_runs": index_runs
        }
    except Exception as e:
        logger.exception(f"Error getting index runs: {e}", stack_info=True)
        raise HTTPException(status_code=400, detail=str(e))

# API endpoint to delete an index run by ID
@app.delete("/api/index-runs/{kb_name}/{index_run_id}")
async def delete_index_run(kb_name: str, index_run_id: int):
    """Delete an index run by ID."""
    try:
        index_run = memory_manager.index_manager.get_index_run_by_id(index_run_id)
        chunk_run_id = index_run["chunk_run_id"]
        embedding_config_id = index_run["embedding_configure_id"]
        indexer = get_indexer(kb_name, chunk_run_id, embedding_config_id)
        indexer.delete_file_chunks(save=True)

        success = memory_manager.index_manager.delete_index_run(index_run_id)
        if success:
            return {
                "success": True,
                "message": "Index run deleted successfully"
            }
        return {
            "success": False,
            "message": "Failed to delete index run"
        }
    except Exception as e:
        logger.error(f"Error deleting index run: {e}")
        raise HTTPException(status_code=400, detail=str(e))


# API endpoint for parsing file or folder by path (with path parameter)
@app.post("/api/parse-files/{kb_name}/{path:path}")
async def parse_files(kb_name: str, path: str, request: Request):
    """Parse a file or folder by path."""
    try:
        # Get JSON data from request body
        request_data = await request.json()
        filepath = get_upload_dir(DEFAULT_USER_ID, kb_name, path)

        # Extract parameters from request data
        parameters = request_data.get('parameters', {})

        pipeline = ParallelFileProcessingPipeline(memory_manager=memory_manager)
        async def generate():
            async for result in pipeline.parse_files(filepath, parameters=parameters):
                yield json.dumps(result) + "\n"

        return StreamingResponse(generate(), media_type="application/x-ndjson")
    except Exception as e:
        logger.exception(f"Error parsing file: {e}", stack_info=True)
        raise HTTPException(status_code=400, detail=str(e))

# API endpoint for parsing root folder (empty path)
@app.post("/api/parse-files/{kb_name}/")
async def parse_files_root(kb_name: str, request: Request):
    """Parse the root folder of a knowledgebase."""
    return await parse_files(kb_name, "", request)

@app.post("/api/chunk-files/{kb_id}")
async def chunk_files(
    kb_id: int,
    request: Request
):
    """Chunk files in a knowledgebase."""
    try:        
        # Get all form data as a dictionary
        form_data = await request.form()
        
        # Extract framework which is required
        framework = form_data.get('framework', 'langchain')
        
        # Build kwargs from form data
        kwargs = {}
        for key, value in form_data.items():
            if key != 'framework':
                # Convert string booleans to actual booleans
                if value.lower() in ['true', 'false']:
                    kwargs[key] = value.lower() == 'true'
                # Convert numeric values to integers
                elif value.isdigit():
                    kwargs[key] = int(value)
                # Convert JSON objects to actual objects
                else:
                    try:
                        kwargs[key] = json.loads(value)
                    except json.JSONDecodeError:
                        kwargs[key] = value
        
        pipeline = ParallelFileProcessingPipeline(memory_manager=memory_manager)
        
        async def generate():
            async for result in pipeline.chunk_all_files_in_knowledgebase(kb_id, framework, **kwargs):
                yield json.dumps(result) + "\n"
        
        return StreamingResponse(generate(), media_type="application/x-ndjson")
    except Exception as e:
        logger.exception(f"Error in chunking files: {e}", stack_info=True)
        raise HTTPException(status_code=400, detail=str(e))

# API endpoint to get chunk run history
@app.get("/api/chunk-runs/{kb_id}")
async def get_chunk_runs(
    kb_id: int
):
    """Get chunk run history for a knowledgebase."""
    try:
        chunk_runs = memory_manager.chunking_manager.get_chunk_runs_by_knowledgebase_id(kb_id)
        return {
            "success": True,
            "chunk_runs": chunk_runs
        }
    except Exception as e:
        logger.error(f"Error getting chunk runs: {e}")
        raise HTTPException(status_code=400, detail=str(e))

# API endpoint to delete a chunk run
@app.delete("/api/chunk-runs/{run_id}")
async def delete_chunk_run(
    run_id: int
):
    """Delete a chunk run and its associated chunks."""
    try:
        success = memory_manager.chunking_manager.delete_chunk_run(run_id)
        if success:
            return {
                "success": True,
                "message": "Chunk run deleted successfully"
            }
        else:
            raise HTTPException(status_code=404, detail="Chunk run not found")
    except Exception as e:
        logger.error(f"Error deleting chunk run: {e}")
        raise HTTPException(status_code=400, detail=str(e))

# API endpoint to set active chunk run
@app.patch("/api/chunk-runs/{run_id}/active")
async def set_active_chunk_run(
    run_id: int,
    request: dict
):
    """Set a chunk run as active, deactivating all others for the same knowledgebase."""
    try:
        knowledgebase_id = request.get('knowledgebase_id')
        if not knowledgebase_id:
            raise HTTPException(status_code=400, detail="knowledgebase_id is required")
        
        memory_manager.chunking_manager.set_active_chunk_run(knowledgebase_id, run_id)
        return {
            "success": True,
            "message": "Chunk run set as active successfully"
        }
    except Exception as e:
        logger.error(f"Error setting active chunk run: {e}")
        raise HTTPException(status_code=400, detail=str(e))

# API endpoint to get chunk runs by file_id
@app.get("/api/chunk-runs/by-file/{file_id}")
async def get_chunk_runs_by_file(
    file_id: int
):
    """Get chunk run history for a specific file."""
    try:
        chunk_runs = memory_manager.chunking_manager.get_chunk_runs_by_file_id(file_id)
        logger.info(f"{len(chunk_runs)} chunk runs for file {file_id}")
        return {
            "success": True,
            "chunk_runs": chunk_runs
        }
    except Exception as e:
        logger.error(f"Error getting chunk runs by file ID: {e}")
        raise HTTPException(status_code=400, detail=str(e))

# API endpoint to get chunks by file_id and chunk_run_ids
@app.get("/api/chunks")
async def get_chunks(
    file_id: int, 
    chunk_run_ids: Optional[str] = None
):
    """Get chunks by file_id and optionally filter by chunk_run_ids."""
    try:
        # Parse chunk_run_ids from comma-separated string to list of integers if provided
        parsed_chunk_run_ids = None
        if chunk_run_ids:
            parsed_chunk_run_ids = [int(id.strip()) for id in chunk_run_ids.split(",") if id.strip().isdigit()]
        
        chunks = memory_manager.chunking_manager.get_chunks_by_file_id(file_id, parsed_chunk_run_ids)
        
        return {
            "success": True,
            "chunks": chunks
        }
    except Exception as e:
        logger.error(f"Error getting chunks: {e}")
        raise HTTPException(status_code=400, detail=str(e))

# API endpoint to get a file parsed content by its ID
@app.get("/api/files/{file_id}")
async def get_file_by_id(file_id: int):
    """Get file details by file_id."""
    try:
        file_parsed = memory_manager.parser_manager.get_parsed_content_by_file_id(file_id, is_active=True)
        if not file_parsed or len(file_parsed) == 0:
            raise HTTPException(status_code=404, detail=f"Parsed content with ID {file_id} not found")
        
        file = {
            "file_id": file_parsed[0]["file_id"],
            "parse_run_id": file_parsed[0]["parse_run_id"],
            "parsed_text": file_parsed[0]["parsed_text"],
            "parser": file_parsed[0]["parser"],
            "parameters": file_parsed[0]["parameters"],
            "time_usage": file_parsed[0]["time_usage"],
            "time": file_parsed[0]["time"],
        }
        
        return {
            "success": True,
            "file": file
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting file by ID: {e}")
        raise HTTPException(status_code=400, detail=str(e))

# API endpoint to get parsed content by file_id and parse_run_id
@app.get("/api/parsed-content/{file_id}/{parse_run_id}")
async def get_parsed_content_by_run_id(file_id: int, parse_run_id: int):
    """Get parsed content for a specific file and parse run ID."""
    try:
        parsed_content = memory_manager.parser_manager.get_parsed_content_by_run_id(file_id, parse_run_id)
        if not parsed_content:
            return {
                "success": False,
                "message": f"No parsed content found for file ID {file_id} and parse run ID {parse_run_id}"
            }
        
        return {
            "success": True,
            "parsed_content": parsed_content
        }
    except Exception as e:
        logger.error(f"Error getting parsed content by run ID: {e}")
        raise HTTPException(status_code=400, detail=str(e))

# API endpoint to set active parse run
@app.put("/api/parse-runs/set-active/{file_id}/{parse_run_id}")
async def set_active_parse_run(file_id: int, parse_run_id: int):
    """Set a specific parse run as active for a file."""
    try:
        success = memory_manager.parser_manager.set_active_parse_run(file_id, parse_run_id)
        if success:
            # Desync chunk runs for parsed files have been changed
            knowledgebase_id = memory_manager.knowledgebase_manager.get_file_by_id(file_id)[4]
            if not knowledgebase_id:
                raise HTTPException(status_code=404, detail=f"File {file_id} not found in any knowledgebase")
            memory_manager.chunking_manager.desync_chunk_runs(knowledgebase_id)
            return {
                "success": True,
                "message": f"Successfully set parse run {parse_run_id} as active for file {file_id}"
            }
        else:
            return {
                "success": False,
                "message": f"No parsed content found for file {file_id} and parse run {parse_run_id}"
            }
    except Exception as e:
        logger.error(f"Error setting active parse run: {e}")
        raise HTTPException(status_code=400, detail=str(e))

@app.delete("/api/parse-runs/{kb_name}/{parse_run_id}/{path:path}")
async def delete_parse_run(kb_name: str, parse_run_id: int, path: str):
    """Delete a parse run and all associated records.

    Args:
        kb_name: Name of the knowledgebase
        parse_run_id: ID of the parse run to delete
        path: Path of the file or folder to delete the parse run for
    """
    try:
        path_in_knowledgebase = get_upload_dir(DEFAULT_USER_ID, kb_name, path.lstrip('/'))
        success = memory_manager.parser_manager.delete_parse_run(parse_run_id, path_in_knowledgebase)
        if success:
            return {
                "success": True,
                "message": f"Parse run {parse_run_id} deleted successfully for path {path}"
            }
        else:
            raise HTTPException(status_code=404, detail=f"Parse run {parse_run_id} not found for path {path}")
    except Exception as e:
        logger.error(f"Error deleting parse run: {e}")

@app.delete("/api/parse-runs/{kb_name}/{parse_run_id}")
async def delete_parse_run_root(kb_name: str, parse_run_id: int):
    """Delete a parse run and all associated records for the root folder of a knowledgebase."""
    return await delete_parse_run(kb_name, parse_run_id, "")

# API endpoint for retrieving documents
@app.post("/api/retrieve/{kb_name}/{index_run_id}")
async def retrieve_documents(kb_name: str, index_run_id: int, request: Request):
    """Retrieve relevant documents from the vectorstore based on a query."""
    try:
        # Get request body
        request_data = await request.json()
        query = request_data.get('query')
        retriever_type = request_data.get('retriever_type', 'vector')
        k = request_data.get('k', 5)
        
        if not query:
            raise HTTPException(status_code=400, detail="Query is required")
        
        # Get index run details
        index_run = memory_manager.index_manager.get_index_run_by_id(index_run_id)
        if not index_run:
            raise HTTPException(status_code=404, detail="Index run not found")
        
        chunk_run_id = index_run["chunk_run_id"]
        embedding_config_id = index_run["embedding_configure_id"]
        
        # Initialize Indexer
        indexer = get_indexer(kb_name, chunk_run_id, embedding_config_id)
        if not indexer:
            raise HTTPException(status_code=400, detail="Failed to initialize indexer")
        
        # Create Retriever

        retriever = BaseRetriever.create(retriever_type, indexer)
        
        # Perform retrieval
        results = retriever.retrieve(query, k=k)
        
        # Format results
        formatted_results = []
        for doc, score in results:
            formatted_results.append({
                "id": doc.metadata.get('chunk_id'),
                "document_name": doc.metadata.get('filename', 'Unknown'),
                "file_path": doc.metadata.get('filepath', 'Unknown'),
                "snippet": doc.page_content[:200] + ("..." if len(doc.page_content) > 200 else ""),
                "relevance_score": float(score)
            })
        
        return {
            "success": True,
            "results": formatted_results,
            "retriever_type": retriever_type
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Error retrieving documents: {e}", stack_info=True)
        raise HTTPException(status_code=400, detail=str(e))

# Health check endpoint
@app.get("/health")
async def health_check():
    """Health check endpoint to verify API is running."""
    return {"status": "ok", "message": "File Upload API is running"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)