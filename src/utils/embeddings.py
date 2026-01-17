import logging
import os
from typing import List
from langchain_core.embeddings import Embeddings
from langchain_ollama import OllamaEmbeddings
from langchain_openai import OpenAIEmbeddings    
from langchain_huggingface import HuggingFaceEmbeddings 
import requests
from src.memory.memory import MemoryManager
from src.utils.logging_config import get_logger

logger = get_logger(__name__)

class EmbeddingRunner:
    """
    A class to manage and hold instances of embedding models from Ollama.
    
    This class provides a centralized way to initialize, access, and manage LLM models
    for embeddings generation.
    """
    
    def __init__(self, user_id: int = None):
        """
        Initialize the EmbeddingRunner with specified model configurations.
        
        Args:
            user_id: User's ID (default: None)
        """
        # Initialize memory manager to fetch user config
        self.memory_manager = MemoryManager()
        self.user_id = user_id

        # Get user configuration from memory manager
        if user_id:
            self.user_config = self.memory_manager.get_user_configuration(user_id)
        else:
            self.user_config = None

        # Set default values if no config is found
        if self.user_config:         
            self.embedding_provider = self.user_config.get("embedding_provider", "openai").lower()
            self.embedding_api_key = self.user_config.get("embedding_api_key")
            self.embedding_model_name = self.user_config.get("embedding_model")
        else:
            self.embedding_provider = os.environ.get("EMBED_PROVIDER", "ollama")
            self.embedding_api_key = os.environ.get("EMBED_API_KEY")          
            self.embedding_model_name = os.environ.get("EMBED_MODEL", "nomic-embed-text:latest")   
        
        # Initialize model instances
        self._embedding_model = None
   
        # Initialize models on instantiation
        self._initialize_embedding_model()
        
    def _initialize_embedding_model(self):
        """
        Initialize the embedding model instance.
        """
        if self.embedding_provider == "openai":
            self._embedding_model = OpenAIEmbeddings(
                model=self.embedding_model_name,
                api_key=self.embedding_api_key
            )
            logger.info(f"Initialized OpenAIEmbeddings model: {self.embedding_model_name}")
        elif self.embedding_provider == "hf":
            self._embedding_model = HuggingFaceEmbeddings(
                model_name=self.embedding_model_name
            )
            logger.info(f"Initialized HuggingFaceEmbeddings model: {self.embedding_model_name}")
        elif self.embedding_provider == "ollama":
            self._embedding_model = OllamaEmbeddings(
                model=self.embedding_model_name,
            )
            logger.info(f"Initialized OllamaEmbeddings model: {self.embedding_model_name}")
        else:
            self._embedding_model = None
            logger.warning(f"Embedding provider {self.embedding_provider} is not supported.")
    
    @property
    def embedding_model(self) -> Embeddings:
        """
        Get the initialized embedding model instance.
        
        Returns:
            An instance of the selected embedding model or None if initialization failed
        """
        # Re-initialize if not already initialized
        if self._embedding_model is None:
            self._initialize_embedding_model()
        return self._embedding_model
    
    def get_embedding(self, text) -> List[float]:
        """
        Convenience method to get embeddings for text directly.
        
        Args:
            text: Text to embed
            
        Returns:
            The embedding vector or None if the model is not available
        """
        if self.embedding_model:
            try:
                return self.embedding_model.embed_query(text)
            except Exception as e:
                logger.error(f"Error generating embedding: {e}")
                raise Exception(f"Error generating embedding: {e}")
        else:
           raise Exception("Embedding model not initialized.")

# Create a dictionary to store ApiLLMRunner instances per user
embedding_runners = {}
active_EmbeddingRunner = None

def get_embedding_runner(user_id: int) -> EmbeddingRunner:
    """
    Get or create an EmbeddingRunner instance for the specified user.
    
    Args:
        user_id: User's ID
        
    Returns:
        EmbeddingRunner instance for the user
    """
    global active_EmbeddingRunner
    if user_id not in embedding_runners:
        # Create a new EmbeddingRunner instance for this user with their ID
        embedding_runners[user_id] = EmbeddingRunner(user_id=user_id)
    active_EmbeddingRunner = embedding_runners[user_id]
    return embedding_runners[user_id]

def get_active_embedding_runner() -> EmbeddingRunner:
    """
    Get the currently active EmbeddingRunner instance.
    This function provides a reliable way to access the most recent active runner
    from outside this module, without needing a user ID.
    
    Returns:
        The currently active EmbeddingRunner instance
    """
    global active_EmbeddingRunner
    if active_EmbeddingRunner is None:
        active_EmbeddingRunner = EmbeddingRunner()
    return active_EmbeddingRunner
