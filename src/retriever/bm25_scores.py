from typing import Any, Iterable, List
from langchain_core.documents import Document
from rank_bm25 import BM25Okapi


class BM25Scorer():
    def __init__(self, vectorizer: BM25Okapi = None):
        self.vectorizer = vectorizer
    
    @classmethod
    def from_documents(
        cls,
        documents: Iterable[Document],
    ) -> "BM25Scorer":
        """
        Create a BM25 scorers from a list of documents.

        Args:
            documents (List[Document]): The list of documents.
            **kwargs: Additional keyword arguments to pass to the BM25Scorer.
        """
        tokenized_docs = [doc.page_content.split() for doc in documents]
        return cls(BM25Okapi(tokenized_docs))

    def get_scores(self, query: str) -> List[float]:
        """
        Get the BM25 scores for the given query.

        Args:
            query (str): The query string.

        Returns:
            List[float]: The list of BM25 scores for the documents.
        """
        processed_query = query.split()
        scores = self.vectorizer.get_scores(processed_query)
        return scores