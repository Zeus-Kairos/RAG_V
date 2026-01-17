import os
import asyncio
from typing import List, Dict, Any, AsyncGenerator
from fastapi import UploadFile
from src.file_process.utils import SUPPORTED_FORMATS
from src.utils.paths import get_index_path, get_upload_dir
from src.file_process.indexer import Indexer
from src.file_process.file_splitter import FileSplitter
from src.file_process.file_upload import FileUploader
from src.file_process.file_parser import FileParser
from src.memory.memory import MemoryManager
from src.utils.logging_config import get_logger

logger = get_logger(__name__)

class ParallelFileProcessingPipeline:
    """Pipeline that processes files in parallel and yields results as they complete."""
    
    def __init__(self, indexer: Indexer, memory_manager: MemoryManager = None):
        self.file_uploader = FileUploader()
        self.file_parser = FileParser()
        self.file_splitter = FileSplitter()
        self.memory_manager = memory_manager or MemoryManager()
        self.indexer = indexer
    
    async def process_files(self, user_id: int, knowledge_base: str, files: List[UploadFile], directory: str = "") -> AsyncGenerator[Dict[str, Any], None]:
        """Process files in parallel and yield results as each file completes.
        
        Args:
            user_id: User identifier
            knowledge_base: Knowledge base name
            files: List of UploadFile objects
            directory: Optional directory path
            
        Yields:
            Dict containing the result for each processed file
        """
        logger.info(f"Starting parallel file processing pipeline: user_id={user_id}, knowledge_base={knowledge_base}, directory={directory}, file_count={len(files)}")
        
        upload_dir = get_upload_dir(user_id, knowledge_base, directory)
        os.makedirs(upload_dir, exist_ok=True)
        
        # Create tasks for parallel processing of each file
        tasks = []
        for file in files:
            task = self._process_single_file(
                user_id,
                knowledge_base,
                file,
                upload_dir
            )
            tasks.append(task)
        
        # Process files in parallel and yield results as they complete
        for task in asyncio.as_completed(tasks):
            try:
                result = await task
                yield result
            except Exception as e:
                logger.error(f"Unexpected error in parallel processing: {e}")
                # This shouldn't happen as _process_single_file handles exceptions internally

        self.indexer.save_index()
    
    async def _process_single_file(self, user_id: int, knowledge_base: str, file: UploadFile, upload_dir: str) -> Dict[str, Any]:
        """Process a single file through upload, parsing, database insertion, splitting, and indexing.
        
        Args:
            user_id: User identifier
            knowledge_base: Knowledge base name
            file: UploadFile object from FastAPI
            upload_dir: Directory to save the file
            
        Returns:
            Updated file_result with processing details
        """
        filename = file.filename
        
        try:
            # Step 1: Upload the file
            file_result = await self.file_uploader.upload_file(file, upload_dir)
            
            # Check if upload was successful
            if file_result["status"] not in ["success", "updated"]:
                # Upload failed or skipped, return the result
                return file_result
            
            file_path = file_result["path"]
            file_size = file_result["file_size"]
            
            # Check if file is parsable (redundant check for safety)
            file_ext = os.path.splitext(filename)[1].lower()
            if file_ext not in SUPPORTED_FORMATS:
                file_result["status"] = "failed"
                file_result["parsed"] = False
                file_result["parsing_error"] = "File type not parsable"
                logger.error(f"File {filename} is not parsable")
                return file_result
            
            # Step 2: Parse the file (run sync method in thread pool)
            parse_result = await asyncio.to_thread(self.file_parser.parse_file, file_path)
            
            if parse_result["success"]:
                file_result["parsed"] = True
                logger.info(f"File parsed successfully: {filename}")
                
                # Step 3: Add file to database
                try:
                    file_id = self.memory_manager.knowledgebase_manager.add_file_by_knowledgebase_name(
                        filename=filename,
                        filepath=file_path,
                        parsed_text=parse_result["content"],
                        user_id=user_id,
                        knowledgebase_name=knowledge_base,
                        file_size=file_size,
                        parentFolder=upload_dir
                    )
                    file_result["file_id"] = file_id
                except Exception as e:
                    file_result["status"] = "failed"
                    file_result["error"] = f"Failed to add file to database: {str(e)}"
                    logger.error(f"Failed to add file {filename} to database: {e}")
                    return file_result
                
                # Step 4: Split parsed content (run sync method in thread pool)
                content = parse_result["content"]
                metadata = {
                    "file_id": file_id,
                    "filename": filename,
                    'file_path': file_path,
                }
                documents = await asyncio.to_thread(self.file_splitter.split_text, content, metadata)
                logger.info(f"File split into {len(documents)} documents: {filename}")
                
                # Step 5: Index chunks (run sync method in thread pool)
                vectorstore = await asyncio.to_thread(self.indexer.index_chunks, {file_id: documents})
                file_result["chunks_count"] = len(documents)
                logger.info(f"File indexed successfully: {filename}, chunks: {len(documents)}")
            else:
                file_result["status"] = "failed"
                file_result["parsed"] = False
                file_result["parsing_error"] = parse_result["error"]
                logger.error(f"Failed to parse content for {filename}: {parse_result['error']}")
        except Exception as e:
            # Create a result dictionary if file_result doesn't exist yet
            if 'file_result' not in locals():
                file_result = {
                    "filename": filename,
                    "status": "failed",
                    "error": f"Unexpected error during processing: {str(e)}"
                }
            else:
                file_result["status"] = "failed"
                file_result["error"] = f"Unexpected error during processing: {str(e)}"
            logger.error(f"Unexpected error processing file {filename}: {e}")
        
        return file_result