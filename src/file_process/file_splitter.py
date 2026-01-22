from langchain_core.documents import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter, MarkdownHeaderTextSplitter
from chonkie import Pipeline


class LangchainFileSplitter:
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

class ChonkieFileSplitter:
    def __init__(self, **kwargs):
        self.chunkers = kwargs.get("chunkers", None)
    
    def split_text(self, text: str, metadata: dict = None) -> list[Document]:     
        pipeline = Pipeline().process_with("markdown")
        for chunker in self.chunkers:
            pipeline = pipeline.chunk_with(chunker["chunker"], **chunker["params"])     
        chunks = pipeline.run(text).chunks

        documents = []
        chunk_index = 0
        file_id = metadata.get("file_id", "")
        for chunk in chunks:
            document = Document(page_content=chunk.text, 
                        metadata={
                            **{k: v for k, v in chunk.to_dict().items() if k != "text"},
                            "chunk_id": f"{file_id}_{chunk_index}",
                            **metadata
                        })
            chunk_index += 1
            documents.append(document)
        return documents

if __name__ == "__main__":
    print("Testing ChonkieFileSplitter:")
    splitter = ChonkieFileSplitter(chunkers=[
        {"chunker": "recursive", "params": {"chunk_size": 200}},
        {"chunker": "sentence", "params": {"chunk_size": 100, "chunk_overlap": 10}},
        {"chunker": "semantic", "params": {"chunk_size":100, "threshold":0.8, "similarity_window":3}}
    ])
    text = """
    # Noise Figure Converters Freq

    ## Main

    * [Start, Stop, Center, Span, Step](../Applications/Noise_Figure_on_Converters.htm#MxrSwpCombos)

    * [CW](../Applications/Noise_Figure_on_Converters.htm#MxrSwpCombos)

    * [Frequency Offset...](../FreqOffset/Frequency_Offset_Mode.htm)

    * [NFX Setup...](../Applications/Noise_Figure_on_Converters.htm#MxrSwpCombos)
    """
    splits = splitter.split_text(text, metadata={"file_id": 1})
    for split in splits:
        print(split)
    
    print("\n\nTesting refactored LangchainFileSplitter with default chunkers:")
    langchain_splitter = LangchainFileSplitter()
    langchain_splits = langchain_splitter.split_text(text, metadata={"file_id": 2})
    for split in langchain_splits:
        print(split)
    
    print("\n\nTesting LangchainFileSplitter with custom chunkers:")
    custom_langchain_splitter = LangchainFileSplitter(chunkers=[
        {"chunker": "markdown_header", "params": {"header_levels": 2, "strip_headers": True}},
        {"chunker": "recursive", "params": {"chunk_size": 150, "chunk_overlap": 20}}
    ])
    custom_splits = custom_langchain_splitter.split_text(text, metadata={"file_id": 3})
    for split in custom_splits:
        print(split)
    
    print("\n\nTesting LangchainFileSplitter with only recursive chunker:")
    recursive_only_splitter = LangchainFileSplitter(chunkers=[
        {"chunker": "recursive", "params": {"chunk_size": 100, "chunk_overlap": 10}}
    ])
    recursive_splits = recursive_only_splitter.split_text(text, metadata={"file_id": 4})
    for split in recursive_splits:
        print(split)
        
        