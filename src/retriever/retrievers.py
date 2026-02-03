import numpy as np
from typing import List, Tuple, Optional, Dict
from langchain_core.documents import Document
from src.retriever.bm25_scores import BM25Scorer
from src.file_process.indexer import Indexer
from src.utils.logging_config import get_logger

logger = get_logger(__name__)

class BaseRetriever:
    """Base retriever class that uses an Indexer to retrieve documents.
    
    This class provides a retrieve method to fetch relevant documents from the
    Indexer's vectorstore based on a query, supporting multiple retrieval methods.
    """
    
    # Retriever registry to store retriever classes with their names
    _retriever_registry = {}
    
    def __init__(self, indexer: Indexer):
        """Initialize the retriever with an Indexer instance.
        
        Args:
            indexer: An Indexer instance that contains the vectorstore
        """
        self.indexer = indexer
        self._retrievers = {}
    
    def retrieve(self, query: str, k: int = 5, **kwargs) -> List[Tuple[Document, float]]:
        """Retrieve relevant documents from the vectorstore based on a query.
        
        Args:
            query: The query string to search for
            k: The number of documents to retrieve (default: 5)
            **kwargs: Additional keyword arguments to pass to the similarity search
        
        Returns:
            A list of tuples containing Document objects and their relevance scores
        """
        retriever_type = kwargs.get("retriever_type", "vector")
        if retriever_type not in self._retrievers:
            # Create and store the retriever instance if not already created
            retriever = BaseRetriever.create(retriever_type, self.indexer)
        
        # Delegate to the specific retriever's retrieve method
        return retriever.retrieve(query, k, **kwargs)
    
    @classmethod
    def register_retriever(cls, name: str):
        """
        Decorator to register a retriever class with a given name.
        
        Args:
            name: Name of the retriever to register
            
        Returns:
            Decorator function
        """
        def decorator(retriever_class):
            cls._retriever_registry[name] = retriever_class
            return retriever_class
        return decorator
    
    @classmethod
    def create(cls, retriever_type: str, indexer: Indexer) -> "BaseRetriever":
        """
        Create a retriever instance based on the retriever type.
        
        Args:
            retriever_type: Type of retriever to create
            indexer: An Indexer instance that contains the vectorstore
            
        Returns:
            A retriever instance
        """
        if retriever_type in cls._retriever_registry:
            return cls._retriever_registry[retriever_type](indexer)
        else:
            raise ValueError(f"Unknown retriever type: {retriever_type}")


@BaseRetriever.register_retriever("vector")
class VectorRetriever(BaseRetriever):
    """Retriever that uses vector similarity search."""
    
    def retrieve(self, query: str, k: int = 5, **kwargs) -> List[Tuple[Document, float]]:
        """Retrieve documents using vector similarity search.
        
        Args:
            query: The query string to search for
            k: The number of documents to retrieve
            **kwargs: Additional keyword arguments
        
        Returns:
            A list of tuples containing Document objects and their relevance scores
        """
        if not self.indexer.vectorstore:
            raise ValueError("Vectorstore not initialized in Indexer")
        
        return self.indexer.vectorstore.similarity_search_with_relevance_scores(
            query, k=k, **kwargs
        )


@BaseRetriever.register_retriever("bm25")
class BM25BasedRetriever(BaseRetriever):
    """Retriever that uses BM25 search."""
    
    def __init__(self, indexer: Indexer):
        """Initialize the BM25 retriever.
        
        Args:
            indexer: An Indexer instance that contains the documents
        """
        super().__init__(indexer)
    
    def retrieve(self, query: str, k: int = 5, **kwargs) -> List[Tuple[Document, float]]:
        """Retrieve documents using BM25 search.
        
        Args:
            query: The query string to search for
            k: The number of documents to retrieve
            **kwargs: Additional keyword arguments
        
        Returns:
            A list of tuples containing Document objects and their relevance scores
        """
        bm25_scorer = BM25Scorer.from_documents(self.indexer.all_docs)
        bm25_scores = bm25_scorer.get_scores(query)
        bm25_scores = [score for score in bm25_scores if score > 0]
        sorted_indices = np.argsort(bm25_scores)[::-1][:k]
        sorted_results = [(self.indexer.all_docs[i], float(bm25_scores[i])) for i in sorted_indices[:k]]
        
        return sorted_results


@BaseRetriever.register_retriever("fusion")
class FusionRetriever(BaseRetriever):
    """Retriever that uses fusion of multiple retrieval methods."""
    
    def retrieve(self, query: str, k: int = 5, **kwargs) -> List[Tuple[Document, float]]:
        """Retrieve documents using fusion of multiple retrieval methods.
        
        Uses Reciprocal Rank Fusion (RRF) to combine results from vector and BM25 search.
        
        Args:
            query: The query string to search for
            k: The number of documents to retrieve
            **kwargs: Additional keyword arguments
        
        Returns:
            A list of tuples containing Document objects and their relevance scores
        """
        # Get vector scores and BM25 scores
        all_docs_with_scores = self.indexer.vectorstore.similarity_search_with_relevance_scores("", k=self.indexer.vectorstore.index.ntotal)
        vector_scores = [score for _, score in all_docs_with_scores]

        bm25_scorer = BM25Scorer.from_documents(self.indexer.all_docs)
        bm25_scores = bm25_scorer.get_scores(query)

        # Nomalize scores
        epsilon = 1e-6
        alpha = 0.5
        
        vector_scores = 1 - (vector_scores - np.min(vector_scores)) / (np.max(vector_scores) - np.min(vector_scores) + epsilon)
        bm25_scores = (bm25_scores - np.min(bm25_scores)) / (np.max(bm25_scores) -  np.min(bm25_scores) + epsilon)
        combined_scores = alpha * vector_scores + (1 - alpha) * bm25_scores  
        sorted_indices = np.argsort(combined_scores)[::-1]

        sorted_results = [(self.indexer.all_docs[i], float(combined_scores[i])) for i in sorted_indices[:k]]
        
        # Return top k results
        return sorted_results
