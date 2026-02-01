import os
import json
import sqlite3
from typing import List, Dict, Any, Optional, Tuple, Union
from datetime import datetime, timezone, timedelta
from src.utils.logging_config import get_logger

logger = get_logger(__name__)

class IndexManager:
    """Manages index runs using SQLite database"""
    
    def __init__(self, conn: sqlite3.Connection):
        """
        Initialize the index manager with database connection.
        
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
            
            # Create index_run table
            cur.execute("""
                CREATE TABLE IF NOT EXISTS index_run (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    chunk_run_id INTEGER,
                    embedding_configure_id TEXT,
                    run_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (chunk_run_id) REFERENCES chunk_run(id) ON DELETE CASCADE,
                    FOREIGN KEY (embedding_configure_id) REFERENCES embedding_configure(id) ON DELETE CASCADE,
                    UNIQUE(chunk_run_id, embedding_configure_id)
                )
            """)
            
            self.conn.commit()
        except Exception as e:
            logger.error(f"Error initializing database tables: {e}")
            return
    
    def create_index_run(self, chunk_run_id: int, embedding_configure_id: str) -> Tuple[bool, str]:
        """
        Create a new index run record.
        
        Args:
            chunk_run_id: ID of the chunk run
            embedding_configure_id: ID of the embedding configuration
            
        Returns:
            True if the record was created successfully, False otherwise
        """
        try:
            cur = self.conn.cursor()
            
            cur.execute("""
                INSERT INTO index_run (chunk_run_id, embedding_configure_id)
                VALUES (?, ?)
            """, (chunk_run_id, embedding_configure_id))
            
            self.conn.commit()
            return cur.rowcount > 0, ""
        except sqlite3.IntegrityError as e:
            if "UNIQUE constraint failed" in str(e):
                # Handle duplicate entry case
                fail_reason = f"Index run already exists for chunk_run_id {chunk_run_id} and embedding_configure_id {embedding_configure_id}"
            else:
                fail_reason = f"Integrity error creating index run: {e}"
            logger.error(fail_reason)
            return False, fail_reason
    
        except Exception as e:
            fail_reason = f"Error creating index run: {e}"
            logger.error(fail_reason)
            return False, fail_reason
    
    def get_index_runs(self) -> List[Dict[str, Any]]:
        """
        Get all index runs.
        
        Returns:
            List of index run dictionaries
        """
        try:
            cur = self.conn.cursor()
            cur.execute("SELECT index_run.id, index_run.chunk_run_id, index_run.embedding_configure_id, index_run.run_time, chunk_run.framework FROM index_run JOIN chunk_run ON index_run.chunk_run_id = chunk_run.id ORDER BY index_run.run_time DESC")
            runs = cur.fetchall()
            return [
                {
                    "id": run[0],
                    "chunk_run_id": run[1],
                    "embedding_configure_id": run[2],
                    "run_time": run[3],
                    "framework": run[4]
                }
                for run in runs
            ]
        except Exception as e:
            logger.error(f"Error getting index runs: {e}")
            return []
    
    def get_index_run_by_id(self, id: int) -> Optional[Dict[str, Any]]:
        """
        Get an index run by ID.
        
        Args:
            id: Index run ID
            
        Returns:
            Index run dictionary if found, None otherwise
        """
        try:
            cur = self.conn.cursor()
            cur.execute("SELECT index_run.id, index_run.chunk_run_id, index_run.embedding_configure_id, index_run.run_time, chunk_run.framework FROM index_run JOIN chunk_run ON index_run.chunk_run_id = chunk_run.id WHERE index_run.id = ?", (id,))
            run = cur.fetchone()
            if run:
                return {
                    "id": run[0],
                    "chunk_run_id": run[1],
                    "embedding_configure_id": run[2],
                    "run_time": run[3],
                    "framework": run[4]
                }
            return None
        except Exception as e:
            logger.error(f"Error getting index run by ID: {e}")
            return None

    def get_index_runs_by_knowledgebase_id(self, knowledgebase_id: int) -> List[Dict[str, Any]]:
        """
        Get index runs for a specific knowledgebase, ordered by run_time descending.
        
        Args:
            knowledgebase_id: ID of the knowledgebase
            
        Returns:
            List of index run dictionaries
        """
        try:
            cur = self.conn.cursor()
            # Get all chunk_run_ids for knowledgebase_id
            chunk_run_ids = []
            cur.execute(
                "SELECT id FROM chunk_run WHERE knowledgebase_id = ?",
                (knowledgebase_id,)
            )
            chunk_run_ids = [row[0] for row in cur.fetchall()]
            if not chunk_run_ids:
                return []
            # Create dynamic placeholders for the IN clause
            placeholders = ','.join(['?' for _ in chunk_run_ids])
            cur.execute(
                f"SELECT index_run.id, index_run.chunk_run_id, index_run.embedding_configure_id, index_run.run_time, chunk_run.framework FROM index_run JOIN chunk_run ON index_run.chunk_run_id = chunk_run.id WHERE index_run.chunk_run_id IN ({placeholders}) ORDER BY index_run.run_time DESC",
                chunk_run_ids
            )
            runs = []
            for row in cur.fetchall():
                runs.append({
                    "id": row[0],
                    "chunk_run_id": row[1],
                    "embedding_configure_id": row[2],
                    "run_time": row[3],
                    "framework": row[4]
                })
            return runs
        except Exception as e:
            logger.error(f"Error getting index runs by knowledgebase ID: {e}")
            return []

    
    def get_index_runs_by_chunk_run_id(self, chunk_run_id: int) -> List[Dict[str, Any]]:
        """
        Get index runs by chunk run ID.
        
        Args:
            chunk_run_id: Chunk run ID
            
        Returns:
            List of index run dictionaries
        """
        try:
            cur = self.conn.cursor()
            cur.execute("SELECT index_run.id, index_run.chunk_run_id, index_run.embedding_configure_id, index_run.run_time, chunk_run.framework FROM index_run JOIN chunk_run ON index_run.chunk_run_id = chunk_run.id WHERE index_run.chunk_run_id = ? ORDER BY index_run.run_time DESC", (chunk_run_id,))
            runs = cur.fetchall()
            return [
                {
                    "id": run[0],
                    "chunk_run_id": run[1],
                    "embedding_configure_id": run[2],
                    "run_time": run[3],
                    "framework": run[4]
                }
                for run in runs
            ]
        except Exception as e:
            logger.error(f"Error getting index runs by chunk run ID: {e}")
            return []

    def delete_index_run(self, id: int) -> bool:
        """
        Delete an index run by ID.
        
        Args:
            id: Index run ID
            
        Returns:
            True if the record was deleted successfully, False otherwise
        """
        try:
            cur = self.conn.cursor()
            cur.execute("DELETE FROM index_run WHERE id = ?", (id,))
            self.conn.commit()
            return True
        except Exception as e:
            logger.error(f"Error deleting index run by ID: {e}")
            return False
