import os
import shutil
from typing import Any, Dict
from markitdown import MarkItDown
from unstructured.partition.auto import partition
import pymupdf.layout
import pymupdf4llm
from pypdf import PdfReader
import pdfplumber
from docling.document_converter import DocumentConverter

from src.utils.logging_config import get_logger

logger = get_logger(__name__)

class BaseParser:
    """
    File parsing module that converts files to markdown format using different parsers.
    """
    
    # Parser registry to store parser classes with their names
    _parser_registry = {}
    
    def parse(self, file_path: str) -> str:
        pass

    @classmethod
    def register_parser(cls, name: str):
        """
        Decorator to register a parser class with a given name.
        
        Args:
            name: Name of the parser to register
            
        Returns:
            Decorator function
        """
        def decorator(parser_class):
            cls._parser_registry[name] = parser_class
            return parser_class
        return decorator

    @classmethod
    def create(cls, parser: str, params: Dict[str, Any] = {}) -> "BaseParser":
        if parser == "default":
            parser = "markitdown"
        
        if parser in cls._parser_registry:
            return cls._parser_registry[parser](params)
        else:
            raise ValueError(f"Unknown parser: {parser}")
            

@BaseParser.register_parser("pymupdf4llm")
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
            # image_path=image_dir,
            image_size_limit=0.01,  # Exclude small images below this size threshold.
            force_text=True,  # Include text overlapping images/graphics.
            margins=0,  # Specify page margins for text extraction.
            table_strategy="lines_strict",  # Strategy for table detection.
            ignore_code=False,  # If True, avoids special formatting for mono-spaced text.
            extract_words=False,  # Adds word-level data to each page dictionary.
            **self.parser_params
        )

        return md_text

@BaseParser.register_parser("markitdown")
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

@BaseParser.register_parser("unstructured")
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

@BaseParser.register_parser("pypdf")
class PyPdfParser(BaseParser):
    """
    PDF parsing module that converts PDF files to text using pypdf.  
    """
    def __init__(self, parameters: Dict[str, Any] = {}):
        self.parser_params = parameters
    
    def parse(self, file_path: str) -> str:
        """
        Parse a file and return the text content.
        
        Args:
            file_path: Path to the PDF file to parse
            
        Returns:
            Parsed text content as string
        """
        reader = PdfReader(file_path)
        if "keep_layout" in self.parser_params and self.parser_params["keep_layout"]:
            extraction_mode = "layout"
        else:
            extraction_mode = "plain"
        return "\n".join([page.extract_text(extraction_mode=extraction_mode) for page in reader.pages])

@BaseParser.register_parser("pdfplumber")
class PdfPlumberParser(BaseParser):
    """
    PDF parsing module that converts PDF files to text using pdfplumber.  
    """
    def __init__(self, parameters: Dict[str, Any] = {}):
        self.parser_params = parameters
    
    def parse(self, file_path: str) -> str:
        """
        Parse a file and return the text content.
        
        Args:
            file_path: Path to the PDF file to parse
            
        Returns:
            Parsed text content as string
        """
        with pdfplumber.open(file_path) as pdf:
                text = "\n".join([page.extract_text(**self.parser_params) for page in pdf.pages])
        return text

@BaseParser.register_parser("docling")
class DoclingParser(BaseParser):
    """
    File parsing module that converts files to text using docling.  
    """
    def __init__(self, parameters: Dict[str, Any] = {}):
        self.parser_params = parameters
    
    def parse(self, file_path: str) -> str:
        """
        Parse a file and return the text content.
        
        Args:
            file_path: Path to the PDF file to parse
            
        Returns:
            Parsed text content as string
        """
        converter = DocumentConverter()
        result = converter.convert(file_path)
        return result.document.export_to_markdown()
