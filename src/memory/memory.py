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
        
        # Enable foreign key constraints for SQLite
        self.conn.execute("PRAGMA foreign_keys = ON")
        
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
                CREATE TABLE IF NOT EXISTS embedding_configure (
                    id TEXT PRIMARY KEY,
                    embedding_base_url TEXT,
                    embedding_provider TEXT,
                    embedding_api_key TEXT,
                    embedding_model TEXT,
                    is_active INTEGER DEFAULT 0
                )
            """)
            
            self.conn.commit()
        except Exception as e:
            logger.error(f"Error initializing database tables: {e}")
            return

    def update_embedding_configuration(self, id: str, embedding_base_url: Optional[str] = None, embedding_provider: Optional[str] = None,
                            embedding_api_key: Optional[str] = None, embedding_model: Optional[str] = None) -> bool:
        """
        Update or insert configuration.
        
        Args:
            id: configure id as string
            embedding_base_url: Embedding base URL
            embedding_provider: Embedding provider
            embedding_api_key: Embedding API key
            embedding_model: Embedding model name
            
        Returns:
            True if configuration was successfully updated, False otherwise
        """
        try:
            cur = self.conn.cursor()
            
            # Use UPSERT to handle both insert and update cases
            cur.execute("""
                INSERT INTO embedding_configure (
                    id, embedding_base_url, embedding_provider, embedding_api_key, embedding_model, is_active
                ) VALUES (?, ?, ?, ?, ?, ?)        
                ON CONFLICT (id) DO UPDATE SET
                    embedding_base_url = excluded.embedding_base_url,
                    embedding_provider = excluded.embedding_provider,
                    embedding_api_key = excluded.embedding_api_key,
                    embedding_model = excluded.embedding_model,
                    is_active = excluded.is_active
            """, (id, embedding_base_url, embedding_provider, embedding_api_key, embedding_model, 1))
            
            # Commit the transaction to save changes
            self.conn.commit()           
            return cur.rowcount > 0

        except Exception as e:
            logger.error(f"Error updating configuration: {e}")
            raise

    def set_active_embedding_configuration(self, id: str) -> dict:
        """
        Set active configuration, ensuring only one active at a time.
        
        Args:
            id: configure id as string
            
        Returns:
            The active configuration
        """
        try:
            cur = self.conn.cursor()
                        
            cur.execute("""
                UPDATE embedding_configure
                SET is_active = CASE 
                    WHEN id = ? THEN 1 
                    ELSE 0 
                END
            """, (id,))
                        
            # Fetch the active configuration
            cur.execute("SELECT * FROM embedding_configure WHERE is_active = 1")
            config = cur.fetchone()
            
            # Commit the transaction
            self.conn.commit()           
            
            if config:
                return {
                    "id": config[0],
                    "embedding_base_url": config[1],
                    "embedding_provider": config[2],
                    "embedding_api_key": config[3],
                    "embedding_model": config[4]
                }
            else:
                # If no active config found, fetch the one we just tried to activate
                cur.execute("SELECT * FROM embedding_configure WHERE id = ?", (id,))
                config = cur.fetchone()
                if config:
                    return {
                        "id": config[0],
                        "embedding_base_url": config[1],
                        "embedding_provider": config[2],
                        "embedding_api_key": config[3],
                        "embedding_model": config[4]
                    }
                raise ValueError(f"Configuration with id {id} not found")

        except Exception as e:
            # Rollback on error
            self.conn.rollback()
            logger.error(f"Error setting active configuration: {e}")
            raise
            
    def get_active_embedding_configuration(self) -> Optional[dict]:
        """
        Get active configuration.
        
        Returns:
            Configuration dictionary if found, None otherwise
        """
        try:
            cur = self.conn.cursor()
            cur.execute("SELECT * FROM embedding_configure WHERE is_active = 1")
            config = cur.fetchone()
            if config:
                return {
                    "id": config[0],
                    "embedding_base_url": config[1],
                    "embedding_provider": config[2],
                    "embedding_api_key": config[3],
                    "embedding_model": config[4]
                }
            return None
        except Exception as e:
            logger.error(f"Error getting active configuration: {e}")
            return None

    def get_embedding_configuration(self, id: str) -> Optional[dict]:
        """
        Get configuration by ID.
        
        Args:
            id: configure id as string
            
        Returns:
            Configuration dictionary if found, None otherwise
        """
        try:
            cur = self.conn.cursor()
            cur.execute("SELECT * FROM embedding_configure WHERE id = ?", (id,))
            config = cur.fetchone()
            if config:
                return {
                    "id": config[0],
                    "embedding_base_url": config[1],
                    "embedding_provider": config[2],
                    "embedding_api_key": config[3],
                    "embedding_model": config[4]
                }
            return None
        except Exception as e:
            logger.error(f"Error getting configuration: {e}")
            return None
    
    def get_all_embedding_configurations(self) -> list:
        """
        Get all embedding configurations.
        
        Returns:
            List of configuration dictionaries
        """
        try:
            cur = self.conn.cursor()
            cur.execute("SELECT * FROM embedding_configure")
            configs = cur.fetchall()
            return [
                {
                    "id": config[0],
                    "embedding_base_url": config[1],
                    "embedding_provider": config[2],
                    "embedding_api_key": config[3],
                    "embedding_model": config[4],
                    "is_active": config[5]
                }
                for config in configs
            ]
        except Exception as e:
            logger.error(f"Error getting all configurations: {e}")
            return []
    
    def delete_embedding_configuration(self, id: str) -> bool:
        """
        Delete an embedding configuration by ID.
        
        Args:
            id: Configuration ID to delete
            
        Returns:
            True if deletion was successful, False otherwise
        """
        try:
            cur = self.conn.cursor()
            cur.execute("DELETE FROM embedding_configure WHERE id = ?", (id,))
            self.conn.commit()
            return cur.rowcount > 0
        except Exception as e:
            logger.error(f"Error deleting configuration: {e}")
            return False
