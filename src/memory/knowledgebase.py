import os
import json
import sqlite3
from datetime import datetime
from typing import List, Dict, Any, Optional, Tuple, Union

from src.utils.logging_config import get_logger

logger = get_logger(__name__)

class KnowledgebaseManager:
    """
    Manages knowledgebase creation, updates, and file operations.
    """
    
    def __init__(self, conn: sqlite3.Connection):
        """
        Initialize the KnowledgebaseManager with a database connection.
        
        Args:
            conn: SQLite database connection.
        """
        self.conn = conn
        self._init_knowledgebase_tables()
        
    def _init_knowledgebase_tables(self):
        """
        Initialize knowledgebase-related database tables if they don't exist.
        """
        try:
            cur = self.conn.cursor()
            
            # Create knowledgebase table (no user_id)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS knowledgebase (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    description TEXT,
                    root_path TEXT NOT NULL,
                    is_active INTEGER DEFAULT 0,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE (name)
                )
            """)
            
            # Create files table for storing document files
            cur.execute("""
                CREATE TABLE IF NOT EXISTS files (
                    file_id INTEGER PRIMARY KEY AUTOINCREMENT,
                    filename TEXT NOT NULL,
                    filepath TEXT NOT NULL UNIQUE,
                    parsed_text TEXT NOT NULL,
                    uploaded_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    knowledgebase_id INTEGER NOT NULL,
                    file_size INTEGER,
                    description TEXT,
                    type TEXT NOT NULL CHECK (type IN ('file', 'folder')),
                    parent INTEGER,
                    FOREIGN KEY (knowledgebase_id) REFERENCES knowledgebase(id) ON DELETE CASCADE,
                    FOREIGN KEY (parent) REFERENCES files(file_id) ON DELETE CASCADE,
                    CHECK (type != 'file' OR file_size IS NOT NULL)
                )
            """)
            
            # Create index on files.knowledgebase_id for efficient queries
            cur.execute("""
                CREATE INDEX IF NOT EXISTS idx_files_knowledgebase_id ON files(knowledgebase_id)
            """)
            
            # Create index on files.filepath for efficient queries
            cur.execute("""
                CREATE INDEX IF NOT EXISTS idx_files_filepath ON files(filepath)
            """)

            self.conn.commit()
        except Exception as e:
            logger.error(f"Error initializing knowledgebase tables: {e}")
            raise
    
    def create_knowledgebase(self, name: str, root_path: str, description: str = None) -> int:
        """
        Create a new knowledge base.
        
        Args:
            name: Knowledge base name
            root_path: Root folder path for the knowledge base
            description: Optional knowledge base description
            
        Returns:
            The created knowledge base ID
        """
        try:
            cur = self.conn.cursor()
            
            # Insert the new knowledgebase as active
            cur.execute(
                "INSERT INTO knowledgebase (name, description, root_path, is_active) VALUES (?, ?, ?, ?)",
                (name, description, root_path, 1)
            )
            knowledgebase_id = cur.lastrowid

            # Create root folder                    
            cur.execute(
                """
                INSERT INTO files (filename, filepath, parsed_text, knowledgebase_id, file_size, description, type, parent)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                ('root', root_path, 'root', knowledgebase_id, None, 'root folder for the knowledgebase', 'folder', None)
            )
            
            # Set all other knowledgebases to inactive
            cur.execute(
                "UPDATE knowledgebase SET is_active = 0 WHERE is_active = 1 AND id != ?",
                (knowledgebase_id,)
            )
            
            self.conn.commit()
            return knowledgebase_id
        except sqlite3.IntegrityError as e:
            if 'UNIQUE constraint' in str(e):
                raise ValueError("Knowledgebase with this name already exists")
            raise
        except Exception as e:
            raise
    
    def get_all_knowledgebases(self) -> list:
        """
        Get all knowledgebases.
        
        Returns:
            List of knowledgebase records
        """
        try:
            cur = self.conn.cursor()
            cur.execute("""
                SELECT id, name, description, root_path, is_active, created_at, updated_at
                FROM knowledgebase
                ORDER BY is_active DESC, updated_at DESC
            """)
            # Convert results to dictionaries
            results = []
            for row in cur.fetchall():
                results.append({
                    "id": row[0],
                    "name": row[1],
                    "description": row[2],
                    "root_path": row[3],
                    "is_active": bool(row[4]),
                    "created_at": row[5],
                    "updated_at": row[6]
                })
            return results
        except Exception as e:
            logger.error(f"Error getting knowledgebases: {e}")
            raise
    
    def set_active_knowledgebase(self, knowledgebase_id: int) -> bool:
        """
        Set a specific knowledgebase as active, deactivating all other knowledgebases.
        
        Args:
            knowledgebase_id: ID of the knowledgebase to set as active
            
        Returns:
            True if the update was successful
        """
        try:
            cur = self.conn.cursor()
            # Update all knowledgebases - set the specified one to active, others to inactive
            cur.execute("""
                UPDATE knowledgebase
                SET is_active = CASE 
                    WHEN id = ? THEN 1 
                    ELSE 0 
                END
            """, (knowledgebase_id,))
            self.conn.commit()
            return cur.rowcount > 0
        except Exception as e:
            logger.error(f"Error setting active knowledgebase: {e}")
            raise
    
    def get_knowledgebase(self, knowledgebase_id: int) -> dict:
        """
        Get a specific knowledgebase by ID.
        
        Args:
            knowledgebase_id: ID of the knowledgebase
            
        Returns:
            Knowledgebase record if found, None otherwise
        """
        try:
            cur = self.conn.cursor()
            cur.execute("""
                SELECT id, name, description
                FROM knowledgebase
                WHERE id = ?
            """, (knowledgebase_id,))
            row = cur.fetchone()
            if row:
                return {
                    "id": row[0],
                    "name": row[1],
                    "description": row[2]
                }
            return None
        except Exception as e:
            logger.error(f"Error getting knowledgebase {knowledgebase_id}: {e}")
            raise


    def add_file_by_knowledgebase_name(self, filename: str, filepath: str, parsed_text: str, knowledgebase_name: str, file_size: int = None, description: str = None, type: str = 'file', parentFolder: str = "") -> int:
        """
        Add a new file record to the database using knowledgebase name.
        
        Args:
            filename: Name of the file
            filepath: Path to the uploaded file
            parsed_text: Text content of the parsed file
            knowledgebase_name: Name of the knowledgebase associated with the file
            file_size: Size of the file in bytes (required for file type)
            description: Description of the file or folder
            type: Type of the item (file or folder)
            parentFolder: Path to the parent folder
            
        Returns:
            The created file ID
        """
        try:
            cur = self.conn.cursor()
            # Check if knowledgebase exists
            cur.execute(
                "SELECT id FROM knowledgebase WHERE name = ?",
                (knowledgebase_name,)
            )
            knowledgebase = cur.fetchone()
            if not knowledgebase:
                raise ValueError(f"Knowledgebase {knowledgebase_name} does not exist")
            knowledgebase_id = knowledgebase[0]
            
            # Call the main add_file method with knowledgebase_id
            return self.add_file(filename, filepath, parsed_text, knowledgebase_id, file_size, description, type, parentFolder)

        except Exception as e:
            logger.error(f"Error adding file: {e}")
            raise
    
    def add_file(self, filename: str, filepath: str, parsed_text: str, knowledgebase_id: int, file_size: int = None, description: str = None, type: str = 'file', parentFolder: str = "") -> int:
        """
        Add a new file record to the database.
        
        Args:
            filename: Name of the file
            filepath: Path to the uploaded file
            parsed_text: Text content of the parsed file
            knowledgebase_id: ID of the knowledgebase associated with the file
            file_size: Size of the file in bytes (required for file type)
            description: Description of the file or folder
            type: Type of the item (file or folder)
            parentFolder: Path to the parent folder
            
        Returns:
            The created file ID
        """
        try:
            cur = self.conn.cursor()
            # Get parent ID if parentFolder is provided
            parent_id = None
            if parentFolder:
                cur.execute(
                    "SELECT file_id FROM files WHERE filepath = ? AND knowledgebase_id = ? AND type = 'folder'",
                    (parentFolder, knowledgebase_id)
                )
                parent_result = cur.fetchone()
                if parent_result:
                    parent_id = parent_result[0]
            
            # Insert the file record with UPSERT (update if filepath exists)
            cur.execute(
                """
                INSERT INTO files (filename, filepath, parsed_text, knowledgebase_id, file_size, description, type, parent)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (filepath) DO UPDATE
                SET filename = excluded.filename,
                    parsed_text = excluded.parsed_text,
                    file_size = excluded.file_size,
                    description = excluded.description,
                    type = excluded.type,
                    parent = excluded.parent,
                    uploaded_time = CURRENT_TIMESTAMP
                """,
                (filename, filepath, parsed_text, knowledgebase_id, file_size, description, type, parent_id)
            )
            file_id = cur.lastrowid
            
            # If it was an update, get the file_id
            if file_id == 0:
                cur.execute("SELECT file_id FROM files WHERE filepath = ?", (filepath,))
                file_id = cur.fetchone()[0]
            
            # Update the knowledgebase's updated_at timestamp
            cur.execute(
                "UPDATE knowledgebase SET updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                (knowledgebase_id,)
            )
            
            self.conn.commit()
            return file_id
        except Exception as e:
            logger.error(f"Error adding file: {e}")
            raise
    
    def get_files_by_knowledgebase_id(self, knowledgebase_id: int) -> list:
        """
        Get all files for a specific knowledgebase.
        
        Args:
            knowledgebase_id: ID of the knowledgebase
            
        Returns:
            List of file records
        """
        try:
            cur = self.conn.cursor()
            cur.execute("""
                SELECT file_id, filename, filepath, parsed_text, uploaded_time, knowledgebase_id, file_size, description, type, parent      
                FROM files
                WHERE knowledgebase_id = ?
                ORDER BY uploaded_time DESC
            """, (knowledgebase_id,))
            files = cur.fetchall()
            return files
        except Exception as e:
            logger.error(f"Error getting files by knowledgebase ID: {e}")
            raise

    def get_files_by_parent(self, knowledgebase_id: int, parentFolder: str):
        """
        Get all files for a specific parent folder.
        
        Args:
            knowledgebase_id: ID of the knowledgebase
            parentFolder: Path to the parent folder
            
        Returns:
            List of file records with file_id, filename, uploaded_time, file_size, description, and type
        """
        # Normalize path separators to match the database storage format
        normalized_path = parentFolder.replace('/', os.sep)
        
        cur = self.conn.cursor()
        cur.execute("""
            SELECT f.file_id, f.filename, f.uploaded_time, f.file_size, f.description, f.type
            FROM files f
            JOIN files parent_f ON parent_f.file_id = f.parent
            WHERE f.knowledgebase_id = ? 
            AND parent_f.knowledgebase_id = ? 
            AND parent_f.filepath = ?
            AND parent_f.type = 'folder'
            ORDER BY f.uploaded_time DESC
        """, (knowledgebase_id, knowledgebase_id, normalized_path))
        files = cur.fetchall()
        return files
    
    def get_file_by_id(self, file_id: int) -> tuple:
        """
        Get a specific file by ID.
        
        Args:
            file_id: ID of the file
            
        Returns:
            File record if found, None otherwise
        """
        try:
            cur = self.conn.cursor()
            cur.execute("""
                SELECT file_id, filename, filepath, parsed_text, uploaded_time, knowledgebase_id, file_size, description, type, parent  
                FROM files
                WHERE file_id = ?
            """, (file_id,))
            file = cur.fetchone()
            return file
        except Exception as e:
            logger.error(f"Error getting file by ID: {e}")
            raise
    
    def delete_file(self, file_id: int) -> bool:
        """
        Delete a file by ID.
        
        Args:
            file_id: ID of the file
            
        Returns:
            True if deletion was successful, False otherwise
        """
        try:
            cur = self.conn.cursor()
            # Get the knowledgebase_id for the file before deleting it
            cur.execute(
                "SELECT knowledgebase_id FROM files WHERE file_id = ?",
                (file_id,)
            )
            file = cur.fetchone()
            if not file:
                return False
            
            knowledgebase_id = file[0]
            
            # Delete the file
            cur.execute(
                "DELETE FROM files WHERE file_id = ?",
                (file_id,)
            )
            
            if cur.rowcount > 0:
                # Update the knowledgebase's updated_at timestamp
                cur.execute(
                    "UPDATE knowledgebase SET updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                    (knowledgebase_id,)
                )
            
            self.conn.commit()
            return cur.rowcount > 0
        except Exception as e:
            logger.error(f"Error deleting file: {e}")
            raise

    def get_files_by_path_prefix(self, path_prefix: str) -> List[int]:
        """
        Get all file IDs with filepath starting with the given prefix.
        
        Args:
            path_prefix: The path prefix to match
            
        Returns:
            List of file IDs that match the path prefix
        """
        try:
            cur = self.conn.cursor()
            logger.debug(f"Path prefix: {path_prefix}")
            
            # Properly escape backslashes for SQL LIKE pattern
            # Also handle both Windows and Unix path formats
            normalized_path_prefix = path_prefix.replace('/', os.sep)
            path_prefix_windows = normalized_path_prefix.replace('\\', '\\\\')
            path_prefix_unix = normalized_path_prefix.replace('\\', '/')
            
            # SQLite uses LIKE (case-insensitive with COLLATE NOCASE) instead of ILIKE
            cur.execute(
                "SELECT file_id FROM files WHERE type = 'file' AND (filepath LIKE ? ESCAPE '\\' OR filepath LIKE ? ESCAPE '\\')",
                (f"{path_prefix_windows}%", f"{path_prefix_unix}%")
            )
            file_ids = [row[0] for row in cur.fetchall()]
            logger.debug(f"File IDs: {file_ids}")
            return file_ids
        except Exception as e:
            logger.error(f"Error getting files by path prefix: {e}")
            raise
    
    def delete_files_by_path_prefix(self, path_prefix: str) -> int:
        """
        Delete all files with filepath starting with the given prefix.
        
        Args:
            path_prefix: The path prefix to match
            
        Returns:
            The number of files deleted
        """
        try:
            cur = self.conn.cursor()
            logger.debug(f"Path prefix: {path_prefix}")
            
            # Properly escape backslashes for SQL LIKE pattern
            # Also handle both Windows and Unix path formats
            path_prefix_windows = path_prefix.replace('\\', '\\\\')
            path_prefix_unix = path_prefix.replace('\\', '/')
            
            # Get unique knowledgebase_ids for the files that will be deleted
            cur.execute(
                "SELECT DISTINCT knowledgebase_id FROM files WHERE filepath LIKE ? ESCAPE '\\' OR filepath LIKE ? ESCAPE '\\'",
                (f"{path_prefix_windows}%", f"{path_prefix_unix}%")
            )
            knowledgebase_ids = [row[0] for row in cur.fetchall()]
            
            # Delete the files
            cur.execute(
                "DELETE FROM files WHERE filepath LIKE ? ESCAPE '\\' OR filepath LIKE ? ESCAPE '\\'",
                (f"{path_prefix_windows}%", f"{path_prefix_unix}%")
            )
            deleted_count = cur.rowcount
            
            # Update the updated_at timestamp for all affected knowledgebases
            if deleted_count > 0 and knowledgebase_ids:
                for kb_id in knowledgebase_ids:
                    cur.execute(
                        "UPDATE knowledgebase SET updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                        (kb_id,)
                    )
            
            self.conn.commit()
            return deleted_count
        except Exception as e:
            logger.error(f"Error deleting files by path prefix: {e}")
            raise
    
    def delete_file_by_path(self, filepath: str) -> int:
        """
        Delete a file by filepath.
        
        Args:
            filepath: Path of the file
            
        Returns:
            file_id if deletion was successful, None otherwise
        """
        try:
            cur = self.conn.cursor()
            # Get file_id and knowledgebase_id before deleting
            cur.execute(
                "SELECT file_id, knowledgebase_id FROM files WHERE filepath = ?",
                (filepath,)
            )
            file_info = cur.fetchone()
            
            if file_info:
                file_id, knowledgebase_id = file_info
                # Delete the file
                cur.execute(
                    "DELETE FROM files WHERE filepath = ?",
                    (filepath,)
                )
                # Update the knowledgebase's updated_at timestamp
                cur.execute(
                    "UPDATE knowledgebase SET updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                    (knowledgebase_id,)
                )
                self.conn.commit()
                return file_id
            return None
        except Exception as e:
            logger.error(f"Error deleting file by path: {e}")
            raise
    
    def rename_knowledgebase(self, knowledgebase_id: int, new_name: str) -> bool:
        """
        Rename a knowledgebase.
        
        Args:
            knowledgebase_id: ID of the knowledgebase to rename
            new_name: New name for the knowledgebase
            
        Returns:
            True if renaming was successful, False otherwise
        """
        try:
            cur = self.conn.cursor()
            # Update the knowledgebase name
            cur.execute(
                "UPDATE knowledgebase SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                (new_name, knowledgebase_id)
            )
            self.conn.commit()
            return cur.rowcount > 0
        except sqlite3.IntegrityError as e:
            if 'UNIQUE constraint' in str(e):
                raise ValueError("Knowledgebase with this name already exists")
            raise
        except Exception as e:
            logger.error(f"Error renaming knowledgebase: {e}")
            raise
    
    def update_knowledgebase_description(self, knowledgebase_id: int, description: str) -> bool:
        """
        Update a knowledgebase description.
        
        Args:
            knowledgebase_id: ID of the knowledgebase to update
            description: New description for the knowledgebase
            
        Returns:
            True if update was successful, False otherwise
        """
        try:
            cur = self.conn.cursor()
            # Update the knowledgebase description
            cur.execute(
                "UPDATE knowledgebase SET description = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                (description, knowledgebase_id)
            )
            self.conn.commit()
            return cur.rowcount > 0
        except Exception as e:
            logger.error(f"Error updating knowledgebase description: {e}")
            raise
    
    def delete_knowledgebase(self, knowledgebase_id: int) -> bool:
        """
        Delete a knowledgebase.
        
        Args:
            knowledgebase_id: ID of the knowledgebase to delete
            
        Returns:
            True if deletion was successful, False otherwise
        """
        try:
            logger.info(f"Attempting to delete knowledgebase: knowledgebase_id={knowledgebase_id}")
            cur = self.conn.cursor()
            
            # First check if the knowledgebase exists
            cur.execute(
                "SELECT id, name, is_active FROM knowledgebase WHERE id = ?",
                (knowledgebase_id,)
            )
            kb = cur.fetchone()
            if not kb:
                logger.warning(f"Knowledgebase not found: knowledgebase_id={knowledgebase_id}")
                return False
            
            # Check if this is the only knowledgebase
            cur.execute("SELECT COUNT(*) FROM knowledgebase")
            kb_count = cur.fetchone()[0]
            if kb_count <= 1:
                logger.warning(f"Cannot delete the only knowledgebase: knowledgebase_id={knowledgebase_id}")
                raise ValueError("Cannot delete the only knowledgebase.")
            
            logger.info(f"Found knowledgebase to delete: id={kb[0]}, name={kb[1]}, is_active={kb[2]}")
            is_deleted_kb_active = bool(kb[2])
            
            # Delete the knowledgebase - files will be deleted automatically due to ON DELETE CASCADE
            cur.execute(
                "DELETE FROM knowledgebase WHERE id = ?",
                (knowledgebase_id,)
            )
            self.conn.commit()
            logger.info(f"Successfully deleted knowledgebase: affected rows={cur.rowcount}")
            
            # If the deleted knowledgebase was active, set the most recently updated one as active
            if is_deleted_kb_active:
                # Find the most recently updated knowledgebase (excluding the deleted one)
                cur.execute("""
                    SELECT id FROM knowledgebase 
                    WHERE id != ?
                    ORDER BY updated_at DESC 
                    LIMIT 1
                """, (knowledgebase_id,))
                remaining_kb = cur.fetchone()
                
                if remaining_kb:
                    # Set the most recently updated knowledgebase as active
                    cur.execute("""
                        UPDATE knowledgebase 
                        SET is_active = 1 
                        WHERE id = ?
                    """, (remaining_kb[0],))
                    self.conn.commit()
                    logger.info(f"Set knowledgebase {remaining_kb[0]} as active after deleting active knowledgebase {knowledgebase_id}")
                else:
                    logger.info(f"No remaining knowledgebases after deleting active knowledgebase {knowledgebase_id}")
            
            return True
        except Exception as e:
            logger.error(f"Error deleting knowledgebase: {e}", exc_info=True)
            raise
    
    def update_multiple_descriptions(self, knowledgebase_id: int, updates: List[Dict[str, Any]]) -> bool:
        """
        Update descriptions for multiple files and folders in a knowledgebase.
        
        Args:
            knowledgebase_id: ID of the knowledgebase
            updates: List of dictionaries containing file_id and description
                     Example: [{"file_id": 1, "description": "Updated description"}, ...]
            
        Returns:
            True if updates were successful
        """
        try:
            cur = self.conn.cursor()
            # Check if knowledgebase exists
            cur.execute(
                "SELECT id FROM knowledgebase WHERE id = ?",
                (knowledgebase_id,)
            )
            if not cur.fetchone():
                raise ValueError(f"Knowledgebase ID {knowledgebase_id} does not exist")
            
            # Prepare the SQL statement for batch update
            update_sql = """
                UPDATE files
                SET description = ?
                WHERE file_id = ? AND knowledgebase_id = ?
            """
            
            # Prepare the data for batch execution
            update_data = []
            for update in updates:
                file_id = update.get("file_id")
                description = update.get("description")
                if file_id is not None:
                    update_data.append((description, file_id, knowledgebase_id))
            
            # Execute the batch update
            cur.executemany(update_sql, update_data)
            
            # Update the knowledgebase's updated_at timestamp
            cur.execute(
                "UPDATE knowledgebase SET updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                (knowledgebase_id,)
            )
            
            self.conn.commit()
            logger.info(f"Successfully updated {cur.rowcount} descriptions")
            return True
        except Exception as e:
            logger.error(f"Error updating multiple descriptions: {e}")
            raise
