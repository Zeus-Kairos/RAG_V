import os
import faiss
import threading
from langchain_core.documents import Document
import numpy as np
from typing import Any, Dict, List, Optional
from langchain_community.vectorstores import FAISS
from langchain_community.docstore.in_memory import InMemoryDocstore
from langchain_ollama import OllamaEmbeddings
from src.utils.logging_config import get_logger
from src.utils.embeddings import EmbeddingRunner, get_embedding_runner

logger = get_logger(__name__)

# index file chunks into faiss index
class Indexer:
    def __init__(self, embedding_config_id: str, index_path: str):
        self.embedding_config_id = embedding_config_id
        self._embeddings = get_embedding_runner(embedding_config_id).embedding_model
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
    
    def index_chunks(self, chunks: Dict[int, List[Document]] | List[Document], save: bool = False) -> FAISS:
        """Index file chunks into faiss index.
        
        Args:
            chunks: Dict of file chunks to index, keyed by file_id or list of documents
            save: Whether to save the index after indexing (default: False)
        """
        if isinstance(chunks, dict):
            file_ids = list(chunks.keys())
            with self._lock:           
                self.delete_file_chunks(file_ids)

            all_chunks = [chunk for chunk_list in chunks.values() for chunk in chunk_list]   
        else:
            file_ids = None
            all_chunks = chunks
        
        # Only add documents if there are chunks to index
        if all_chunks:
            chunk_ids = [chunk.metadata['chunk_id'] for chunk in all_chunks]          
            texts = [chunk.page_content for chunk in all_chunks]
            metadatas = [chunk.metadata for chunk in all_chunks]
            embeddings = self._embeddings.embed_documents(texts)            
            with self._lock:  
                self.vectorstore.add_embeddings(zip(texts, embeddings), metadatas=metadatas, ids=chunk_ids)          
                self.all_docs.extend(all_chunks)     
                if file_ids:
                    logger.info(f"Index {len(all_chunks)} chunks for {len(file_ids)} files")  
                else:
                    logger.info(f"Index {len(all_chunks)} chunks")  
                logger.info(f"Total {len(self.all_docs)} chunks in vectorstore")
                if save:
                    self.vectorstore.save_local(self.index_path)
        else:
            logger.info("No chunks to index")
                  
        return self.vectorstore

    def delete_file_chunks(self, file_ids: List[int] = None, save: bool = False) -> None:
        """Delete all chunks for a file from the index.
        
        Args:
            file_ids: List of file IDs to delete chunks for
        """
        if self.all_docs:
            if file_ids is None:
                existing_chunks_ids = [doc.metadata['chunk_id'] for doc in self.all_docs]
            else:
                existing_chunks_ids = [doc.metadata['chunk_id'] for doc in self.all_docs if doc.metadata.get("file_id") in file_ids]
                      
            if existing_chunks_ids:
                self.vectorstore.delete(ids=existing_chunks_ids)          
                if file_ids is not None:
                    logger.info(f"Delete {len(existing_chunks_ids)} chunks for file_ids: {file_ids}")
                    self.all_docs = [doc for doc in self.all_docs if doc.metadata.get("file_id") not in file_ids]
                else:
                    self.all_docs = []
                logger.info(f"{len(self.all_docs)} chunks left in vectorstore")
                if save:
                    self.vectorstore.save_local(self.index_path)

    def save_index(self) -> None:
        """Save the current index to disk."""
        with self._lock:
            self.vectorstore.save_local(self.index_path)
        logger.info(f"Save index to {self.index_path}")

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

    def get_all_embeddings_with_ids(self) -> tuple[np.ndarray, List[str]]:
        """Return all vectors in index order and their chunk ids (FAISS row i matches ids[i])."""
        with self._lock:
            vs = self.vectorstore
            n = vs.index.ntotal
            if n == 0:
                return np.array([], dtype=np.float32).reshape(0, 0), []
            dim = int(vs.index.d)
            mat = np.empty((n, dim), dtype=np.float32)
            ids: List[str] = []
            for i in range(n):
                mat[i] = np.asarray(vs.index.reconstruct(i), dtype=np.float32)
                ids.append(str(vs.index_to_docstore_id[i]))
            return mat, ids

    def get_chunk_filename(self, chunk_id: str) -> str:
        """Best-effort filename for tooltip from docstore."""
        with self._lock:
            try:
                found = self.vectorstore.docstore.search(str(chunk_id))
                if isinstance(found, Document) and found.metadata:
                    return str(found.metadata.get("filename") or found.metadata.get("filepath") or "")
            except Exception:
                pass
        return ""

    @staticmethod
    def _truncate_preview(text: str, max_len: int) -> str:
        if not text:
            return ""
        one_line = " ".join(str(text).split())
        if len(one_line) <= max_len:
            return one_line
        return one_line[: max_len - 1] + "…"

    def get_chunk_text_preview(self, chunk_id: str, max_len: int = 96) -> str:
        """Single-line chunk text for UMAP labels (truncated).

        Uses FAISS docstore first, then ``all_docs`` (must match chunk_id). Docstore ``search``
        returns an error string when the id is missing — only ``Document`` instances carry text.
        """
        cid = str(chunk_id)
        with self._lock:
            try:
                found = self.vectorstore.docstore.search(cid)
                if isinstance(found, Document):
                    raw = (found.page_content or "").strip()
                    if raw:
                        return self._truncate_preview(found.page_content, max_len)
            except Exception:
                pass
            for doc in self.all_docs:
                if str(doc.metadata.get("chunk_id", "")) != cid:
                    continue
                raw = (doc.page_content or "").strip()
                if raw:
                    return self._truncate_preview(doc.page_content, max_len)
        return ""

    def get_chunk_detail_from_index(self, chunk_id: str) -> Optional[Dict[str, Any]]:
        """Full page_content + metadata from FAISS docstore or ``all_docs``."""
        cid = str(chunk_id)
        with self._lock:
            try:
                found = self.vectorstore.docstore.search(cid)
                if isinstance(found, Document):
                    meta = dict(found.metadata or {})
                    return {
                        "content": found.page_content or "",
                        "metadata": meta,
                        "document_name": str(
                            meta.get("filename") or meta.get("filepath") or ""
                        ),
                    }
            except Exception:
                pass
            for doc in self.all_docs:
                if str(doc.metadata.get("chunk_id", "")) != cid:
                    continue
                meta = dict(doc.metadata or {})
                return {
                    "content": doc.page_content or "",
                    "metadata": meta,
                    "document_name": str(meta.get("filename") or meta.get("filepath") or ""),
                }
        return None
