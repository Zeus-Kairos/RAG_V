import os
import hashlib
from datetime import datetime
from typing import List, Dict, Any
from fastapi import UploadFile
from src.file_process.utils import MAX_FILE_SIZE, SUPPORTED_FORMATS
from src.utils.paths import get_upload_dir
from src.utils.logging_config import get_logger

logger = get_logger(__name__)

class FileUploader:
    """Class to handle file upload functionality without parsing."""
    
    def __init__(self):
        pass
    
    async def upload_file(self, file: UploadFile, upload_dir: str) -> Dict[str, Any]:
        """Upload a single file to the specified directory.
        
        Args:
            file: UploadFile object from FastAPI
            upload_dir: Directory to save the file
            
        Returns:
            Dict containing upload result
        """
        try:
            file_path = os.path.join(upload_dir, file.filename)

            # Get file extension and validate format
            file_ext = os.path.splitext(file.filename)[1].lower()
            
            if file_ext not in SUPPORTED_FORMATS:
                # Generate file_id even for failed uploads                
                return {
                    "filename": file.filename,
                    "status": "failed",
                    "error": f"Unsupported file format: {file_ext}. Supported formats: {', '.join(SUPPORTED_FORMATS)}"
                }
            
            # Read file content
            content = await file.read()
            
            # Check file size
            if len(content) > MAX_FILE_SIZE:
                return {
                    "filename": file.filename,
                    "status": "failed",
                    "error": f"File size exceeds maximum limit (100MB)"
                }          
            
            # Generate file hash
            file_hash = hashlib.md5(content).hexdigest()
            
            # Check if file with same name already exists
            if os.path.exists(file_path):
                # Same name exists, check if content is identical
                with open(file_path, "rb") as f:
                    existing_content = f.read()
                existing_hash = hashlib.md5(existing_content).hexdigest()
                
                if existing_hash == file_hash:
                    # Same name and same content
                    return {
                        "filename": file.filename,
                        "status": "skipped",
                        "message": "File already exists with identical content"
                    }
                else:
                    # Same name but different content - update the file
                    with open(file_path, "wb") as f:
                        f.write(content)
                    
                    logger.info(f"File updated successfully: {file.filename} -> {file_path}")
                    
                    result_entry = {
                        "filename": file.filename,
                        "status": "updated",
                        "path": file_path,
                        "file_size": len(content),
                        "file_hash": file_hash
                    }
                    
                    return result_entry
            else:
                # New file - save it
                with open(file_path, "wb") as f:
                    f.write(content)
                
                # Log successful upload
                logger.info(f"File uploaded successfully: {file.filename} -> {file_path}")
                
                # Add to results
                result_entry = {
                    "filename": file.filename,
                    "status": "success",
                    "path": file_path,
                    "file_size": len(content),
                    "file_hash": file_hash
                }
                
                return result_entry
            
        except Exception as e:
            logger.error(f"Error processing file {file.filename}: {str(e)}")
            # Generate file_id even for failed uploads
            return {
                "filename": file.filename,
                "status": "failed",
                "error": str(e)
            }
    
    async def upload_files(self, user_id: int, knowledge_base: str, files: List[UploadFile], directory: str = "") -> Dict[str, Any]:
        """Upload multiple files for a user and knowledge base.
        
        Args:
            user_id: User ID for the upload
            knowledge_base: Knowledge base name
            files: List of UploadFile objects
            directory: Directory to store files (optional, defaults to empty string)
            
        Returns:
            Dict containing upload results for all files
        """
        # Create upload directory structure
        upload_dir = get_upload_dir(user_id, knowledge_base, directory)
        os.makedirs(upload_dir, exist_ok=True)
        
        # Process each file
        upload_results = []
        all_successful = True
        
        for file in files:
            result = await self.upload_file(file, upload_dir)
            upload_results.append(result)
            
            if result["status"] not in ["success", "skipped", "updated"]:
                all_successful = False
        
        # Determine overall status
        overall_status = "success" if all_successful else "partial_success"
        
        return {
            "status": overall_status,
            "files": upload_results,
            "total": len(files),
            "successful": sum(1 for r in upload_results if r["status"] in ["success", "updated"]),
            "skipped": sum(1 for r in upload_results if r["status"] == "skipped"),
            "failed": sum(1 for r in upload_results if r["status"] == "failed")
        }









