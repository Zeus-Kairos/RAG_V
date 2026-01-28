import os
import shutil
from typing import Any, Dict
import pymupdf.layout
import pymupdf4llm

from src.utils.logging_config import get_logger

logger = get_logger(__name__)

class PdfParser:
    """
    PDF parsing module that converts PDF files to markdown format using pymupdf4llm.
    """
    
    def parse(self, file_path: str) -> str:
        pass

    @classmethod
    def create(cls, parser: str, params: Dict[str, Any] = {}) -> "PdfParser":
        if parser == "pymupdf4llm":
            return PymuPdfParser(params)
        elif parser == "default":
            return PymuPdfParser(params)
        else:
            raise ValueError(f"Unknown PDF parser: {parser}")
            

class PymuPdfParser(PdfParser):
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
            embed_images=True,  # Embeds images directly as base64 in markdown.
            # image_path=image_dir,
            image_size_limit=0.05,  # Exclude small images below this size threshold.
            force_text=True,  # Include text overlapping images/graphics.
            margins=0,  # Specify page margins for text extraction.
            table_strategy="lines_strict",  # Strategy for table detection.
            ignore_code=False,  # If True, avoids special formatting for mono-spaced text.
            extract_words=False,  # Adds word-level data to each page dictionary.
        )


        return md_text
