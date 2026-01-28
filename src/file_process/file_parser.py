import os
import asyncio
import re
from typing import List, Dict, Any, Optional, Tuple
from markitdown import MarkItDown
from bs4 import BeautifulSoup
import html2text

from src.file_process.pdf_parser import PdfParser
from src.utils.logging_config import get_logger

logger = get_logger(__name__)

class FileParser:
    """
    File parsing module that converts uploaded files to markdown format.
    Supports Markdown, Plain Text, and HTML file types with batch processing capability.
    """
    
    def __init__(self, parameters: Dict[str, Any] = {}):
        self.markdownable_parser = MarkItDown(enable_plugins=False)
        self.parser_params = parameters
    
    def _read_file_with_encoding(self, file_path: str) -> str:
        """
        Read a text file trying multiple encodings in order of likelihood.
        
        Args:
            file_path: Path to the file to read
            
        Returns:
            File content as string
            
        Raises:
            UnicodeDecodeError: If all encodings fail
        """
        # Try encodings in order of likelihood
        encodings = [
            'utf-8',           # Most common modern encoding
            'windows-1252',    # Common for Windows files, especially HTML (handles byte 0xa0)
            'iso-8859-1',      # Latin-1, common fallback
        ]
        
        last_error = None
        for encoding in encodings:
            try:
                with open(file_path, 'r', encoding=encoding) as f:
                    content = f.read()
                logger.debug(f"Successfully read {file_path} with encoding: {encoding}")
                return content
            except UnicodeDecodeError as e:
                last_error = e
                logger.debug(f"Failed to read {file_path} with encoding {encoding}: {e}")
                continue
            except Exception as e:
                # For other errors (like file not found), re-raise immediately
                logger.error(f"Error reading file {file_path}: {e}")
                raise
        
        # If all encodings failed, try utf-8 with error handling as last resort
        logger.warning(f"All encodings failed for {file_path}, trying utf-8 with error replacement")
        try:
            with open(file_path, 'r', encoding='utf-8', errors='replace') as f:
                content = f.read()
            logger.warning(f"Read {file_path} with utf-8 and error replacement (some characters may be lost)")
            return content
        except Exception as e:
            logger.error(f"Final attempt to read {file_path} failed: {e}")
            raise UnicodeDecodeError(
                'utf-8',
                b'',
                0,
                1,
                f"Could not decode file {file_path} with any encoding. Last error: {last_error}"
            ) from last_error
    
    def detect_file_type(self, file_path: str) -> str:
        """
        Detect file type based on extension.
        """
        _, extension = os.path.splitext(file_path)
        extension = extension.lower()
        
        if extension in ['.md', '.markdown']:
            return 'markdown'
        elif extension in ['.txt', '.csv']:
            return 'text'
        elif extension in ['.html', '.htm']:
            return 'html'
        elif extension in ['.pdf']:
            return 'pdf'
        elif extension in ['.docx', '.pptx', '.xlsx']:
            return 'markdownable'
        else:
            return 'unknown'
    
    def parse_file(self, file_path: str) -> Dict[str, Any]:
        """
        Parse a single file based on its type and return the result.
        
        Args:
            file_path: Path to the file to parse
            
        Returns:
            Dict containing:
                - 'success': bool indicating if parsing succeeded
                - 'content': parsed markdown content (if successful)
                - 'original_file': path to original file
                - 'parsed_file': path to parsed file (if saved)
                - 'error': error message (if failed)
        """
        try:
            file_type = self.detect_file_type(file_path)
            
            parser = "default"
            params = {}
            parsed_content = None
            if file_type == 'markdown':
                content = self._read_file_with_encoding(file_path)
                parsed_content = self._parse_markdown(content)
            elif file_type == 'text':
                content = self._read_file_with_encoding(file_path)
                parsed_content = self._parse_text(content)
            elif file_type == 'html':
                content = self._read_file_with_encoding(file_path)
                parsed_content = self._parse_html(content)
            elif file_type == 'pdf':
                if "pdf" in self.parser_params:
                    parser = self.parser_params["pdf"].get("parser")
                    params = self.parser_params["pdf"].get("parameters")
                    parsed_content = self._parse_pdf(file_path, parser, params)
                else:
                    parsed_content = self._parse_pdf(file_path)
                # Check if we got a list of page chunks or a single string
                if isinstance(parsed_content, list):
                    logger.info(f"Parsed PDF content in {len(parsed_content)} pages")
                    parsed_content = '\n\n'.join([page['text'] for page in parsed_content])
                else:
                    # Single string case
                    logger.info(f"Parsed PDF content")
            elif file_type == 'markdownable':
                # For binary files, don't read them directly as text
                parsed_content = self._parse_markdownable(file_path)
            else:
                logger.warning(f"Unsupported file type for parsing: {file_path}")
                return {
                    'success': False,
                    'content': None,
                    'original_file': file_path,
                    'error': f"Unsupported file type: {file_type}"
                }
                            
            return {
                'success': True,
                'parser': parser,
                'parameters': params,
                'content': parsed_content,
                'original_file': file_path,
                'error': None
            }
                
        except Exception as e:
            logger.exception(f"Error parsing file {file_path}: {str(e)}", stack_info=True)
            return {
                'success': False,
                'content': None,
                'original_file': file_path,
                'error': str(e)
            }
    
    def _parse_markdown(self, content: str) -> str:
        """
        Parse Markdown content using MarkitDown.
        """
        return content
    
    def _parse_text(self, content: str) -> str:
        """
        Parse Plain Text content into Markdown format.
        """
        if not content.strip():
            return ''
        
        # Convert newlines to markdown line breaks
        content = content.replace('\r\n', '\n')
        return content
    
    def _parse_html(self, content: str) -> str:
        """
        Parse HTML content using BeautifulSoup4 to handle malformed HTML, then convert to text using html2text.
        Creates a new HTML2Text instance for each call to ensure thread safety.
        """        
        # Use BeautifulSoup to handle malformed HTML
        soup = BeautifulSoup(content, 'html.parser')
        # Get the cleaned HTML
        cleaned_html = str(soup)
        
        # Create a new HTML2Text instance for each call to ensure thread safety
        converter = html2text.HTML2Text()
        converter.ignore_links = False
        converter.ignore_images = False
        converter.body_width = 0  # No line wrapping
        
        # Convert to markdown using html2text
        return converter.handle(cleaned_html)

    def _parse_pdf(self, file_path: str, parser: str = "default", params: Dict[str, Any] = {}) -> str:
        """
        Parse PDF content using the injected PdfParser.
        """

        pdf_parser = PdfParser.create(parser, params)

        logger.info(f"Using PDF parser: {pdf_parser.__class__.__name__}")
        
        return pdf_parser.parse(file_path)


    def _parse_markdownable(self, file_path: str) -> str:
        """
        Parse Markdownable content using MarkitDown.
        """
        return self.markdownable_parser.convert(file_path).text_content
    
    async def parse_batch(self, file_paths: List[str], save: bool = True) -> Dict[str, Any]:
        """
        Parse multiple files in batch using asyncio.
        
        Args:
            file_paths: List of paths to files to parse
            save: Whether to save parsed content to disk
            
        Returns:
            Dict containing:
                - 'results': Dict mapping original file paths to their parsing results
                - 'original_to_parsed': Dict mapping original file paths to parsed file paths
                - 'parsed_to_original': Dict mapping parsed file paths to original file paths
                - 'summary': Summary statistics about the batch parsing
        """
        results = {}
        original_to_parsed = {}
        parsed_to_original = {}
        success_count = 0
        failure_count = 0
        saved_count = 0
        
        async def parse_file_async(file_path):
            result = self.parse_file(file_path, save=save)
            return file_path, result
        
        tasks = [parse_file_async(file_path) for file_path in file_paths]
        completed_tasks = await asyncio.gather(*tasks, return_exceptions=True)
        
        for file_path, result in completed_tasks:
            if isinstance(result, Exception):
                results[file_path] = {
                    'success': False,
                    'content': None,
                    'original_file': file_path,
                    'parsed_file': None,
                    'error': str(result)
                }
                failure_count += 1
                logger.error(f"Error parsing file {file_path}: {str(result)}")
            else:
                results[file_path] = result
                if result['success']:
                    success_count += 1
                    if save and result['parsed_file']:
                        original_to_parsed[file_path] = result['parsed_file']
                        parsed_to_original[result['parsed_file']] = file_path
                        saved_count += 1
                else:
                    failure_count += 1
        
        return {
            'results': results,
            'original_to_parsed': original_to_parsed,
            'parsed_to_original': parsed_to_original,
            'summary': {
                'total_files': len(file_paths),
                'successful_parsing': success_count,
                'failed_parsing': failure_count,
                'saved_parsed_files': saved_count
            }
        }

    