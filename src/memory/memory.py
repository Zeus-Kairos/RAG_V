import os
import json
import sqlite3
from datetime import datetime, timezone, timedelta
from typing import List, Dict, Any, Optional, Tuple, Union
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.store.base import BaseStore
from langgraph.store.memory import InMemoryStore

from .knowledgebase import KnowledgebaseManager
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
        
        # Create SQLite connection
        self.conn = sqlite3.connect(db_path, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row  # Enable dict-like access to rows
        
        # Initialize database tables
        self._init_db_tables()
        
        # Initialize knowledgebase manager
        self.knowledgebase_manager = KnowledgebaseManager(self.conn)
        
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

    def _init_db_tables(self):
        """
        Initialize database tables if they don't exist.
        """
        try:
            cur = self.conn.cursor()            
            
            # Create configure table (single configuration, no user_id)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS configure (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    model_provider TEXT,
                    api_key TEXT,
                    llm_model TEXT,
                    api_base_url TEXT,
                    embedding_provider TEXT,
                    embedding_api_key TEXT,
                    embedding_model TEXT
                )
            """)
            
            self.conn.commit()
        except Exception as e:
            logger.error(f"Error initializing database tables: {e}")
            return

    def update_configuration(self, api_key: Optional[str] = None, 
                            llm_model: Optional[str] = None, embedding_model: Optional[str] = None, 
                            model_provider: Optional[str] = None, api_base_url: Optional[str] = None,
                            embedding_provider: Optional[str] = None, embedding_api_key: Optional[str] = None) -> dict:
        """
        Update or insert configuration.
        
        Args:
            api_key: API key
            llm_model: LLM model name
            embedding_model: Embedding model name
            model_provider: Model provider
            api_base_url: API base URL
            embedding_provider: Embedding provider
            embedding_api_key: Embedding API key
            
        Returns:
            The updated configuration
        """
        try:
            cur = self.conn.cursor()
            # Use UPSERT to handle both insert and update cases
            cur.execute("""
                INSERT INTO configure (
                    id, model_provider, api_key, llm_model, api_base_url, embedding_provider, embedding_api_key, embedding_model
                ) VALUES (1, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (id) DO UPDATE SET
                    model_provider = excluded.model_provider,
                    api_key = excluded.api_key,
                    llm_model = excluded.llm_model,
                    api_base_url = excluded.api_base_url,
                    embedding_provider = excluded.embedding_provider,
                    embedding_api_key = excluded.embedding_api_key,
                    embedding_model = excluded.embedding_model
            """, (model_provider, api_key, llm_model, api_base_url, embedding_provider, embedding_api_key, embedding_model))
            
            self.conn.commit()
            
            # Fetch the updated config
            cur.execute("SELECT * FROM configure WHERE id = 1")
            config = cur.fetchone()
            
            return {
                "model_provider": config[1] if config else model_provider,
                "api_key": config[2] if config else api_key,
                "llm_model": config[3] if config else llm_model,
                "api_base_url": config[4] if config else api_base_url,
                "embedding_provider": config[5] if config else embedding_provider,
                "embedding_api_key": config[6] if config else embedding_api_key,
                "embedding_model": config[7] if config else embedding_model
            }
        except Exception as e:
            logger.error(f"Error updating configuration: {e}")
            raise
            
    def get_configuration(self) -> Optional[dict]:
        """
        Get configuration.
        
        Returns:
            Configuration dictionary if found, None otherwise
        """
        try:
            cur = self.conn.cursor()
            cur.execute("SELECT * FROM configure WHERE id = 1")
            config = cur.fetchone()
            if config:
                return {
                    "model_provider": config[1],
                    "api_key": config[2],
                    "llm_model": config[3],
                    "api_base_url": config[4],
                    "embedding_provider": config[5],
                    "embedding_api_key": config[6],
                    "embedding_model": config[7]
                }
            return None
        except Exception as e:
            logger.error(f"Error getting configuration: {e}")
            raise
