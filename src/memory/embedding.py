import os
import json
import sqlite3
from typing import List, Dict, Any, Optional, Tuple, Union
from datetime import datetime, timezone, timedelta
from src.memory.vector_store import drop_vec_table
from src.utils.logging_config import get_logger

logger = get_logger(__name__)


def _embedding_config_dict(row: sqlite3.Row) -> dict:
    keys = row.keys()
    return {
        "id": row["id"],
        "embedding_base_url": row["embedding_base_url"],
        "embedding_provider": row["embedding_provider"],
        "embedding_api_key": row["embedding_api_key"],
        "embedding_model": row["embedding_model"],
        "is_active": row["is_active"],
        "embedding_dim": row["embedding_dim"] if "embedding_dim" in keys else None,
    }

class EmbeddingManager:
    """Manages embedding configurations using SQLite database"""
    
    def __init__(self, conn: sqlite3.Connection):
        """
        Initialize the embedding manager with database connection.
        
        Args:
            conn: SQLite database connection
        """
        self.conn = conn
        self._init_db_tables()
    
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
            cur.execute("PRAGMA table_info(embedding_configure)")
            cols = {row[1] for row in cur.fetchall()}
            if "embedding_dim" not in cols:
                cur.execute(
                    "ALTER TABLE embedding_configure ADD COLUMN embedding_dim INTEGER"
                )

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
                d = _embedding_config_dict(config)
                del d["is_active"]
                return d
            else:
                # If no active config found, fetch the one we just tried to activate
                cur.execute("SELECT * FROM embedding_configure WHERE id = ?", (id,))
                config = cur.fetchone()
                if config:
                    d = _embedding_config_dict(config)
                    del d["is_active"]
                    return d
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
                d = _embedding_config_dict(config)
                del d["is_active"]
                return d
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
                d = _embedding_config_dict(config)
                del d["is_active"]
                return d
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
            return [_embedding_config_dict(config) for config in configs]
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
            drop_vec_table(self.conn, id)

            # Check if the record being deleted is active
            cur.execute("SELECT is_active FROM embedding_configure WHERE id = ?", (id,))
            record = cur.fetchone()
            is_active_record = record and record[0] == 1
            
            # Delete the record
            cur.execute("DELETE FROM embedding_configure WHERE id = ?", (id,))
            delete_success = cur.rowcount > 0
            
            # If we deleted an active record, set the first remaining record to active
            if delete_success and is_active_record:
                # Get all remaining records
                cur.execute("SELECT id FROM embedding_configure")
                remaining_records = cur.fetchall()
                
                if remaining_records:
                    # Set the first remaining record as active
                    first_record_id = remaining_records[0][0]
                    cur.execute("UPDATE embedding_configure SET is_active = 1 WHERE id = ?", (first_record_id,))
            
            self.conn.commit()
            return delete_success
        except Exception as e:
            logger.error(f"Error deleting configuration: {e}")
            return False
