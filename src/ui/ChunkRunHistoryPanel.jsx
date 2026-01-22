import React, { useState, useEffect } from 'react';
import './ChunkBrowser.css'; // Reuse existing styles

const ChunkRunHistoryPanel = ({ fileId, fileName, onClose }) => {
  const [chunkRuns, setChunkRuns] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selectedChunkRuns, setSelectedChunkRuns] = useState(new Set());
  // Parsed Text option is always considered selected and can't be unselected
  const hasParsedTextSelected = true;

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
    // Open the visualization window immediately (better UX + avoids popup blockers),
    // render a loading skeleton, then populate it once the data is ready.
    const visualizationWindow = openLoadingChunksWindow(fileName);
    if (!visualizationWindow) return;

    try {
      setIsLoading(true);
      // Step 1: Get file parsed_text
      const fileResponse = await fetch(`http://localhost:8000/api/files/${fileId}`);
      if (!fileResponse.ok) {
        throw new Error('Failed to fetch file content');
      }
      const fileData = await fileResponse.json();
      const parsedText = fileData.success ? fileData.file.parsed_text : '';

      let chunks = [];
      // Step 2: Get chunks for selected runs if any are selected
      if (selectedChunkRuns.size > 0) {
        const selectedRunIds = Array.from(selectedChunkRuns);
        const chunkRunIds = selectedRunIds.join(',');
        
        const chunksResponse = await fetch(`http://localhost:8000/api/chunks?file_id=${fileId}&chunk_run_ids=${chunkRunIds}`);
        if (!chunksResponse.ok) {
          throw new Error('Failed to fetch chunks');
        }
        const chunksData = await chunksResponse.json();
        chunks = chunksData.success ? chunksData.chunks : [];
      }

      // Step 3: Populate the already-open window
      setIsLoading(false);
      
      // Step 4: Open new window with parsed_text, chunk boundaries, and run parameters
      openChunksWindow(parsedText, chunks, fileName, chunkRuns, visualizationWindow);
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

  const openLoadingChunksWindow = (fileName) => {
    const newWindow = window.open('', '_blank', 'width=1200,height=800');
    if (!newWindow) {
      alert('Could not open new window. Please check your popup blocker settings.');
      return null;
    }

    // Try to maximize the new window (subject to browser constraints)
    try {
      newWindow.moveTo(0, 0);
      newWindow.resizeTo(screen.availWidth, screen.availHeight);
    } catch (e) {
      // Best-effort only; ignore if blocked
      console.warn('Unable to resize visualization window:', e);
    }

    newWindow.document.open();
    newWindow.document.write(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Loading… Chunk Visualization: ${fileName}</title>
        <style>
          * { box-sizing: border-box; }
          body { font-family: Arial, sans-serif; background:#f5f5f5; margin:0; padding:24px; }
          .card { background:#fff; border:1px solid #ddd; border-radius:10px; padding:18px; box-shadow:0 2px 4px rgba(0,0,0,0.08); max-width: 860px; }
          .row { display:flex; align-items:center; gap:12px; }
          .spinner {
            width:16px; height:16px; border-radius:50%;
            border:2px solid #ddd; border-top-color:#333;
            animation: spin 0.9s linear infinite;
          }
          @keyframes spin { to { transform: rotate(360deg); } }
          .sub { color:#666; font-size: 13px; margin-top: 8px; }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="row">
            <div class="spinner"></div>
            <div><strong>Loading chunk visualization…</strong></div>
          </div>
          <div class="sub">Fetching file text and selected chunk runs. This window will update automatically.</div>
        </div>
      </body>
      </html>
    `);
    newWindow.document.close();
    return newWindow;
  };

  const openChunksWindow = (parsedText, chunks, fileName, chunkRuns, existingWindow = null) => {
    // Group chunks by chunk_run_id if any chunks exist
    const chunksByRunId = chunks.length > 0 ? chunks.reduce((acc, chunk) => {
      const runId = chunk.chunk_run_id;
      if (!acc[runId]) {
        acc[runId] = [];
      }
      acc[runId].push(chunk);
      return acc;
    }, {}) : {};

    const runIds = Object.keys(chunksByRunId);
    const hasChunkRuns = runIds.length > 0;
    const isSingleRun = runIds.length === 1;

    // Helper function to find chunk positions in the text
    const findChunkPositions = (chunkContent, fileText, minStart = 0, useExactMatch = false) => {
      
      // Handle empty/whitespace-only chunks separately to avoid failing tokenization
      if (!chunkContent || !chunkContent.trim()) {
        const startIdx = fileText.indexOf(chunkContent, minStart);
        if (startIdx !== -1 && startIdx >= minStart) {
          return { start_idx: startIdx, end_idx: startIdx + chunkContent.length };
        }
        // Fallback: treat as zero-length match at minStart to keep progression
        return { start_idx: minStart, end_idx: minStart };
      }

      // Use exact match when markdown header splitting is disabled
      if (useExactMatch) {
        // Simple and fast exact match search (original implementation)
        const startIdx = fileText.indexOf(chunkContent, minStart);
        
        if (startIdx === -1 || startIdx < minStart) {
          return null; // No match found
        }
        
        return {
          start_idx: startIdx,
          end_idx: startIdx + chunkContent.length
        };
      }
      
      // Use regex match when markdown header splitting is enabled (handles whitespace differences)
      try {
        // Token-based regex: match the same non-whitespace tokens in order, allowing
        // any amount of whitespace between them. This is robust to blank-line removal.
        const tokens = chunkContent.trim().split(/\s+/).filter(Boolean);
        if (tokens.length === 0) return null;

        const pattern = tokens
          .map(t => t.replace(/[.*+?^${}()|\[\]\\]/g, '\\$&'))
          .join('\\s*');
        
        // Create regex with global flag to use lastIndex for starting position
        const regex = new RegExp(pattern, 'g');
        
        // Set the starting position for the search
        regex.lastIndex = minStart;
        
        // Find the match
        const match = regex.exec(fileText);
        
        if (!match || match.index < minStart) {
          return null; // No match found
        }
        
        return {
          start_idx: match.index,
          end_idx: match.index + match[0].length
        };
      } catch (e) {
        console.warn('Regex matching failed, falling back to exact match:', e);
        // Fallback to exact match if regex fails
        const startIdx = fileText.indexOf(chunkContent, minStart);
        if (startIdx === -1 || startIdx < minStart) {
          return null;
        }
        return {
          start_idx: startIdx,
          end_idx: startIdx + chunkContent.length
        };
      }
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

    // Use existing window if provided; otherwise open a new one
    const newWindow = existingWindow || window.open('', '_blank', 'width=1200,height=800');
    if (!newWindow) {
      alert('Could not open new window. Please check your popup blocker settings.');
      return;
    }

    // If we opened a new one here, attempt to maximize (best effort)
    if (!existingWindow) {
      try {
        newWindow.moveTo(0, 0);
        newWindow.resizeTo(screen.availWidth, screen.availHeight);
      } catch (e) {
        console.warn('Unable to resize visualization window:', e);
      }
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
          
          html, body {
            height: 100%;
            margin: 0;
            padding: 20px;
            background-color: #f5f5f5;
            font-family: Arial, sans-serif;
          }
          
          * {
            box-sizing: border-box;
          }
          
          h1 {
            margin-bottom: 20px;
          }
          
          .main-container {
            display: flex;
            flex-direction: column;
            height: calc(100vh - 40px); /* Subtract body padding */
            width: 100%;
          }
          
          /* Header row styling */
          .header-row {
            display: flex;
            flex-direction: ${hasChunkRuns && isSingleRun ? 'column' : 'row'};
            gap: 20px;
            margin-bottom: -1px; /* Overlap with content row border */
            flex-shrink: 0; /* Don't shrink headers */
          }
          
          /* Scrollable content row styling */
          .scroll-container {
            display: flex;
            flex-direction: ${hasChunkRuns && isSingleRun ? 'column' : 'row'};
            gap: 20px;
            overflow-y: auto;
            flex-grow: 1;
            flex-shrink: 1;
            scrollbar-width: thin;
            min-height: 0; /* Allow shrinking below content size */
          }
          
          .run-column {
            flex: 1;
            background: white;
            border: 1px solid #ddd;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            display: flex;
            flex-direction: column;
          }
          
          /* Shared header styling */
          .run-header {
            font-size: 16px;
            font-weight: bold;
            padding: 15px;
            border-bottom: 1px solid #eee;
            color: #333;
            background: white;
            margin: 0;
            border-radius: 8px 8px 0 0;
            height: 80px;
            display: flex;
            flex-direction: column;
            justify-content: flex-start;
          }
          
          /* Content column styling */
          .content-column {
            flex: 1;
            background: white;
            border: 1px solid #ddd;
            border-top: none;
            border-radius: 0 0 8px 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            display: flex;
            flex-direction: column;
            min-height: 0; /* Allow shrinking below content size */
          }
          
          /* Column content wrapper */
          .column-content {
            display: flex;
            flex-direction: column;
            height: 100%;
          }
          
          /* Text container styling - no independent scrolling */
          .text-container {
            --scrollbar-gutter-size: 14px; /* fallback gutter width */
            flex: 1;
            overflow: visible; /* Allow content to overflow into scroll container */
            scrollbar-gutter: stable both-edges; /* reserve space consistently */
            font-family: 'Courier New', Courier, monospace;
            font-size: 14px;
            line-height: 1.5;
            background: #fafafa;
            border: 1px solid #eee;
            border-radius: 0 0 4px 4px;
            padding: 10px;
            padding-right: calc(10px + var(--scrollbar-gutter-size)); /* manual gutter fallback */
            position: relative;
          }

          /* Hide scrollbars on text containers, show them on the main scroll container */
          .text-container {
            scrollbar-width: none; /* Firefox */
          }

          .text-container::-webkit-scrollbar {
            width: 0;
            height: 0;
          }
          
          /* Show scrollbars on main scroll container */
          .scroll-container {
            scrollbar-width: thin; /* Firefox */
            scrollbar-color: #ccc #f0f0f0; /* Firefox */
          }
          
          .scroll-container::-webkit-scrollbar {
            width: 8px;
            height: 8px;
          }
          
          .scroll-container::-webkit-scrollbar-track {
            background: #f0f0f0;
            border-radius: 4px;
          }
          
          .scroll-container::-webkit-scrollbar-thumb {
            background: #ccc;
            border-radius: 4px;
          }
          
          .scroll-container::-webkit-scrollbar-thumb:hover {
            background: #999;
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
        <div class="main-container">
    `;

    // Show Parsed Text column only when no chunk runs are selected
    if (!hasChunkRuns) {
      html += `
        <div class="header-row">
          <div class="run-column">
            <div class="run-header">
              <div style="margin-bottom: 5px; font-weight: bold;">Parsed Text</div>
              <div style="font-size: 12px; color: #666;">Original parsed content of the file</div>
            </div>
          </div>
        </div>
        <div class="scroll-container">
          <div class="content-column">
            <div class="column-content">
              <div class="text-container" style="position: relative;">
                <div class="chunk-text">${escapeHtml(parsedText)}</div>
              </div>
            </div>
          </div>
        </div>
      `;
    }

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

    if (hasChunkRuns) {
      // Create mappings from runId to run parameters and framework
      const runParamsMap = new Map();
      const runFrameworkMap = new Map();
      chunkRuns.forEach(run => {
        runParamsMap.set(run.id, run.parameters);
        runFrameworkMap.set(run.id, run.framework);
      });
      
      // Create framework-to-color mapping for consistent coloring
      const frameworkColors = new Map();
      const uniqueFrameworks = [...new Set(chunkRuns.map(run => run.framework))];
      uniqueFrameworks.forEach((framework, index) => {
        frameworkColors.set(framework, colors[index % colors.length]);
      });

      // Helper function to format parameters for display
        const formatParamsForDisplay = (params) => {
          if (!params) return '';
          
          // Convert to object if it's a string
          const paramsObj = typeof params === 'string' ? JSON.parse(params) : params;
          
          // Format parameters as readable strings
          const paramStrings = [];
          
          // Handle chunkers array (for both frameworks)
          if (paramsObj.chunkers && Array.isArray(paramsObj.chunkers)) {
            paramsObj.chunkers.forEach((chunker, index) => {
              const chunkerType = chunker.chunker.charAt(0).toUpperCase() + chunker.chunker.slice(1);
              paramStrings.push(`${chunkerType}: Enabled`);
              
              // Display all parameters for this chunker based on type
              Object.entries(chunker.params).forEach(([paramName, paramValue]) => {
                // Format parameter name to be more readable
                const displayName = paramName
                  .replace(/_/g, ' ')    
                  .replace(/\b\w/g, l => l.toUpperCase());
                
                // Format value based on type
                let displayValue = paramValue;
                if (typeof paramValue === 'boolean') {
                  displayValue = paramValue ? 'Enabled' : 'Disabled';
                }
                
                paramStrings.push(`${displayName}: ${displayValue}`);
              });
            });
          } else {
            // Handle other frameworks and regular parameters
            Object.entries(paramsObj)
              .forEach(([key, value]) => {
                if (typeof value !== 'object' || value === null) {
                  // Format key to be more readable
                  const displayKey = key
                    .replace(/_/g, ' ')    
                    .replace(/\b\w/g, l => l.toUpperCase());
                  
                  // Format value based on type
                  let displayValue = value;
                  if (typeof value === 'boolean') {
                    displayValue = value ? 'Enabled' : 'Disabled';
                  }
                  
                  paramStrings.push(`${displayKey}: ${displayValue}`);
                }
              });
          }
          
          return paramStrings.join(', ');
        };

      // Generate headers first
      html += '<div class="header-row">';
      runIds.forEach((runId, runIndex) => {
        const runChunks = chunksByRunId[runId];
        const framework = runFrameworkMap.get(parseInt(runId));
        const baseColor = frameworkColors.get(framework);
        const runParams = runParamsMap.get(parseInt(runId));
        const formattedParams = formatParamsForDisplay(runParams);
        
        html += `
          <div class="run-column">
            <div class="run-header">
              <div style="margin-bottom: 5px; font-weight: bold;">Chunk Run ID: ${runId} (${runChunks.length} chunks)</div>
              <div style="font-size: 12px; color: #666; white-space: pre-wrap; max-width: 100%; overflow-wrap: break-word;">Framework: <span style="background-color: ${baseColor}; color: white; padding: 2px 6px; border-radius: 3px; font-weight: bold; opacity: 0.8;">${framework}</span></div>
              <div style="font-size: 12px; color: #666; white-space: pre-wrap; max-width: 100%; overflow-wrap: break-word; margin-top: 4px;">${formattedParams || 'No parameters available'}</div>
            </div>
          </div>
        `;
      });
      html += '</div>';
      
      // Generate scrollable content
      html += '<div class="scroll-container">';
      runIds.forEach((runId, runIndex) => {
        const runChunks = chunksByRunId[runId];
        const framework = runFrameworkMap.get(parseInt(runId));
        const baseColor = frameworkColors.get(framework);
        const runParams = runParamsMap.get(parseInt(runId));
        const formattedParams = formatParamsForDisplay(runParams);
        
        // Find positions for all chunks and filter out those with no match
        let lastStart = -1;
        // Check if markdown header splitting was disabled (use exact match in that case)
        const useExactMatch = runParams && runParams.markdown_header_splitting === false;
        // IMPORTANT: enforce document order before applying the increasing-start constraint.
        // The API may not return chunks sorted, and an out-of-order chunk would fail matching
        // once minStart has advanced past its true location.
        const runChunksSorted = [...runChunks].sort((a, b) => {
          const aId = typeof a.chunk_id === 'string' ? a.chunk_id : '';
          const bId = typeof b.chunk_id === 'string' ? b.chunk_id : '';
          const aParts = aId.split('_');
          const bParts = bId.split('_');
          const aIdx = parseInt(aParts[aParts.length - 1], 10);
          const bIdx = parseInt(bParts[bParts.length - 1], 10);
          if (!Number.isNaN(aIdx) && !Number.isNaN(bIdx)) return aIdx - bIdx;
          // Fallback: stable string compare
          return String(aId).localeCompare(String(bId));
        });

        const chunksWithPositions = runChunksSorted
          .map(chunk => {
            const minStart = lastStart + 1; // enforce strictly after previous start
            const positions = findChunkPositions(chunk.content, parsedText, minStart, useExactMatch);
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
        
        // Generate HTML for this run's content
        html += `
          <div class="content-column">
            <div class="column-content">
              <div class="text-container" style="position: relative;">
                <div class="chunk-text">${highlightedText}</div>
            `;
        
        html += `
              </div>
              <div class="legend">
                <div class="legend-item">
                  <span class="legend-color" style="background-color: ${baseColor}; opacity: 0.3;"></span>
                  <span>Framework: ${framework} | Run Parameters: ${formattedParams}</span>
                </div>
              </div>
            </div>
          </div>
        `;
      });
      html += '</div>';
    }
    
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
                                let displayValue = paramValue;
                                if (typeof paramValue === 'boolean') {
                                  displayValue = paramValue ? 'Enabled' : 'Disabled';
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
                        let displayValue = value;
                        if (typeof value === 'boolean') {
                          displayValue = value ? 'Enabled' : 'Disabled';
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