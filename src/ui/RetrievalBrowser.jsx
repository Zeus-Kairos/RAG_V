import React, { useState, useEffect, useCallback, useRef } from 'react';
import { fetchWithAuth } from './store';
import useKnowledgebaseStore from './store';
import useRetrievalStore from './retrievalStore';
import UmapScatterPanel from './UmapScatterPanel';
import ChunkDetailPopover from './ChunkDetailPopover';
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
    isLoading,
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
    clearError,
    setSelectedRuns,
    retrieverType,
    lastSearchQuery,
    k
  } = useRetrievalStore();
  
  // State for selected index runs
  const [localSelectedRuns, setLocalSelectedRuns] = useState(new Set());
  const [showUmapView, setShowUmapView] = useState(false);
  
  // State for expanded parameters per run
  const [expandedParams, setExpandedParams] = useState({});

  const [listChunkPopover, setListChunkPopover] = useState(null);
  const [listChunkDetail, setListChunkDetail] = useState(null);
  const [listDetailLoading, setListDetailLoading] = useState(false);
  const [listDetailError, setListDetailError] = useState(null);

  // Toggle parameters expansion for a run
  const toggleParams = (runId) => {
    setExpandedParams(prev => ({
      ...prev,
      [runId]: !prev[runId]
    }));
  };
  
  // Handle checkbox change
  const handleCheckboxChange = (runId) => {
    setLocalSelectedRuns(prev => {
      const newSet = new Set(prev);
      if (newSet.has(runId)) {
        newSet.delete(runId);
      } else {
        newSet.add(runId);
      }
      // Also update the store's selectedRuns
      setSelectedRuns(newSet);
      return newSet;
    });
  };
  
  // Handle delete selected runs
  const handleDeleteSelected = async () => {
    if (localSelectedRuns.size === 0) return;
    
    try {
      // Delete each selected run
      for (const runId of localSelectedRuns) {
        await fetchWithAuth(`/api/index-runs/${activeKnowledgebase?.name || 'default'}/${runId}`, {
          method: 'DELETE'
        });
      }
      
      // Refresh index runs
      await fetchIndexRuns(activeKnowledgebase?.id);
      
      // Clear selection
      setLocalSelectedRuns(new Set());
      setSelectedRuns(new Set());
    } catch (error) {
      console.error('Error deleting index runs:', error);
    }
  };
  
  // Handle select all
  const handleSelectAll = () => {
    let newSet;
    if (localSelectedRuns.size === indexRuns.length) {
      // Deselect all
      newSet = new Set();
    } else {
      // Select all
      newSet = new Set(indexRuns.map(run => run.id));
    }
    setLocalSelectedRuns(newSet);
    setSelectedRuns(newSet);
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

  useEffect(() => {
    if (!listChunkPopover) {
      setListChunkDetail(null);
      setListDetailError(null);
      setListDetailLoading(false);
      return undefined;
    }
    const { indexRunId, chunkId } = listChunkPopover;
    const kbName = activeKnowledgebase?.name || 'default';
    let cancelled = false;
    (async () => {
      setListDetailLoading(true);
      setListDetailError(null);
      setListChunkDetail(null);
      try {
        const res = await fetchWithAuth(
          `/api/retrieve/${encodeURIComponent(kbName)}/${indexRunId}/chunk/${encodeURIComponent(String(chunkId))}`,
        );
        const text = await res.text();
        let json;
        try {
          json = JSON.parse(text);
        } catch {
          throw new Error(text || res.statusText);
        }
        if (!res.ok) {
          const d = json.detail;
          const msg =
            typeof d === 'string' ? d : Array.isArray(d) ? d.map((x) => x.msg || JSON.stringify(x)).join('; ') : JSON.stringify(d);
          throw new Error(msg || json.message || res.statusText);
        }
        if (cancelled) return;
        if (!json.success) {
          throw new Error(json.message || 'Failed to load');
        }
        setListChunkDetail({
          content: json.content ?? '',
          metadata: json.metadata ?? {},
          document_name: json.document_name ?? '',
        });
      } catch (e) {
        if (!cancelled) setListDetailError(e.message || String(e));
      } finally {
        if (!cancelled) setListDetailLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [listChunkPopover, activeKnowledgebase?.name]);

  const closeListChunkPopover = useCallback(() => {
    setListChunkPopover(null);
    setListChunkDetail(null);
    setListDetailError(null);
  }, []);

  const openListChunkPopover = useCallback((indexRunId, chunkId, e) => {
    e?.stopPropagation?.();
    setListChunkPopover({
      indexRunId: Number(indexRunId),
      chunkId: String(chunkId),
      clientX: e.clientX,
      clientY: e.clientY,
    });
  }, []);

  // Handle query submission
  const handleQuerySubmit = (e) => {
    e.preventDefault();
    if (currentQuery.trim()) {
      queryDocuments(currentQuery, localSelectedRuns);
    }
  };
  
  // Handle clear query
  const handleClearQuery = () => {
    setCurrentQuery('');
    clearRetrievalResults();
    closeListChunkPopover();
  };
  
  // Handle run indexing
  const handleRunIndexing = () => {
    runIndexing();
  };
  
  // Sync result panel header heights
  const resultsContainerRef = useRef(null);
  
  useEffect(() => {
    const syncHeaderHeights = () => {
      if (showUmapView || !resultsContainerRef.current) {
        return;
      }
      const headers = resultsContainerRef.current.querySelectorAll('.result-panel-header');
      if (headers.length > 0) {
        let maxHeight = 0;
        headers.forEach(header => {
          header.style.height = 'auto';
          const height = header.offsetHeight;
          if (height > maxHeight) {
            maxHeight = height;
          }
        });
        headers.forEach(header => {
          header.style.height = `${maxHeight}px`;
        });
      }
    };
    
    // Run initially
    syncHeaderHeights();
    
    // Add resize event listener
    window.addEventListener('resize', syncHeaderHeights);
    
    // Clean up
    return () => {
      window.removeEventListener('resize', syncHeaderHeights);
    };
  }, [expandedParams, retrievalResults, showUmapView]);
  
  return (
    <div className="retrieval-browser">
      <div className="retrieval-browser-content">
        {/* Sidebar */}
        <div className="retrieval-browser-sidebar">
          {/* Active Configuration and Indexing */}
          <div className="retrieval-sidebar-section">
            <div className="active-config-info">
              <h4>Index Configuration</h4>
              <div className="config-item">
                <span className="config-label">Knowledgebase:</span>
                <span className="config-value">{activeKnowledgebase?.name || 'No active KB'}</span>
              </div>
              <div className="config-item">
                <span className="config-label">Chunker:</span>
                <span className="config-value">{activeChunkRun?.framework ? activeChunkRun.framework : 'No active chunk run'}</span>
              </div>
              <div className="config-item">
                <span className="config-label">Embedding:</span>
                <span className="config-value">{activeEmbeddingConfig?.id || 'No active embedding'}</span>
              </div>
              <div className="indexing-btn-container">
                <button 
                  className="indexing-btn"
                  onClick={handleRunIndexing}
                  disabled={isIndexing || !activeChunkRun?.id || !activeEmbeddingConfig?.id}
                  style={{ width: '100%' }}
                >
                  {isIndexing ? 'Indexing...' : 'Run Indexing'}
                </button>
              </div>
            </div>
          </div>
          
          {/* Index List */}
          <div className="retrieval-sidebar-section">
            <div className="index-list-header">
              <div className="index-list-header-left">
                {indexRuns.length > 0 && (
                  <input
                    type="checkbox"
                    className="select-all-checkbox"
                    checked={indexRuns.length > 0 && localSelectedRuns.size === indexRuns.length}
                    onChange={handleSelectAll}
                  />
                )}
                <h3>Index List</h3>
              </div>
              {localSelectedRuns.size > 0 && (
                <button 
                  className="delete-btn"
                  onClick={handleDeleteSelected}
                >
                  Delete ({localSelectedRuns.size})
                </button>
              )}
            </div>
            <div className="index-runs-list">
              {indexRuns.length === 0 ? (
                <div className="no-runs">No index runs found</div>
              ) : (
                indexRuns.map(run => {
                  const activeChunkRunId = activeChunkRun?.id;
                  const isOnActiveChunkRun =
                    activeChunkRunId != null &&
                    Number(run.chunk_run_id) === Number(activeChunkRunId);
                  return (
                  <div
                    key={run.id}
                    className={`index-run-item ${localSelectedRuns.has(run.id) ? 'selected' : ''} ${isOnActiveChunkRun ? 'index-run-item-active-chunk' : ''}`}
                  >
                    <div className="index-run-header">
                      <div className="run-checkbox-container">
                        <input
                          type="checkbox"
                          className="run-checkbox"
                          checked={localSelectedRuns.has(run.id)}
                          onChange={() => handleCheckboxChange(run.id)}
                        />
                        <span className="run-id">ID: {run.id}</span>
                      </div>
                      <span className="run-time">
                        {(() => {
                          // Parse the UTC time string correctly
                          const timeStr = run.run_time;
                          // If time string doesn't have timezone info, assume it's UTC
                          let date;
                          if (timeStr.includes('T') || timeStr.includes('Z')) {
                            // ISO format with timezone
                            date = new Date(timeStr);
                          } else {
                            // SQLite format without timezone - treat as UTC
                            const utcTimeStr = timeStr.replace(' ', 'T') + 'Z';
                            date = new Date(utcTimeStr);
                          }
                          // Convert to local time display
                          return date.toLocaleString();
                        })()}
                      </span>
                    </div>
                    <div className="index-run-details">
                      <span className="embedding-id">{run.embedding_configure_id}</span>
                      <span>{run.framework || 'N/A'}</span>
                    </div>
                    {run.parameters && Object.keys(run.parameters).length > 0 && (
                      <div className="index-run-tooltip">
                        <div className="tooltip-content">
                          <h4>Chunk Parameters</h4>
                          <div className="tooltip-params">
                            {(() => {
                              const paramElements = [];
                              let index = 0;
                              
                              Object.entries(run.parameters).forEach(([key, value]) => {
                                // Handle chunkers array specially
                                if (key === 'chunkers' && Array.isArray(value)) {
                                  value.forEach((chunker) => {
                                    const chunkerType = chunker.chunker.charAt(0).toUpperCase() + chunker.chunker.slice(1);
                                    paramElements.push(
                                      <span key={`${index++}`}>{`${chunkerType}: Enabled`}</span>
                                    );
                                    
                                    // Display parameters for this chunker
                                    if (chunker.params) {
                                      Object.entries(chunker.params).forEach(([paramName, paramValue]) => {
                                        const displayName = paramName
                                          .replace(/_/g, ' ')
                                          .replace(/\b\w/g, (l) => l.toUpperCase());
                                        let displayValue;
                                        if (typeof paramValue === 'boolean') {
                                          displayValue = paramValue ? 'Enabled' : 'Disabled';
                                        } else if (
                                          typeof paramValue === 'object' &&
                                          paramValue !== null
                                        ) {
                                          displayValue = JSON.stringify(paramValue);
                                        } else {
                                          displayValue = paramValue;
                                        }
                                        paramElements.push(
                                          <span key={`${index++}`}>{`${displayName}: ${displayValue}`}</span>
                                        );
                                      });
                                    }
                                  });
                                } else {
                                  // Format regular key to be more readable
                                  const displayKey = key
                                    .replace(/_/g, ' ')
                                    .replace(/\b\w/g, l => l.toUpperCase());
                                   
                                  let displayValue;
                                  if (typeof value === 'boolean') {
                                    displayValue = value ? 'Enabled' : 'Disabled';
                                  } else if (typeof value === 'object' && value !== null) {
                                    displayValue = JSON.stringify(value);
                                  } else {
                                    displayValue = value;
                                  }

                                  paramElements.push(
                                    <span key={`${index++}`}>{`${displayKey}: ${displayValue}`}</span>
                                  );
                                }
                              });
                              
                              return paramElements;
                            })()}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
        
        {/* Main Content */}
        <div className="retrieval-browser-main">

          {/* Query and Results */}
          <div className="retrieval-section">
            <div className="retrieval-section-header">
              <h3>Document Retrieval</h3>
              <div className="retrieval-view-toggle" role="group" aria-label="结果展示方式">
                <button
                  type="button"
                  className={`retrieval-view-toggle-btn ${!showUmapView ? 'is-active' : ''}`}
                  onClick={() => setShowUmapView(false)}
                  aria-pressed={!showUmapView}
                >
                  列表
                </button>
                <button
                  type="button"
                  className={`retrieval-view-toggle-btn ${showUmapView ? 'is-active' : ''}`}
                  onClick={() => setShowUmapView(true)}
                  aria-pressed={showUmapView}
                >
                  UMAP 映射
                </button>
              </div>
            </div>
            
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
                  disabled={!currentQuery.trim() || localSelectedRuns.size === 0 || isLoading}
                >
                  {isLoading ? 'Searching...' : 'Search'}
                </button>
                <button 
                  type="button" 
                  className="query-clear-btn"
                  onClick={handleClearQuery}
                  disabled={!currentQuery.trim() && Object.keys(retrievalResults).length === 0}
                >
                  Clear
                </button>
              </div>
            </form>
            
            {/* Results */}
            <div className="retrieval-results">
              {showUmapView ? (
                (() => {
                  const retrievalRunIds = Object.keys(retrievalResults);
                  const displayedRunIds =
                    retrievalRunIds.length > 0
                      ? [...retrievalRunIds].sort((a, b) => Number(a) - Number(b))
                      : [...localSelectedRuns].sort((a, b) => Number(a) - Number(b)).map(String);
                  if (displayedRunIds.length === 0) {
                    return (
                      <div className="no-query">请在左侧勾选至少一个索引以查看映射</div>
                    );
                  }
                  return (
                    <div className="umap-results-grid">
                      {displayedRunIds.map((runId) => (
                        <div key={runId} className="umap-result-panel">
                          <div className="umap-result-panel-title">Index ID: {runId}</div>
                          <UmapScatterPanel
                            kbName={activeKnowledgebase?.name || 'default'}
                            indexRunId={Number(runId)}
                            query={retrievalResults[runId] ? lastSearchQuery : ''}
                            highlightIds={
                              retrievalResults[runId]?.results
                                ?.slice(0, k)
                                .map((r) => String(r.id)) ?? []
                            }
                          />
                        </div>
                      ))}
                    </div>
                  );
                })()
              ) : Object.keys(retrievalResults).length === 0 ? (
                lastSearchQuery ? (
                  <div className="no-results">No results found for "{lastSearchQuery}"</div>
                ) : (
                  <div className="no-query">Enter a query to search for documents</div>
                )
              ) : (
                <div className="results-container" ref={resultsContainerRef}>
                  {Object.entries(retrievalResults).map(([runId, runData]) => {
                    // Find the index run info for this runId
                    const indexRun = indexRuns.find(run => run.id.toString() === runId);
                    const { results, retrieverType } = runData;
                    return (
                      <div key={runId} className="result-panel">
                        {/* Index run info header */}
                        <div className="result-panel-header">
                          <div className="run-info">
                            <h4>Index ID: {runId}</h4>
                            {indexRun && (
                              <div className="run-details">
                                <div className="run-meta-row">
                                  <span className="run-embedding-id">
                                    Embedding: <span className="highlight-value">{indexRun.embedding_configure_id}</span>
                                  </span>
                                  <span className="run-retriever-type">
                                    Retriever: <span className="highlight-value">{retrieverType.charAt(0).toUpperCase() + retrieverType.slice(1)}</span>
                                  </span>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
                                  {indexRun.framework && (
                                    <span className="run-framework">{indexRun.framework}</span>
                                  )}
                                  {indexRun.parameters && Object.keys(indexRun.parameters).length > 0 && (
                                    <>
                                      <button 
                                        onClick={() => toggleParams(runId)}
                                        className="params-toggle-btn"
                                        title={expandedParams[runId] ? 'Hide parameters' : 'Show parameters'}
                                      >
                                        {expandedParams[runId] ? '▼' : '▶'}
                                      </button>
                                      {expandedParams[runId] && (
                                        <div className="result-chunk-params">
                                          {(() => {
                                            const paramElements = [];
                                            let index = 0;
                                             
                                            Object.entries(indexRun.parameters).forEach(([key, value]) => {
                                              // Handle chunkers array specially
                                              if (key === 'chunkers' && Array.isArray(value)) {
                                                value.forEach((chunker) => {
                                                  const chunkerType = chunker.chunker.charAt(0).toUpperCase() + chunker.chunker.slice(1);
                                                  paramElements.push(
                                                    <span key={`${index++}`}>{`${chunkerType}: Enabled`}</span>
                                                  );
                                                   
                                                  // Display parameters for this chunker
                                                  if (chunker.params) {
                                                    Object.entries(chunker.params).forEach(([paramName, paramValue]) => {
                                                      const displayName = paramName
                                                        .replace(/_/g, ' ')
                                                        .replace(/\b\w/g, l => l.toUpperCase());
                                                      let displayValue = paramValue;
                                                      if (typeof paramValue === 'boolean') {
                                                        displayValue = paramValue ? 'Enabled' : 'Disabled';
                                                      }
                                                      paramElements.push(
                                                        <span key={`${index++}`}>{`${displayName}: ${displayValue}`}</span>
                                                      );
                                                    });
                                                  }
                                                });
                                              } else {
                                                // Format regular key to be more readable
                                                const displayKey = key
                                                  .replace(/_/g, ' ')
                                                  .replace(/\b\w/g, l => l.toUpperCase());
                                                   
                                                // Format value based on type
                                                let displayValue = value;
                                                if (typeof value === 'boolean') {
                                                  displayValue = value ? 'Enabled' : 'Disabled';
                                                }
                                                 
                                                paramElements.push(
                                                  <span key={`${index++}`}>{`${displayKey}: ${displayValue}`}</span>
                                                );
                                              }
                                            });
                                             
                                            return paramElements;
                                          })()}
                                        </div>
                                      )}
                                    </>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                        
                        {/* Results for this run */}
                        <div className="result-panel-content">
                          <div className="panel-results-header">
                            Found {results.length} results for "{lastSearchQuery}"
                          </div>
                          <div className="panel-results-list">
                            {results.map(result => (
                              <div key={result.id} className="result-item">
                                <div className="result-meta">
                                  <span className="result-id">
                                    ID:{' '}
                                    <button
                                      type="button"
                                      className="result-chunk-id-btn"
                                      title="Full text and metadata"
                                      onClick={(e) => openListChunkPopover(runId, result.id, e)}
                                    >
                                      {result.id}
                                    </button>
                                  </span>
                                  <span className="result-score">
                                    {result.relevance_score.toFixed(2)}
                                  </span>
                                  <span className="result-title">{result.document_name}</span>
                                </div>
                                <div className="result-snippet">
                                  {result.snippet}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <ChunkDetailPopover
        popover={
          listChunkPopover
            ? {
                type: 'chunk',
                chunkId: listChunkPopover.chunkId,
                clientX: listChunkPopover.clientX,
                clientY: listChunkPopover.clientY,
              }
            : null
        }
        onClose={closeListChunkPopover}
        chunkDetail={listChunkDetail}
        detailLoading={listDetailLoading}
        detailError={listDetailError}
      />

      {/* Error Modal */}
      {error && (
        <div className="error-modal-overlay">
          <div className="error-modal">
            <div className="error-modal-header">
              <div className="error-modal-icon">❌</div>
              <h3>Error</h3>
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