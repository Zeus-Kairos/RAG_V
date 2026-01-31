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
          {/* Run Indexing Button */}
          <div className="retrieval-sidebar-section">
            <button 
              className="indexing-btn"
              onClick={handleRunIndexing}
              disabled={isIndexing}
              style={{ width: '100%' }}
            >
              {isIndexing ? 'Indexing...' : 'Run Indexing'}
            </button>
          </div>
          
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