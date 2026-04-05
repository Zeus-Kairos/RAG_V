import React, { useState, useEffect } from 'react';
import useKnowledgebaseStore from './store';
import { buildChunkingFormData, getSplitterFrameworks } from './splitterUtils';
import './ChunkBrowser.css';

const ChunkBrowser = () => {
  const { knowledgebases, splitterSettings, refreshFileBrowser, activeFramework, setActiveFramework } = useKnowledgebaseStore();
  const [chunkRuns, setChunkRuns] = useState([]);
  const [isRunning, setIsRunning] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  // Chunking modal state
  const [showChunkingModal, setShowChunkingModal] = useState(false);
  const [chunkingResults, setChunkingResults] = useState([]);
  // Ref for auto-scrolling results
  const chunkingResultsListRef = React.useRef(null);
  
  // Get active knowledgebase
  const activeKnowledgebase = knowledgebases.find(kb => kb.is_active === 1) || knowledgebases[0];
  
  // Fetch chunk runs when component mounts or active knowledgebase changes
  useEffect(() => {
    if (activeKnowledgebase) {
      fetchChunkRuns(activeKnowledgebase.id);
    }
  }, [activeKnowledgebase]);
  
  const fetchChunkRuns = async (kbId) => {
    try {
      const response = await fetch(`http://localhost:8000/api/chunk-runs/${kbId}`);
      const data = await response.json();
      if (data.success) {
        setChunkRuns(data.chunk_runs);
      }
    } catch (err) {
      console.error('Error fetching chunk runs:', err);
      setError('Failed to fetch chunk run history');
    }
  };
  
  // Auto-scroll to bottom when chunking results change
  useEffect(() => {
    if (chunkingResultsListRef.current) {
      chunkingResultsListRef.current.scrollTop = chunkingResultsListRef.current.scrollHeight;
    }
  }, [chunkingResults]);

  const handleRunChunking = async () => {
    if (!activeKnowledgebase) {
      setError('No active knowledgebase found');
      return;
    }
    
    try {
      setIsRunning(true);
      setError(null);
      setShowChunkingModal(true);
      setChunkingResults([]);
      
      const formData = buildChunkingFormData(activeFramework, splitterSettings);
      
      // Send request to chunk-files endpoint
      const response = await fetch(`http://localhost:8000/api/chunk-files/${activeKnowledgebase.id}`, {
        method: 'POST',
        body: formData
      });
      
      // Read streaming response
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        const chunk = decoder.decode(value);
        const lines = chunk.split('\n').filter(line => line.trim() !== '');
        
        for (const line of lines) {
          try {
            const result = JSON.parse(line);
            console.log('Chunking result:', result);
            // Update results state for modal display
            setChunkingResults(prev => [...prev, result]);
          } catch (parseError) {
            console.error('Error parsing chunking result:', parseError);
          }
        }
      }
      
      // Refresh chunk runs after completion
      fetchChunkRuns(activeKnowledgebase.id);
      // Refresh file browser to show updated chunks
      refreshFileBrowser();
    } catch (err) {
      console.error('Error running chunking:', err);
      setError('Failed to run chunking process');
    } finally {
      setIsRunning(false);
    }
  };
  
  const formatDateTime = (dateTimeString) => {
    // Convert database UTC timestamp (YYYY-MM-DD HH:MM:SS) to ISO format with Z (UTC indicator)
    const utcIsoString = dateTimeString.replace(' ', 'T') + 'Z';
    const date = new Date(utcIsoString);
    // Convert to local time string with full date and time
    return date.toLocaleString();
  };
  
  const formatParameters = (params) => {
    try {
      const parsedParams = typeof params === 'string' ? JSON.parse(params) : params;
      return JSON.stringify(parsedParams, null, 2);
    } catch (err) {
      return String(params);
    }
  };
  
  // Delete a chunk run
  const deleteChunkRun = async (runId) => {
    try {
      setIsLoading(true);
      setError(null);
      
      const response = await fetch(`http://localhost:8000/api/chunk-runs/${runId}`, {
        method: 'DELETE'
      });
      
      if (response.ok) {
        // Refresh chunk runs after deletion
        fetchChunkRuns(activeKnowledgebase.id);
      } else {
        const data = await response.json();
        throw new Error(data.detail || 'Failed to delete chunk run');
      }
    } catch (err) {
      console.error('Error deleting chunk run:', err);
      setError('Failed to delete chunk run');
    } finally {
      setIsLoading(false);
    }
  };

  // Set active chunk run
  const handleSetActiveChunkRun = async (runId) => {
    try {
      if (!activeKnowledgebase) return;
      
      setIsLoading(true);
      setError(null);
      
      const response = await fetch(`http://localhost:8000/api/chunk-runs/${runId}/active`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ knowledgebase_id: activeKnowledgebase.id })
      });
      
      if (response.ok) {
        // Refresh chunk runs to show updated active status
        fetchChunkRuns(activeKnowledgebase.id);
      } else {
        const data = await response.json();
        throw new Error(data.detail || 'Failed to set active chunk run');
      }
    } catch (err) {
      console.error('Error setting active chunk run:', err);
      setError('Failed to set active chunk run');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="chunk-browser">
      <div className="chunk-browser-header">
        <div className="chunk-browser-controls">
          <div className="chunk-browser-actions">
            <button 
              className="chunk-browser-btn chunk-browser-btn-primary"
              onClick={handleRunChunking}
              disabled={isRunning || (!activeKnowledgebase || activeKnowledgebase.parsed_file_count === 0)}
            >
              {isRunning ? 'Running...' : 'Run Chunking'}
            </button>
          </div>
          <div className="framework-selection">
            <label htmlFor="framework-select">Framework:</label>
            <select
              id="framework-select"
              className="framework-select"
              value={activeFramework}
              onChange={(e) => setActiveFramework(e.target.value)}
              disabled={isRunning}
            >
              {getSplitterFrameworks().map(({ id, label }) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>
        {error && <div className="error-message">{error}</div>}
      </div>
      
      <div className="chunk-browser-content">
        {/* Active Knowledge Info */}
        {activeKnowledgebase && (
          <div className="active-knowledge-info">
            <h4>Active Knowledgebase</h4>
            <div className="knowledge-header">
              <span className="knowledge-name">{activeKnowledgebase.name}</span>
              <span className="knowledge-description">{activeKnowledgebase.description || 'No description available'}</span>
            </div>
            <div className="knowledge-meta">
              <div className="knowledge-meta-item">
                <span className="meta-label">Parsed Files:</span>
                <span className="meta-value">{activeKnowledgebase.parsed_file_count || 0}</span>
              </div>
              <div className="knowledge-meta-item">
                <span className="meta-label">Created:</span>
                <span className="meta-value">{formatDateTime(activeKnowledgebase.created_at)}</span>
              </div>
            </div>
          </div>
        )}
        
        {/* Chunk Run History */}
        <div className="chunk-run-history">
          <h4>Chunk Run History</h4>
          {isLoading ? (
            <div className="loading">Loading chunk runs...</div>
          ) : chunkRuns.length > 0 ? (
            <div className="chunk-run-list">
              {chunkRuns.map(run => (
                <div key={run.id} className={`chunk-run-item ${run.is_active ? 'active' : ''}`}>
                  <div className="chunk-run-header">
                    <div className="chunk-run-header-left">
                      <span className="chunk-run-framework">{run.framework}</span>
                      <span className="chunk-run-time">
                        {formatDateTime(run.run_time)}
                        {!run.in_sync && <span className="chunk-run-out-of-sync" title="out of sync - text to chunk has been changed">⛓️</span>}
                      </span>
                    </div>
                    <div className="chunk-run-header-actions">
                      <button 
                        className={`chunk-run-set-active-btn ${run.is_active ? 'active' : ''}`}
                        onClick={() => handleSetActiveChunkRun(run.id)}
                        disabled={isLoading}
                        title="Set as active chunk run"
                      >
                        {run.is_active ? '✓ Active' : 'Set Active'}
                      </button>
                      <button 
                        className="chunk-run-delete-btn"
                        onClick={() => deleteChunkRun(run.id)}
                        disabled={isLoading}
                        title="Delete chunk run"
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                  <div className="chunk-run-params">
                    {/* Special handling for frameworks with chunkers */}
                    {run.framework && run.parameters.chunkers && (
                      <>
                        {/* Display each chunker with its parameters */}
                        {run.parameters.chunkers.map((chunker, index) => (
                          <React.Fragment key={`${run.framework}-chunker-${index}`}>
                            {/* Chunker type with enabled styling */}
                            <span className="param-label">
                              {chunker.chunker.charAt(0).toUpperCase() + chunker.chunker.slice(1)}: Enabled
                            </span>
                            
                            {/* Display all parameters for this chunker based on type */}
                            {Object.entries(chunker.params).map(([paramName, paramValue]) => {
                              // Format parameter name to be more readable
                              const displayName = paramName
                                .replace(/_/g, ' ')    
                                .replace(/\b\w/g, l => l.toUpperCase());
                              
                              // Format value based on type
                              let displayValue;
                              if (typeof paramValue === 'boolean') {
                                displayValue = paramValue ? 'Enabled' : 'Disabled';
                              } else if (typeof paramValue === 'object' && paramValue !== null) {
                                displayValue = JSON.stringify(paramValue);
                              } else {
                                displayValue = paramValue;
                              }
                              
                              // Determine parameter type for styling
                              let paramClass = "param-label";
                              if (typeof paramValue === "boolean") {
                                // Boolean values get standard styling
                              } else if (typeof paramValue === "number" || (!isNaN(Number(paramValue)) && paramValue !== "")) {
                                paramClass += " param-label-digital";
                              }
                              
                              return (
                                <span key={paramName} className={paramClass}>
                                  {displayName}: {displayValue}
                                </span>
                              );
                            })}
                          </React.Fragment>
                        ))}
                      </>
                    )}
                    
                    {/* Display all other parameters (excluding chunkers since we're displaying it specially) */}
                    {Object.entries(run.parameters).map(([key, value]) => {
                      // Skip chunkers since we're displaying it specially above
                      if (key === 'chunkers') {
                        return null;
                      }
                      
                      // Check if this parameter is part of a disabled feature (for legacy parameters)
                      let isDisabled = false;
                      if (key === 'header_levels' || key === 'strip_headers') {
                        isDisabled = run.parameters.markdown_header_splitting === false;
                      } else if (key === 'chunk_size' || key === 'chunk_overlap') {
                        isDisabled = run.parameters.recursive_splitting === false;
                      }
                      
                      // Format parameter name to be more readable
                      const displayName = key
                        .replace(/_/g, ' ')    
                        .replace(/\b\w/g, l => l.toUpperCase());
                      
                      // Format value based on type
                      let displayValue;
                      if (typeof value === 'boolean') {
                        displayValue = value ? 'Enabled' : 'Disabled';
                      } else if (typeof value === 'object' && value !== null) {
                        displayValue = JSON.stringify(value);
                      } else {
                        displayValue = value;
                      }
                      
                      // Determine parameter type for styling
                      let paramClass = "param-label";
                      if (isDisabled) {
                        paramClass += " param-label-disabled";
                      } else if (typeof value === "boolean") {
                        // Boolean values get standard styling
                      } else if (typeof value === "number" || (!isNaN(Number(value)) && value !== "")) {
                        paramClass += " param-label-digital";
                      }
                      
                      return (
                        <span key={key} className={paramClass}>
                          {displayName}: {displayValue}
                        </span>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="no-runs">No chunk runs yet. Click "Run Chunking" to start.</div>
          )}
        </div>
      </div>
      
      {/* Chunking Progress Modal */}
      {showChunkingModal && (
        <div className="kb-dialog-overlay">
          <div className="kb-dialog">
            <div className="dialog-header">
              <h3>Chunking Progress</h3>
              <button 
                className="dialog-close"
                onClick={() => {
                  setShowChunkingModal(false);
                  setChunkingResults([]);
                }}
                disabled={isRunning}
              >
                ×
              </button>
            </div>
            <div className="dialog-body">
              {/* Real-time Chunking Results */}
              {chunkingResults.length > 0 && (
                <div className="upload-results">
                  <p>Chunking Results:</p>
                  <div className="upload-results-list" ref={chunkingResultsListRef}>
                    {chunkingResults.map((result, index) => {
                      // Get status icon and message based on result
                      let statusIcon, statusClass;
                      switch (result.status) {
                        case 'success':
                        case 'completed': // Chunking uses 'completed' instead of 'success'
                          statusIcon = '✅';
                          statusClass = 'upload-success';
                          break;
                        case 'failed':
                          statusIcon = '❌';
                          statusClass = 'upload-failed';
                          break;
                        default:
                          statusIcon = '⏳';
                          statusClass = 'upload-processing';
                      }
                      
                      return (
                        <div key={index} className={`upload-result-item ${statusClass}`}>
                          <div className="upload-result-header">
                            <span className="upload-result-icon">{statusIcon}</span>
                            <span className="upload-result-filename">{result.filename || 'Processing...'}</span>
                            <span className="upload-result-status">
                              {result.status === 'completed' ? 'Completed' : 
                               result.status ? result.status.charAt(0).toUpperCase() + result.status.slice(1) : 'Processing'}
                            </span>
                          </div>
                          {(result.status === 'success' || result.status === 'completed') && result.chunks_count && (
                            <div className="upload-result-details">
                              <span>Chunks: {result.chunks_count}</span>
                            </div>
                          )}
                          {result.warning && (
                            <div className="upload-result-warning" role="alert">
                              {result.warning}
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
              
              {isRunning && (
                <div className="uploading-indicator">
                  <div className="loading-spinner"></div>
                  <span>
                    Chunking files... ({chunkingResults.filter(r => r.status).length} files processed)
                  </span>
                </div>
              )}
            </div>
            <div className="dialog-footer">
              <button 
                onClick={() => {
                  setShowChunkingModal(false);
                  setChunkingResults([]);
                }}
                disabled={isRunning}
              >
                {isRunning ? 'Processing...' : 'Close'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ChunkBrowser;
