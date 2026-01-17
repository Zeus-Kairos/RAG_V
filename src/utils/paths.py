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

def get_parsed_path(original_file_path: str) -> Tuple[str, str]:
        """
        Get the parsed file path from the original file path.
        
        Args:
            original_file_path: Original file path
            
        Returns:
            Tuple of (parsed_dir, filename) where:
            - parsed_dir: Directory path where parsed content will be saved
            - filename: Filename without extension (or folder name if original is a folder)
        """
        # Extract user_id, knowledge_base, and filename from original path
        path_parts = original_file_path.split(os.sep)
            
        # Find the origin folder index
        try:
            origin_idx = path_parts.index("origin")
            if origin_idx < 2:  # Need at least uploads/user_id/knowledge_base/origin
                raise ValueError("Invalid path structure")
                    
            # Build parsed directory path
            filepath_with_ext = os.sep.join(path_parts[origin_idx+1:])
            parsed_dir_parts = path_parts[:origin_idx] + ["parsed"] + filepath_with_ext.split(os.sep)[:-1]
            parsed_dir = os.sep.join(parsed_dir_parts)
            
            # Create parsed directory if it doesn't exist
            os.makedirs(parsed_dir, exist_ok=True)
                
            # Get filename (handle both files with extensions and folders without)
            filename_with_ext = filepath_with_ext.split(os.sep)[-1]
            filename, original_ext = os.path.splitext(filename_with_ext)
            
            return parsed_dir, filename.replace(" ", "_")
        except ValueError as e:
            logger.error(f"Error extracting path components from {original_file_path}: {str(e)}")
            # Return a default value instead of None to avoid unpacking errors
            return os.path.join(BASE_UPLOAD_DIR, "parsed"), os.path.basename(original_file_path)
        except Exception as e:
            logger.error(f"Unexpected error in get_parsed_path: {str(e)}")
            # Return a default value instead of None to avoid unpacking errors
            return os.path.join(BASE_UPLOAD_DIR, "parsed"), os.path.basename(original_file_path)

def get_index_path(user_id: int, knowledgebase_name: str) -> str:
    """Generate a unique index path for the given user_id and knowledgebase_name.
    
    Args:
        user_id: User ID
        knowledgebase_name: Knowledgebase name
        
    Returns:
        Unique index path as a string
    """
    return f"./index/{user_id}/{knowledgebase_name}"

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
