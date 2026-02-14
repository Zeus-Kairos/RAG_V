from dataclasses import asdict
from docling.document_converter import DocumentConverter
from docling.datamodel.base_models import InputFormat
from docling.chunking import HybridChunker
from langchain_core.documents import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter, MarkdownHeaderTextSplitter
from chonkie import Pipeline


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
    
    def split_text(self, text: str, metadata: dict = None) -> list[Document]:
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
                    "splitter": RecursiveCharacterTextSplitter(chunk_size=chunk_size, chunk_overlap=chunk_overlap, strip_whitespace=False)
                })
    
    def split_text(self, text: str, metadata: dict = None) -> list[Document]:
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
    
    def split_text(self, text: str, metadata: dict = None) -> list[Document]:     
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


class DoclingSplitter(BaseFileSplitter, splitter_name="docling"):
    """Splitter that uses Docling's HybridChunker for chunking."""
    
    def __init__(self, **kwargs):
        self.parser_params = kwargs

    def split_text(self, text: str, metadata: dict = None) -> list[Document]:
        filename = metadata.get("filename", None)
        converter = DocumentConverter()
        doc = converter.convert_string(text, InputFormat.MD, filename).document

        chunker = HybridChunker(**self.parser_params)
        chunks = chunker.chunk(doc)
        documents = []
        chunk_index = 0
        file_id = metadata.get("file_id", "")
        for chunk in chunks:
            document = Document(page_content=chunk.text, 
                        metadata={
                            **chunk.meta.export_json_dict(),
                            "chunk_id": f"{file_id}_{chunk_index}",
                            **metadata
                        })
            chunk_index += 1
            documents.append(document)
        return documents

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
        
        