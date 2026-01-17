import os
import faiss
import threading
from langchain_core.documents import Document
import numpy as np
from typing import Any, Dict, List
from langchain_community.vectorstores import FAISS
from langchain_community.docstore.in_memory import InMemoryDocstore
from langchain_ollama import OllamaEmbeddings
from src.utils.logging_config import get_logger
from src.utils.embeddings import EmbeddingRunner, get_embedding_runner

logger = get_logger(__name__)

# index file chunks into faiss index
class Indexer:
    def __init__(self, user_id: int, index_path: str):
        self.user_id = user_id
        self._embeddings = get_embedding_runner(user_id).embedding_model
        self.index_path = index_path
        # Add thread lock to prevent concurrent modifications
        self._lock = threading.Lock()
        if os.path.exists(index_path):
            with self._lock:
                self.vectorstore = FAISS.load_local(index_path, self._embeddings, allow_dangerous_deserialization=True)
                self.all_docs = self.get_all_docs()
        else:
            with self._lock:
                index = faiss.IndexFlatL2(len(self._embeddings.embed_query("test")))
                self.vectorstore = FAISS(self._embeddings, index, 
                    docstore= InMemoryDocstore(),
                    index_to_docstore_id={})   
                self.all_docs = []
    
    def index_chunks(self, chunks: Dict[int, List[Document]], save: bool = False) -> FAISS:
        """Index file chunks into faiss index.
        
        Args:
            chunks: Dict of file chunks to index, keyed by file_id
        """
        file_ids = list(chunks.keys())
        with self._lock:           
            self.delete_file_chunks(file_ids)

        all_chunks = [chunk for chunk_list in chunks.values() for chunk in chunk_list]           
        # Only add documents if there are chunks to index
        if all_chunks:
            chunk_ids = [chunk.metadata['chunk_id'] for chunk in all_chunks]
            texts = [chunk.page_content for chunk in all_chunks]
            metadatas = [chunk.metadata for chunk in all_chunks]
            embeddings = self._embeddings.embed_documents(texts)            
            with self._lock:  
                self.vectorstore.add_embeddings(zip(texts, embeddings), metadatas=metadatas, ids=chunk_ids)          
                self.all_docs.extend(all_chunks)     
                logger.info(f"Index {len(all_chunks)} chunks for {len(file_ids)} files")      
                logger.info(f"Total {len(self.all_docs)} chunks in vectorstore")
                if save:
                    self.vectorstore.save_local(self.index_path)
        else:
            logger.info("No chunks to index")
                  
        return self.vectorstore

    def delete_file_chunks(self, file_ids: List[int], save: bool = False) -> None:
        """Delete all chunks for a file from the index.
        
        Args:
            file_ids: List of file IDs to delete chunks for
        """
        if self.all_docs:
            existing_chunks_ids = [doc.metadata['chunk_id'] for doc in self.all_docs if doc.metadata.get("file_id") in file_ids]
            if existing_chunks_ids:
                self.vectorstore.delete(ids=existing_chunks_ids)
                logger.info(f"Delete {len(existing_chunks_ids)} chunks for file_ids: {file_ids}")
                self.all_docs = [doc for doc in self.all_docs if doc.metadata.get("file_id") not in file_ids]
                logger.info(f"{len(self.all_docs)} chunks left in vectorstore")
                if save:
                    self.vectorstore.save_local(self.index_path)

    def save_index(self) -> None:
        """Save the current index to disk."""
        with self._lock:
            self.vectorstore.save_local(self.index_path)

    def get_all_docs(self) -> List[Document]:
        """Get all documents in the index.
        
        Returns:
            List of all documents in the index
        """
        # This method is called from __init__ which already holds the lock
        if self.vectorstore.index.ntotal == 0:
            return []
        all_docs_with_scores = self.vectorstore.similarity_search_with_relevance_scores("", k=self.vectorstore.index.ntotal)
        return [doc for doc, _ in all_docs_with_scores]
