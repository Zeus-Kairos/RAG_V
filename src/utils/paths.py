import os
from typing import Tuple
from src.utils.logging_config import get_logger

logger = get_logger(__name__)

# Base upload directory from environment or use default
BASE_UPLOAD_DIR = os.getenv("BASE_UPLOAD_DIR", "uploads")

def get_upload_dir(user_id: int, knowledge_base: str, directory: str) -> str:
    """Generate a unique upload directory for the given user_id.
    
    Args:
        user_id: User ID
        knowledge_base: Knowledgebase name
        directory: Directory name
        
    Returns:
        Unique upload directory as a string
    """
    # Remove leading slash to avoid absolute path issues
    directory = directory.lstrip('/')
    
    # Split directory into parts
    parts = directory.split('/') if directory else []
    
    return os.path.join(BASE_UPLOAD_DIR, str(user_id), knowledge_base, "origin", *parts)


def get_index_path(knowledgebase_name: str, embedding_config_id: str) -> str:
    """Generate a unique index path for the given knowledgebase_name.
    
    Args:
        knowledgebase_name: Knowledgebase name
        embedding_config_id: Embedding configuration ID
        
    Returns:
        Unique index path as a string
    """
    return f"./index/{knowledgebase_name}/{embedding_config_id}"

def get_relative_path_from_origin(folder: str) -> str:
    """Get the relative path from the origin folder.
    
    Args:
        folder: Folder path
        
    Returns:
        Relative path from origin as a string
    """
    if "origin" in folder:
        parts = folder.split(os.path.sep)
        try:
            origin_index = parts.index("origin")
            if len(parts) == origin_index + 1:
                rel_path = "root"
            else:
                sub_path = os.path.sep.join(parts[origin_index + 1:])
                rel_path = sub_path if sub_path else "root"
        except ValueError:
            rel_path = folder
    else:
        rel_path = folder
    return rel_path
