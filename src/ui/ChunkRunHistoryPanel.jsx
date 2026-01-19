import React, { useState, useEffect } from 'react';
import './ChunkBrowser.css'; // Reuse existing styles

const ChunkRunHistoryPanel = ({ fileId, fileName, onClose }) => {
  const [chunkRuns, setChunkRuns] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selectedChunkRuns, setSelectedChunkRuns] = useState(new Set());

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
    if (selectedChunkRuns.size === 0) {
      alert('Please select at least one chunk run to open.');
      return;
    }

    try {
      setIsLoading(true);
      // Step 1: Get file parsed_text
      const fileResponse = await fetch(`http://localhost:8000/api/files/${fileId}`);
      if (!fileResponse.ok) {
        throw new Error('Failed to fetch file content');
      }
      const fileData = await fileResponse.json();
      const parsedText = fileData.success ? fileData.file.parsed_text : '';

      // Step 2: Get chunks for selected runs
      const selectedRunIds = Array.from(selectedChunkRuns);
      const chunkRunIds = selectedRunIds.join(',');
      
      const chunksResponse = await fetch(`http://localhost:8000/api/chunks?file_id=${fileId}&chunk_run_ids=${chunkRunIds}`);
      if (!chunksResponse.ok) {
        throw new Error('Failed to fetch chunks');
      }
      const chunksData = await chunksResponse.json();
      const chunks = chunksData.success ? chunksData.chunks : [];

      // Step 3: Set loading to false BEFORE opening window (window.open can be slow)
      setIsLoading(false);
      
      // Step 4: Open new window with parsed_text, chunk boundaries, and run parameters
      openChunksWindow(parsedText, chunks, fileName, chunkRuns);
    } catch (err) {
      console.error('Error opening chunks:', err);
      alert(`Failed to open chunks: ${err.message}`);
      setIsLoading(false);
    }
  };

  const openChunksWindow = (parsedText, chunks, fileName, chunkRuns) => {
    // Group chunks by chunk_run_id
    const chunksByRunId = chunks.reduce((acc, chunk) => {
      const runId = chunk.chunk_run_id;
      if (!acc[runId]) {
        acc[runId] = [];
      }
      acc[runId].push(chunk);
      return acc;
    }, {});

    const runIds = Object.keys(chunksByRunId);
    const isSingleRun = runIds.length === 1;

    // Helper function to find chunk positions in the text (optimized version)
    const findChunkPositions = (chunkContent, fileText, minStart = 0) => {
      // Simple and fast exact match search
      const startIdx = fileText.indexOf(chunkContent, minStart);
      
      if (startIdx === -1 || startIdx < minStart) {
        return null; // No match found (removed expensive similarity check)
      }
      
      return {
        start_idx: startIdx,
        end_idx: startIdx + chunkContent.length
      };
    };

    // Escape raw text before injecting into HTML
    const escapeHtml = (text) =>
      text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    // Apply alpha to a hex color (expects #RRGGBB)
    const applyAlpha = (hex, alpha = 0.25) => {
      const safeHex = hex.replace('#', '');
      const r = parseInt(safeHex.slice(0, 2), 16);
      const g = parseInt(safeHex.slice(2, 4), 16);
      const b = parseInt(safeHex.slice(4, 6), 16);
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    };

    // Build HTML that keeps the original text exactly once, inserting zero-width
    // boundary markers (so overlaps never duplicate/extend the text).
    const formatTextWithBoundaryMarkers = (
      fileText,
      chunksWithPositions,
      palette
    ) => {
      let result = '';
      let cursor = 0;

      // Keep native newlines; container uses pre-wrap to preserve layout
      const escapeAndFormat = (snippet) => escapeHtml(snippet);

      // Collect boundary points. We only insert markers; we do NOT wrap text.
      // That keeps output length identical to input and avoids overlap issues.
      const boundariesByPos = new Map();
      const addBoundary = (pos, boundary) => {
        if (!boundariesByPos.has(pos)) boundariesByPos.set(pos, []);
        boundariesByPos.get(pos).push(boundary);
      };

      chunksWithPositions.forEach((chunk, idx) => {
        addBoundary(chunk.start_idx, { kind: 'start', idx, chunkId: chunk.chunk_id });
        addBoundary(chunk.end_idx, { kind: 'end', idx, chunkId: chunk.chunk_id });
      });

      const sortedPositions = Array.from(boundariesByPos.keys()).sort((a, b) => a - b);

      sortedPositions.forEach((pos) => {
        if (pos > cursor) {
          result += escapeAndFormat(fileText.slice(cursor, pos));
        }

        const boundaries = boundariesByPos.get(pos) || [];
        // Deterministic stacking: end markers first, then start markers.
        boundaries
          .slice()
          .sort((a, b) => (a.kind === b.kind ? a.idx - b.idx : a.kind === 'end' ? -1 : 1))
          .forEach((b, stackIdx) => {
            const labelBase = (() => {
              if (typeof b.chunkId === 'string') {
                const parts = b.chunkId.split('_');
                return parts[parts.length - 1] || b.chunkId;
              }
              return b.chunkId ?? b.idx + 1;
            })();
            const label = b.kind === 'start' ? String(labelBase) : `${labelBase}e`;

            const paletteIndex = (() => {
              const n = Array.isArray(palette) && palette.length > 0 ? palette.length : 1;
              const num = parseInt(String(labelBase), 10);
              if (!Number.isNaN(num)) return ((num % n) + n) % n;
              // Fallback: simple string hash
              const s = String(b.chunkId ?? labelBase);
              let h = 0;
              for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
              return h % n;
            })();
            const boundaryColor = palette[paletteIndex] ?? '#333';

            result += `<span class="chunk-boundary" data-kind="${b.kind}" data-label="${label}" style="--boundary-color: ${boundaryColor}; --boundary-stack: ${stackIdx};"></span>`;
          });

        cursor = pos;
      });

      if (cursor < fileText.length) {
        result += escapeAndFormat(fileText.slice(cursor));
      }

      return result;
    };

    // Create new window
    const newWindow = window.open('', '_blank', 'width=1200,height=800');
    if (!newWindow) {
      alert('Could not open new window. Please check your popup blocker settings.');
      return;
    }

    // Try to maximize the new window (subject to browser constraints)
    try {
      newWindow.moveTo(0, 0);
      newWindow.resizeTo(screen.availWidth, screen.availHeight);
    } catch (e) {
      // Best-effort only; ignore if blocked
      console.warn('Unable to resize visualization window:', e);
    }

    // Generate HTML for the new window
    let html = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Chunk Visualization: ${fileName}</title>
        <style>
          * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
          }
          
          body {
            font-family: Arial, sans-serif;
            background-color: #f5f5f5;
            padding: 20px;
          }
          
          .container {
            display: flex;
            flex-direction: ${isSingleRun ? 'column' : 'row'};
            gap: 20px;
            max-width: 100%;
            height: 100%;
          }
          
          .run-column {
            flex: 1;
            background: white;
            border: 1px solid #ddd;
            border-radius: 8px;
            padding: 15px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            overflow: hidden;
            display: flex;
            flex-direction: column;
          }
          
          .run-header {
            font-size: 16px;
            font-weight: bold;
            margin-bottom: 15px;
            padding-bottom: 10px;
            border-bottom: 1px solid #eee;
            color: #333;
          }
          
          .text-container {
            --scrollbar-gutter-size: 14px; /* fallback gutter width */
            flex: 1;
            overflow-x: auto;
            overflow-y: auto; /* allow scroll only when needed */
            scrollbar-gutter: stable both-edges; /* reserve space consistently */
            font-family: 'Courier New', Courier, monospace;
            font-size: 14px;
            line-height: 1.5;
            background: #fafafa;
            border: 1px solid #eee;
            border-radius: 4px;
            padding: 10px;
            padding-right: calc(10px + var(--scrollbar-gutter-size)); /* manual gutter fallback */
            position: relative;
          }

          /* Hide scrollbars but keep scroll functionality */
          .text-container {
            scrollbar-width: none; /* Firefox */
          }

          .text-container::-webkit-scrollbar {
            width: 0;
            height: 0;
          }
          
          .chunk-text {
            white-space: pre-wrap;
            word-wrap: break-word;
          }
          
          .legend {
            margin-top: 15px;
            padding: 10px;
            background: #f9f9f9;
            border-radius: 4px;
            border: 1px solid #eee;
          }
          
          .legend-item {
            display: inline-block;
            margin-right: 15px;
            font-size: 12px;
          }
          
          .legend-color {
            display: inline-block;
            width: 12px;
            height: 12px;
            border-radius: 2px;
            margin-right: 5px;
            opacity: 0.3;
          }
          
          .chunk-boundary {
            position: relative;
            display: inline;
            width: 0;
            height: 0;
          }

          .chunk-boundary::before {
            content: attr(data-label);
            position: absolute;
            top: calc(-0.9em - (var(--boundary-stack, 0) * 1.1em));
            left: 0;
            transform: translate(-2px, -40%);
            color: #fff;
            font-size: 10px;
            font-weight: bold;
            line-height: 1;
            padding: 1px 4px;
            border-radius: 2px;
            opacity: 0.92;
            pointer-events: none;
            white-space: nowrap;
            background: var(--boundary-color, #000);
          }

          /* tiny vertical tick that doesn't affect layout */
          .chunk-boundary::after {
            content: '';
            position: absolute;
            left: 0;
            top: 0.15em;
            width: 2px;
            height: 1.1em;
            background: var(--boundary-color, #000);
            opacity: 0.35;
            pointer-events: none;
          }

          .chunk-boundary[data-kind="end"]::after {
            opacity: 0.22;
          }
        </style>
      </head>
      <body>
        <h1>Chunk Visualization: ${fileName}</h1>
        <div class="container">
    `;

    // Define colors for boundary markers (darker for readability on white)
    const colors = [
      '#B91C1C', // red-700
      '#0F766E', // teal-700
      '#1D4ED8', // blue-700
      '#166534', // green-800
      '#B45309', // amber-700
      '#6D28D9', // violet-700
      '#0E7490', // cyan-700
      '#9A3412', // orange-800
      '#BE185D', // pink-700
      '#374151'  // gray-700
    ];

    // Create a mapping from runId to run parameters
    const runParamsMap = new Map();
    chunkRuns.forEach(run => {
      runParamsMap.set(run.id, run.parameters);
    });

    // Helper function to format parameters for display
    const formatParamsForDisplay = (params) => {
      if (!params) return '';
      
      // Convert to object if it's a string
      const paramsObj = typeof params === 'string' ? JSON.parse(params) : params;
      
      // Format parameters as readable strings, excluding any nested objects
      return Object.entries(paramsObj)
        .filter(([key, value]) => typeof value !== 'object' || value === null)
        .map(([key, value]) => {
          // Format key to be more readable
          const displayKey = key
            .replace(/_/g, ' ')
            .replace(/\b\w/g, l => l.toUpperCase());
          
          // Format value based on type
          let displayValue = value;
          if (typeof value === 'boolean') {
            displayValue = value ? 'Enabled' : 'Disabled';
          }
          
          return `${displayKey}: ${displayValue}`;
        })
        .join(', ');
    };

    // Process each chunk run
    runIds.forEach((runId, runIndex) => {
      const runChunks = chunksByRunId[runId];
      const baseColor = colors[runIndex % colors.length];
      const runParams = runParamsMap.get(parseInt(runId));
      const formattedParams = formatParamsForDisplay(runParams);
      
      // Find positions for all chunks and filter out those with no match
      let lastStart = -1;
      const chunksWithPositions = runChunks
        .map(chunk => {
          const minStart = lastStart + 1; // enforce strictly after previous start
          const positions = findChunkPositions(chunk.content, parsedText, minStart);
          if (!positions) return null;
          lastStart = positions.start_idx;
          return { ...chunk, ...positions };
        })
        .filter(chunk => chunk !== null);
      const highlightedText = formatTextWithBoundaryMarkers(
        parsedText,
        chunksWithPositions,
        colors
      );
      
      // Generate HTML for this run
      html += `
        <div class="run-column">
          <div class="run-header">
            <div style="margin-bottom: 5px; font-weight: bold;">Chunk Run: ${runIndex + 1} (${chunksWithPositions.length}/${runChunks.length} chunks matched)</div>
            <div style="font-size: 12px; color: #666; white-space: pre-wrap; max-width: 100%; overflow-wrap: break-word;">${formattedParams || 'No parameters available'}</div>
          </div>
          <div class="text-container" style="position: relative;">
            <div class="chunk-text">${highlightedText}</div>
      `;
      
      html += `
          </div>
          <div class="legend">
            <div class="legend-item">
              <span class="legend-color" style="background-color: ${baseColor};"></span>
              <span>Run Parameters: ${formattedParams}</span>
            </div>
          </div>
        </div>
      `;
    });
    
    html += `
        </div>
      </body>
      </html>
    `;
    
    // Write HTML to the new window
    newWindow.document.open();
    newWindow.document.write(html);
    newWindow.document.close();
  };

  // Fetch chunk runs when fileId changes
  useEffect(() => {
    if (fileId) {
      fetchChunkRuns(fileId);
    }
  }, [fileId]);

  const fetchChunkRuns = async (id) => {
    try {
      setIsLoading(true);
      setError(null);
      const response = await fetch(`http://localhost:8000/api/chunk-runs/by-file/${id}`);
      const data = await response.json();
      if (data.success) {
        setChunkRuns(data.chunk_runs);
      }
    } catch (err) {
      console.error('Error fetching chunk runs:', err);
      setError('Failed to fetch chunk run history');
    } finally {
      setIsLoading(false);
    }
  };

  const formatDateTime = (dateTimeStr) => {
    if (!dateTimeStr) return '';
    // Ensure datetime string is in ISO format with UTC timezone for correct parsing
    const isoDateTimeStr = dateTimeStr
      .replace(/\s+/, 'T') // Replace space with T to make ISO format
      .replace(/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.\d+)?(?!Z$)/, '$1Z'); // Add Z if missing, indicating UTC
    const date = new Date(isoDateTimeStr);
    // Convert to local time and display in a readable format
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
        ) : chunkRuns.length > 0 ? (
          <>
            <div className="chunk-run-select-all">
              <label>
                <input
                  type="checkbox"
                  checked={selectedChunkRuns.size === chunkRuns.length && chunkRuns.length > 0}
                  onChange={handleSelectAll}
                  disabled={isLoading}
                />
                Select All
              </label>
            </div>
            <div className="chunk-run-list">
              {chunkRuns.map(run => (
                <div key={run.id} className="chunk-run-item">
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
                    {Object.entries(run.parameters).map(([key, value]) => {
                      // Format parameter name to be more readable
                      const displayName = key
                        .replace(/_/g, ' ')    
                        .replace(/\b\w/g, l => l.toUpperCase());
                      
                      // Format value based on type
                      let displayValue = value;
                      if (typeof value === 'boolean') {
                        displayValue = value ? 'Enabled' : 'Disabled';
                      }
                      
                      // Check if this parameter is part of a disabled feature
                      const isDisabled = (() => {
                        // Check parent feature flags
                        if (key === 'header_levels' || key === 'strip_headers') {
                          return run.parameters.markdown_header_splitting === false;
                        }
                        if (key === 'chunk_size' || key === 'chunk_overlap') {
                          return run.parameters.recursive_splitting === false;
                        }
                        // Check if the parameter itself is disabled (boolean false)
                        return displayValue === "Disabled";
                      })();
                      
                      // Determine parameter type for styling
                      let paramClass = "param-label";
                      if (isDisabled) {
                        paramClass += " param-label-disabled";
                      } else if (typeof value === "boolean") {
                        // Keep boolean values as original styling
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
          </>
        ) : (
          <div className="no-runs">No chunk runs yet for this file.</div>
        )}
      </div>
      {chunkRuns.length > 0 && (
        <div className="chunk-run-history-panel-footer">
          <button 
            className="chunk-run-history-panel-open-btn"
            onClick={handleOpenChunks}
            disabled={isLoading || selectedChunkRuns.size === 0}
            title="Open selected chunk runs"
          >
            Open
          </button>
        </div>
      )}
    </div>
  );
};

export default ChunkRunHistoryPanel;