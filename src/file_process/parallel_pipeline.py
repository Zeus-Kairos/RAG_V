import os
import asyncio
from typing import List, Dict, Any, AsyncGenerator
from fastapi import UploadFile
from langchain_core.documents import Document
from src.file_process.utils import SUPPORTED_FORMATS
from src.utils.paths import get_index_path, get_upload_dir
from src.file_process.indexer import Indexer
from src.file_process.file_splitter import ChonkieFileSplitter, LangchainFileSplitter
from src.file_process.file_upload import FileUploader
from src.file_process.file_parser import FileParser
from src.memory.memory import MemoryManager
from src.utils.logging_config import get_logger

logger = get_logger(__name__)

class ParallelFileProcessingPipeline:
    """Pipeline that processes files in parallel and yields results as they complete."""
    
    def __init__(self, memory_manager: MemoryManager = None):
        self.file_uploader = None
        self.file_parser = None
        self.file_splitter = None
        self.indexer = None
        self.memory_manager = memory_manager or MemoryManager()     
    
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
        
        # Initialize components if not already initialized
        if not self.file_uploader:
            self.file_uploader = FileUploader()
        if not self.file_parser:
            self.file_parser = FileParser()
        if not self.file_splitter:
            self.file_splitter = LangchainFileSplitter()  # Default to LangchainFileSplitter
        if not self.indexer:
            self.indexer = Indexer()  # Initialize indexer if not provided in constructor
        
        # Create tasks for parallel processing of each file
        tasks = []
        for file in files:
            task = self._process_single_file(
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
    
    async def _process_single_file(self, knowledge_base: str, file: UploadFile, upload_dir: str) -> Dict[str, Any]:
        """Process a single file through upload, parsing, database insertion, splitting, and indexing.
        
        Args:
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

    async def parse_files(self, filepath: str, parameters: Dict[str, Any] = None) -> AsyncGenerator[Dict[str, Any], None]:
        """Parse a single file or files under a folder in parallel, yield results as they complete.
        
        Args:
            filepath: Path to the file or folder to parse
            parameters: Parser parameters as a dictionary
            
        Yields:
            Dict containing the result for each parsed file
        """
        logger.info(f"Starting parallel parse pipeline: filepath={filepath}, parameters={parameters}")
        
        parameters = parameters or {}
        self.file_parser = FileParser(parameters)

        file = self.memory_manager.knowledgebase_manager.get_file_by_path(filepath)
        if not file:
            logger.error(f"File with filepath {filepath} not found")
            return

        file_dict = dict(file)

        # Create a parse run
        parse_run_id, parse_run_time = self.memory_manager.parser_manager.create_parse_run(
            file_id=file_dict['file_id']
        )        
                
        type = file_dict['type']
        if type == 'folder':
            # parse all files under the folder
            file_ids = self.memory_manager.knowledgebase_manager.get_files_by_path_prefix(filepath, include_folders=True)
        else:
            # parse the file
            file_ids = [file_dict['file_id']]
        
        # Create tasks for parallel parsing of each file
        tasks = []
        for file_id in file_ids:
            task = self._parse_single_file(
                file_id,
                parameters,
                parse_run_id,
                parse_run_time
            )
            tasks.append(task)
        
        # Process files in parallel and yield results as they complete
        for task in asyncio.as_completed(tasks):
            try:
                result = await task
                yield result
            except Exception as e:
                logger.error(f"Unexpected error in parallel parsing: {e}")

        # Desync chunk runs for parsed files have been changed
        self.memory_manager.chunking_manager.desync_chunk_runs(file_dict['knowledgebase_id'])
        
    
    async def _parse_single_file(self, file_id: int, parameters: Dict[str, Any], parse_run_id: int, parse_run_time: str) -> Dict[str, Any]:
        """Parse a single file.
        
        Args:
            file_id: File ID from the database
            parameters: Parser parameters as a dictionary
            parse_run_id: ID of the parse run
            parse_run_time: Time of the parse run
            
        Returns:
            Dict containing parse results
        """
        try:           
            # Get file information from database
            file = self.memory_manager.knowledgebase_manager.get_file_by_id(file_id)
            if not file:
                return {
                    "file_id": file_id,
                    "filename": "Unknown",
                    "parse_run_id": parse_run_id,
                    "parsed": False,
                    "status": "failed",
                    "error": f"File with ID {file_id} not found"
                }
            
            file_dict = dict(file)
            filename = file_dict['filename']
            filepath = file_dict['filepath']
            type = file_dict['type']

            if type == 'folder':
                parsed_id = self.memory_manager.parser_manager.add_parsed_content(
                    file_id=file_id,
                    parse_run_id=parse_run_id,
                    parse_run_time=parse_run_time,
                    parsed_text="",
                    parser="combined",
                    parameters=parameters,
                    is_active=True
                )
                return {
                    "file_id": file_id,
                    "filename": filename,
                    "parse_run_id": parse_run_id,
                    "parse_run_time": parse_run_time,
                    "parsed": True,
                    "parsed_id": parsed_id
                }
            
            # Parse the file (run sync method in thread pool)
            parse_result = await asyncio.to_thread(self.file_parser.parse_file, filepath)
            
            result = {
                "file_id": file_id,
                "filename": filename,
                "parse_run_id": parse_run_id,
                "parse_run_time": parse_run_time
            }
            
            if parse_result["success"]:
                result["status"] = "success"
                result["parsed"] = True
                result["content_length"] = len(parse_result["content"])
                logger.info(f"File parsed successfully: {filename}")
                
                # Add parsed content to database
                parsed_id = self.memory_manager.parser_manager.add_parsed_content(
                    file_id=file_id,
                    parse_run_id=parse_run_id,
                    parse_run_time=parse_run_time,
                    parsed_text=parse_result["content"],
                    parser=parse_result["parser"],
                    parameters=parse_result["parameters"],
                    is_active=True
                )
                result["parsed_id"] = parsed_id
                
            else:
                result["status"] = "failed"
                result["parsed"] = False
                result["error"] = parse_result["error"]
                logger.error(f"Failed to parse content for {filename}: {parse_result['error']}")
            
            return result
        except Exception as e:
            logger.error(f"Unexpected error parsing file {file_id}: {e}")
            return {
                "file_id": file_id,
                "filename": "Unknown",
                "status": "failed",
                "error": f"Unexpected error during parsing: {str(e)}"
            }
    
    async def chunk_all_files_in_knowledgebase(self, knowledgebase_id: int, framework: str = "langchain", **kwargs) -> AsyncGenerator[Dict[str, Any], None]:
        """Chunk all files in a knowledgebase in parallel.
        
        Args:
            knowledgebase_id: Knowledge base ID
            framework: Framework to use for chunking (default: "langchain")
            markdown_header_splitting: Whether to use markdown header splitting
            recursive_splitting: Whether to use recursive splitting
            chunk_size: Size of each chunk
            chunk_overlap: Overlap between chunks
            header_levels: Number of header levels to split on
            
        Yields:
            Dict containing chunking results for each file
        """
        logger.info(f"Starting parallel chunking for knowledgebase: knowledgebase_id={knowledgebase_id}")
        
        # Initialize FileSplitter with the provided parameters
        if framework == "langchain":        
            self.file_splitter = LangchainFileSplitter(**kwargs)
            logger.info(f"Using LangchainFileSplitter with parameters: {kwargs}")
        elif framework == "chonkie":
            self.file_splitter = ChonkieFileSplitter(**kwargs)
            logger.info(f"Using ChonkieFileSplitter with parameters: {kwargs}")
        else:
            raise ValueError(f"Unsupported chunking framework: {framework}")
        
        try:                      
            chunk_run_id = self.memory_manager.chunking_manager.save_chunk_run_config(
                knowledgebase_id=knowledgebase_id,
                framework=framework,
                chunk_parameters=kwargs
            )
            
            # Get all parsed files from the knowledgebase
            files = self.memory_manager.knowledgebase_manager.get_parsed_files_by_knowledgebase_id(knowledgebase_id)
            
            # Filter out files that are folders or don't have parsed content
            valid_files = []
            for file in files:
                file_dict = dict(file)
                if file_dict['type'] == 'file' and file_dict['parsed_text']:
                    valid_files.append(file_dict)
            
            logger.info(f"Found {len(valid_files)} valid files to chunk out of {len(files)} total files")
            
            # Create tasks for parallel chunking of each file
            tasks = []
            for file in valid_files:
                task = self._chunk_single_file(
                    file,
                    chunk_run_id,
                )
                tasks.append(task)
            
            # Process files in parallel and yield results as they complete
            for task in asyncio.as_completed(tasks):
                try:
                    result = await task
                    yield result
                except Exception as e:
                    logger.error(f"Unexpected error in parallel chunking: {e}")
                    yield {"status": "failed", "error": f"Unexpected error: {str(e)}"}
            
        except Exception as e:
            logger.error(f"Error in chunk_all_files_in_knowledgebase: {e}")
            yield {"status": "failed", "error": f"Unexpected error: {str(e)}"}
    
    async def _chunk_single_file(self, file: Dict[str, Any], chunk_run_id: int) -> Dict[str, Any]:
        """Chunk a single file and save chunks to the database.
        
        Args:
            file: File dictionary from the database
            chunk_run_id: ID of the chunk_run record
            
        Returns:
            Dict containing chunking results
        """
        file_id = file['file_id']
        filename = file['filename']
        parsed_text = file['parsed_text']
        parse_run_id = file['parse_run_id']
        
        try:
            logger.info(f"Starting to chunk file: {filename} (ID: {file_id})")
            
            # Prepare metadata for the file
            metadata = {
                "file_id": file_id,
                "filename": filename,
                "filepath": file['filepath'],
                "parse_run_id": parse_run_id
            }
            
            # Split the file content into chunks
            documents = await asyncio.to_thread(self.file_splitter.split_text, parsed_text, metadata)
            
            if not documents:
                logger.warning(f"No chunks created for file: {filename}")
                return {
                    "file_id": file_id,
                    "filename": filename,
                    "status": "completed",
                    "chunks_count": 0,
                    "message": "No chunks created"
                }
            
            # Prepare chunks for database insertion
            chunks_to_insert = []
            for doc in documents:
                chunks_to_insert.append({
                    "chunk_id": doc.metadata["chunk_id"],
                    "file_id": file_id,
                    "parse_run_id": parse_run_id,
                    "chunk_run_id": chunk_run_id,
                    "content": doc.page_content,
                    "metadata": doc.metadata
                })
            
            # Save chunks to the chunks table
            chunks_added = self.memory_manager.chunking_manager.add_chunks(chunks_to_insert)
            
            logger.info(f"Chunked file: {filename}, chunks: {len(documents)}")
            
            return {
                "file_id": file_id,
                "parse_run_id": parse_run_id,
                "filename": filename,
                "status": "completed",
                "chunks_count": chunks_added,
                "chunk_run_id": chunk_run_id
            }
        except Exception as e:
            logger.exception(f"Error chunking file {filename}: {e}", stack_info=True)
            return {
                "file_id": file_id,
                "filename": filename,
                "status": "failed",
                "error": f"Chunking failed: {str(e)}"
            }
    
    async def upload_files(self, user_id: int, knowledge_base: str, files: List[UploadFile], directory: str = "") -> AsyncGenerator[Dict[str, Any], None]:
        """Upload and parse files in parallel, yield results as they complete.
        
        Args:
            user_id: User identifier
            knowledge_base: Knowledge base name
            files: List of UploadFile objects
            directory: Optional directory path
            
        Yields:
            Dict containing the result for each uploaded file
        """
        logger.info(f"Starting parallel upload pipeline: user_id={user_id}, knowledge_base={knowledge_base}, directory={directory}, file_count={len(files)}")
        
        self.file_uploader = FileUploader()
        upload_dir = get_upload_dir(user_id, knowledge_base, directory)
        os.makedirs(upload_dir, exist_ok=True)
        
        # Create tasks for parallel upload of each file
        tasks = []
        for file in files:
            task = self._upload_single_file(
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
                logger.error(f"Unexpected error in upload: {e}")
    
    async def _upload_single_file(self, knowledge_base: str, file: UploadFile, upload_dir: str) -> Dict[str, Any]:
        """Upload and parse a single file.
        
        Args:
            knowledge_base: Knowledge base name
            file: UploadFile object from FastAPI
            upload_dir: Directory to save the file
            
        Returns:
            Dict containing upload and parse results
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
            
            # Check if file is parsable
            file_ext = os.path.splitext(filename)[1].lower()
            if file_ext not in SUPPORTED_FORMATS:
                file_result["status"] = "failed"
                file_result["uploaded"] = False
                file_result["upload_error"] = "File type not supported"      
                logger.error(f"File {filename} is not supported")
                return file_result  
            
              
            # Step 3: Add file to database
            try:
                file_id = self.memory_manager.knowledgebase_manager.add_file_by_knowledgebase_name(
                    filename=filename,
                    filepath=file_path,
                    knowledgebase_name=knowledge_base,
                    file_size=file_size,
                    parentFolder=upload_dir
                )
                file_result["file_id"] = file_id
                file_result["uploaded"] = True
                logger.info(f"File uploaded successfully: {filename}")
            except Exception as e:
                file_result["status"] = "failed"
                file_result["uploaded"] = False
                file_result["upload_error"] = f"Failed to add file to database: {str(e)}"
                logger.error(f"Failed to add file {filename} to database: {e}")
                return file_result

        except Exception as e:
            # Create a result dictionary if file_result doesn't exist yet
            if 'file_result' not in locals():
                file_result = {
                    "uploaded": False,
                    "filename": filename,
                    "status": "failed",
                    "error": f"Unexpected error during upload: {str(e)}"
                }
            else:
                file_result["status"] = "failed"
                file_result["error"] = f"Unexpected error during upload: {str(e)}"
            logger.error(f"Unexpected error uploading file {filename}: {e}")
        
        return file_result

    async def index_all_chunks(self, indexer: Indexer, chunk_run_id: int, embedding_config_id: str, batch_size: int = 20) -> AsyncGenerator[Dict[str, Any], None]:
        """Index all chunks in a knowledgebase in parallel.
        
        Args:
            indexer: Indexer object to use for indexing
            chunk_run_id: ID of the chunk_run record
            embedding_config_id: ID of the embedding configure record
            batch_size: Batch size for indexing
            
        Yields:
            Dict containing indexing results for each chunk
        """
        success, fail_reason = self.memory_manager.index_manager.create_index_run(
            chunk_run_id=chunk_run_id,
            embedding_configure_id=embedding_config_id
        )
        if not success:
            yield {"status": "failed", "error": fail_reason}
            return

        
        self.indexer = indexer  
        self.indexer.delete_file_chunks()
        chunks = self.memory_manager.chunking_manager.get_chunks_by_chunk_run_id(chunk_run_id)
        if not chunks:
            logger.warning(f"No chunks found for chunk_run_id {chunk_run_id}")
            yield {"status": "failed", "error": "No chunks found"}

        # Create tasks for parallel indexing of each chunk batch
        tasks = []
        for i in range(0, len(chunks), batch_size):
            batch = chunks[i:i + batch_size]
            task = self._index_single_batch(
                batch,
            )
            tasks.append(task)
        
        # Process chunks in parallel and yield results as they complete
        for task in asyncio.as_completed(tasks):
            try:
                result = await task
                yield result
            except Exception as e:
                logger.error(f"Unexpected error in parallel indexing: {e}")
                yield {"status": "failed", "error": f"Unexpected error: {str(e)}"}

        self.indexer.save_index()

    async def _index_single_batch(self, batch: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Index a batch of chunks.
        
        Args:
            batch: List of chunk dictionaries
            
        Returns:
            Dict containing indexing results for the batch
        """
        try:
            docs = [Document(page_content=chunk["content"], id=chunk["chunk_id"], metadata=chunk["metadata"]) for chunk in batch]
            # Index the batch of chunks
            self.indexer.index_chunks(docs)
            
            return {
                "status": "success",
                "message": "Chunks indexed successfully"
            }
        except Exception as e:
            logger.exception(f"Unexpected error indexing batch: {e}", stack_info=True)
            return {"status": "failed", "error": f"Unexpected error: {str(e)}"}
        
