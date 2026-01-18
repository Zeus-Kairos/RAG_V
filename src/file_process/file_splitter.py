from langchain_core.documents import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter, MarkdownHeaderTextSplitter

class FileSplitter:
    def __init__(self, markdown_header_splitting=True, recursive_splitting=True, chunk_size=500, chunk_overlap=50):
        headers_to_split_on = [
            ("#", "Header 1"),
            ("##", "Header 2"),
            ("###", "Header 3"),
        ]
        self.markdown_header_splitting = markdown_header_splitting
        self.recursive_splitting = recursive_splitting
        self.markdown_splitter = MarkdownHeaderTextSplitter(headers_to_split_on, strip_headers=False)
        self.text_splitter = RecursiveCharacterTextSplitter(chunk_size=chunk_size, chunk_overlap=chunk_overlap)      
    
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