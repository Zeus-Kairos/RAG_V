from typing import List
from langchain_core.documents import Document

def merge_documents(documents: List[Document]) -> List[Document]:
    """
    Merge documents with the same file_path and Headers (Header 1, Header 2).
    """
    merged_docs = {}
    for doc in documents:
        chunk_id = doc.metadata.get("chunk_id")
        if chunk_id not in merged_docs:
            merged_docs[chunk_id] = doc

    return list(merged_docs.values())