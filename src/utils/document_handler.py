import os
from typing import List, Tuple
from langchain_core.documents import Document


def format_documents(documents: list[Document] | List[Tuple[Document, float]], with_index: bool = True, index_offset: int = 0) -> str:
    """
    Format a list of documents for display.
    """
    if documents and isinstance(documents[0], tuple):
        # Tuple structure: (doc, score)
        if with_index:
            doc_contents = "\n".join([
                f"Document Index: {idx+index_offset}\n{doc[0].page_content}\n['Source: '{doc[0].metadata['file_path']}]"
                for idx, doc in enumerate(documents)
            ])
        else:
            doc_contents = "\n".join([
                f"{doc[0].page_content}\n['Source: '{doc[0].metadata['file_path']}]"
                for doc in documents
            ])
    else:
        # Regular Document list
        if with_index:
            doc_contents = "\n".join([
                f"Document Index: {idx+index_offset}\n{doc.page_content}\n['Source: '{doc.metadata['file_path']}]"
                for idx, doc in enumerate(documents)
            ])
        else:
            doc_contents = "\n".join([
                f"{doc.page_content}\n['Source: '{doc.metadata['file_path']}]"
                for doc in documents
            ])

    return doc_contents

def format_references(references: list[Document] | List[Tuple[Document, float]], root_path: str = "", with_index: bool = True, index_offset: int = 0) -> str:
    """
    Format a list of references for display.
    """
    if references and isinstance(references[0], tuple):
        references = [doc for doc, _ in references]  # Tuple structure: (doc, score)
    
    if with_index:
        ref_contents = "\n".join([
            f"Document Index: {idx+index_offset}\n{doc.page_content}\n[Source: {extract_path(doc, root_path)}]"
            for idx, doc in enumerate(references)
        ])
    else:
        ref_contents = "\n".join([
            f"{doc.page_content}\n[Source: {extract_path(doc, root_path)}]"
            for doc in references
        ])
    
    return ref_contents

def extract_path(doc: Document, root_path: str = "") -> str:
    """
    Extract the path of the document.
    """
    relative_path = doc.metadata["file_path"].replace(root_path, "").lstrip(os.path.sep)
    header_path = ""
    for meta_key in doc.metadata.keys():
        if meta_key.startswith("Header"):
            header_path += f"{doc.metadata[meta_key]}{os.path.sep}"
    if header_path:
        relative_path = f"{relative_path}#{header_path.rstrip(os.path.sep)}"

    return relative_path



