import os
import json
import sqlite3
from datetime import datetime
from typing import List, Dict, Any, Optional, Tuple, Union

from src.utils.logging_config import get_logger

logger = get_logger(__name__)

class ParserManager:
    """
    Manages parsing configurations and parsed content.
    """
    
    def __init__(self, conn: sqlite3.Connection):
        """
        Initialize the ParserManager with a database connection.
        
        Args:
            conn: SQLite database connection.
        """
        self.conn = conn
        self._init_parse_tables()
        
    def _init_parse_tables(self):
        """
        Initialize parse-related database tables if they don't exist.
        """
        try:
            cur = self.conn.cursor()
            
            # Create parse_run table for storing parse processing configurations
            cur.execute("""
                CREATE TABLE IF NOT EXISTS parse_run (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    file_id INTEGER NOT NULL,
                    time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (file_id) REFERENCES files(file_id) ON DELETE CASCADE
                )
            """)
            
            # Create parsed table for storing parsed content
            cur.execute("""
                CREATE TABLE IF NOT EXISTS parsed (
                    parse_id INTEGER PRIMARY KEY AUTOINCREMENT,
                    file_id INTEGER NOT NULL,
                    parse_run_id INTEGER NOT NULL,
                    parsed_text TEXT,
                    parser TEXT NOT NULL,
                    parameters TEXT DEFAULT '{}',
                    is_active INTEGER DEFAULT 0,
                    time TIMESTAMP,
                    FOREIGN KEY (file_id) REFERENCES files(file_id) ON DELETE CASCADE,
                    FOREIGN KEY (parse_run_id) REFERENCES parse_run(id) ON DELETE CASCADE
                )
            """)
            
            # Create indexes for efficient queries
            cur.execute("CREATE INDEX IF NOT EXISTS idx_parsed_parse_run_id ON parsed(parse_run_id)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_parsed_file_id ON parsed(file_id)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_parsed_is_active ON parsed(is_active)")

            self.conn.commit()
        except Exception as e:
            logger.error(f"Error initializing parse tables: {e}")
            raise
    
    def create_parse_run(self, file_id: int) -> int:
        """
        Create a new parse run record.
        
        Args:
            file_id: File ID of the parse run
            
        Returns:
            The created parse_run ID and time
        """
        try:
            cur = self.conn.cursor()
            
            cur.execute(
                "INSERT INTO parse_run (file_id) VALUES (?)",
                (file_id,)  
            )
            # Get the parse_run ID from the last inserted row
            parse_run_id = cur.lastrowid
            
            # Get the time for the newly created parse run
            cur.execute(
                "SELECT time FROM parse_run WHERE id = ?",
                (parse_run_id,)  
            )
            row = cur.fetchone()
            parse_run_time = row[0]
            
            self.conn.commit()
            return parse_run_id, parse_run_time
        except Exception as e:
            logger.error(f"Error creating parse run: {e}")
            raise
    
    def add_parsed_content(self, file_id: int, parse_run_id: int, parse_run_time: str, parsed_text: str, parser: str, parameters: dict, is_active: bool = True) -> int:
        """
        Add parsed content to the database.
        
        Args:
            file_id: ID of the file
            parse_run_id: ID of the parse run
            parse_run_time: Time of the parse run
            parsed_text: Parsed text content
            parser: Name of the parser used
            parameters: Parser parameters as a dictionary
            is_active: Whether this parsed content is active
            
        Returns:
            The created parsed ID
        """
        try:
            cur = self.conn.cursor()
            
            params_json = json.dumps(parameters)
            
            cur.execute(
                "INSERT INTO parsed (file_id, parse_run_id, parsed_text, parser, parameters, is_active, time) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (file_id, parse_run_id, parsed_text, parser, params_json, 1 if is_active else 0, parse_run_time)
            )
            parsed_id = cur.lastrowid
            
            # If this is active, deactivate other parsed content for the same file
            if is_active:
                cur.execute(
                    "UPDATE parsed SET is_active = 0 WHERE file_id = ? AND parse_id != ?",
                    (file_id, parsed_id)
                )
            
            self.conn.commit()
            return parsed_id
        except Exception as e:
            logger.error(f"Error adding parsed content: {e}")
            raise
    
    def get_parse_run(self, parse_run_id: int) -> Optional[Dict[str, Any]]:
        """
        Get a parse run by ID.
        
        Args:
            parse_run_id: ID of the parse run
            
        Returns:
            Parse run dictionary if found, None otherwise
        """
        try:
            cur = self.conn.cursor()
            cur.execute(
                "SELECT id, file_id, time FROM parse_run WHERE id = ?",
                (parse_run_id,)
            )
            row = cur.fetchone()
            if row:
                return {
                    "id": row[0],
                    "file_id": row[1],
                    "time": row[2]
                }
            return None
        except Exception as e:
            logger.error(f"Error getting parse run: {e}")
            raise
    
    def get_parsed_content_by_file_id(self, file_id: int, is_active: bool = None) -> List[Dict[str, Any]]:
        """
        Get parsed content for a specific file.
        
        Args:
            file_id: ID of the file
            is_active: Optional filter for active status
            
        Returns:
            List of parsed content records
        """
        try:
            cur = self.conn.cursor()
            
            if is_active is not None:
                cur.execute(
                    "SELECT parse_id, file_id, parse_run_id, parsed_text, parser, parameters, is_active, time FROM parsed WHERE file_id = ? AND is_active = ?",
                    (file_id, 1 if is_active else 0)
                )
            else:
                cur.execute(
                    "SELECT parse_id, file_id, parse_run_id, parsed_text, parser, parameters, is_active, time FROM parsed WHERE file_id = ?",
                    (file_id,)
                )
            
            parsed_contents = []
            for row in cur.fetchall():
                parsed_contents.append({
                    "parse_id": row[0],
                    "file_id": row[1],
                    "parse_run_id": row[2],
                    "parsed_text": row[3],
                    "parser": row[4],
                    "parameters": json.loads(row[5]),
                    "is_active": bool(row[6]),
                    "time": row[7]
                })
            
            return parsed_contents
        except Exception as e:
            logger.error(f"Error getting parsed content by file ID: {e}")
            raise

    def get_parsed_content_by_run_id(self, file_id: int, parse_run_id: int) -> Dict[str, Any]:
        """
        Get parsed content for a specific parse run ID.
        
        Args:
            file_id: ID of the file
            parse_run_id: Optional filter for parse run ID
            
        Returns:
            Parsed content dictionary
        """
        try:
            cur = self.conn.cursor()     

            cur.execute(
                "SELECT parse_id, file_id, parse_run_id, parsed_text, parser, parameters, is_active, time FROM parsed WHERE file_id = ? AND parse_run_id = ?",
                (file_id, parse_run_id)
            )
            
            parsed_contents = []
            for row in cur.fetchall():
                parsed_contents.append({
                    "parse_id": row[0],
                    "file_id": row[1],
                    "parse_run_id": row[2],
                    "parsed_text": row[3],
                    "parser": row[4],
                    "parameters": json.loads(row[5]),
                    "is_active": bool(row[6])
                })
            
            return parsed_contents
        except Exception as e:
            logger.error(f"Error getting parsed content by run ID: {e}")
            raise

    def get_parse_runs_by_file_id(self, file_id: int) -> List[Dict[str, Any]]:
        """
        Get all parse run records for a specific file.
        
        Args:
            file_id: ID of the file
            
        Returns:
            List of parse run records, each with 'id', 'file_id', 'parser', 'parameters', and 'time'     
        """
        try:
            cur = self.conn.cursor()
            cur.execute(
                "SELECT parse_run_id, file_id, parser, parameters, time, is_active FROM parsed WHERE file_id = ?",
                (file_id,)
            )
            
            parse_runs = []
            for row in cur.fetchall():
                parse_runs.append({
                    "id": row[0],
                    "file_id": row[1],
                    "parser": row[2],
                    "parameters": json.loads(row[3]),
                    "time": row[4],
                    "is_active": bool(row[5])
                })
            
            return parse_runs
        except Exception as e:
            logger.error(f"Error getting parse runs by file ID: {e}")
            raise

    
    def get_files_by_parse_run_id(self, parse_run_id: int) -> List[int]:
        """
        Get all file IDs associated with a parse run.
        
        Args:
            parse_run_id: ID of the parse run
            
        Returns:
            List of file IDs
        """
        try:
            cur = self.conn.cursor()
            cur.execute(
                "SELECT file_id FROM parsed WHERE parse_run_id = ?",
                (parse_run_id,)
            )
            
            file_ids = [row[0] for row in cur.fetchall()]
            return file_ids
        except Exception as e:
            logger.error(f"Error getting files by parse run ID: {e}")
            raise
    
    def set_active_parse_run(self, file_id: int, parse_run_id: int) -> bool:
        """
        Set a specific parse run as active, deactivating all others for the same file.
        
        Args:
            file_id: ID of the file
            parse_run_id: ID of the parse run to set as active
            
        Returns:
            True if the update was successful
        """
        try:
            cur = self.conn.cursor()
                       
            # Set all parsed content for this file to inactive
            cur.execute(
                "UPDATE parsed SET is_active = 0 WHERE file_id = ?",
                (file_id,)
            )
            
            # Set the specified parse run to active
            cur.execute(
                "UPDATE parsed SET is_active = 1 WHERE file_id = ? AND parse_run_id = ?",
                (file_id, parse_run_id,)
            )
            
            # Commit the transaction
            self.conn.commit()
            return cur.rowcount > 0
        except Exception as e:
            # Rollback on error
            self.conn.rollback()
            logger.error(f"Error setting active parse run: {e}")
            raise
    
    def delete_parse_run(self, parse_run_id: int, filepath: str) -> bool:
        """
        Delete a parse run and all associated records.
        
        Args:
            parse_run_id: ID of the parse run to delete
            filepath: Path of the file or folder to delete the parse run for
            
        Returns:
            True if deletion was successful
        """
        try:
            cur = self.conn.cursor()
            
            # Get file type and path
            cur.execute(
                "SELECT file_id, type, filepath FROM files WHERE filepath = ?",
                (filepath,)
            )
            file_info = cur.fetchone()
            
            if not file_info:
                raise ValueError(f"File with filepath {filepath} not found")
            
            file_id, file_type, file_path = file_info[0], file_info[1], file_info[2]
   
            # Delete the parse_run record. If the parse was run on this file_id, all children will be deleted as CASCADE
            cur.execute(
                "DELETE FROM parse_run WHERE id = ? AND file_id = ?",
                (parse_run_id, file_id)
            )
            if cur.rowcount > 0:
                self.conn.commit()
                return True
                                 
            if file_type == 'file':
                cur.execute(
                    "DELETE FROM parsed WHERE parse_run_id = ? AND file_id = ?",
                    (parse_run_id, file_id)
                )
                logger.info(f"Delete parsed record for file {file_path}")
            else:  # folder
                # Convert backslashes to forward slashes for consistent path matching
                path_prefix_windows = filepath.replace('\\', '\\\\')
                path_prefix_unix = filepath.replace('\\', '/')
                
                # If it's a folder, delete all records with filepath under the folder with the parse_run_id
                # Get all file_ids for files under this folder
                cur.execute(
                    "SELECT file_id FROM files WHERE filepath LIKE ? ESCAPE '\\' OR filepath LIKE ? ESCAPE '\\'",
                    (f"{path_prefix_windows}%", f"{path_prefix_unix}%")
                )
                folder_file_ids = [row[0] for row in cur.fetchall()]
                
                if folder_file_ids:
                    # Delete all parsed records for these files with the given parse_run_id
                    placeholders = ','.join('?' * len(folder_file_ids))
                    cur.execute(
                        f"DELETE FROM parsed WHERE parse_run_id = ? AND file_id IN ({placeholders})",
                        (parse_run_id, *folder_file_ids)
                    )
                    logger.info(f"Delete {len(folder_file_ids)} parsed records under folder {filepath}")
            
            self.conn.commit()
            return True
        except Exception as e:
            logger.error(f"Error deleting parse run: {e}")
            raise