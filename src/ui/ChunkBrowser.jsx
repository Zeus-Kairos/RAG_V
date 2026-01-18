import React, { useState, useEffect } from 'react';
import useKnowledgebaseStore from './store';
import './ChunkBrowser.css';

const ChunkBrowser = () => {
  const { knowledgebases, isLoading, splitterSettings, refreshFileBrowser } = useKnowledgebaseStore();
  const [chunkRuns, setChunkRuns] = useState([]);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState(null);
  
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
  
  const handleRunChunking = async () => {
    if (!activeKnowledgebase) {
      setError('No active knowledgebase found');
      return;
    }
    
    try {
      setIsRunning(true);
      setError(null);
      
      // Prepare form data with splitter settings
      const formData = new FormData();
      formData.append('framework', 'langchain');
      formData.append('markdown_header_splitting', splitterSettings.isMarkdownEnabled ? 'true' : 'false');
      formData.append('recursive_splitting', splitterSettings.isRecursiveEnabled ? 'true' : 'false');
      
      // Add markdown settings
      formData.append('header_levels', splitterSettings.markdownSettings.headerLevels);
      formData.append('strip_headers', splitterSettings.markdownSettings.stripHeaders ? 'true' : 'false');
      
      // Add recursive settings
      formData.append('chunk_size', splitterSettings.recursiveSettings.chunkSize);
      formData.append('chunk_overlap', splitterSettings.recursiveSettings.chunkOverlap);
      
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
    const date = new Date(dateTimeString);
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
  
  return (
    <div className="chunk-browser">
      <div className="chunk-browser-header">
        <div className="chunk-browser-actions">
          <button 
            className="chunk-browser-btn chunk-browser-btn-primary"
            onClick={handleRunChunking}
            disabled={isRunning || (!activeKnowledgebase || activeKnowledgebase.file_count === 0)}
          >
            {isRunning ? 'Running...' : 'Run Chunking'}
          </button>
        </div>
        {error && <div className="error-message">{error}</div>}
      </div>
      
      <div className="chunk-browser-content">
        {/* Active Knowledge Info */}
        {activeKnowledgebase && (
          <div className="active-knowledge-info">
            <h4>Active Knowledgebase</h4>
            <p className="knowledge-name">{activeKnowledgebase.name}</p>
            <p className="knowledge-description">{activeKnowledgebase.description || 'No description available'}</p>
            <div className="knowledge-meta">
              <div className="knowledge-meta-item">
                <span className="meta-label">Files:</span>
                <span className="meta-value">{activeKnowledgebase.file_count || 0}</span>
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
                <div key={run.id} className="chunk-run-item">
                  <div className="chunk-run-header">
                    <span className="chunk-run-time">{formatDateTime(run.run_time)}</span>
                    <span className="chunk-run-framework">{run.framework}</span>
                  </div>
                  <div className="chunk-run-params">
                    <strong>Parameters:</strong>
                    <pre>{formatParameters(run.parameters)}</pre>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="no-runs">No chunk runs yet. Click "Run Chunking" to start.</div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ChunkBrowser;
