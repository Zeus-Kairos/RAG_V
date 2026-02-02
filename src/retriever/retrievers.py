from typing import List, Tuple, Optional, Dict
from langchain_core.documents import Document
from langchain_community.retrievers import BM25Retriever
from src.file_process.indexer import Indexer


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
        self._bm25_retriever = None
    
    def retrieve(self, query: str, k: int = 5, **kwargs) -> List[Tuple[Document, float]]:
        """Retrieve documents using BM25 search.
        
        Args:
            query: The query string to search for
            k: The number of documents to retrieve
            **kwargs: Additional keyword arguments
        
        Returns:
            A list of tuples containing Document objects and their relevance scores
        """
        if not self._bm25_retriever:
            # Initialize BM25 retriever if not already initialized
            bm25_retriever = BM25Retriever.from_documents(self.indexer.all_docs)
        
        # BM25Retriever returns just documents, not scores
        documents = bm25_retriever.invoke(query, k=k)
        
        # Create dummy scores (BM25 doesn't provide relevance scores directly)
        # In a real implementation, you might want to calculate proper scores
        results = []
        for i, doc in enumerate(documents):
            # Assign scores based on rank (higher rank = higher score)
            score = 1.0 - (i / k)
            results.append((doc, score))
        
        return results


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
        # Create vector and BM25 retrievers
        vector_retriever = BaseRetriever.create("vector", self.indexer)
        bm25_retriever = BaseRetriever.create("bm25", self.indexer)
        
        # Get results from different retrievers
        vector_results = vector_retriever.retrieve(query, k=k*2)
        bm25_results = bm25_retriever.retrieve(query, k=k*2)
        
        # Create a dictionary to store fused scores
        fused_scores = {}
        
        # RRF parameters
        k_rrf = 60
        
        # Process vector results
        for rank, (doc, score) in enumerate(vector_results):
            doc_id = doc.metadata.get('chunk_id', id(doc))
            if doc_id not in fused_scores:
                fused_scores[doc_id] = {
                    'document': doc,
                    'score': 0
                }
            fused_scores[doc_id]['score'] += 1 / (rank + k_rrf)
        
        # Process BM25 results
        for rank, (doc, score) in enumerate(bm25_results):
            doc_id = doc.metadata.get('chunk_id', id(doc))
            if doc_id not in fused_scores:
                fused_scores[doc_id] = {
                    'document': doc,
                    'score': 0
                }
            fused_scores[doc_id]['score'] += 1 / (rank + k_rrf)
        
        # Convert to list and sort by score
        sorted_results = sorted(
            [(v['document'], v['score']) for v in fused_scores.values()],
            key=lambda x: x[1],
            reverse=True
        )
        
        # Return top k results
        return sorted_results[:k]
