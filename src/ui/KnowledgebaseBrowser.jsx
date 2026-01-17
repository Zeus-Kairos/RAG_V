import React, { useState, useEffect, useCallback } from 'react';
import { fetchWithAuth } from './store';
import useKnowledgebaseStore from './store';
import './KnowledgebaseBrowser.css';

const KnowledgebaseBrowser = () => {
  const { knowledgebases, setActiveKnowledgebase, refreshFileBrowser } = useKnowledgebaseStore();
  const [currentKnowledgebase, setCurrentKnowledgebase] = useState(knowledgebases.find(kb => kb.is_active)?.name || 'default');
  const [currentPath, setCurrentPath] = useState(['']);
  const [fileItems, setFileItems] = useState([]); // Contains files and folders with their descriptions
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [showNewFolderInput, setShowNewFolderInput] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [uploadResults, setUploadResults] = useState([]);
  const [isUploading, setIsUploading] = useState(false);
  // Refs for auto-scrolling
  const uploadResultsListRef = React.useRef(null);
  const uploadDialogBodyRef = React.useRef(null);
  // New state variables for knowledgebase management
  const [showCreateKBModal, setShowCreateKBModal] = useState(false);
  const [newKBName, setNewKBName] = useState('');
  const [newKBDescription, setNewKBDescription] = useState('');
  // State variables for editing knowledgebase descriptions
  const [showInlineEdit, setShowInlineEdit] = useState(false);
  const [kbToEditDescription, setKBToEditDescription] = useState(null);
  const [editKBDescription, setEditKBDescription] = useState('');
  
  // State variables for bulk editing file/folder descriptions
  const [showEditDescriptionsModal, setShowEditDescriptionsModal] = useState(false);
  const [editingFiles, setEditingFiles] = useState([]);
  
  // State variables for confirm dialogs
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [confirmDialogConfig, setConfirmDialogConfig] = useState({
    title: '',
    message: '',
    onConfirm: () => {},
    confirmText: 'Confirm',
    cancelText: 'Cancel'
  });
  
  // Cache for directory contents - key is path, value is the fetched data
  const [directoryCache, setDirectoryCache] = useState({});
  const [isDragging, setIsDragging] = useState(false);
  
  // Ref to access the latest directoryCache without triggering re-renders
  const directoryCacheRef = React.useRef(directoryCache);
  
  // Update the ref whenever directoryCache changes
  useEffect(() => {
    directoryCacheRef.current = directoryCache;
  }, [directoryCache]);
  
  // Update currentKnowledgebase when knowledgebases change
  useEffect(() => {
    const activeKB = knowledgebases.find(kb => kb.is_active);
    if (activeKB) {
      setCurrentKnowledgebase(activeKB.name);
    }
  }, [knowledgebases]);

  // Fetch directory contents - memoized with useCallback to prevent infinite loops
  const fetchDirectoryContents = useCallback(async (path, forceRefresh = false) => {
    setIsLoading(true);
    setError('');
    try {
      // Get the active knowledgebase to get its ID
      const activeKB = knowledgebases.find(kb => kb.is_active);
      if (!activeKB || !activeKB.id || !activeKB.name) {
        throw new Error('No active knowledgebase found or invalid knowledgebase data');
      }
      
      // Create cache key based on knowledgebase and path
      const cacheKey = `${activeKB.id}:${path}`;
      
      // Check if we have cached data for this path using the ref, unless forceRefresh is true
      if (!forceRefresh && directoryCacheRef.current[cacheKey]) {
        // Use cached data
        setFileItems(directoryCacheRef.current[cacheKey]);
        setIsLoading(false);
        return;
      }
      
      // Get old items from cache BEFORE fetching fresh data
      const oldItems = directoryCacheRef.current[cacheKey] || [];
      
      // Call API with kb_id instead of knowledge_base name
      const response = await fetchWithAuth(`/api/knowledgebase/${activeKB.id}/list?path=${encodeURIComponent(path)}&knowledge_base=${encodeURIComponent(activeKB.name)}`);
      if (!response.ok) {
        throw new Error('Failed to fetch directory contents');
      }
      const data = await response.json();
      
      // Get current child folder names from the new data
      const newFolderNames = new Set(
        data.folders.map(folder => folder.name)
      );
      
      // Clear cache for any folders that were in the old cache but not in the new data (deleted folders)
      oldItems.forEach(item => {
        if (item.type === 'folder' && !newFolderNames.has(item.name)) {
          // This folder was deleted, clear its cache
          const deletedFolderPath = path ? `${path}/${item.name}` : item.name;
          const deletedCacheKey = `${activeKB.id}:${deletedFolderPath}`;
          
          // Clear from state
          setDirectoryCache(prev => {
            const updatedCache = { ...prev };
            delete updatedCache[deletedCacheKey];
            return updatedCache;
          });
          
          // Clear from ref immediately
          const updatedRefCache = { ...directoryCacheRef.current };
          delete updatedRefCache[deletedCacheKey];
          directoryCacheRef.current = updatedRefCache;
        }
      });
      
      // Store the full file items with their metadata for display
      const allItems = [];
      
      // Add folders with metadata
      if (Array.isArray(data.folders)) {
        data.folders.forEach(folder => {
          allItems.push({
            id: folder.id,
            name: folder.name,
            type: 'folder',
            uploaded_time: folder.uploaded_time,
            description: folder.description
          });
        });
      }
      
      // Add files with metadata
      if (Array.isArray(data.files)) {
        data.files.forEach(file => {
          allItems.push({
            id: file.id,
            name: file.name,
            type: 'file',
            uploaded_time: file.uploaded_time,
            file_size: file.file_size,
            description: file.description
          });
        });
      }
      
      // Update file items state
      setFileItems(allItems);
      
      // Cache the result
      setDirectoryCache(prev => ({
        ...prev,
        [cacheKey]: allItems
      }));
      
      // Also update the ref immediately
      directoryCacheRef.current = {
        ...directoryCacheRef.current,
        [cacheKey]: allItems
      };
    } catch (err) {
      setError(err.message);
      // Clear fileItems on error
      setFileItems([]);
    } finally {
      setIsLoading(false);
    }
  }, [knowledgebases]);

  // Navigate to a folder
  const navigateToFolder = (folderName) => {
    const newPath = [...currentPath, folderName];
    setCurrentPath(newPath);
  };

  // Create a new folder
  const createFolder = async () => {
    if (!newFolderName.trim()) return;

    setIsLoading(true);
    setError('');
    try {
      const activeKB = knowledgebases.find(kb => kb.name === currentKnowledgebase);
      const fullPath = currentPath.join('/').replace(/^\//, '');
      const response = await fetchWithAuth(`/api/knowledgebase/${activeKB.id}/folder`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: newFolderName,
          parentPath: fullPath,
          knowledge_base: currentKnowledgebase,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || 'Failed to create folder');
      }

      // Force refresh after folder creation to get fresh data from API
      fetchDirectoryContents(fullPath, true);
      refreshFileBrowser(fullPath); // Trigger sidebar refresh with the modified path
      setShowNewFolderInput(false);
      setNewFolderName('');
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  // Delete a folder
  const deleteFolder = async (folderName) => {
    const handleDelete = async () => {
      setIsLoading(true);
      setError('');
      try {
        const activeKB = knowledgebases.find(kb => kb.name === currentKnowledgebase);
        const fullPath = [...currentPath, folderName].join('/').replace(/^\//, '');
        const response = await fetchWithAuth(`/api/knowledgebase/${activeKB.id}/folder`, {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            path: fullPath,
            knowledge_base: currentKnowledgebase,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.detail || 'Failed to delete folder');
        }

        // Clear cache for the deleted folder and all its subfolders recursively
        if (activeKB) {
          // Create cache key prefix for the deleted folder and its subfolders
          const deletedCachePrefix = `${activeKB.id}:${fullPath}`;
          
          // Function to recursively clear cache for this folder and all subfolders
          const clearCacheRecursively = (cache) => {
            const updatedCache = { ...cache };
            Object.keys(updatedCache).forEach(key => {
              // Delete if the key matches the exact folder or starts with the folder path followed by /
              if (key === deletedCachePrefix || key.startsWith(`${deletedCachePrefix}/`)) {
                delete updatedCache[key];
              }
            });
            return updatedCache;
          };
          
          // Clear from state
          setDirectoryCache(prev => clearCacheRecursively(prev));
          
          // Clear from ref immediately
          directoryCacheRef.current = clearCacheRecursively(directoryCacheRef.current);
        }

        // Force refresh after folder deletion to get fresh data from API
        const currentCachePath = currentPath.join('/').replace(/^\//, '');
        fetchDirectoryContents(currentCachePath, true);
        refreshFileBrowser(currentCachePath); // Trigger sidebar refresh with the modified path
      } catch (err) {
        setError(err.message);
      } finally {
        setIsLoading(false);
      }
    };

    // Show confirm dialog
    setConfirmDialogConfig({
      title: 'Delete Folder',
      message: `All files and subfolders in "${folderName}" will be deleted. Are you sure you want to continue?`,
      onConfirm: handleDelete,
      confirmText: 'Delete',
      cancelText: 'Cancel'
    });
    setShowConfirmDialog(true);
  };

  // Delete a file
  const deleteFile = async (fileName) => {
    const handleDelete = async () => {
      setIsLoading(true);
      setError('');
      try {
        const activeKB = knowledgebases.find(kb => kb.name === currentKnowledgebase);
        const fullPath = [...currentPath, fileName].join('/').replace(/^\//, '');
        const response = await fetchWithAuth(`/api/knowledgebase/${activeKB.id}/file`, {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            path: fullPath,
            knowledge_base: currentKnowledgebase,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.detail || 'Failed to delete file');
        }

        // Clear cache for the current directory and refresh contents
        // Force refresh after file deletion to get fresh data from API
        const currentCachePath = currentPath.join('/').replace(/^\//, '');
        fetchDirectoryContents(currentCachePath, true);
        refreshFileBrowser(currentCachePath); // Trigger sidebar refresh with the modified path
      } catch (err) {
        setError(err.message);
      } finally {
        setIsLoading(false);
      }
    };

    // Show confirm dialog
    setConfirmDialogConfig({
      title: 'Delete File',
      message: `Are you sure you want to delete file "${fileName}"?`,
      onConfirm: handleDelete,
      confirmText: 'Delete',
      cancelText: 'Cancel'
    });
    setShowConfirmDialog(true);
  };

  // Handle file selection for upload
  const handleFileSelect = (e) => {
    setSelectedFiles(Array.from(e.target.files));
  };

  // Upload files to the current directory (traditional approach)
  const uploadFiles = async () => {
    if (selectedFiles.length === 0) return;

    setIsLoading(true);
    setError('');
    try {
      const formData = new FormData();
      const fullPath = currentPath.join('/').replace(/^\//, '');
      
      formData.append('knowledge_base', currentKnowledgebase);
      formData.append('directory', fullPath);
      
      selectedFiles.forEach((file) => {
        formData.append('files', file);
      });

      // Use the fixed fetchWithAuth function which now handles FormData correctly
      const response = await fetchWithAuth('/api/upload', {
        method: 'POST',
        body: formData,
        headers: {} // Empty headers to let fetchWithAuth handle it automatically
      });

      // Always parse the JSON response body
      const responseData = await response.json();
      
      // Handle error response format
      if (responseData.detail) {
        throw new Error(responseData.detail);
      }
      
      // Show detailed error message if any files failed
      const failedFiles = responseData.files ? responseData.files.filter(file => file.status === 'failed') : [];
      if (failedFiles.length > 0) {
        const errorMessages = failedFiles.map(file => `${file.filename}: ${file.error || 'Unknown error'}`);
        throw new Error(`Upload failed for ${failedFiles.length} file(s):\n${errorMessages.join('\n')}`);
      }

      // Force refresh after file upload to get fresh data from API
      fetchDirectoryContents(fullPath, true);
      refreshFileBrowser(fullPath); // Trigger sidebar refresh with the modified path
      setShowUploadDialog(false);
      setSelectedFiles([]);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  // Upload files with streaming response (real-time results)
  const uploadFilesWithStream = async () => {
    if (selectedFiles.length === 0) return;

    setIsUploading(true);
    setUploadResults([]);
    setError('');
    
    // Scroll dialog body to bottom after a short delay to ensure UI updates
    setTimeout(() => {
      if (uploadDialogBodyRef.current) {
        uploadDialogBodyRef.current.scrollTop = uploadDialogBodyRef.current.scrollHeight;
      }
    }, 100);
    
    try {
      const formData = new FormData();
      const fullPath = currentPath.join('/').replace(/^\//, '');
      
      formData.append('knowledge_base', currentKnowledgebase);
      formData.append('directory', fullPath);
      
      selectedFiles.forEach((file) => {
        formData.append('files', file);
      });

      // Use fetchWithAuth which already handles streaming and FormData correctly
      const response = await fetchWithAuth('/api/stream-upload', {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || 'Upload failed');
      }

      // Read the response as a stream
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      // Process the stream line by line
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        
        // Split buffer by newlines
        const lines = buffer.split('\n');
        // Keep the last incomplete line in buffer
        buffer = lines.pop();

        // Process each complete line
        for (const line of lines) {
          if (line.trim()) {
            try {
              const result = JSON.parse(line);
              setUploadResults(prev => [...prev, result]);
            } catch (parseError) {
              console.error('Error parsing upload result:', parseError);
            }
          }
        }
      }

      // Force refresh after all files are processed
      fetchDirectoryContents(fullPath, true);
      refreshFileBrowser(fullPath); // Trigger sidebar refresh with the modified path
      
      // Close dialog automatically after all files are processed
      setTimeout(() => {
        setShowUploadDialog(false);
        setSelectedFiles([]);
        setUploadResults([]);
      }, 1000); // Short delay to allow users to see the final results
    } catch (err) {
      setError(err.message);
    } finally {
      setIsUploading(false);
    }
  };

  // Create a new knowledgebase
  const createKnowledgebase = async () => {
    if (!newKBName.trim()) return;

    setIsLoading(true);
    setError('');
    try {
      const response = await fetchWithAuth('/api/knowledgebase', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: newKBName,
          description: newKBDescription,
          navigation: {}
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || 'Failed to create knowledgebase');
      }

      // Refresh knowledgebases by setting the newly created one as active
      const result = await response.json();
      setActiveKnowledgebase(result.knowledgebase_id);
      
      // Reset form
      setShowCreateKBModal(false);
      setNewKBName('');
      setNewKBDescription('');
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  // Delete a knowledgebase
  const deleteKnowledgebase = async (kbId, kbName) => {
    // Prevent deletion if this is the only knowledgebase
    if (knowledgebases.length <= 1) {
      setConfirmDialogConfig({
        title: 'Cannot Delete',
        message: 'Cannot delete the only knowledgebase.',
        onConfirm: () => {},
        confirmText: 'OK',
        cancelText: 'Cancel'
      });
      setShowConfirmDialog(true);
      return;
    }

    const handleDelete = async () => {
      setIsLoading(true);
      setError('');
      try {
        const response = await fetchWithAuth(`/api/knowledgebase/${kbId}`, {
          method: 'DELETE',
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.detail || 'Failed to delete knowledgebase');
        }

        // Refresh knowledgebases by fetching them again
        const kbsResponse = await fetchWithAuth('/api/knowledgebase');
        if (kbsResponse.ok) {
          const kbsData = await kbsResponse.json();
          // Update the store's knowledgebases directly
          useChatStore.setState({ knowledgebases: kbsData.knowledgebases || [] });
          
          // Set the active knowledgebase if one exists
          const activeKB = kbsData.knowledgebases.find(kb => kb.is_active);
          if (activeKB) {
            setActiveKnowledgebase(activeKB.id);
          }
        }
      } catch (err) {
        setError(err.message);
      } finally {
        setIsLoading(false);
      }
    };

    // Show confirm dialog
    setConfirmDialogConfig({
      title: 'Delete Knowledgebase',
      message: `All files and subfolders in knowledgebase "${kbName}" will be deleted. Are you sure you want to continue? This action cannot be undone.`,
      onConfirm: handleDelete,
      confirmText: 'Delete',
      cancelText: 'Cancel'
    });
    setShowConfirmDialog(true);
  };

  // Use current directory's items when edit descriptions modal is opened
  useEffect(() => {
    if (showEditDescriptionsModal) {
      // Use the existing fileItems from the current directory
      setEditingFiles(fileItems);
    }
  }, [showEditDescriptionsModal, fileItems]);

  // Fetch directory contents when currentPath changes
  useEffect(() => {
    fetchDirectoryContents(currentPath.join('/').replace(/^\//, ''));
  }, [currentPath, fetchDirectoryContents]);
  
  // Auto-scroll to bottom when upload results change
  useEffect(() => {
    // Scroll results list to bottom
    if (uploadResultsListRef.current) {
      uploadResultsListRef.current.scrollTop = uploadResultsListRef.current.scrollHeight;
    }
    
    // Scroll dialog body to bottom as well
    if (uploadDialogBodyRef.current) {
      uploadDialogBodyRef.current.scrollTop = uploadDialogBodyRef.current.scrollHeight;
    }
  }, [uploadResults]);

  // Helper function to recursively process folder entries
  const processEntry = async (entry, basePath = '', fileList = [], folderList = []) => {
    if (entry.isFile) {
      return new Promise((resolve) => {
        entry.file((file) => {
          // Create a File object with webkitRelativePath to preserve folder structure
          const relativePath = basePath ? `${basePath}/${file.name}` : file.name;
          const fileWithPath = new File([file], relativePath, { type: file.type });
          fileList.push(fileWithPath);
          resolve();
        });
      });
    } else if (entry.isDirectory) {
      folderList.push(basePath ? `${basePath}/${entry.name}` : entry.name);
      const reader = entry.createReader();
      const entries = [];
      
      return new Promise((resolve) => {
        const readEntries = () => {
          reader.readEntries((batch) => {
            if (batch.length === 0) {
              // Process all entries in parallel
              Promise.all(entries.map(subEntry => 
                processEntry(subEntry, basePath ? `${basePath}/${entry.name}` : entry.name, fileList, folderList)
              )).then(() => resolve());
            } else {
              entries.push(...batch);
              readEntries();
            }
          });
        };
        readEntries();
      });
    }
  };

  // Process dropped items (files and folders)
  const processDroppedItems = async (items) => {
    const fileList = [];
    const folderList = [];
    
    // Process all items
    await Promise.all(Array.from(items).map((item) => {
      const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : 
                    (item.getAsEntry ? item.getAsEntry() : null);
      
      if (entry) {
        return processEntry(entry, '', fileList, folderList);
      } else {
        // Fallback to file API for browsers that don't support entries
        const file = item.getAsFile();
        if (file) {
          fileList.push(file);
        }
      }
    }));
    
    return { fileList, folderList };
  };

  // Drag and drop handlers
  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDragEnter = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    // Only set isDragging to false if the cursor is completely leaving the drop zone
    if (e.currentTarget.contains(e.relatedTarget)) {
      return;
    }
    setIsDragging(false);
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    try {
      const items = e.dataTransfer.items;
      
      // Check if we have folder support (DataTransferItem with webkitGetAsEntry)
      if (items && items.length > 0 && (items[0].webkitGetAsEntry || items[0].getAsEntry)) {
        // Process folders and files
        const { fileList, folderList } = await processDroppedItems(items);
        
        if (folderList.length === 0 && fileList.length === 0) {
          return;
        }
        
        setIsLoading(true);
        setError('');
        
        try {
          const activeKB = knowledgebases.find(kb => kb.is_active);
          if (!activeKB) {
            throw new Error('No active knowledgebase found');
          }
          
          const fullPath = currentPath.join('/').replace(/^\//, '');
          
          // Deduplicate folder list and create folders first (in order, from root to deepest)
          const uniqueFolders = [...new Set(folderList)];
          const sortedFolders = uniqueFolders.sort((a, b) => {
            const depthA = a.split('/').length;
            const depthB = b.split('/').length;
            return depthA - depthB;
          });
          
          for (const folderPath of sortedFolders) {
            const pathParts = folderPath.split('/');
            let currentFolderPath = fullPath;
            
            // Create each folder in the path if it doesn't exist
            for (let i = 0; i < pathParts.length; i++) {
              const folderName = pathParts[i];
              const parentPath = currentFolderPath;
              const newFolderPath = currentFolderPath ? `${currentFolderPath}/${folderName}` : folderName;
              
              try {
                // Check if folder already exists by trying to create it
                const createResponse = await fetchWithAuth(`/api/knowledgebase/${activeKB.id}/folder`, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({
                    name: folderName,
                    parentPath: parentPath,
                    knowledge_base: currentKnowledgebase,
                  }),
                });
                
                if (!createResponse.ok) {
                  const errorData = await createResponse.json().catch(() => ({}));
                  // If folder already exists, that's okay, continue
                  if (!errorData.detail || !errorData.detail.includes('already exists')) {
                    console.warn(`Failed to create folder ${folderName}:`, errorData.detail || 'Unknown error');
                  }
                }
              } catch (err) {
                console.warn(`Error creating folder ${folderName}:`, err.message);
              }
              
              currentFolderPath = newFolderPath;
            }
          }
          
          // Now upload files with their relative paths
          if (fileList.length > 0) {
            setSelectedFiles(fileList);
            setShowUploadDialog(true);
            // Auto-start upload after a short delay to allow the dialog to render
            setTimeout(() => {
              uploadFilesWithStreamForFolders(fileList, fullPath);
            }, 100);
          } else {
            // Only folders were dropped, refresh the view
            fetchDirectoryContents(fullPath, true);
            refreshFileBrowser(fullPath);
            setIsLoading(false);
          }
        } catch (err) {
          setError(err.message);
          setIsLoading(false);
        }
      } else {
        // Fallback to file-only handling
        const droppedFiles = Array.from(e.dataTransfer.files);
        if (droppedFiles.length > 0) {
          setSelectedFiles(droppedFiles);
          setShowUploadDialog(true);
          // Auto-start upload after a short delay to allow the dialog to render
          setTimeout(() => {
            uploadFilesWithStream();
          }, 100);
        }
      }
    } catch (err) {
      setError(`Error processing dropped items: ${err.message}`);
    }
  };
  
  // Upload files with folder structure support
  const uploadFilesWithStreamForFolders = async (files, baseDirectory) => {
    if (files.length === 0) return;

    setIsUploading(true);
    setUploadResults([]);
    setError('');
    
    // Scroll dialog body to bottom after a short delay to ensure UI updates
    setTimeout(() => {
      if (uploadDialogBodyRef.current) {
        uploadDialogBodyRef.current.scrollTop = uploadDialogBodyRef.current.scrollHeight;
      }
    }, 100);
    
    try {
      const activeKB = knowledgebases.find(kb => kb.is_active);
      if (!activeKB) {
        throw new Error('No active knowledgebase found');
      }
      
      // Group files by their directory path
      const filesByDirectory = {};
      files.forEach((file) => {
        // Extract directory path from file name (which contains the relative path)
        const relativePath = file.name;
        const pathParts = relativePath.split('/');
        const fileName = pathParts.pop();
        const fileDirectory = pathParts.join('/');
        const targetDirectory = fileDirectory ? `${baseDirectory}/${fileDirectory}` : baseDirectory;
        
        if (!filesByDirectory[targetDirectory]) {
          filesByDirectory[targetDirectory] = [];
        }
        
        // Create a new File object with just the filename for upload
        const fileForUpload = new File([file], fileName, { type: file.type });
        filesByDirectory[targetDirectory].push(fileForUpload);
      });
      
      // Upload files directory by directory
      for (const [directory, directoryFiles] of Object.entries(filesByDirectory)) {
        const formData = new FormData();
        formData.append('knowledge_base', currentKnowledgebase);
        formData.append('directory', directory);
        
        directoryFiles.forEach((file) => {
          formData.append('files', file);
        });

        // Use fetchWithAuth which already handles streaming and FormData correctly
        const response = await fetchWithAuth('/api/stream-upload', {
          method: 'POST',
          body: formData
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          // Add error results for all files in this directory
          directoryFiles.forEach(file => {
            setUploadResults(prev => [...prev, {
              filename: file.name,
              status: 'failed',
              error: errorData.detail || 'Upload failed'
            }]);
          });
          continue;
        }

        // Read the response as a stream
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        // Process the stream line by line
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          
          // Split buffer by newlines
          const lines = buffer.split('\n');
          // Keep the last incomplete line in buffer
          buffer = lines.pop();

          // Process each complete line
          for (const line of lines) {
            if (line.trim()) {
              try {
                const result = JSON.parse(line);
                setUploadResults(prev => [...prev, result]);
              } catch (parseError) {
                console.error('Error parsing upload result:', parseError);
              }
            }
          }
        }
      }

      // Force refresh after all files are processed
      fetchDirectoryContents(baseDirectory, true);
      refreshFileBrowser(baseDirectory);
      
      // Close dialog automatically after all files are processed
      setTimeout(() => {
        setShowUploadDialog(false);
        setSelectedFiles([]);
        setUploadResults([]);
      }, 1000); // Short delay to allow users to see the final results
    } catch (err) {
      setError(err.message);
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="knowledgebase-browser">
      <div className="kb-header">
        <h2>Knowledge Base</h2>
      </div>

      {error && <div className="kb-error">{error}</div>}

      {/* Knowledgebase Selector */}
      <div className="kb-knowledgebase-selector">
        <div className="kb-knowledgebase-label">Knowledgebase:</div>
        <div className="kb-knowledgebase-list-wrapper">
          <div className="kb-knowledgebase-list">
            {knowledgebases.map((kb) => (
              <div 
              key={kb.id}
              className={`kb-knowledgebase-item ${kb.is_active ? 'active' : ''}`}
            >
              <div 
                className="kb-knowledgebase-name"
                onClick={() => {
                  setActiveKnowledgebase(kb.id);
                }}
              >
                {kb.name}
                {kb.is_active && <span className="kb-knowledgebase-active-indicator">✓</span>}
              </div>
              <div className="kb-knowledgebase-actions">
                <button 
                  className="kb-knowledgebase-delete-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteKnowledgebase(kb.id, kb.name);
                  }}
                  disabled={knowledgebases.length <= 1}
                  title={knowledgebases.length <= 1 ? 'Cannot delete the only knowledgebase' : 'Delete knowledgebase'}
                >
                  🗑️
                </button>
              </div>
            </div>
            ))}
          </div>
          <button 
            onClick={() => setShowCreateKBModal(true)} 
            className="kb-btn kb-btn-tertiary kb-new-kb-btn"
            disabled={isLoading}
            title="Create new knowledgebase"
          >
            <svg width="60" height="60" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
              <path d="M80,360 L256,410 L432,360 L432,180 L420,180 L420,350 L256,395 L92,350 L92,180 L80,180 Z" fill="#3E3159"/>
              <path d="M216,398 C216,415 296,415 296,398 Z" fill="#3E3159"/>
              
              <path d="M256,150 L110,110 L110,335 L256,380 Z" fill="white" stroke="#3E3159" stroke-width="6" stroke-linejoin="round"/>
              
              <path d="M256,150 L402,110 L402,335 L256,380 Z" fill="white" stroke="#3E3159" stroke-width="6" stroke-linejoin="round"/>
              
              <path d="M280,100 L280,220 C280,245 400,245 400,220 L400,100 Z" fill="#9B66AA"/>
              <ellipse cx="340" cy="100" rx="60" ry="25" fill="#4B2C69"/>
              <path d="M280,140 C280,165 400,165 400,140" fill="none" stroke="#3E3159" stroke-width="3"/>
              <path d="M280,180 C280,205 400,205 400,180" fill="none" stroke="#3E3159" stroke-width="3"/>
              
              <circle cx="295" cy="148" r="4" fill="white"/>
              <circle cx="312" cy="153" r="4" fill="white"/>
              <circle cx="295" cy="188" r="4" fill="white"/>
              <circle cx="312" cy="193" r="4" fill="white"/>
              
              <path d="M256,200 V320 M196,260 H316" 
                    fill="none" 
                    stroke="white" 
                    stroke-width="36" 
                    stroke-linecap="round"/>
              <path d="M256,200 V320 M196,260 H316" 
                    fill="none" 
                    stroke="#8CC665" 
                    stroke-width="36" 
                    stroke-linecap="round"/>
            </svg>
          </button>
        </div>
      </div>

      {/* Active Knowledgebase Description with inline edit */}
      {(() => {
        const activeKB = knowledgebases.find(kb => kb.is_active);
        if (activeKB) {
          return (
            <div className="kb-active-description">
              <div className="kb-active-description-title">
                <span>Description:</span>
                <button 
                  className="kb-knowledgebase-edit-btn"
                  onClick={() => {
                    setKBToEditDescription(activeKB);
                    setEditKBDescription(activeKB.description || '');
                    setShowInlineEdit(true);
                  }}
                  title="Edit knowledgebase description"
                >
                  ✎
                </button>
              </div>
              {showInlineEdit && kbToEditDescription && kbToEditDescription.id === activeKB.id ? (
                <div className="kb-active-description-edit">
                  <textarea
                    value={editKBDescription}
                    onChange={(e) => setEditKBDescription(e.target.value)}
                    placeholder="Enter knowledgebase description"
                    rows="3"
                    style={{ width: '100%', marginBottom: '8px' }}
                    autoFocus
                  />
                  <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                    <button 
                      onClick={() => {
                        setShowInlineEdit(false);
                        setKBToEditDescription(null);
                        setEditKBDescription('');
                      }}
                      style={{ padding: '4px 8px', fontSize: '14px' }}
                    >
                      Cancel
                    </button>
                    <button 
                      onClick={async () => {
                        setIsLoading(true);
                        setError('');
                        try {
                          const response = await fetchWithAuth(`/api/knowledgebase/${kbToEditDescription.id}/description`, {
                            method: 'PUT',
                            headers: {
                              'Content-Type': 'application/json',
                            },
                            body: JSON.stringify({
                              description: editKBDescription
                            }),
                          });

                          if (!response.ok) {
                            const errorData = await response.json().catch(() => ({}));
                            throw new Error(errorData.detail || 'Failed to update knowledgebase description');
                          }

                          // Refresh knowledgebases by fetching them again
                          const kbsResponse = await fetchWithAuth('/api/knowledgebase');
                          if (kbsResponse.ok) {
                            const kbsData = await kbsResponse.json();
                            // Update the store's knowledgebases directly
                            useChatStore.setState({ knowledgebases: kbsData.knowledgebases || [] });
                            
                            // Set the active knowledgebase if one exists
                            const activeKB = kbsData.knowledgebases.find(kb => kb.is_active);
                            if (activeKB) {
                              setActiveKnowledgebase(activeKB.id);
                            }
                          }
                          
                          setShowInlineEdit(false);
                          setKBToEditDescription(null);
                          setEditKBDescription('');
                        } catch (err) {
                          setError(err.message);
                        } finally {
                          setIsLoading(false);
                        }
                      }}
                      className="dialog-primary"
                      style={{ padding: '4px 8px', fontSize: '14px' }}
                      disabled={isLoading}
                    >
                      Save
                    </button>
                  </div>
                </div>
              ) : (
                <div className="kb-active-description-content">
                  {activeKB.description || 'No description available'}
                </div>
              )}
            </div>
          );
        }
        return null;
      })()}

      {/* Breadcrumb Navigation */}
      <div className="kb-breadcrumb">
        <div className="kb-breadcrumb-content">
          <span 
            className="breadcrumb-item"
            onClick={() => setCurrentPath([''])}
          >
            Root
          </span>
          {currentPath.slice(1).map((folder, index) => (
            <React.Fragment key={index}>
              <span className="breadcrumb-separator">/</span>
              <span 
                className="breadcrumb-item"
                onClick={() => setCurrentPath(currentPath.slice(0, index + 2))}
              >
                {folder}
                {/* Show count only for the last folder in the breadcrumb (current folder) */}
                {index === currentPath.slice(1).length - 1 && fileItems.length > 0 && (
                  <span className="breadcrumb-folder-count">
                    ({fileItems.filter(item => item.type === 'folder').length} folders, 
                    {fileItems.filter(item => item.type === 'file').length} files)
                  </span>
                )}
              </span>
            </React.Fragment>
          ))}
          {/* Show count for root folder if currentPath is just [''] */}
          {currentPath.length === 1 && fileItems.length > 0 && (
            <span className="breadcrumb-folder-count">
              ({fileItems.filter(item => item.type === 'folder').length} folders, 
              {fileItems.filter(item => item.type === 'file').length} files)
            </span>
          )}
        </div>
        
        <div className="kb-breadcrumb-actions">
          <button 
            onClick={() => setShowNewFolderInput(true)} 
            className="kb-btn kb-btn-primary kb-breadcrumb-btn"
            disabled={isLoading}
          >
            New Folder
          </button>
          <button 
            onClick={() => setShowUploadDialog(true)} 
            className="kb-btn kb-btn-secondary kb-breadcrumb-btn"
            disabled={isLoading}
          >
            Upload Files
          </button>
          <button 
            onClick={() => setShowEditDescriptionsModal(true)} 
            className="kb-btn kb-btn-secondary kb-breadcrumb-btn"
            disabled={isLoading}
          >
            Edit Descriptions
          </button>
        </div>
      </div>

      {/* New Folder Input */}
      {showNewFolderInput && (
        <div className="new-folder-input">
          <input
            type="text"
            placeholder="Enter folder name"
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && createFolder()}
            autoFocus
          />
          <div className="input-actions">
            <button onClick={createFolder} disabled={isLoading || !newFolderName.trim()}>
              Create
            </button>
            <button onClick={() => {
              setShowNewFolderInput(false);
              setNewFolderName('');
            }} disabled={isLoading}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Directory Contents */}
      <div 
        className={`kb-contents ${isDragging ? 'dragging-over' : ''}`}
        onDragOver={handleDragOver}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {isLoading ? (
          <div className="kb-loading">Loading...</div>
        ) : (
          <div className="kb-section">
            {isDragging && (
              <div className="kb-drag-overlay">
                <div className="kb-drag-message">
                  <div className="kb-drag-icon">📁</div>
                  <div className="kb-drag-text">Drop files or folders to upload</div>
                </div>
              </div>
            )}
            {fileItems.length === 0 && !isDragging ? (
              <div className="kb-empty">No items found</div>
            ) : (
              <div className="kb-items">
                {/* Sort items: folders first, then files, both by name */}
                {fileItems
                  .sort((a, b) => {
                    // Sort folders before files
                    if (a.type === 'folder' && b.type !== 'folder') return -1;
                    if (a.type !== 'folder' && b.type === 'folder') return 1;
                    // Sort by name
                    return a.name.localeCompare(b.name);
                  })
                  .map((item) => (
                    <div 
                      key={`${item.type}-${item.name}`} 
                      className={`kb-item ${item.type}-item`}
                    >
                      <div 
                        className="item-content"
                        onClick={item.type === 'folder' ? () => navigateToFolder(item.name) : undefined}
                      >
                        <span className={`item-icon ${item.type}-icon`}>
                          {item.type === 'folder' ? '📁' : '📄'}
                        </span>
                        <div className="item-details">
                          <div className="item-header">
                            <div className="item-title-container">
                              <span className="item-name">{item.name}</span>
                              {item.type === 'file' && item.file_size && (
                                <span className="item-size">({(item.file_size / 1024).toFixed(2)} KB)</span>
                              )}
                            </div>
                            {item.uploaded_time && (
                              <span className="item-uploaded-time">
                                {new Date(item.uploaded_time).toLocaleString()}
                              </span>
                            )}
                          </div>
                          {item.description && (
                            <div className="item-description">{item.description}</div>
                          )}
                        </div>
                      </div>
                      <button 
                        className="item-action delete-action"
                        onClick={() => {
                          if (item.type === 'folder') {
                            deleteFolder(item.name);
                          } else {
                            deleteFile(item.name);
                          }
                        }}
                        title={`Delete ${item.type}`}
                      >
                        🗑️
                      </button>
                    </div>
                  ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Upload Dialog */}
      {showUploadDialog && (
        <div className="kb-dialog-overlay">
          <div className="kb-dialog" style={{ maxWidth: '700px' }}>
            <div className="dialog-header">
              <h3>Upload Files</h3>
              <button 
                className="dialog-close"
                onClick={() => {
                  setShowUploadDialog(false);
                  setSelectedFiles([]);
                  setUploadResults([]);
                }}
              >
                ×
              </button>
            </div>
            <div className="dialog-body" ref={uploadDialogBodyRef}>
              <input
                type="file"
                multiple
                onChange={handleFileSelect}
                className="file-input"
                disabled={isUploading}
              />
              {selectedFiles.length > 0 && (
                <div className="selected-files">
                  <p>Selected files ({selectedFiles.length}):</p>
                  <ul>
                    {selectedFiles.map((file, index) => (
                      <li key={index}>{file.name}</li>
                    ))}
                  </ul>
                </div>
              )}
              
              {/* Real-time Upload Results */}
              {uploadResults.length > 0 && (
                <div className="upload-results">
                  <p>Upload Results:</p>
                  <div className="upload-results-list" ref={uploadResultsListRef}>
                    {uploadResults.map((result, index) => {
                      // Get status icon and message based on result
                      let statusIcon, statusClass;
                      switch (result.status) {
                        case 'success':
                          statusIcon = '✅';
                          statusClass = 'upload-success';
                          break;
                        case 'failed':
                          statusIcon = '❌';
                          statusClass = 'upload-failed';
                          break;
                        case 'updated':
                          statusIcon = '🔄';
                          statusClass = 'upload-updated';
                          break;
                        default:
                          statusIcon = '⏳';
                          statusClass = 'upload-processing';
                      }
                      
                      return (
                        <div key={index} className={`upload-result-item ${statusClass}`}>
                          <div className="upload-result-header">
                            <span className="upload-result-icon">{statusIcon}</span>
                            <span className="upload-result-filename">{result.filename}</span>
                            <span className="upload-result-status">
                              {result.status.charAt(0).toUpperCase() + result.status.slice(1)}
                            </span>
                          </div>
                          {result.status === 'success' && (
                            <div className="upload-result-details">
                              {result.file_size !== undefined && (
                                <span>Size: {(result.file_size / 1024).toFixed(2)} KB</span>
                              )}
                              {result.parsed && <span>• Indexed</span>}
                            </div>
                          )}
                          {result.status === 'failed' && result.error && (
                            <div className="upload-result-error">
                              {result.error}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              
              {isUploading && (
                <div className="uploading-indicator">
                  <div className="loading-spinner"></div>
                  <span>
                    Uploading and processing files... ({uploadResults.length}/{selectedFiles.length})
                  </span>
                </div>
              )}
            </div>
            <div className="dialog-footer">
              <button 
                onClick={() => {
                  setShowUploadDialog(false);
                  setSelectedFiles([]);
                  setUploadResults([]);
                }}
                disabled={isUploading}
              >
                Cancel
              </button>
              <button 
                onClick={uploadFilesWithStream}
                className="dialog-primary"
                disabled={isUploading || selectedFiles.length === 0}
              >
                {isUploading ? 'Uploading...' : 'Upload'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Knowledgebase Modal */}
      {showCreateKBModal && (
        <div className="kb-dialog-overlay">
          <div className="kb-dialog">
            <div className="dialog-header">
              <h3>Create New Knowledgebase</h3>
              <button 
                className="dialog-close"
                onClick={() => {
                  setShowCreateKBModal(false);
                  setNewKBName('');
                  setNewKBDescription('');
                }}
              >
                ×
              </button>
            </div>
            <div className="dialog-body">
              <div className="form-group">
                <label htmlFor="new-kb-name">Name *</label>
                <input
                  type="text"
                  id="new-kb-name"
                  value={newKBName}
                  onChange={(e) => setNewKBName(e.target.value)}
                  placeholder="Enter knowledgebase name"
                  autoFocus
                />
              </div>
              <div className="form-group">
                <label htmlFor="new-kb-description">Description</label>
                <textarea
                  id="new-kb-description"
                  value={newKBDescription}
                  onChange={(e) => setNewKBDescription(e.target.value)}
                  placeholder="Enter knowledgebase description (optional)"
                  rows="3"
                />
              </div>
            </div>
            <div className="dialog-footer">
              <button 
                onClick={() => {
                  setShowCreateKBModal(false);
                  setNewKBName('');
                  setNewKBDescription('');
                }}
                disabled={isLoading}
              >
                Cancel
              </button>
              <button 
                onClick={createKnowledgebase}
                className="dialog-primary"
                disabled={isLoading || !newKBName.trim()}
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}



      {/* Rename Knowledgebase Modal */}
      {/* Commented out to hide rename functionality temporarily */}
      {/* {showRenameKBModal && kbToRename && (
        <div className="kb-dialog-overlay">
          <div className="kb-dialog">
            <div className="dialog-header">
              <h3>Rename Knowledgebase</h3>
              <button 
                className="dialog-close"
                onClick={() => {
                  setShowRenameKBModal(false);
                  setKBToRename(null);
                  setRenameKBName('');
                }}
              >
                ×
              </button>
            </div>
            <div className="dialog-body">
              <div className="form-group">
                <label htmlFor="rename-kb-name">Name *</label>
                <input
                  type="text"
                  id="rename-kb-name"
                  value={renameKBName}
                  onChange={(e) => setRenameKBName(e.target.value)}
                  placeholder="Enter new knowledgebase name"
                  autoFocus
                />
              </div>
            </div>
            <div className="dialog-footer">
              <button 
                onClick={() => {
                  setShowRenameKBModal(false);
                  setKBToRename(null);
                  setRenameKBName('');
                }}
                disabled={isLoading}
              >
                Cancel
              </button>
              <button 
                onClick={renameKnowledgebase}
                className="dialog-primary"
                disabled={isLoading || !renameKBName.trim()}
              >
                Rename
              </button>
            </div>
          </div>
        </div>
      )} */}

      {/* Edit File/Folder Descriptions Modal */}
      {showEditDescriptionsModal && (
        <div className="kb-dialog-overlay">
          <div className="kb-dialog" style={{ maxWidth: '780px', maxHeight: '90vh' }}>
            <div className="dialog-header">
              <h3>Edit File & Folder Descriptions</h3>
              <button 
                className="dialog-close"
                onClick={() => {
                  setShowEditDescriptionsModal(false);
                  setEditingFiles([]);
                }}
              >
                ×
              </button>
            </div>
            <div className="dialog-body" style={{ overflowY: 'auto', maxHeight: '65vh' }}>
              {isLoading ? (
                <div className="kb-loading">Loading files...</div>
              ) : editingFiles.length === 0 ? (
                <div className="kb-empty">No files found to edit</div>
              ) : (
                <div className="edit-descriptions-list">
                  {editingFiles.map((file) => (
                    <div key={`${file.type}-${file.id}-${file.name}`} className="edit-description-item">
                      <div className="edit-description-item-header">
                        <span className={`item-icon ${file.type}-icon`}>
                          {file.type === 'folder' ? '📁' : '📄'}
                        </span>
                        <span className="item-name">{file.name}</span>
                        {file.type === 'file' && file.file_size && (
                          <span className="item-size">({(file.file_size / 1024).toFixed(2)} KB)</span>
                        )}
                      </div>
                      <div className="form-group">
                        <label htmlFor={`description-${file.id}`}>Description</label>
                        <textarea
                          id={`description-${file.id}`}
                          value={file.description || ''}
                          onChange={(e) => {
                            setEditingFiles(prev => prev.map(f => 
                              f.id === file.id ? { ...f, description: e.target.value } : f
                            ));
                          }}
                          placeholder="Enter description for this file/folder"
                          rows="2"
                          style={{ fontSize: '13px', padding: '6px 8px' }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="dialog-footer">
              <button 
                onClick={() => {
                  setShowEditDescriptionsModal(false);
                  setEditingFiles([]);
                }}
                disabled={isLoading}
              >
                Cancel
              </button>
              <button 
                onClick={async () => {
                  // Save all updated descriptions
                  setIsLoading(true);
                  setError('');
                  try {
                    const activeKB = knowledgebases.find(kb => kb.is_active);
                    if (!activeKB) {
                      throw new Error('No active knowledgebase found');
                    }

                    // Prepare the updates array
                    const updates = editingFiles.map(file => ({
                      file_id: file.id,
                      description: file.description || ''
                    }));

                    // Call the API to update multiple descriptions
                    const response = await fetchWithAuth(`/api/knowledgebase/${activeKB.id}/descriptions`, {
                      method: 'PUT',
                      headers: {
                        'Content-Type': 'application/json',
                      },
                      body: JSON.stringify(updates),
                    });

                    if (!response.ok) {
                      const errorData = await response.json().catch(() => ({}));
                      throw new Error(errorData.detail || 'Failed to update descriptions');
                    }

                    // Force refresh after description update to get fresh data from API
      const currentCachePath = currentPath.join('/').replace(/^\//, '');
      fetchDirectoryContents(currentCachePath, true);
      refreshFileBrowser(currentCachePath); // Trigger sidebar refresh with the modified path
      
      // Close the modal
      setShowEditDescriptionsModal(false);
      setEditingFiles([]);
                  } catch (err) {
                    setError(err.message);
                  } finally {
                    setIsLoading(false);
                  }
                }}
                className="dialog-primary"
                disabled={isLoading}
              >
                Save All Descriptions
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Confirm Dialog */}
      {showConfirmDialog && (
        <div className="kb-dialog-overlay">
          <div className="kb-dialog">
            <div className="dialog-header">
              <h3>{confirmDialogConfig.title}</h3>
              <button 
                className="dialog-close"
                onClick={() => setShowConfirmDialog(false)}
              >
                ×
              </button>
            </div>
            <div className="dialog-body">
              <p>{confirmDialogConfig.message}</p>
            </div>
            <div className="dialog-footer">
              <button 
                onClick={() => setShowConfirmDialog(false)}
                disabled={isLoading}
              >
                {confirmDialogConfig.cancelText}
              </button>
              <button 
                onClick={() => {
                  confirmDialogConfig.onConfirm();
                  setShowConfirmDialog(false);
                }}
                className="dialog-primary"
                disabled={isLoading}
              >
                {confirmDialogConfig.confirmText}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default KnowledgebaseBrowser;