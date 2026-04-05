import React, { useState, useEffect } from 'react';
import './ChunkBrowser.css'; // Reuse existing styles
import { fetchWithAuth } from './store';
import {
  openLoadingChunksWindow,
  openChunksWindow,
  buildChunksVisualizationDocumentHtml,
} from './chunksVisualizationWindow';
const ChunkRunHistoryPanel = ({ fileId, fileName, onClose, mainViewApi = null }) => {
  const [chunkRuns, setChunkRuns] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selectedChunkRuns, setSelectedChunkRuns] = useState(new Set());
  // Parsed Text option is always considered selected and can't be unselected
  const hasParsedTextSelected = true;
  // State for parsed text metadata
  const [parsedTextMetadata, setParsedTextMetadata] = useState({
    parser: '',
    time: '',
    parse_run_id: '',
    time_usage: null,
    parameters: {}
  });

  const formatTimeUsage = (seconds) => {
    if (seconds === null || seconds === undefined || Number.isNaN(Number(seconds))) return '';
    return `${Number(seconds).toFixed(3)}s`;
  };

  const handleChunkRunSelect = (runId) => {
    const newSelected = new Set(selectedChunkRuns);
    if (newSelected.has(runId)) {
      newSelected.delete(runId);
    } else {
      newSelected.add(runId);
    }
    setSelectedChunkRuns(newSelected);
  };

  const handleSelectAll = () => {
    if (selectedChunkRuns.size === chunkRuns.length) {
      setSelectedChunkRuns(new Set());
    } else {
      setSelectedChunkRuns(new Set(chunkRuns.map(run => run.id)));
    }
  };

  const handleOpenChunks = async () => {
    const runLoad = async () => {
      const fileResponse = await fetchWithAuth(`/api/files/${fileId}`);
      if (!fileResponse.ok) {
        throw new Error('Failed to fetch file content');
      }
      const fileData = await fileResponse.json();

      const parsedText = fileData.success ? fileData.file.parsed_text : '';
      const parsedTextParser = fileData.success ? fileData.file.parser : '';
      const parsedTextTime = fileData.success ? fileData.file.time : '';
      const parsedTextRunId = fileData.success ? fileData.file.parse_run_id : '';
      const parsedTextTimeUsage = fileData.success ? fileData.file.time_usage : null;
      const parsedTextParameters = fileData.success ? fileData.file.parameters : {};

      setParsedTextMetadata({
        parser: parsedTextParser,
        time: parsedTextTime,
        parse_run_id: parsedTextRunId,
        time_usage: parsedTextTimeUsage,
        parameters: parsedTextParameters,
      });

      let chunks = [];
      if (selectedChunkRuns.size > 0) {
        const chunkRunIds = Array.from(selectedChunkRuns).join(',');
        const chunksResponse = await fetchWithAuth(
          `/api/chunks?file_id=${fileId}&chunk_run_ids=${encodeURIComponent(chunkRunIds)}`
        );
        if (!chunksResponse.ok) {
          throw new Error('Failed to fetch chunks');
        }
        const chunksData = await chunksResponse.json();
        chunks = chunksData.success ? chunksData.chunks : [];
      }

      const meta = {
        parser: parsedTextParser,
        time: parsedTextTime,
        parse_run_id: fileData.success ? fileData.file.parse_run_id : '',
        time_usage: fileData.success ? fileData.file.time_usage : null,
        parameters: fileData.success ? fileData.file.parameters : {},
      };

      return { parsedText, chunks, meta };
    };

    if (mainViewApi) {
      mainViewApi.beginChunksMainView(fileName);
      setIsLoading(true);
      try {
        const { parsedText, chunks, meta } = await runLoad();
        const html = buildChunksVisualizationDocumentHtml(parsedText, chunks, fileName, chunkRuns, meta, {
          controlsInParent: true,
        });
        mainViewApi.setMainViewReady(html, fileName, 'chunks', {
          showChunkOnlyToggle: selectedChunkRuns.size > 0,
        });
      } catch (err) {
        console.error('Error opening chunks:', err);
        mainViewApi.setMainViewError(fileName, String(err?.message ?? err));
      } finally {
        setIsLoading(false);
      }
      return;
    }

    const visualizationWindow = openLoadingChunksWindow(fileName);
    if (!visualizationWindow) return;

    try {
      setIsLoading(true);
      const { parsedText, chunks, meta } = await runLoad();
      setIsLoading(false);
      openChunksWindow(parsedText, chunks, fileName, chunkRuns, visualizationWindow, meta);
    } catch (err) {
      console.error('Error opening chunks:', err);
      alert(`Failed to open chunks: ${err.message}`);
      setIsLoading(false);
      try {
        visualizationWindow.document.title = `Failed: Chunk Visualization: ${fileName}`;
        visualizationWindow.document.body.innerHTML = `
          <div style="font-family: Arial, sans-serif; padding: 24px;">
            <h2 style="margin-bottom: 12px;">Failed to load chunk visualization</h2>
            <div style="color:#b00020; white-space: pre-wrap;">${String(err?.message ?? err)}</div>
          </div>
        `;
      } catch (e) {
        // ignore
      }
    }
  };

  // Fetch chunk runs and parsed text metadata when fileId changes
  useEffect(() => {
    if (fileId) {
      fetchChunkRuns(fileId);
      fetchParsedTextMetadata(fileId);
    }
  }, [fileId]);

  const fetchChunkRuns = async (id) => {
    try {
      setIsLoading(true);
      setError(null);
      const response = await fetchWithAuth(`/api/chunk-runs/by-file/${id}`);
      const data = await response.json();
      if (data.success) {
        setChunkRuns(data.chunk_runs);
        // Select all chunk runs by default
        setSelectedChunkRuns(new Set(data.chunk_runs.map(run => run.id)));
      }
    } catch (err) {
      console.error('Error fetching chunk runs:', err);
      setError('Failed to fetch chunk run history');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchParsedTextMetadata = async (id) => {
    try {
      const response = await fetchWithAuth(`/api/files/${id}`);
      if (response.ok) {
        const data = await response.json();
        console.log('File data response:', data); // Debug log
        if (data.success) {
          setParsedTextMetadata({
            parser: data.file.parser || '',
            time: data.file.time || '',
            parse_run_id: data.file.parse_run_id || '',
            time_usage: data.file.time_usage ?? null,
            parameters: data.file.parameters || {}
          });
        }
      }
    } catch (err) {
      console.error('Error fetching parsed text metadata:', err);
    }
  };

  const formatDateTime = (dateTimeStr) => {
    if (!dateTimeStr) return '';
    try {
      // Always format as ISO with Z to ensure UTC parsing
      // This ensures consistent behavior regardless of browser timezone settings
      const isoDateTimeStr = dateTimeStr
        .replace(/\s+/, 'T') // Replace space with T to make ISO format
        .replace(/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.\d+)?(?!Z$)/, '$1Z'); // Add Z if missing, indicating UTC
      
      const date = new Date(isoDateTimeStr);
      if (!isNaN(date.getTime())) {
        // Convert UTC date to local time string
        return date.toLocaleString();
      }
      
      return dateTimeStr; // Fallback to original string if parsing fails
    } catch (e) {
      console.error('Error formatting date:', e);
      return dateTimeStr; // Fallback to original string
    }
  };

  const formatParameters = (params) => {
    try {
      const parsedParams = typeof params === 'string' ? JSON.parse(params) : params;
      return JSON.stringify(parsedParams, null, 2);
    } catch (err) {
      return String(params);
    }
  };

  const formatParamsForDisplay = (params) => {
    if (!params || Object.keys(params).length === 0) return '';
    
    const paramStrings = [];
    Object.entries(params).forEach(([key, value]) => {
      // Format key to be more readable
      const displayKey = key
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

      paramStrings.push(`${displayKey}: ${displayValue}`);
    });

    return paramStrings.join(', ');
  };

  return (
    <div className="chunk-run-history-panel">
      <div className="chunk-run-history-panel-header">
        <h3>Chunk Run History: {fileName}</h3>
        <div className="chunk-run-history-panel-actions">
          <button 
            className="chunk-run-history-panel-close-btn"
            onClick={onClose}
            title="Close panel"
          >
            ×
          </button>
        </div>
      </div>
      <div className="chunk-run-history-panel-content">
        {isLoading ? (
          <div className="loading">Loading chunk runs...</div>
        ) : error ? (
          <div className="error-message">{error}</div>
        ) : (
          <>
            <div className="chunk-run-select-all">
              <label>
                <input
                  type="checkbox"
                  checked={true}
                  disabled={true}
                  title="Parsed Text is always included and cannot be unselected"
                />
                Parsed Text 
                {((parsedTextMetadata.parser !== undefined && parsedTextMetadata.parser !== '') || 
                  parsedTextMetadata.parse_run_id !== undefined || 
                  (parsedTextMetadata.time !== undefined && parsedTextMetadata.time !== '') ||
                  parsedTextMetadata.time_usage !== null ||
                  (parsedTextMetadata.parameters && Object.keys(parsedTextMetadata.parameters).length > 0)) && (
                  <span className="parsed-text-metadata">
                    {parsedTextMetadata.parse_run_id !== undefined && (
                      <span className="run-id-info">Run ID: {parsedTextMetadata.parse_run_id} | </span>
                    )}
                    {parsedTextMetadata.parser && (
                      <span className="parser-info">Parser: {parsedTextMetadata.parser}</span>
                    )}
                    {parsedTextMetadata.parameters && Object.keys(parsedTextMetadata.parameters).length > 0 && (
                      <span className="params-info"> | Parameters: {formatParamsForDisplay(parsedTextMetadata.parameters)}</span>
                    )}
                    {parsedTextMetadata.time_usage !== null && (
                      <span className="time-usage-info"> | Time Usage: {formatTimeUsage(parsedTextMetadata.time_usage)}</span>
                    )}
                    {parsedTextMetadata.time && (
                      <span className="time-info"> | Time: {formatDateTime(parsedTextMetadata.time)}</span>
                    )}
                  </span>
                )}
              </label>
            </div>
            {chunkRuns.length > 0 && (
              <div className="chunk-run-select-all">
                <label>
                  <input
                    type="checkbox"
                    checked={selectedChunkRuns.size === chunkRuns.length && chunkRuns.length > 0}
                    onChange={handleSelectAll}
                    disabled={isLoading}
                  />
                  Select All Chunk Runs
                </label>
              </div>
            )}
            {chunkRuns.length > 0 ? (
              <div className="chunk-run-list">
                {chunkRuns.map(run => (
                  <div key={run.id} className={`chunk-run-item ${run.is_active ? 'active' : ''}`}>
                    <div className="chunk-run-header">
                      <div className="chunk-run-header-left">
                        <input
                          type="checkbox"
                          className="chunk-run-checkbox"
                          checked={selectedChunkRuns.has(run.id)}
                          onChange={() => handleChunkRunSelect(run.id)}
                          disabled={isLoading}
                          title="Select this chunk run"
                        />
                        <span className="chunk-run-framework">{run.framework}</span>
                        <span className="chunk-run-time">{formatDateTime(run.run_time)}</span>
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
              <div className="no-runs">No chunk runs yet for this file.</div>
            )}
          </>
        )}
      </div>
      <div className="chunk-run-history-panel-footer">
        <button 
          className="chunk-run-history-panel-open-btn"
          onClick={handleOpenChunks}
          disabled={isLoading}
          title="Open parsed text and selected chunk runs"
        >
          Open
        </button>
      </div>
    </div>
  );
};

export default ChunkRunHistoryPanel;