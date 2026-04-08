from __future__ import annotations

import re
from dataclasses import asdict
from typing import Any

from src.file_process.multimodal_splitter_helpers import (
    image_url_for_vision,
    markdown_image_target,
)
from src.utils.llm_helpers import (
    complete_chat,
    llm_env_configured_general_preferred,
    llm_env_configured_multimodal_preferred,
    resolve_llm_general_preferred,
    resolve_llm_multimodal_preferred,
)


class BaseFileSplitter:
    """Base file splitter class that uses a registry pattern for splitter types.
    
    This class provides a registry for different splitter implementations
    and a create method to instantiate them by type.
    """
    
    # Splitter registry to store splitter classes with their names
    _splitter_registry = {}
    
    def __init_subclass__(cls, splitter_name: str, **kwargs):
        """Automatically register subclasses when they are defined.
        
        Args:
            splitter_name: Name of the splitter class
            **kwargs: Additional keyword arguments
        """
        super().__init_subclass__(**kwargs)
        BaseFileSplitter._splitter_registry[splitter_name] = cls
    
    def split_text(self, text: str, metadata: dict = None) -> list[Any]:
        """Split text into chunks.
        
        Args:
            text: Text to split
            metadata: Metadata to attach to chunks
            
        Returns:
            List of Document objects
        """
        raise NotImplementedError("Subclasses must implement split_text method")
    
    @classmethod
    def register_splitter(cls, name: str):
        """
        Decorator to register a splitter class with a given name.
        
        Args:
            name: Name of the splitter to register
            
        Returns:
            Decorator function
        """
        def decorator(splitter_class):
            cls._splitter_registry[name] = splitter_class
            return splitter_class
        return decorator
    
    @classmethod
    def create(cls, splitter_type: str, **kwargs) -> "BaseFileSplitter":
        """
        Create a splitter instance based on the splitter type.
        
        Args:
            splitter_type: Type of splitter to create
            **kwargs: Additional keyword arguments for splitter initialization
            
        Returns:
            A splitter instance
        """
        if splitter_type in cls._splitter_registry:
            return cls._splitter_registry[splitter_type](**kwargs)
        else:
            raise ValueError(f"Unknown splitter type: {splitter_type}")
    
    @classmethod
    def get_splitter_names(cls) -> list[str]:
        """
        Get all discovered splitter names.
        
        Returns:
            A list of splitter names
        """
        return list(cls._splitter_registry.keys())


class LangchainFileSplitter(BaseFileSplitter, splitter_name="langchain"):
    """Splitter that uses Langchain's text splitters."""
    
    def __init__(self, **kwargs):
        from langchain_text_splitters import MarkdownHeaderTextSplitter, RecursiveCharacterTextSplitter

        # Use chunkers parameter similar to ChonkieFileSplitter
        self.chunkers = kwargs.get("chunkers", [
            {"chunker": "markdown_header", "params": {"header_levels": 3, "strip_headers": False}},
            {"chunker": "recursive", "params": {"chunk_size": 500, "chunk_overlap": 50}}
        ])
        
        # Initialize splitters based on chunkers configuration
        self.splitters = []
        for chunker in self.chunkers:
            if chunker["chunker"] == "markdown_header":
                header_levels = chunker["params"].get("header_levels", 3)
                headers_to_split_on = [("#"*i, f"Header {i}") for i in range(1, header_levels + 1)]
                strip_headers = chunker["params"].get("strip_headers", False)
                self.splitters.append({
                    "type": "markdown_header",
                    "splitter": MarkdownHeaderTextSplitter(headers_to_split_on, strip_headers=strip_headers)
                })
            elif chunker["chunker"] == "recursive":
                chunk_size = chunker["params"].get("chunk_size", 500)
                chunk_overlap = chunker["params"].get("chunk_overlap", 50)
                self.splitters.append({
                    "type": "recursive",
                    "splitter": RecursiveCharacterTextSplitter(
                        chunk_size=chunk_size, chunk_overlap=chunk_overlap, 
                        separators=["\n\n", "\n", " "], 
                        keep_separator=True,
                        strip_whitespace=False)
                })
    
    def split_text(self, text: str, metadata: dict = None) -> list[Any]:
        from langchain_core.documents import Document

        # Fix mutable default argument issue
        if metadata is None:
            metadata = {}
        
        # Initial document
        current_docs = [Document(page_content=text, metadata=metadata)]
        
        # Apply each splitter in sequence
        for splitter_config in self.splitters:
            if splitter_config["type"] == "markdown_header":
                new_docs = []
                for doc in current_docs:
                    new_docs.extend(splitter_config["splitter"].split_text(doc.page_content))
                    # Merge metadata
                    for new_doc in new_docs[-len(splitter_config["splitter"].split_text(doc.page_content)):]:
                        new_doc.metadata = {**new_doc.metadata, **doc.metadata}
                current_docs = new_docs
            elif splitter_config["type"] == "recursive":
                new_docs = []
                for doc in current_docs:
                    new_docs.extend(splitter_config["splitter"].split_documents([doc]))
                current_docs = new_docs
        
        # Add chunk_id to each document
        documents = []
        chunk_index = 0
        file_id = metadata.get("file_id", "")
        for doc in current_docs:
            doc.metadata = {
                **doc.metadata,
                "chunk_id": f"{file_id}_{chunk_index}",
                **metadata
            }
            chunk_index += 1
            documents.append(doc)
        
        return documents


class ChonkieFileSplitter(BaseFileSplitter, splitter_name="chonkie"):
    """Splitter that uses Chonkie's pipeline for chunking."""
    
    def __init__(self, **kwargs):
        self.chunkers = kwargs.get("chunkers", None)
        self.chef = kwargs.get("chef", "markdown")
        # Validate chef parameter
        if self.chef not in ["markdown", "text", "table"]:
            raise ValueError(f"Invalid chef parameter: {self.chef}. Must be one of: markdown, text, table")
    
    def split_text(self, text: str, metadata: dict = None) -> list[Any]:
        from chonkie import Pipeline
        from langchain_core.documents import Document

        pipeline = Pipeline().process_with(self.chef)
        for chunker in self.chunkers:
            pipeline = pipeline.chunk_with(chunker["chunker"], **chunker["params"])
        doc = pipeline.run(text)
        chunks = getattr(doc, 'chunks', [])
        images = getattr(doc, 'images', [])
        tables = getattr(doc, 'tables', [])
        codes = getattr(doc, 'code', [])
        chunk_tuples = [(chunk.start_index, "text", chunk.text, {k: v for k, v in chunk.to_dict().items() if k != "text"}) for chunk in chunks]
        image_tuples = [(image.start_index, "image", image.content, {k: v for k, v in asdict(image).items() if k != "content"}) for image in images]
        table_tuples = [(table.start_index, "table", table.content, {k: v for k, v in asdict(table).items() if k != "content"}) for table in tables]
        code_tuples = [(code.start_index, "code", code.content, {k: v for k, v in asdict(code).items() if k != "content"}) for code in codes]
        
        # Merge all tuples
        all_tuples = chunk_tuples + image_tuples + table_tuples + code_tuples
        
        # Sort by start index
        all_tuples.sort(key=lambda x: x[0])
        
        documents = []
        chunk_index = 0
        file_id = metadata.get("file_id", "")
        for _, chunk_type, content, chunk_meta in all_tuples:
            document = Document(page_content=content, 
                        metadata={
                            "chunk_type": chunk_type,
                            **chunk_meta,
                            "chunk_id": f"{file_id}_{chunk_index}",
                            **metadata
                        })
            chunk_index += 1
            documents.append(document)
        return documents


# Docling parses Markdown before chunking; ``\\`` is a hard line break and breaks LaTeX row
# separators inside math. Private-use chars are unlikely in source text and survive round-trip.
_DOCLING_LTX_BS_MARKER = "\uE000\uE001\uE002"


def _mask_latex_double_backslash_in_math(text: str) -> str:
    """Replace ``\\\\`` (LaTeX row / alignment) inside math spans so MD parsing does not alter it."""

    def sub_pairs(s: str) -> str:
        return re.sub(r"\\\\", _DOCLING_LTX_BS_MARKER, s)

    parts = text.split("$$")
    for i in range(1, len(parts), 2):
        parts[i] = sub_pairs(parts[i])

    def mask_block(seg: str, o: str, c: str) -> str:
        esc_o, esc_c = re.escape(o), re.escape(c)
        pat = re.compile(esc_o + r"(.*?)" + esc_c, re.DOTALL)

        def repl(m: re.Match) -> str:
            return o + sub_pairs(m.group(1)) + c

        return pat.sub(repl, seg)

    for i in range(0, len(parts), 2):
        s = parts[i]
        s = mask_block(s, r"\[", r"\]")
        s = mask_block(s, r"\(", r"\)")
        parts[i] = s

    return "$$".join(parts)


def _restore_latex_double_backslash(text: str) -> str:
    return text.replace(_DOCLING_LTX_BS_MARKER, "\\\\")


class DoclingSplitter(BaseFileSplitter, splitter_name="docling"):
    """Splitter that uses Docling's HybridChunker for chunking."""
    
    def __init__(self, **kwargs):
        self.parser_params = kwargs

    def split_text(self, text: str, metadata: dict = None) -> list[Any]:
        try:
            from docling.chunking import HybridChunker
            from docling.datamodel.base_models import InputFormat
            from docling.document_converter import DocumentConverter
        except Exception as exc:  # pragma: no cover
            raise ImportError(
                "DoclingSplitter requires 'docling' and its dependencies. "
                "Install the docling extra/deps (e.g. numpy/pandas) or use a different splitter."
            ) from exc

        from langchain_core.documents import Document

        filename = metadata.get("filename", None)
        masked = _mask_latex_double_backslash_in_math(text)
        converter = DocumentConverter()
        doc = converter.convert_string(masked, InputFormat.MD, filename).document

        chunker = HybridChunker(**self.parser_params)
        chunks = chunker.chunk(doc)
        documents = []
        chunk_index = 0
        file_id = metadata.get("file_id", "")
        for chunk in chunks:
            document = Document(page_content=_restore_latex_double_backslash(chunk.text), 
                        metadata={
                            **chunk.meta.export_json_dict(),
                            "chunk_id": f"{file_id}_{chunk_index}",
                            **metadata
                        })
            chunk_index += 1
            documents.append(document)
        return documents

class HybridSplitter(BaseFileSplitter, splitter_name="hybrid"):
    """Splitter that uses Langchain and Chonkie for chunking."""

    def __init__(self, **kwargs):
        self.parser_params = kwargs
        self._table_chunker = None
        self._contextual_headers = bool(self.parser_params.get("contextual_headers", False))
        self._doc_augmentation = bool(self.parser_params.get("doc_augmentation", False))
        try:
            self._augmentation_question_count = int(self.parser_params.get("augmentation_question_count", 1))
        except Exception:
            self._augmentation_question_count = 1
        self._augmentation_question_count = max(1, min(10, self._augmentation_question_count))

    def split_text(self, text: str, metadata: dict = None) -> list[Any]:
        """Split text into chunks.
        
        Args:
            text: Text to split
            metadata: Metadata to attach to chunks
            
        Returns:
            List of Document objects
        """
        from chonkie import Pipeline
        from langchain_core.documents import Document
        from langchain_text_splitters import MarkdownHeaderTextSplitter

        # Initialize TableChunker only when explicitly enabled (UI sends table_chunk_enabled).
        # If table_chunk_enabled is absent, keep legacy behavior: default size 3 when flag not used.
        self._table_chunker = None
        table_chunk_enabled = self.parser_params.get("table_chunk_enabled")
        if table_chunk_enabled is False:
            pass
        else:
            table_chunk_size = self.parser_params.get("table_chunk_size", 3)
            table_tokenizer = self.parser_params.get("table_tokenizer", "row")
            try:
                from chonkie import TableChunker

                self._table_chunker = TableChunker(tokenizer=table_tokenizer, chunk_size=table_chunk_size)
            except Exception:
                pass

        header_levels = self.parser_params.get("header_levels", 3)
        headers_to_split_on = [("#"*i, f"Header {i}") for i in range(1, header_levels + 1)]
        strip_headers = self.parser_params.get("strip_headers", True)
        markdown_splitter = MarkdownHeaderTextSplitter(headers_to_split_on, strip_headers=strip_headers)
        docs = markdown_splitter.split_text(text)

        chunk_size = self.parser_params.get("chunk_size", 1000)
        pipeline = Pipeline().process_with("markdown").chunk_with("recursive", chunk_size=chunk_size)

        chunk_index = 0
        documents = []
        for doc in docs:
            splits, chunk_index = self._split_pipeline(pipeline, doc, chunk_index, metadata)
            documents.extend(splits)

        if self._doc_augmentation:
            documents, _chunk_index = self._augment_documents_with_questions(
                documents,
                start_chunk_index=chunk_index,
                metadata=metadata,
            )
            chunk_index = _chunk_index
        return documents

    def _contextual_header_prefix_for_meta(self, meta: dict[str, Any]) -> str:
        if not meta:
            return ""
        headers: list[tuple[int, str]] = []
        for k, v in meta.items():
            if not isinstance(k, str):
                continue
            m = re.match(r"^Header\s+(\d+)$", k)
            if not m:
                continue
            if v is None:
                continue
            val = str(v).strip()
            if not val:
                continue
            level = int(m.group(1))
            headers.append((level, val))
        if not headers:
            return ""
        headers.sort(key=lambda x: x[0])
        # Use markdown headings to preserve structure for retrieval.
        lines = [("#" * lvl) + " " + txt for (lvl, txt) in headers]
        return "\n".join(lines).strip()

    def _split_pipeline(self, pipeline: Any, doc: Any, chunk_index: int, metadata: dict) -> tuple[list[Any], int]:
        """Split document into recursive chunks with Chonkie pipeline.
        
        Args:
            pipeline: Chonkie pipeline to use for chunking
            doc: Document to split
            chunk_index: Current chunk index
            metadata: Metadata to attach to chunks
            
        Returns:
            List of Document objects and updated chunk_index
        """
        from langchain_core.documents import Document

        document = pipeline.run(doc.page_content)
        chunks = getattr(document, 'chunks', [])
        images = getattr(document, 'images', [])
        tables = getattr(document, 'tables', [])
        codes = getattr(document, 'code', [])
        chunk_tuples = [(chunk.start_index, "text", chunk.text, {k: v for k, v in chunk.to_dict().items() if k != "text"}) for chunk in chunks]
        image_tuples = [(image.start_index, "image", image.content, {k: v for k, v in asdict(image).items() if k != "content"}) for image in images]
        table_tuples = []
        for table in tables:
            base_meta = {k: v for k, v in asdict(table).items() if k != "content"}
            parts = self._chunk_table(table.content)
            total = len(parts)
            for part_index, part in enumerate(parts):
                part_meta = {**base_meta, "table_chunk_index": part_index, "table_chunk_count": total}
                table_tuples.append((table.start_index, "table", part, part_meta))
        code_tuples = [(code.start_index, "code", code.content, {k: v for k, v in asdict(code).items() if k != "content"}) for code in codes]
    
        # Merge all tuples
        all_tuples = chunk_tuples + image_tuples + table_tuples + code_tuples
    
        # Sort by start index
        all_tuples.sort(key=lambda x: x[0])
    
        file_id = metadata.get("file_id", "")
        documents = []
        for _, chunk_type, content, chunk_meta in all_tuples:
            page = content
            if self._contextual_headers:
                prefix = self._contextual_header_prefix_for_meta({**getattr(doc, "metadata", {}), **(chunk_meta or {})})
                if prefix:
                    page = f"{prefix}\n\n{content}"
            document = Document(page_content=page, 
                    metadata={
                        "chunk_id": f"{file_id}_{chunk_index}",
                        "chunk_type": chunk_type,
                        **doc.metadata,
                        **chunk_meta,                         
                        **metadata
                    })
            chunk_index += 1
            documents.append(document)
        return documents, chunk_index

    def _llm_credentials_ok(self) -> bool:
        return llm_env_configured_general_preferred()

    def _generate_questions_for_chunk(self, chunk_text: str, count: int) -> list[str]:
        if not self._llm_credentials_ok():
            return []
        api_url, api_key, model = resolve_llm_general_preferred()
        n = max(1, min(10, int(count)))
        messages = [
            {
                "role": "system",
                "content": (
                    "You generate user questions for retrieval augmentation. "
                    "Return ONLY a JSON array of strings (questions). "
                    "No preamble, no markdown, no keys."
                ),
            },
            {
                "role": "user",
                "content": (
                    f"Generate {n} short, specific questions that this chunk can answer.\n\n"
                    f"Chunk:\n{chunk_text}"
                ),
            },
        ]
        raw = complete_chat(api_url, api_key, model, messages)
        if not raw:
            return []
        raw = raw.strip()
        # Prefer JSON array; fall back to line parsing.
        try:
            import json

            data = json.loads(raw)
            if isinstance(data, list):
                out = []
                for x in data:
                    if isinstance(x, str) and x.strip():
                        out.append(x.strip())
                return out[:n]
        except Exception:
            pass

        # Fallback: split on newlines, strip bullets/numbering.
        lines = []
        for line in raw.splitlines():
            s = line.strip()
            if not s:
                continue
            s = re.sub(r"^\s*[-*]\s*", "", s)
            s = re.sub(r"^\s*\d+[\).\s-]+\s*", "", s)
            if s:
                lines.append(s)
        return lines[:n]

    def _augment_documents_with_questions(
        self,
        documents: list[Any],
        *,
        start_chunk_index: int,
        metadata: dict | None,
    ) -> tuple[list[Any], int]:
        from langchain_core.documents import Document

        if not documents:
            return documents, start_chunk_index

        file_id = (metadata or {}).get("file_id", "")
        out_docs = list(documents)
        chunk_index = start_chunk_index
        n = self._augmentation_question_count

        for doc in documents:
            try:
                meta = getattr(doc, "metadata", {}) or {}
                if meta.get("chunk_type") != "text":
                    continue
                chunk_text = getattr(doc, "page_content", "") or ""
                if not chunk_text.strip():
                    continue
                questions = self._generate_questions_for_chunk(chunk_text, n)
                for qi, q in enumerate(questions):
                    aug_meta = {
                        "chunk_id": f"{file_id}_{chunk_index}",
                        "chunk_type": "augment",
                        "source_chunk_id": meta.get("chunk_id"),
                        "source_chunk_content": chunk_text,
                        "augment_index": qi,
                        "augment_count": len(questions),
                        **(metadata or {}),
                    }
                    out_docs.append(Document(page_content=q, metadata=aug_meta))
                    chunk_index += 1
            except Exception:
                # Best-effort augmentation: never fail the base chunking run.
                continue

        return out_docs, chunk_index

    def _chunk_table(self, table_content: str) -> list[str]:
        if not table_content:
            return []
        if self._table_chunker is None:
            return [table_content]
        try:
            return [c.text for c in self._table_chunker.chunk(table_content)]
        except Exception:
            return [table_content]


class MultiModalSplitter(HybridSplitter, splitter_name="multimodal"):
    """Like HybridSplitter (header split + Chonkie markdown/recursive), but tables stay whole.

    Optional: LLM summary of each full table (for embedding), and optional VLM description
    of each image. Uses MULTIMODAL_LLM_* when set; otherwise falls back to general
    LLM_BASE_URL, LLM_MODEL, optional LLM_API_KEY.
    """

    def __init__(self, **kwargs):
        super().__init__(**{**kwargs, "table_chunk_enabled": False})

    def _llm_credentials_ok(self) -> bool:
        return llm_env_configured_multimodal_preferred()

    def _summarize_table(self, table_markdown: str) -> str | None:
        if not self._llm_credentials_ok():
            return None
        api_url, api_key, model = resolve_llm_multimodal_preferred()
        messages = [
            {
                "role": "system",
                "content": (
                    "You summarize Markdown tables for semantic search. "
                    "Output a concise paragraph in the same language as the table when possible. "
                    "Capture structure, key entities, metrics, and relationships. No preamble."
                ),
            },
            {
                "role": "user",
                "content": f"Summarize this table for retrieval:\n\n{table_markdown}",
            },
        ]
        return complete_chat(
            api_url,
            api_key,
            model,
            messages,
        )

    def _describe_image(self, image_markdown: str, file_path: str | None) -> str | None:
        if not self._llm_credentials_ok():
            return None
        target = markdown_image_target(image_markdown)
        if not target:
            return None
        image_url = image_url_for_vision(target, file_path)
        if not image_url:
            return None
        api_url, api_key, model = resolve_llm_multimodal_preferred()
        messages = [
            {
                "role": "system",
                "content": (
                    "You describe images for document retrieval. "
                    "Output a concise factual description: subject, text (if any), charts/tables, "
                    "and purpose. Same language as visible text when possible. No preamble."
                ),
            },
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "Describe this image for search indexing."},
                    {"type": "image_url", "image_url": {"url": image_url}},
                ],
            },
        ]
        return complete_chat(
            api_url,
            api_key,
            model,
            messages,
        )

    def _split_pipeline(self, pipeline: Any, doc: Any, chunk_index: int, metadata: dict) -> tuple[list[Any], int]:
        from langchain_core.documents import Document

        document = pipeline.run(doc.page_content)
        chunks = getattr(document, "chunks", [])
        images = getattr(document, "images", [])
        tables = getattr(document, "tables", [])
        codes = getattr(document, "code", [])
        chunk_tuples = [
            (chunk.start_index, "text", chunk.text, {k: v for k, v in chunk.to_dict().items() if k != "text"})
            for chunk in chunks
        ]
        image_tuples = [
            (image.start_index, "image", image.content, {k: v for k, v in asdict(image).items() if k != "content"})
            for image in images
        ]
        table_tuples = []
        for table in tables:
            base_meta = {k: v for k, v in asdict(table).items() if k != "content"}
            parts = self._chunk_table(table.content)
            total = len(parts)
            for part_index, part in enumerate(parts):
                part_meta = {**base_meta, "table_chunk_index": part_index, "table_chunk_count": total}
                table_tuples.append((table.start_index, "table", part, part_meta))
        code_tuples = [
            (code.start_index, "code", code.content, {k: v for k, v in asdict(code).items() if k != "content"})
            for code in codes
        ]

        all_tuples = chunk_tuples + image_tuples + table_tuples + code_tuples
        all_tuples.sort(key=lambda x: x[0])

        file_id = metadata.get("file_id", "")
        fp = metadata.get("file_path")
        table_llm = bool(self.parser_params.get("table_llm_enabled"))
        image_vlm = bool(self.parser_params.get("image_vlm_enabled"))

        documents = []
        for _, chunk_type, content, chunk_meta in all_tuples:
            page = content
            mm_meta: dict[str, Any] = {}
            if chunk_type == "table" and table_llm:
                summary = self._summarize_table(content)
                if summary:
                    mm_meta["table_markdown_original"] = content
                    mm_meta["multimodal_table_summary"] = True
                    page = summary
                else:
                    mm_meta["multimodal_table_summary"] = False
            elif chunk_type == "image" and image_vlm:
                desc = self._describe_image(content, fp)
                if desc:
                    mm_meta["image_markdown_original"] = content
                    mm_meta["multimodal_image_description"] = True
                    page = desc
                else:
                    mm_meta["multimodal_image_description"] = False

            document = Document(
                page_content=page,
                metadata={
                    "chunk_id": f"{file_id}_{chunk_index}",
                    "chunk_type": chunk_type,
                    **doc.metadata,
                    **chunk_meta,
                    **mm_meta,
                    **metadata,
                },
            )
            chunk_index += 1
            documents.append(document)
        return documents, chunk_index


if __name__ == "__main__":

    text = """
        APPLICATION NOTE 

**N8480 Series Power Sensors** 

Upgrade your 8480 Power Sensor to the N8480 Series 


![](uploads/1/test_kb/origin/N8480 Series Power Sensors_images/N8480 Series Power Sensors.pdf-0001-03.png)


## **Table of Contents** 

A New Thermocouple Power Sensor for Average or Complex Modulations Power Measurement .............. 3 

Introduction ................................................................................................................................................... 4 N8480 Series Power Sensors ....................................................................................................................... 5 Key Specifications and Features .................................................................................................................. 7 Step-by-Step Migration Guide from 8480 to N848x with EPM Power Meter .............................................. 20 Conclusion .................................................................................................................................................. 24 References .................................................................................................................................................. 24 Related Literatures ...................................................................................................................................... 25 Related Links .............................................................................................................................................. 25 


![](uploads/1/test_kb/origin/N8480 Series Power Sensors_images/N8480 Series Power Sensors.pdf-0002-03.png)


## **A New Thermocouple Power Sensor for Average or Complex Modulations Power Measurement** 

Keysight Technologies, Inc. is introducing the N8480 Series power sensors to replace its legacy 8480 Series power sensor (excluding the D-model sensor). The new N8480 Series power sensors offers new features, including a built-in EEPROM, better dynamic range up to 55 dB, better measurement accuracy and repeatability, as well as backward compatibility with existing Keysight power meters. 

This document compares the legacy 8480 and the new N8480 power sensors. It also outlines the stepby-step migration from the 8480 to the N8480 Series with the EPM power meter.
    """

    print("Available splitters:", BaseFileSplitter.get_splitter_names())

    print("\n\nTesting ChonkieFileSplitter:")
    splitter = BaseFileSplitter.create("chonkie", chunkers=[
        # {"chunker": "recursive", "params": {"chunk_size": 200}},
        {"chunker": "sentence", "params": {"chunk_size": 1000, "chunk_overlap": 100}},
        # {"chunker": "semantic", "params": {"chunk_size":100, "threshold":0.8, "similarity_window":3}}
    ])
    splits = splitter.split_text(text, metadata={"file_id": 1})
    for split in splits:
        print(split)

    print("\n\nTesting DoclingSplitter:")
    docling_splitter = BaseFileSplitter.create("docling")
    docling_splits = docling_splitter.split_text(text, metadata={"file_id": 1, "filename": "test.md"})
    for split in docling_splits:
        print(split)
    
    print("\n\nTesting LangchainFileSplitter with default chunkers:")
    langchain_splitter = BaseFileSplitter.create("langchain")
    langchain_splits = langchain_splitter.split_text(text, metadata={"file_id": 2})
    for split in langchain_splits:
        print(split)
    
    print("\n\nTesting LangchainFileSplitter with custom chunkers:")
    custom_langchain_splitter = BaseFileSplitter.create("langchain", chunkers=[
        {"chunker": "markdown_header", "params": {"header_levels": 2, "strip_headers": True}},
        {"chunker": "recursive", "params": {"chunk_size": 150, "chunk_overlap": 20}}
    ])
    custom_splits = custom_langchain_splitter.split_text(text, metadata={"file_id": 3})
    for split in custom_splits:
        print(split)
    
    print("\n\nTesting LangchainFileSplitter with only recursive chunker:")
    recursive_only_splitter = BaseFileSplitter.create("langchain", chunkers=[
        {"chunker": "recursive", "params": {"chunk_size": 100, "chunk_overlap": 10}}
    ])
    recursive_splits = recursive_only_splitter.split_text(text, metadata={"file_id": 4})
    for split in recursive_splits:
        print(split)

    print("\n\nTesting HybridSplitter:")
    hybrid_splitter = BaseFileSplitter.create("hybrid")
    hybrid_splits = hybrid_splitter.split_text(text, metadata={"file_id": 5})
    for split in hybrid_splits:
        print(split)

    print("\n\nTesting MultiModalSplitter (no LLM/VLM calls):")
    mm = BaseFileSplitter.create(
        "multimodal",
        header_levels=3,
        strip_headers=True,
        chunk_size=1000,
        table_llm_enabled=False,
        image_vlm_enabled=False,
    )
    mm_splits = mm.split_text(text, metadata={"file_id": 6, "file_path": ""})
    for split in mm_splits[:3]:
        print(split)

        