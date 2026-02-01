import React, { useState, useEffect, useCallback, useRef } from 'react';
import { fetchWithAuth } from './store';
import useKnowledgebaseStore from './store';
import useRetrievalStore from './retrievalStore';
import './RetrievalBrowser.css';

const RetrievalBrowser = () => {
  // Knowledgebase store
  const { knowledgebases, setActiveKnowledgebase, refreshFileBrowser, activeEmbeddingConfig } = useKnowledgebaseStore();
  
  // Get active knowledgebase from knowledgebases array
  const activeKnowledgebase = knowledgebases.find(kb => kb.is_active === 1) || knowledgebases[0];
  
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
    clearRetrievalResults,
    activeChunkRun,
    fetchActiveChunkRun,
    fetchActiveEmbeddingConfig,
    error,
    clearError
  } = useRetrievalStore();
  
  // State for selected index runs
  const [selectedRuns, setSelectedRuns] = useState(new Set());
  
  // Handle checkbox change
  const handleCheckboxChange = (runId) => {
    setSelectedRuns(prev => {
      const newSet = new Set(prev);
      if (newSet.has(runId)) {
        newSet.delete(runId);
      } else {
        newSet.add(runId);
      }
      return newSet;
    });
  };
  
  // Handle delete selected runs
  const handleDeleteSelected = async () => {
    if (selectedRuns.size === 0) return;
    
    try {
      // Delete each selected run
      for (const runId of selectedRuns) {
        await fetchWithAuth(`/api/index-runs/${activeKnowledgebase?.name || 'default'}/${runId}`, {
          method: 'DELETE'
        });
      }
      
      // Refresh index runs
      await fetchIndexRuns(activeKnowledgebase?.id);
      
      // Clear selection
      setSelectedRuns(new Set());
    } catch (error) {
      console.error('Error deleting index runs:', error);
    }
  };
  

  // Fetch index runs and active configs on mount and when knowledgebase changes
  useEffect(() => {
    fetchIndexRuns(activeKnowledgebase?.id);
    // Fetch active chunk run and embedding config
    const fetchConfigs = async () => {
      await fetchActiveChunkRun(activeKnowledgebase?.id);
      await fetchActiveEmbeddingConfig();
    };
    fetchConfigs();
  }, [fetchIndexRuns, fetchActiveChunkRun, fetchActiveEmbeddingConfig, knowledgebases, activeKnowledgebase]);
  
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
          {/* Active Configuration Info */}
          <div className="retrieval-sidebar-section">
            <div className="active-config-info">
              <h4>Active Configuration</h4>
              <div className="config-item">
                <span className="config-label">Knowledgebase:</span>
                <span className="config-value">{activeKnowledgebase?.name || 'No active KB'}</span>
              </div>
              <div className="config-item">
                <span className="config-label">Chunk Run:</span>
                <span className="config-value">{activeChunkRun?.id ? `ID: ${activeChunkRun.id}` : 'No active chunk run'}</span>
              </div>
              <div className="config-item">
                <span className="config-label">Embedding:</span>
                <span className="config-value">{activeEmbeddingConfig?.id || 'No active embedding'}</span>
              </div>
            </div>
          </div>
          
          {/* Run Indexing Button */}
          <div className="retrieval-sidebar-section">
            <button 
              className="indexing-btn"
              onClick={handleRunIndexing}
              disabled={isIndexing || !activeChunkRun?.id || !activeEmbeddingConfig?.id}
              style={{ width: '100%' }}
            >
              {isIndexing ? 'Indexing...' : 'Run Indexing'}
            </button>
          </div>
          
          {/* Index List */}
          <div className="retrieval-sidebar-section">
            <div className="index-list-header">
              <h3>Index List</h3>
              {selectedRuns.size > 0 && (
                <button 
                  className="delete-btn"
                  onClick={handleDeleteSelected}
                >
                  Delete ({selectedRuns.size})
                </button>
              )}
            </div>
            <div className="index-runs-list">
              {indexRuns.length === 0 ? (
                <div className="no-runs">No index runs found</div>
              ) : (
                indexRuns.map(run => (
                  <div key={run.id} className={`index-run-item ${selectedRuns.has(run.id) ? 'selected' : ''}`}>
                    <div className="index-run-header">
                      <input
                        type="checkbox"
                        className="run-checkbox"
                        checked={selectedRuns.has(run.id)}
                        onChange={() => handleCheckboxChange(run.id)}
                      />
                      <span className="run-time">
                        {new Date(run.run_time).toLocaleString()}
                      </span>
                    </div>
                    <div className="index-run-details">
                      <span className="embedding-id">{run.embedding_configure_id}</span>
                      <span>{run.framework || 'N/A'}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
        
        {/* Main Content */}
        <div className="retrieval-browser-main">

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
      
      {/* Error Modal */}
      {error && (
        <div className="error-modal-overlay">
          <div className="error-modal">
            <div className="error-modal-header">
              <div className="error-modal-icon">⚠️</div>
              <h3>Warning</h3>
              <button className="error-modal-close" onClick={clearError}>
                ×
              </button>
            </div>
            <div className="error-modal-body">
              <p>{error}</p>
            </div>
            <div className="error-modal-footer">
              <button className="error-modal-button" onClick={clearError}>
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RetrievalBrowser;