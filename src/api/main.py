import os
import shutil
from datetime import datetime, timedelta, timezone

from typing import List, Optional, Dict, Any

from fastapi import FastAPI, File, UploadFile, Form, HTTPException, Body
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from contextlib import asynccontextmanager

from src.file_process.indexer import Indexer
from src.utils.paths import get_index_path, get_upload_dir
from src.file_process.parallel_pipeline import ParallelFileProcessingPipeline
from src.memory.memory import MemoryManager
from src.utils.logging_config import get_logger

logger = get_logger(__name__)

# Default user ID (since we don't have authentication)
DEFAULT_USER_ID = 1

# Pydantic model for configuration update
class ConfigUpdate(BaseModel):
    api_key: Optional[str] = None
    llm_model: Optional[str] = None   
    model_provider: Optional[str] = None
    api_base_url: Optional[str] = None
    embedding_provider: Optional[str] = None
    embedding_api_key: Optional[str] = None
    embedding_model: Optional[str] = None

# Initialize MemoryManager
memory_manager = MemoryManager()

indexers = {}

def get_indexer(knowledge_base: str) -> Indexer:
    """Get or create an Indexer for the given knowledge base."""
    indexer_key = knowledge_base
    if indexer_key not in indexers:
        indexers[indexer_key] = Indexer(DEFAULT_USER_ID, get_index_path(DEFAULT_USER_ID, knowledge_base))
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


# Initialize MemoryManager
memory_manager = MemoryManager()

indexers = {}

def get_indexer(knowledge_base: str) -> Indexer:
    """Get or create an Indexer for the given knowledge base."""
    indexer_key = knowledge_base
    if indexer_key not in indexers:
        indexers[indexer_key] = Indexer(DEFAULT_USER_ID, get_index_path(DEFAULT_USER_ID, knowledge_base))
    return indexers[indexer_key]

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
@app.patch("/api/config")
async def update_configuration(config_data: ConfigUpdate):
    """Update configuration settings."""
    try:
        updated_config = memory_manager.update_configuration(
            model_provider=config_data.model_provider,           
            api_key=config_data.api_key,
            llm_model=config_data.llm_model,
            api_base_url=config_data.api_base_url,
            embedding_provider=config_data.embedding_provider,
            embedding_api_key=config_data.embedding_api_key,
            embedding_model=config_data.embedding_model,                     
        )       
        
        return {
            "success": True,
            "message": "Configuration updated successfully",
            "config": updated_config
        }
    except Exception as e:
        logger.error(f"Error updating configuration: {e}")
        raise HTTPException(status_code=400, detail=str(e))

# API endpoint for getting configuration
@app.get("/api/config")
async def get_configuration():
    """Get configuration settings."""
    try:
        config = memory_manager.get_configuration()
        if config:
            return {
                "success": True,
                "config": config
            }
        return {
            "success": True,
            "config": None,
            "message": "No configuration found"
        }
    except Exception as e:
        logger.error(f"Error getting configuration: {e}")
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

# API endpoint to rename a knowledgebase
@app.put("/api/knowledgebase/{kb_id}/rename")
async def rename_knowledgebase(kb_id: int, rename_data: dict):
    """Rename a knowledgebase."""
    try:
        if "name" not in rename_data:
            return {
                "success": False,
                "message": "Name field is required"
            }
        
        new_name = rename_data["name"]
        success = memory_manager.knowledgebase_manager.rename_knowledgebase(kb_id, new_name)
        if success:
            return {
                "success": True,
                "message": "Knowledgebase renamed successfully"
            }
        return {
            "success": False,
            "message": "Failed to rename knowledgebase"
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error renaming knowledgebase: {e}")
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
            
            if type == 'folder':
                folders.append({
                    "id": file_id,
                    "name": filename,
                    "uploaded_time": uploaded_time if uploaded_time else None,
                    "description": description
                })
            else:
                files.append({
                    "id": file_id,
                    "name": filename,
                    "uploaded_time": uploaded_time if uploaded_time else None,
                    "file_size": file_size,
                    "description": description
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
                name, new_folder_path, "", knowledge_base, type="folder", parentFolder=parent_dir)
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
        
        file_ids = memory_manager.knowledgebase_manager.get_files_by_path_prefix(folder_path)
        indexer = get_indexer(knowledge_base)
        indexer.delete_file_chunks(file_ids, save=True)
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
        
        file_id = memory_manager.knowledgebase_manager.delete_file_by_path(full_file_path)
        indexer = get_indexer(knowledge_base)
        indexer.delete_file_chunks([file_id], save=True)
        
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
        from fastapi.responses import StreamingResponse
        import json
        
        indexer = get_indexer(knowledge_base)
        pipeline = ParallelFileProcessingPipeline(indexer, memory_manager)
        
        async def generate():
            async for result in pipeline.process_files(DEFAULT_USER_ID, knowledge_base, files, directory):
                yield json.dumps(result) + "\n"
        
        return StreamingResponse(generate(), media_type="application/x-ndjson")
    except Exception as e:
        logger.error(f"Error in stream upload: {e}")
        raise HTTPException(status_code=400, detail=str(e))

# Health check endpoint
@app.get("/health")
async def health_check():
    """Health check endpoint to verify API is running."""
    return {"status": "ok", "message": "File Upload API is running"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)