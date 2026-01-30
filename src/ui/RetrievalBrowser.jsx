import React, { useState, useEffect, useCallback, useRef } from 'react';
import { fetchWithAuth } from './store';
import useKnowledgebaseStore from './store';
import useRetrievalStore from './retrievalStore';
import './RetrievalBrowser.css';

const RetrievalBrowser = () => {
  // Knowledgebase store
  const { knowledgebases, setActiveKnowledgebase, refreshFileBrowser } = useKnowledgebaseStore();
  
  // Retrieval store
  const { 
    runIndexing, 
    isIndexing, 
    queryDocuments, 
    currentQuery, 
    setCurrentQuery, 
    retrievalResults, 
    indexRuns, 
    fetchIndexRuns,
    clearRetrievalResults
  } = useRetrievalStore();
  
  // Local state for file browser
  const [currentKnowledgebase, setCurrentKnowledgebase] = useState(knowledgebases.find(kb => kb.is_active)?.name || 'default');
  const [currentPath, setCurrentPath] = useState(['']);
  const [fileItems, setFileItems] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  
  // Cache for directory contents
  const [directoryCache, setDirectoryCache] = useState({});
  const directoryCacheRef = React.useRef(directoryCache);
  const currentPathRef = React.useRef(currentPath);
  
  // Update refs whenever their state changes
  useEffect(() => {
    directoryCacheRef.current = directoryCache;
  }, [directoryCache]);
  
  useEffect(() => {
    currentPathRef.current = currentPath;
  }, [currentPath]);
  
  // Update currentKnowledgebase when knowledgebases change
  useEffect(() => {
    const activeKB = knowledgebases.find(kb => kb.is_active);
    if (activeKB) {
      setCurrentKnowledgebase(activeKB.name);
    }
  }, [knowledgebases]);
  
  // Fetch directory contents
  const fetchDirectoryContents = useCallback(async (path, forceRefresh = false) => {
    setIsLoading(true);
    setError('');
    try {
      // Get the active knowledgebase
      const activeKB = knowledgebases.find(kb => kb.is_active);
      if (!activeKB || !activeKB.id || !activeKB.name) {
        throw new Error('No active knowledgebase found');
      }
      
      // Create cache key
      const cacheKey = `${activeKB.id}:${path}`;
      
      // Check cache
      if (!forceRefresh && directoryCacheRef.current[cacheKey]) {
        setFileItems(directoryCacheRef.current[cacheKey]);
        setIsLoading(false);
        return;
      }
      
      // Call API
      const response = await fetchWithAuth(`/api/knowledgebase/${activeKB.id}/list?path=${encodeURIComponent(path)}&knowledge_base=${encodeURIComponent(activeKB.name)}`);
      if (!response.ok) {
        throw new Error('Failed to fetch directory contents');
      }
      const data = await response.json();
      
      // Process items
      const allItems = [];
      
      // Add folders
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
      
      // Add files
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
      
      // Update state
      setFileItems(allItems);
      setDirectoryCache(prev => ({
        ...prev,
        [cacheKey]: allItems
      }));
      
      // Update ref
      directoryCacheRef.current = {
        ...directoryCacheRef.current,
        [cacheKey]: allItems
      };
    } catch (err) {
      setError(err.message);
      setFileItems([]);
    } finally {
      setIsLoading(false);
    }
  }, [knowledgebases]);
  
  // Navigate to folder
  const navigateToFolder = (folderName) => {
    const newPath = [...currentPath, folderName];
    setCurrentPath(newPath);
  };
  
  // Handle path change
  useEffect(() => {
    fetchDirectoryContents(currentPath.join('/').replace(/^\//, ''));
  }, [currentPath, fetchDirectoryContents]);
  
  // Fetch index runs on mount
  useEffect(() => {
    fetchIndexRuns();
  }, []);
  
  // Handle query submission
  const handleQuerySubmit = (e) => {
    e.preventDefault();
    if (currentQuery.trim()) {
      queryDocuments(currentQuery);
    }
  };
  
  // Handle clear query
  const handleClearQuery = () => {
    setCurrentQuery('');
    clearRetrievalResults();
  };
  
  // Handle run indexing
  const handleRunIndexing = () => {
    runIndexing();
  };
  
  return (
    <div className="retrieval-browser">
      <div className="retrieval-browser-content">
        {/* Sidebar */}
        <div className="retrieval-browser-sidebar">
          {/* Index Run History */}
          <div className="retrieval-sidebar-section">
            <h3>Index Run History</h3>
            <div className="index-runs-list">
              {indexRuns.length === 0 ? (
                <div className="no-runs">No index runs found</div>
              ) : (
                indexRuns.map(run => (
                  <div key={run.id} className="index-run-item">
                    <div className="index-run-header">
                      <span className={`run-status ${run.status}`}>
                        {run.status === 'completed' ? '✓' : run.status === 'failed' ? '✗' : '⏳'}
                      </span>
                      <span className="run-time">
                        {new Date(run.time).toLocaleString()}
                      </span>
                    </div>
                    <div className="index-run-details">
                      <span>Files: {run.files_indexed}</span>
                      <span>Duration: {run.duration}</span>
                    </div>
                    {run.error && (
                      <div className="index-run-error">
                        {run.error}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
        
        {/* Main Content */}
        <div className="retrieval-browser-main">
          {/* File Tree and Indexing */}
          <div className="retrieval-section">
            <div className="retrieval-section-header">
              <h3>Knowledgebase Files</h3>
              <button 
                className="indexing-btn"
                onClick={handleRunIndexing}
                disabled={isIndexing}
              >
                {isIndexing ? 'Indexing...' : 'Run Indexing'}
              </button>
            </div>
            
            {/* Breadcrumb Navigation */}
            <div className="retrieval-breadcrumb">
              <div className="breadcrumb-item" onClick={() => setCurrentPath([''])}>
                Root
              </div>
              {currentPath.slice(1).map((folder, index) => (
                <React.Fragment key={index}>
                  <span className="breadcrumb-separator">/</span>
                  <div 
                    className="breadcrumb-item"
                    onClick={() => setCurrentPath(currentPath.slice(0, index + 2))}
                  >
                    {folder}
                  </div>
                </React.Fragment>
              ))}
            </div>
            
            {/* File List */}
            <div className="retrieval-file-list">
              {isLoading ? (
                <div className="loading">Loading files...</div>
              ) : error ? (
                <div className="error-message">{error}</div>
              ) : (
                <>
                  {fileItems.length === 0 ? (
                    <div className="no-files">No files found</div>
                  ) : (
                    fileItems
                      .sort((a, b) => {
                        // Sort folders before files
                        if (a.type === 'folder' && b.type !== 'folder') return -1;
                        if (a.type !== 'folder' && b.type === 'folder') return 1;
                        // Sort by name
                        return a.name.localeCompare(b.name);
                      })
                      .map((item) => (
                        <div key={`${item.type}-${item.name}`} className={`file-item ${item.type}`}>
                          <div 
                            className="file-item-content"
                            onClick={item.type === 'folder' ? () => navigateToFolder(item.name) : undefined}
                          >
                            <span className="file-icon">
                              {item.type === 'folder' ? '📁' : '📄'}
                            </span>
                            <span className="file-name">{item.name}</span>
                            {item.type === 'file' && item.file_size && (
                              <span className="file-size">
                                ({(item.file_size / 1024).toFixed(2)} KB)
                              </span>
                            )}
                          </div>
                        </div>
                      ))
                  )}
                </>
              )}
            </div>
          </div>
          
          {/* Query and Results */}
          <div className="retrieval-section">
            <h3>Document Retrieval</h3>
            
            {/* Query Form */}
            <form onSubmit={handleQuerySubmit} className="query-form">
              <input
                type="text"
                value={currentQuery}
                onChange={(e) => setCurrentQuery(e.target.value)}
                placeholder="Enter your query..."
                className="query-input"
              />
              <div className="query-actions">
                <button 
                  type="submit" 
                  className="query-submit-btn"
                  disabled={!currentQuery.trim()}
                >
                  Search
                </button>
                <button 
                  type="button" 
                  className="query-clear-btn"
                  onClick={handleClearQuery}
                  disabled={!currentQuery.trim() && retrievalResults.length === 0}
                >
                  Clear
                </button>
              </div>
            </form>
            
            {/* Results */}
            <div className="retrieval-results">
              {retrievalResults.length === 0 ? (
                currentQuery ? (
                  <div className="no-results">No results found for "{currentQuery}"</div>
                ) : (
                  <div className="no-query">Enter a query to search for documents</div>
                )
              ) : (
                <>
                  <div className="results-header">
                    Found {retrievalResults.length} results for "{currentQuery}"
                  </div>
                  <div className="results-list">
                    {retrievalResults.map(result => (
                      <div key={result.id} className="result-item">
                        <div className="result-header">
                          <span className="result-title">{result.document_name}</span>
                          <span className="result-score">
                            {Math.round(result.relevance_score * 100)}%
                          </span>
                        </div>
                        <div className="result-snippet">
                          {result.snippet}
                        </div>
                        <div className="result-meta">
                          <span className="result-path">{result.file_path}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RetrievalBrowser;