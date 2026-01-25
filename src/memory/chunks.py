import os
import json
import sqlite3
from datetime import datetime
from typing import List, Dict, Any, Optional, Tuple, Union

from src.utils.logging_config import get_logger

logger = get_logger(__name__)

class ChunkingManager:
    """
    Manages chunk processing configurations and individual chunks.
    """
    
    def __init__(self, conn: sqlite3.Connection):
        """
        Initialize the ChunkingManager with a database connection.
        
        Args:
            conn: SQLite database connection.
        """
        self.conn = conn
        self._init_chunk_tables()
        
    def _init_chunk_tables(self):
        """
        Initialize chunk-related database tables if they don't exist.
        """
        try:
            cur = self.conn.cursor()
            
            # Create chunk_run table for storing chunk processing configurations
            cur.execute("""
                CREATE TABLE IF NOT EXISTS chunk_run (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,                   
                    knowledgebase_id INTEGER NOT NULL,
                    framework TEXT DEFAULT 'langchain',
                    parameters TEXT DEFAULT '{}',
                    run_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (knowledgebase_id) REFERENCES knowledgebase(id) ON DELETE CASCADE
                )
            """)
            
            # Create chunks table for storing individual chunks
            cur.execute("""
                CREATE TABLE IF NOT EXISTS chunks (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    chunk_id TEXT NOT NULL,
                    file_id INTEGER NOT NULL,
                    parse_run_id INTEGER NOT NULL,
                    chunk_run_id INTEGER NOT NULL,
                    content TEXT NOT NULL,
                    metadata TEXT DEFAULT '{}',
                    FOREIGN KEY (file_id) REFERENCES files(file_id) ON DELETE CASCADE,
                    FOREIGN KEY (chunk_run_id) REFERENCES chunk_run(id) ON DELETE CASCADE
                )
            """)
            
            # Create indexes for efficient queries
            cur.execute("CREATE INDEX IF NOT EXISTS idx_chunks_file_id ON chunks(file_id)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_chunks_chunk_run_id ON chunks(chunk_run_id)")

            self.conn.commit()
        except Exception as e:
            logger.error(f"Error initializing chunk tables: {e}")
            raise
    
    def save_chunk_run_config(self, knowledgebase_id: int, framework: str, chunk_parameters: dict) -> int:
        """
        Save chunk run configuration to the chunk_run table.
        
        Args:
            knowledgebase_id: ID of the knowledgebase associated with this chunk run
            markdown_header_splitting: Whether markdown header splitting is enabled
            recursive_splitting: Whether recursive splitting is enabled
            markdown_header_splitting_parameters: Markdown header splitting parameters as a dict
            recursive_splitting_parameters: Recursive splitting parameters as a dict
            
        Returns:
            The created chunk_run ID
        """
        try:
            cur = self.conn.cursor()
            
            params_json = json.dumps(chunk_parameters)
            
            cur.execute(
                "INSERT INTO chunk_run (knowledgebase_id, framework, parameters) VALUES (?, ?, ?)",
                (knowledgebase_id, framework, params_json)
            )
            chunk_run_id = cur.lastrowid
            self.conn.commit()
            return chunk_run_id
        except Exception as e:
            logger.error(f"Error saving chunk processing config: {e}")
            raise
    
    def get_chunk_run_config(self, chunk_run_id: int) -> dict:
        """
        Get chunk run configuration by ID.
        
        Args:
            chunk_run_id: ID of the chunk_run record
            
        Returns:
            Chunk processing configuration if found, None otherwise
        """
        try:
            cur = self.conn.cursor()
            cur.execute(
                "SELECT id, knowledgebase_id, framework, parameters, run_time FROM chunk_run WHERE id = ?",
                (chunk_run_id,)
            )
            row = cur.fetchone()
            if row:
                return {
                    "id": row[0],
                    "knowledgebase_id": row[1],
                    "framework": row[2],
                    "parameters": json.loads(row[3]),
                    "run_time": row[4]
                }
            return None
        except Exception as e:
            logger.error(f"Error getting chunk processing config: {e}")
            raise
    
    def get_latest_chunk_run_config(self, knowledgebase_id: int = None) -> dict:
        """
        Get the latest chunk run configuration.
        
        Args:
            knowledgebase_id: Optional knowledgebase ID to filter by
            
        Returns:
            Latest chunk run configuration if found, None otherwise
        """
        try:
            cur = self.conn.cursor()
            
            if knowledgebase_id:
                cur.execute(
                    "SELECT id, knowledgebase_id, framework, parameters, run_time FROM chunk_run WHERE knowledgebase_id = ? ORDER BY id DESC LIMIT 1",
                    (knowledgebase_id,)
                )
            else:
                cur.execute(
                    "SELECT id, knowledgebase_id, framework, parameters, run_time FROM chunk_run ORDER BY id DESC LIMIT 1"
                )
            
            row = cur.fetchone()
            if row:
                return {
                    "id": row[0],
                    "knowledgebase_id": row[1],
                    "framework": row[2],
                    "parameters": json.loads(row[3]),
                    "run_time": row[4]
                }
            return None
        except Exception as e:
            logger.error(f"Error getting latest chunk processing config: {e}")
            raise
    
    def add_chunks(self, chunks: List[Dict[str, Any]]) -> int:
        """
        Add chunks to the chunks table.
        
        Args:
            chunks: List of chunk dictionaries, each containing chunk_id, file_id, chunk_run_id, content, and optional metadata
            
        Returns:
            The number of chunks added or updated
        """
        try:
            cur = self.conn.cursor()
            
            # Prepare data for insertion
            chunk_data = []
            for chunk in chunks:
                chunk_data.append((
                    chunk["chunk_id"],
                    chunk["file_id"],
                    chunk["parse_run_id"],
                    chunk["chunk_run_id"],
                    chunk["content"],
                    json.dumps(chunk.get("metadata", {}))
                ))
            
            # Insert chunks with UPSERT (update if chunk_id exists)
            cur.executemany(
                """
                INSERT INTO chunks (chunk_id, file_id, parse_run_id, chunk_run_id, content, metadata) 
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                chunk_data
            )
            
            self.conn.commit()
            return cur.rowcount
        except Exception as e:
            logger.error(f"Error adding chunks: {e}")
            raise
    
    def get_chunks_by_file_id(self, file_id: int, chunk_run_ids: List[int] = None) -> List[Dict[str, Any]]:
        """
        Get all chunks for a specific file with active parse_run_id.
        
        Args:
            file_id: ID of the file
            
        Returns:
            List of chunk records with active parse_run_id
        """
        try:
            cur = self.conn.cursor()
            if chunk_run_ids:
                cur.execute(
                    "SELECT c.chunk_id, c.file_id, c.parse_run_id, c.chunk_run_id, c.content, c.metadata FROM chunks c JOIN parsed p ON c.parse_run_id = p.parse_run_id AND c.file_id = p.file_id AND p.is_active = 1 WHERE c.file_id = ? AND c.chunk_run_id IN ({}) ".format(','.join('?'*len(chunk_run_ids))),
                    (file_id, *chunk_run_ids)
                )
            else:
                cur.execute(
                    "SELECT c.chunk_id, c.file_id, c.parse_run_id, c.chunk_run_id, c.content, c.metadata FROM chunks c JOIN parsed p ON c.parse_run_id = p.parse_run_id AND c.file_id = p.file_id AND p.is_active = 1 WHERE c.file_id = ?",
                    (file_id,)
                )
            
            chunks = []
            for row in cur.fetchall():
                chunks.append({
                    "chunk_id": row[0],
                    "file_id": row[1],
                    "parse_run_id": row[2],
                    "chunk_run_id": row[3],
                    "content": row[4],
                    "metadata": json.loads(row[5])
                })
            
            return chunks
        except Exception as e:
            logger.error(f"Error getting chunks by file ID: {e}")
            raise
    
    def get_chunks_by_chunk_run_id(self, chunk_run_id: int) -> List[Dict[str, Any]]:
        """
        Get all chunks for a specific chunk run.
        
        Args:
            chunk_run_id: ID of the chunk run
            
        Returns:
            List of chunk records
        """
        try:
            cur = self.conn.cursor()
            cur.execute(
                "SELECT chunk_id, file_id, parse_run_id, chunk_run_id, content, metadata FROM chunks WHERE chunk_run_id = ?",
                (chunk_run_id,)
            )
            
            chunks = []
            for row in cur.fetchall():
                chunks.append({
                    "chunk_id": row[0],
                    "file_id": row[1],
                    "parse_run_id": row[2],
                    "chunk_run_id": row[3],
                    "content": row[4],
                    "metadata": json.loads(row[5])
                })
            
            return chunks
        except Exception as e:
            logger.error(f"Error getting chunks by chunk run ID: {e}")
            raise
    
    def delete_chunks_by_file_id(self, file_id: int) -> int:
        """
        Delete all chunks for a specific file.
        
        Args:
            file_id: ID of the file
            
        Returns:
            The number of chunks deleted
        """
        try:
            cur = self.conn.cursor()
            cur.execute(
                "DELETE FROM chunks WHERE file_id = ?",
                (file_id,)
            )
            
            self.conn.commit()
            return cur.rowcount
        except Exception as e:
            logger.error(f"Error deleting chunks by file ID: {e}")
            raise
    
    def delete_chunks_by_chunk_run_id(self, chunk_run_id: int) -> int:
        """
        Delete all chunks for a specific chunk run.
        
        Args:
            chunk_run_id: ID of the chunk run
            
        Returns:
            The number of chunks deleted
        """
        try:
            cur = self.conn.cursor()
            cur.execute(
                "DELETE FROM chunks WHERE chunk_run_id = ?",
                (chunk_run_id,)
            )
            
            self.conn.commit()
            return cur.rowcount
        except Exception as e:
            logger.error(f"Error deleting chunks by chunk run ID: {e}")
            raise
    
    def delete_chunk_run(self, chunk_run_id: int) -> bool:
        """
        Delete a chunk run and all associated chunks.
        
        Args:
            chunk_run_id: ID of the chunk run to delete
            
        Returns:
            True if deletion was successful, False otherwise
        """
        try:
            cur = self.conn.cursor()
            
            # Start a transaction
            cur.execute("BEGIN TRANSACTION")
            
            # Delete chunks first (foreign key constraint will handle this automatically)
            # Then delete the chunk_run record
            cur.execute(
                "DELETE FROM chunk_run WHERE id = ?",
                (chunk_run_id,)
            )
            
            if cur.rowcount > 0:
                # Commit the transaction
                self.conn.commit()
                return True
            else:
                # No record found, rollback
                self.conn.rollback()
                return False
        except Exception as e:
            # Rollback on error
            self.conn.rollback()
            logger.error(f"Error deleting chunk run: {e}")
            raise
    
    def get_chunk_runs_by_knowledgebase_id(self, knowledgebase_id: int) -> List[Dict[str, Any]]:
        """
        Get all chunk runs for a specific knowledgebase, ordered by run_time descending.
        
        Args:
            knowledgebase_id: ID of the knowledgebase
            
        Returns:
            List of chunk run records
        """
        try:
            cur = self.conn.cursor()
            cur.execute(
                "SELECT id, knowledgebase_id, framework, parameters, run_time FROM chunk_run WHERE knowledgebase_id = ? ORDER BY run_time DESC",
                (knowledgebase_id,)
            )
            
            chunk_runs = []
            for row in cur.fetchall():
                chunk_runs.append({
                    "id": row[0],
                    "knowledgebase_id": row[1],
                    "framework": row[2],
                    "parameters": json.loads(row[3]),
                    "run_time": row[4]
                })
            
            return chunk_runs
        except Exception as e:
            logger.error(f"Error getting chunk runs by knowledgebase ID: {e}")
            raise

    def get_chunk_runs_by_file_id(self, file_id: int) -> List[Dict[str, Any]]:
        """
        Get all chunk runs that have chunks with the designated file_id, ordered by run_time descending.
        
        Args:
            file_id: ID of the file
            
        Returns:
            List of chunk run records
        """
        try:
            cur = self.conn.cursor()
            cur.execute(
                "SELECT DISTINCT chunk_run.id, chunk_run.knowledgebase_id, chunk_run.framework, chunk_run.parameters, chunk_run.run_time "
                "FROM chunk_run "
                "JOIN chunks ON chunk_run.id = chunks.chunk_run_id "
                "JOIN parsed ON chunks.parse_run_id = parsed.parse_run_id AND parsed.is_active = 1 "
                "WHERE chunks.file_id = ? "
                "ORDER BY chunk_run.run_time DESC",
                (file_id,)
            )
            
            chunk_runs = []
            for row in cur.fetchall():
                chunk_runs.append({
                    "id": row[0],
                    "knowledgebase_id": row[1],
                    "framework": row[2],
                    "parameters": json.loads(row[3]),
                    "run_time": row[4]
                })
            
            return chunk_runs
        except Exception as e:
            logger.error(f"Error getting chunk runs by file ID: {e}")
            raise
