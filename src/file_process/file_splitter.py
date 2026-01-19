from langchain_core.documents import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter, MarkdownHeaderTextSplitter

class LangchainFileSplitter:
    def __init__(self, **kwargs):
        self.markdown_header_splitting = kwargs.get("markdown_header_splitting", True)
        header_levels = kwargs.get("header_levels", 3)
        headers_to_split_on = [("#"*i, f"Header {i}") for i in range(1, header_levels + 1)]
        strip_headers = kwargs.get("strip_headers", False)
        self.recursive_splitting = kwargs.get("recursive_splitting", True)
        self.markdown_splitter = MarkdownHeaderTextSplitter(headers_to_split_on, strip_headers=strip_headers)
        self.text_splitter = RecursiveCharacterTextSplitter(chunk_size=kwargs.get("chunk_size", 500), chunk_overlap=kwargs.get("chunk_overlap", 50), strip_whitespace=False)      
    
    def split_text(self, text: str, metadata: dict = None) -> list[Document]:
        # Fix mutable default argument issue
        if metadata is None:
            metadata = {}
        
        if self.markdown_header_splitting:
            md_header_splits  = self.markdown_splitter.split_text(text)
        else:
            md_header_splits = [Document(page_content=text, metadata=metadata)]
        
        documents = []
        chunk_index = 0
        file_id = metadata.get("file_id", "")
        for split in md_header_splits:
            if self.recursive_splitting:
                split_docs = self.text_splitter.split_documents([split])
            else:
                split_docs = [split]
            for doc in split_docs:
                # Create a new metadata dictionary for each document to avoid shared state issues
                # This prevents "dictionary changed size during iteration" errors in concurrent processing
                doc.metadata = {
                    **doc.metadata,
                    "chunk_id": f"{file_id}_{chunk_index}",
                    **metadata
                }
                chunk_index += 1
            documents.extend(split_docs)
        return documents