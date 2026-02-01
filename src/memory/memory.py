import os
import json
import sqlite3
from datetime import datetime, timezone, timedelta
from typing import List, Dict, Any, Optional, Tuple, Union
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.store.base import BaseStore
from langgraph.store.memory import InMemoryStore

from .knowledgebase import KnowledgebaseManager
from .parse import ParserManager
from .chunks import ChunkingManager
from .embedding import EmbeddingManager
from .index import IndexManager
from src.utils.logging_config import get_logger

logger = get_logger(__name__)

class MemoryManager:
    """Manages user memory and conversation history using LangGraph MemorySaver and MemoryStore"""
    
    # Singleton instance
    _instance = None
    
    def __new__(cls):
        """Create or return the singleton instance"""
        if cls._instance is None:
            cls._instance = super(MemoryManager, cls).__new__(cls)
        return cls._instance

    def __init__(self):
        """
        Initialize the memory manager with LangGraph persistence components.
        """
        # Only initialize once
        if hasattr(self, '_initialized') and self._initialized:
            return
        
        # Get database path from environment or use default
        db_path = os.getenv("DB_URI", "./data/rag_v.db")
        os.makedirs(os.path.dirname(db_path), exist_ok=True)
        
        # Create SQLite connection
        self.conn = sqlite3.connect(db_path, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row  # Enable dict-like access to rows
        
        # Enable foreign key constraints for SQLite
        self.conn.execute("PRAGMA foreign_keys = ON")
        
        # Initialize knowledgebase manager
        self.knowledgebase_manager = KnowledgebaseManager(self.conn)
        
        # Initialize chunking manager
        self.chunking_manager = ChunkingManager(self.conn)
        
        # Initialize parser manager
        self.parser_manager = ParserManager(self.conn)
        
        # Initialize embedding manager
        self.embedding_manager = EmbeddingManager(self.conn)
        
        # Initialize index manager
        self.index_manager = IndexManager(self.conn)
        
        # Mark as initialized
        self._initialized = True    

    def __del__(self):
        """
        Clean up resources when the MemoryManager instance is destroyed.
        """
        if hasattr(self, 'conn') and self.conn is not None:
            try:
                self.conn.close()
            except Exception as e:
                logger.error(f"Error closing database connection: {e}")
