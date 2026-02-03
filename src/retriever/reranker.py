from typing import List
import os
import requests
import json
from transformers import AutoModel
from langchain_core.documents import Document
from src.utils.logging_config import get_logger

logger = get_logger(__name__)

class JinaReRanker:
    def __init__(self, model_name='jinaai/jina-reranker-v3'):
        # Initialize the reranker model; use_fp16=True speeds up computation with slight performance loss
        self.reranker = AutoModel.from_pretrained(
            'jinaai/jina-reranker-v3',
            dtype="auto",
            trust_remote_code=True
        )
        self.reranker.eval()

    def rerank(self, query:str, documents: List[Document]):
        logger.info(f"Reranking {len(documents)} documents for query: {query}")
        docs = [doc.page_content for doc in documents]
        results = self.reranker.rerank(query, docs)
        scores = [{result['index']: float(result['relevance_score'])} for result in results]
        scored_docs = [(documents[index], score) for score_dict in scores for index, score in score_dict.items()]
        sorted_docs = sorted(scored_docs, key=lambda x: x[1], reverse=True)
        return sorted_docs

class JinaAPIReranker:
    def __init__(self, model_name='jina-reranker-v3', api_key=None):
        """Initialize the Jina API Reranker with the specified model and API key.
        
        Args:
            model_name: The name of the Jina reranker model to use
            api_key: The Jina API key. If not provided, it will be read from the environment variable JINA_API_KEY
        """
        self.model_name = model_name
        self.api_key = api_key or os.getenv('JINA_API_KEY')
        if not self.api_key:
            raise ValueError("JINA_API_KEY must be provided either as an argument or set as an environment variable")
        self.api_url = "https://api.jina.ai/v1/rerank"
        self.headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}"
        }
    
    def rerank(self, query: str, documents: List[Document], return_documents=False):
        """Rerank a list of documents based on their relevance to a query using the Jina API.
        
        Args:
            query: The query string to use for reranking
            documents: List of Document objects to rerank
            return_documents: Whether to return the documents in the API response
            
        Returns:
            List of tuples containing (Document, score), sorted by relevance score in descending order
        """
        # Extract document content from Document objects
        doc_contents = [doc.page_content for doc in documents]
        
        # Prepare the request payload
        payload = {
            "model": self.model_name,
            "query": query,
            "documents": doc_contents,
            "return_documents": return_documents
        }
        
        try:
            # Send the POST request to the Jina API
            response = requests.post(
                self.api_url,
                headers=self.headers,
                data=json.dumps(payload)
            )
            
            # Check if the request was successful
            response.raise_for_status()
            
            # Parse the response
            result = response.json()
            
            # Extract relevance scores
            scores = [{item['index']: float(item['relevance_score'])} for item in result['results']]
            
            # Combine documents with their scores and sort by score (descending)
            scored_docs = [(documents[index], score) for score_dict in scores for index, score in score_dict.items()]
            sorted_docs = sorted(scored_docs, key=lambda x: x[1], reverse=True)
            
            return sorted_docs
            
        except requests.exceptions.RequestException as e:
            # Handle API request errors
            print(f"Error making request to Jina API: {e}")
            raise
        except (KeyError, ValueError) as e:
            # Handle response parsing errors
            print(f"Error parsing Jina API response: {e}")
            raise

