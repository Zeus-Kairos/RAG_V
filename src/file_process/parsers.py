import os
import shutil
import tempfile
from typing import Any, Dict

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
        import pymupdf4llm

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
        from markitdown import MarkItDown

        md = MarkItDown(enable_plugins=False) # Set to True to enable plugins
        result = md.convert(file_path)
        return result.markdown

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
            file_path: Path to the PDF file to parse
            
        Returns:
            Parsed markdown content as string
        """
        from unstructured.partition.pdf import partition_pdf
        from unstructured.partition.auto import partition

        if file_path.endswith(".pdf"):
            elements = partition_pdf(file_path, strategy="auto")
        else:
            elements = partition(file_path)
        return "\n\n".join([str(el) for el in elements])

@BaseParser.register_parser("pymupdf")
class PyMuPdfTextParser(BaseParser):
    """
    PDF parsing module that converts PDF files to text using PyMuPDF.
    """
    def __init__(self, parameters: Dict[str, Any] = {}):
        self.parser_params = parameters

    def parse(self, file_path: str) -> str:
        """
        Parse a PDF file and return extracted text from all pages.

        Args:
            file_path: Path to the PDF file to parse

        Returns:
            Extracted text content as string
        """
        import pymupdf

        page_texts = []
        with pymupdf.open(file_path) as doc:
            for page in doc:
                page_texts.append(page.get_text(**self.parser_params))

        return "\n".join(page_texts)

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
        from pypdf import PdfReader

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
        import pdfplumber

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
        from docling.datamodel.base_models import InputFormat
        from docling.document_converter import DocumentConverter, PdfFormatOption
        from docling.datamodel.pipeline_options import PdfPipelineOptions

        if file_path.endswith(".pdf"):
            pipeline_options = PdfPipelineOptions()
            pipeline_options.do_ocr = self.parser_params.get("ocr_enable", False)
            pipeline_options.do_table_structure = self.parser_params.get("table_enable", True)
            pipeline_options.do_formula_enrichment = self.parser_params.get("formula_enable", True)
            pipeline_options.do_code_enrichment = self.parser_params.get("code_enable", False)
            converter = DocumentConverter(format_options={
                InputFormat.PDF: PdfFormatOption(pipeline_options=pipeline_options)})
            try:
                result = converter.convert(file_path)
                return result.document.export_to_markdown()
            except Exception as exc:
                logger.warning(
                    "Docling failed for PDF %s; trying repaired copy. Error: %s",
                    file_path,
                    str(exc),
                )
                repaired_pdf = self._repair_pdf_for_docling(file_path)
                try:
                    result = converter.convert(repaired_pdf)
                    logger.info("Docling succeeded on repaired PDF copy: %s", file_path)
                    return result.document.export_to_markdown()
                finally:
                    try:
                        os.remove(repaired_pdf)
                    except Exception:
                        logger.debug("Failed to remove temporary repaired PDF: %s", repaired_pdf)

        converter = DocumentConverter()
        result = converter.convert(file_path)
        return result.document.export_to_markdown()

    def _repair_pdf_for_docling(self, file_path: str) -> str:
        """Rewrite PDF pages to normalize page boxes so Docling can read dimensions."""
        from pypdf import PdfReader, PdfWriter

        fd, repaired_path = tempfile.mkstemp(suffix=".pdf", prefix="docling_repaired_")
        os.close(fd)

        reader = PdfReader(file_path)
        writer = PdfWriter()
        for page in reader.pages:
            writer.add_page(page)

        with open(repaired_path, "wb") as repaired_file:
            writer.write(repaired_file)

        return repaired_path

@BaseParser.register_parser("mineru")
class MineruParser(BaseParser):
    """
    File parsing module that converts files to markdown format using mineru.
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
        from pathlib import Path
        from src.file_process.mineru_parse import parse_doc
        import tempfile
        
        # Create a temporary directory for output
        with tempfile.TemporaryDirectory() as temp_dir:
            # Call parse_doc with the file path
            markdown_strings = parse_doc(
                path_list=[Path(file_path)],
                output_dir=temp_dir,
                backend=self.parser_params.get("backend", "pipeline"),
                method=self.parser_params.get("method", "auto"),
                lang=self.parser_params.get("lang", "en"),
                **self.parser_params
            )
            # Return the first markdown string (since we're parsing a single file)
            return markdown_strings[0] if markdown_strings else ""
