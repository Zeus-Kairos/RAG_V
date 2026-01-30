import os
import shutil
from typing import Any, Dict
import pymupdf.layout
import pymupdf4llm
from markitdown import MarkItDown
from unstructured.partition.auto import partition

from src.utils.logging_config import get_logger

logger = get_logger(__name__)

class BaseParser:
    """
    File parsing module that converts files to markdown format using different parsers.
    """
    
    def parse(self, file_path: str) -> str:
        pass

    @classmethod
    def create(cls, parser: str, params: Dict[str, Any] = {}) -> "BaseParser":
        if parser == "pymupdf4llm":
            return PymuPdfParser(params)
        elif parser == "markitdown":
            return MarkitdownParser(params)
        elif parser == "unstructured":
            return UnstructuredParser(params)
        elif parser == "default":
            return MarkitdownParser(params)
        else:
            raise ValueError(f"Unknown parser: {parser}")
            

class PymuPdfParser(BaseParser):
    """
    PDF parsing module that converts PDF files to markdown format using pymupdf4llm.
    """
    def __init__(self, parameters: Dict[str, Any] = {}):
        self.parser_params = parameters
    
    def parse(self, file_path: str) -> str:
        """
        Parse a PDF file and return the markdown content.
        
        Args:
            file_path: Path to the PDF file to parse
            
        Returns:
            Parsed markdown content as string
        """                
        # Extract directory from file path
        # file_dir = os.path.dirname(file_path)
        # file_name = os.path.basename(file_path)
        # # Create images directory in the same directory as the file, using file name as subdirectory
        # image_dir = os.path.join(file_dir, f"{os.path.splitext(file_name)[0]}_images")
        # os.makedirs(image_dir, exist_ok=True)
        
        md_text = pymupdf4llm.to_markdown(
            doc=file_path,  # The file, either as a file path or a PyMuPDF Document.
            headers=False,  # Optional, disables header detection logic.
            footer=False,  # Optional, disables footer detection logic.
            page_chunks=False,  # If True, output is a list of page-specific dictionaries. Set to False for single string.
            show_progress=True,  # Displays a progress bar during processing.
            hdr_info=True,  # Optional, disables header detection logic.
            write_images=False,  # Saves images found in the document as files.
            embed_images=False,  # Embeds images directly as base64 in markdown.
            # image_path=image_dir,
            image_size_limit=0.01,  # Exclude small images below this size threshold.
            force_text=True,  # Include text overlapping images/graphics.
            margins=0,  # Specify page margins for text extraction.
            table_strategy="lines_strict",  # Strategy for table detection.
            ignore_code=False,  # If True, avoids special formatting for mono-spaced text.
            extract_words=False,  # Adds word-level data to each page dictionary.
        )

        return md_text

class MarkitdownParser(BaseParser):
    """
    PDF parsing module that converts PDF files to markdown format using markitdown4llm.
    """
    def __init__(self, parameters: Dict[str, Any] = {}):
        self.parser_params = parameters

    def parse(self, file_path: str) -> str:
        """
        Parse a file and return the markdown content.
        
        Args:
            file_path: Path to the file to parse
            
        Returns:
            Parsed markdown content as string
        """
        md = MarkItDown(enable_plugins=False) # Set to True to enable plugins
        result = md.convert(file_path)
        return result.text_content

class UnstructuredParser(BaseParser):
    """
    PDF parsing module that converts PDF files to markdown format using unstructured.
    """
    def __init__(self, parameters: Dict[str, Any] = {}):
        self.parser_params = parameters
    
    def parse(self, file_path: str) -> str:
        """
        Parse a file and return the markdown content.
        
        Args:
            file_path: Path to the file to parse
            
        Returns:
            Parsed markdown content as string
        """
        elements = partition(file_path)
        return "\n\n".join([str(el) for el in elements])
       
