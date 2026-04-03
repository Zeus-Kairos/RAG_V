/** Chunk visualization popup windows (shared by Chunk browser and Graph view). */
function formatTimeUsage(seconds) {
  if (seconds === null || seconds === undefined || Number.isNaN(Number(seconds))) return '';
  return `${Number(seconds).toFixed(3)}s`;
}

export function openLoadingChunksWindow(fileName) {
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
}

export function buildChunksVisualizationDocumentHtml(
  parsedText,
  chunks,
  fileName,
  chunkRuns,
  parsedTextMetadata = {},
  viewOptions = {}
) {
  const controlsInParent = viewOptions.controlsInParent === true;
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

  /** Lookup for chunk metadata panel: only persisted chunk `metadata` JSON (keyed by chunk_run_id then chunk_id). */
  const chunkMetaByRun = {};
  if (hasChunkRuns) {
    runIds.forEach((rid) => {
      chunkMetaByRun[rid] = {};
      (chunksByRunId[rid] || []).forEach((ch) => {
        const cid = ch.chunk_id;
        chunkMetaByRun[rid][cid] = ch.metadata ?? {};
      });
    });
  }

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

  // Helper function to format parameters for display
  const formatParamsForDisplay = (params) => {
    if (!params || Object.keys(params).length === 0) return '';
    
    const paramStrings = [];
    Object.entries(params).forEach(([key, value]) => {
      // Format key to be more readable
      const displayKey = key
        .replace(/_/g, ' ')
        .replace(/\b\w/g, l => l.toUpperCase());
      
      // Format value based on type
      let displayValue = value;
      if (typeof value === 'boolean') {
        displayValue = value ? 'Enabled' : 'Disabled';
      } else if (typeof value === 'object') {
        displayValue = JSON.stringify(value);
      }
      
      paramStrings.push(`${displayKey}: ${displayValue}`);
    });
    
    return paramStrings.join(', ');
  };

  // Helper function to format date time
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

  // Apply alpha to a hex color (expects #RRGGBB)
  const applyAlpha = (hex, alpha = 0.25) => {
    const safeHex = hex.replace('#', '');
    const r = parseInt(safeHex.slice(0, 2), 16);
    const g = parseInt(safeHex.slice(2, 4), 16);
    const b = parseInt(safeHex.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  };

  /** Same label + palette index as chunk boundary markers (encoding color). */
  const resolveEncodingColor = (chunkId, chunkIdx, palette) => {
    const labelBase = (() => {
      if (typeof chunkId === 'string') {
        const parts = chunkId.split('_');
        return parts[parts.length - 1] || chunkId;
      }
      return chunkId ?? chunkIdx + 1;
    })();
    const n = Array.isArray(palette) && palette.length > 0 ? palette.length : 1;
    const num = parseInt(String(labelBase), 10);
    let paletteIndex;
    if (!Number.isNaN(num)) {
      paletteIndex = ((num % n) + n) % n;
    } else {
      const s = String(chunkId ?? labelBase);
      let h = 0;
      for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
      paletteIndex = h % n;
    }
    const color = palette[paletteIndex] ?? '#333';
    return { color, labelBase };
  };

  const buildChunksOnlyHtml = (chunkRows, fileText, palette, runIdStr) =>
    chunkRows
      .map((chunk, idx) => {
        const { color, labelBase } = resolveEncodingColor(chunk.chunk_id, idx, palette);
        const hasDocSpan =
          typeof chunk.start_idx === 'number' &&
          typeof chunk.end_idx === 'number' &&
          chunk.start_idx >= 0 &&
          chunk.end_idx >= chunk.start_idx;
        const rawBody = hasDocSpan
          ? fileText.slice(chunk.start_idx, chunk.end_idx)
          : String(chunk.content ?? '');
        const body = escapeHtml(rawBody);
        const numLabel = escapeHtml(String(labelBase));
        const ridAttr = escapeHtml(String(runIdStr));
        const cidAttr = escapeHtml(String(chunk.chunk_id ?? ''));
        return `
          <div class="chunk-only-block" style="--chunk-color: ${color}; border-left-color: ${color}; background: ${applyAlpha(color, 0.06)};">
            <div class="chunk-only-block-head">
              <button type="button" class="chunk-only-badge" style="background: ${color}; border: none; cursor: pointer;" data-run-id="${ridAttr}" data-chunk-id="${cidAttr}" title="Show chunk metadata">${numLabel}</button>
            </div>
            <div class="chunk-only-text" style="color: ${color};">${body}</div>
          </div>
        `;
      })
      .join('');

  // Build HTML that keeps the original text exactly once, inserting zero-width
  // boundary markers (so overlaps never duplicate/extend the text).
  const formatTextWithBoundaryMarkers = (
    fileText,
    chunksWithPositions,
    palette,
    runIdStr
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
          const { color: boundaryColor, labelBase } = resolveEncodingColor(
            b.chunkId,
            b.idx,
            palette
          );
          const label = b.kind === 'start' ? String(labelBase) : `${labelBase}e`;
          const ridAttr = escapeHtml(String(runIdStr));
          const cidAttr = escapeHtml(String(b.chunkId ?? ''));
          const clickAttrs =
            b.kind === 'start'
              ? ` data-run-id="${ridAttr}" data-chunk-id="${cidAttr}" role="button" tabindex="0" title="Show chunk metadata"`
              : '';

          result += `<span class="chunk-boundary" data-kind="${b.kind}" data-label="${label}" style="--boundary-color: ${boundaryColor}; --boundary-stack: ${stackIdx};"${clickAttrs}></span>`;
        });

      cursor = pos;
    });

    if (cursor < fileText.length) {
      result += escapeAndFormat(fileText.slice(cursor));
    }

    return result;
  };

  // Generate HTML for popup or embedded iframe
  const numColumns = runIds.length;
  const gridTemplateColumns = numColumns > 0 ? `repeat(${numColumns}, minmax(300px, 1fr))` : '1fr';
  
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
        
        h1 {
          margin-bottom: 20px;
        }
        
        /* Single grid container for perfect alignment */
        .main-container {
          display: flex;
          flex-direction: column;
          height: calc(100vh - 40px); /* Subtract body padding */
          width: 100%;
        }
        
        /* Single grid container for perfect alignment */
        .main-container {
          display: flex;
          flex-direction: column;
          height: calc(100vh - 40px); /* Subtract body padding */
          width: 100%;
        }
        
        /* Ensure grid wrapper has consistent width */
        .grid-wrapper {
          display: contents;
          scrollbar-gutter: stable both-edges;
        }
        
        /* Base styling for both header and scroll rows */
        .header-row, .scroll-container {
          display: grid;
          grid-template-columns: ${gridTemplateColumns};
          gap: 20px;
          width: 100%;
          box-sizing: border-box;
          overflow-y: ${hasChunkRuns && isSingleRun ? 'hidden' : 'auto'};
          scrollbar-width: thin;
          scrollbar-gutter: stable both-edges;
          min-height: 0;
        }
        
        /* Header-specific styling - ensure same width as scroll container */
        .header-row {
          margin-bottom: -1px;
          flex-shrink: 0;
          overflow-y: scroll; /* Match scroll-container overflow */
          visibility: hidden; /* Hide scrollbar visually */
          pointer-events: none; /* Disable interaction with hidden scrollbar */
        }
        
        /* Hide scrollbar for header row while maintaining width */
        .header-row::-webkit-scrollbar {
          visibility: hidden;
          width: 8px;
        }
        
        .header-row::-webkit-scrollbar-track {
          visibility: hidden;
        }
        
        .header-row::-webkit-scrollbar-thumb {
          visibility: hidden;
        }
        
        /* Show scrollbar content */
        .header-row > * {
          visibility: visible;
          pointer-events: auto;
        }
        
        /* Scroll-container specific styling */
        .scroll-container {
          overflow-y: auto;
          flex: 1;
        }
        
        /* Header column */
        .run-column {
          background: white;
          border: 1px solid #ddd;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
          border-radius: 8px 8px 0 0;
          min-width: 300px;
        }
        
        /* Content column */
        .content-column {
          background: white;
          border: 1px solid #ddd;
          border-top: none;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
          border-radius: 0 0 8px 8px;
          min-width: 300px;
          display: flex;
          flex-direction: column;
          height: 100%;
        }
        
        /* Remove grid wrapper since we're using direct grid layout */
        .grid-wrapper {
          display: contents;
        }
        
        /* Ensure single run layout still works correctly */
        ${hasChunkRuns && isSingleRun ? `
          .grid-wrapper {
            grid-template-columns: 1fr;
          }
          .run-column, .content-column {
            width: 100%;
          }
        ` : ''}
        
        /* Shared header styling - allows expansion while maintaining uniform height across all columns */
        .run-header {
          font-size: 16px;
          font-weight: bold;
          padding: 15px;
          border-bottom: 1px solid #eee;
          color: #333;
          background: white;
          margin: 0;
          min-height: 80px; /* Minimum height to maintain readability */
          display: flex;
          flex-direction: column;
          justify-content: flex-start;
          word-wrap: break-word;
          overflow-wrap: break-word;
        }
        
        /* Column content wrapper */
        .column-content {
          display: flex;
          flex-direction: column;
        }
        
        /* Text container styling - only handle horizontal scrolling */
        .text-container {
          overflow-x: auto; /* Only handle horizontal overflow */
          overflow-y: hidden; /* Let scroll-container handle vertical scrolling */
          scrollbar-gutter: stable both-edges; /* Reserve space for scrollbars */
          font-family: 'Courier New', Courier, monospace;
          font-size: 14px;
          line-height: 1.5;
          background: #fafafa;
          border: 1px solid #eee;
          border-radius: 0 0 4px 4px;
          padding: 10px;
          position: relative;
          min-height: 200px; /* Ensure minimum height for consistency */
          height: 100%; /* Fill available space */
        }
        
        /* Ensure column content fills the available space */
        .column-content {
          display: flex;
          flex-direction: column;
          height: 100%;
        }
        
        /* Make text container fill the available space */
        .text-container {
          flex: 1;
        }
        
        /* Chunk text styling */
        .chunk-text {
          white-space: pre-wrap;
          word-wrap: break-word;
          margin: 0;
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
          pointer-events: auto;
          cursor: pointer;
          white-space: nowrap;
          background: var(--boundary-color, #000);
        }

        .chunk-boundary[data-kind="start"]:focus {
          outline: 2px solid #4a6cf7;
          outline-offset: 2px;
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

        .viz-page-head {
          display: flex;
          flex-direction: row;
          flex-wrap: wrap;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 20px;
        }

        .viz-page-head-row {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          width: 100%;
        }

        .viz-page-head-row--end {
          justify-content: flex-end;
        }

        .chunk-meta-float-root {
          position: fixed;
          inset: 0;
          z-index: 100000;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
          box-sizing: border-box;
        }

        .chunk-meta-float-root.is-hidden {
          display: none;
        }

        .chunk-meta-float-backdrop {
          position: absolute;
          inset: 0;
          background: rgba(0, 0, 0, 0.18);
          cursor: default;
        }

        .chunk-meta-float-window {
          position: relative;
          z-index: 1;
          width: min(640px, 100%);
          max-height: min(72vh, 560px);
          display: flex;
          flex-direction: column;
          background: #fff;
          border: 1px solid #ccc;
          border-radius: 10px;
          box-shadow: 0 12px 40px rgba(0, 0, 0, 0.18);
          overflow: hidden;
        }

        .chunk-meta-float-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 10px 14px;
          border-bottom: 1px solid #e8e8e8;
          background: #fafafa;
          flex-shrink: 0;
        }

        .chunk-meta-float-title {
          font-size: 13px;
          font-weight: 700;
          color: #333;
        }

        .chunk-meta-float-close {
          border: none;
          background: transparent;
          font-size: 22px;
          line-height: 1;
          padding: 0 4px;
          cursor: pointer;
          color: #666;
          border-radius: 4px;
        }

        .chunk-meta-float-close:hover {
          background: #eee;
          color: #111;
        }

        .chunk-meta-float-body {
          margin: 0;
          padding: 14px 16px;
          overflow: auto;
          font-family: Arial, Helvetica, sans-serif;
          font-size: 12px;
          line-height: 1.45;
          color: #222;
          flex: 1;
          min-height: 0;
        }

        .chunk-meta-float-body .chunk-meta-empty-msg {
          color: #777;
          font-style: italic;
          margin: 0;
        }

        .chunk-meta-table {
          width: 100%;
          border-collapse: collapse;
          table-layout: fixed;
        }

        .chunk-meta-table thead th {
          background: #f0f0f0;
          border: 1px solid #ddd;
          padding: 8px 10px;
          text-align: left;
          font-weight: 700;
          color: #333;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }

        .chunk-meta-table tbody th[scope="row"] {
          width: 32%;
          border: 1px solid #e5e5e5;
          padding: 8px 10px;
          text-align: left;
          vertical-align: top;
          background: #fafafa;
          font-weight: 600;
          color: #444;
          font-family: ui-monospace, 'Cascadia Code', 'Courier New', monospace;
          font-size: 11px;
          word-break: break-word;
        }

        .chunk-meta-table tbody td {
          border: 1px solid #e5e5e5;
          padding: 8px 10px;
          vertical-align: top;
          background: #fff;
        }

        .chunk-meta-cell-pre {
          margin: 0;
          font-family: ui-monospace, 'Cascadia Code', 'Courier New', monospace;
          font-size: 11px;
          line-height: 1.4;
          white-space: pre-wrap;
          word-break: break-word;
        }

        .viz-toolbar {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .viz-toggle-chunk-only {
          font-size: 13px;
          padding: 8px 14px;
          border-radius: 6px;
          border: 1px solid #ccc;
          background: #fff;
          cursor: pointer;
          font-family: Arial, sans-serif;
        }

        .viz-toggle-chunk-only:hover {
          background: #f0f0f0;
        }

        .viz-toggle-chunk-only[aria-pressed="true"] {
          background: #333;
          color: #fff;
          border-color: #333;
        }

        .chunk-only-view.chunk-only-mode {
          display: none;
        }

        body.chunk-visual--chunk-only .chunk-doc-mode {
          display: none;
        }

        body.chunk-visual--chunk-only .chunk-only-view.chunk-only-mode {
          display: block;
        }

        .chunk-only-block {
          margin-bottom: 14px;
          padding: 10px 12px;
          border-left: 3px solid var(--chunk-color, #333);
          border-radius: 0 6px 6px 0;
        }

        .chunk-only-block:last-child {
          margin-bottom: 0;
        }

        .chunk-only-block-head {
          margin-bottom: 6px;
        }

        .chunk-only-badge {
          display: inline-block;
          color: #fff;
          font-size: 10px;
          font-weight: bold;
          line-height: 1;
          padding: 2px 6px;
          border-radius: 2px;
          font-family: inherit;
        }

        .chunk-only-badge:focus {
          outline: 2px solid #4a6cf7;
          outline-offset: 2px;
        }

        .chunk-only-text {
          white-space: pre-wrap;
          word-wrap: break-word;
          font-family: 'Courier New', Courier, monospace;
          font-size: 14px;
          line-height: 1.5;
          margin: 0;
        }
      </style>
    </head>
    <body>
      ${
        hasChunkRuns && !controlsInParent
          ? `<div class="viz-page-head">
        <div class="viz-page-head-row viz-page-head-row--end">
          <div class="viz-toolbar">
            <button type="button" class="viz-toggle-chunk-only" id="toggle-chunk-only" aria-pressed="false">Chunk only</button>
          </div>
        </div>
      </div>`
          : ''
      }
      ${
        hasChunkRuns
          ? `<div id="chunk-meta-float-root" class="chunk-meta-float-root is-hidden" aria-hidden="true">
        <div class="chunk-meta-float-backdrop" id="chunk-meta-float-backdrop" title="Click to close"></div>
        <div class="chunk-meta-float-window" id="chunk-meta-float-window" role="dialog" aria-modal="true" aria-labelledby="chunk-meta-float-title">
          <div class="chunk-meta-float-header">
            <span class="chunk-meta-float-title" id="chunk-meta-float-title">Chunk metadata</span>
            <button type="button" class="chunk-meta-float-close" id="chunk-meta-float-close" aria-label="Close">&times;</button>
          </div>
          <div class="chunk-meta-float-body" id="chunk-meta-float-body"></div>
        </div>
      </div>`
          : ''
      }
      <div class="main-container">
        <div class="grid-wrapper">
  `;

  // Show Parsed Text column only when no chunk runs are selected
  if (!hasChunkRuns) {
    const parsedTextParams = parsedTextMetadata.parameters ? formatParamsForDisplay(parsedTextMetadata.parameters) : '';
    html += `
      <div class="header-row">
        <div class="run-column" style="min-width: auto; width: 100%;">
          <div class="run-header">
            <div style="margin-bottom: 5px; font-weight: bold;">Parsed Text</div>
            <div style="font-size: 12px; color: #666;">
              ${parsedTextMetadata.parse_run_id ? `Run ID: ${parsedTextMetadata.parse_run_id} | ` : ''}Parser: ${parsedTextMetadata.parser || 'Unknown'} ${parsedTextParams ? `| Parameters: ${parsedTextParams}` : ''} | Time Usage: ${formatTimeUsage(parsedTextMetadata.time_usage) || 'N/A'} | Time: ${parsedTextMetadata.time ? formatDateTime(parsedTextMetadata.time) : 'Unknown'}
            </div>
          </div>
        </div>
      </div>
      <div class="scroll-container">
        <div class="content-column" style="min-width: auto; width: 100%;">
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
    // Create mappings from runId to run parameters, framework, and active status
    const runParamsMap = new Map();
    const runFrameworkMap = new Map();
    const runActiveMap = new Map();
    chunkRuns.forEach(run => {
      runParamsMap.set(run.id, run.parameters);
      runFrameworkMap.set(run.id, run.framework);
      runActiveMap.set(run.id, run.is_active);
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
        
        // Handle top-level parameters first (like chef for Chonkie)
        Object.entries(paramsObj)
          .forEach(([key, value]) => {
            // Skip chunkers array as we'll handle it separately
            if (key === 'chunkers') return;
            
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
      const isActive = runActiveMap.get(parseInt(runId));
      const formattedParams = formatParamsForDisplay(runParams);
      
      const activeTag = isActive ? '<span style="background-color: rgba(76, 175, 80, 0.1); color: #4caf50; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 600; margin-left: 8px; border: 1px solid #4caf50;">Active</span>' : '';
      
      html += `
        <div class="run-column">
          <div class="run-header">
            <div style="margin-bottom: 5px; font-weight: bold; display: flex; align-items: center;">
              <span>Chunk Run ID: ${runId} (${runChunks.length} chunks)</span>
              ${activeTag}
            </div>
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
      
      // Match chunks to parsed text; only successful matches get boundary markers.
      // Chunk-only view still lists every chunk in order, using stored content when unmatched.
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

      const chunksWithPositions = [];
      const chunkOnlyRows = [];
      runChunksSorted.forEach(chunk => {
        const minStart = lastStart + 1; // enforce strictly after previous start
        const positions = findChunkPositions(chunk.content, parsedText, minStart, useExactMatch);
        if (positions) {
          lastStart = positions.start_idx;
          const row = { ...chunk, ...positions };
          chunksWithPositions.push(row);
          chunkOnlyRows.push(row);
        } else {
          chunkOnlyRows.push({ ...chunk });
        }
      });

      const highlightedText = formatTextWithBoundaryMarkers(
        parsedText,
        chunksWithPositions,
        colors,
        runId
      );
      const chunksOnlyHtml = buildChunksOnlyHtml(chunkOnlyRows, parsedText, colors, runId);

      // Generate HTML for this run's content
      html += `
        <div class="content-column">
          <div class="column-content">
            <div class="text-container" style="position: relative;">
              <div class="chunk-text chunk-doc-mode">${highlightedText}</div>
              <div class="chunk-only-view chunk-only-mode">
                <div class="chunk-only-list">${chunksOnlyHtml}</div>
              </div>
          `;
      
      html += `
            </div>
            <div class="legend">
              <div class="legend-item">
                <span class="legend-color" style="background-color: ${baseColor}; opacity: 0.3;"></span>
                <span>Framework: ${framework} | Run Parameters: ${formattedParams} | Parser: ${parsedTextMetadata.parser || 'Unknown'} | Parse Time Usage: ${formatTimeUsage(parsedTextMetadata.time_usage) || 'N/A'} ${parsedTextMetadata.parameters && Object.keys(parsedTextMetadata.parameters).length > 0 ? `| Parser Parameters: ${formatParamsForDisplay(parsedTextMetadata.parameters)}` : ''}</span>
              </div>
            </div>
          </div>
        </div>
      `;
    });
    html += '</div>'; // End scroll-container
  }
  
  html += `
        </div> <!-- End grid-wrapper -->
      </div> <!-- End main-container -->
      <script>
        const CHUNK_META = ${JSON.stringify(chunkMetaByRun).replace(/</g, '\\u003c')};

        function closeChunkMetaFloat() {
          const root = document.getElementById('chunk-meta-float-root');
          if (!root || root.classList.contains('is-hidden')) return;
          root.classList.add('is-hidden');
          root.setAttribute('aria-hidden', 'true');
        }

        function escapeChunkMetaHtml(s) {
          return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
        }

        function formatMetaCellValue(v) {
          if (v === null || v === undefined) return '';
          if (typeof v === 'object') return JSON.stringify(v, null, 2);
          return String(v);
        }

        function metadataToTableHtml(meta) {
          if (meta === null || meta === undefined) {
            return '<p class="chunk-meta-empty-msg">No metadata for this chunk.</p>';
          }
          if (typeof meta !== 'object') {
            return (
              '<table class="chunk-meta-table"><thead><tr><th>Value</th></tr></thead><tbody><tr><td><pre class="chunk-meta-cell-pre">' +
              escapeChunkMetaHtml(formatMetaCellValue(meta)) +
              '</pre></td></tr></tbody></table>'
            );
          }
          if (Array.isArray(meta)) {
            if (meta.length === 0) {
              return '<p class="chunk-meta-empty-msg">Empty metadata array.</p>';
            }
            const rows = meta
              .map(function (item, i) {
                return (
                  '<tr><th scope="row">' +
                  escapeChunkMetaHtml(String(i)) +
                  '</th><td><pre class="chunk-meta-cell-pre">' +
                  escapeChunkMetaHtml(formatMetaCellValue(item)) +
                  '</pre></td></tr>'
                );
              })
              .join('');
            return (
              '<table class="chunk-meta-table"><thead><tr><th>Index</th><th>Value</th></tr></thead><tbody>' +
              rows +
              '</tbody></table>'
            );
          }
          const keys = Object.keys(meta).sort();
          if (keys.length === 0) {
            return '<p class="chunk-meta-empty-msg">Empty metadata object.</p>';
          }
          const rows = keys
            .map(function (k) {
              return (
                '<tr><th scope="row">' +
                escapeChunkMetaHtml(k) +
                '</th><td><pre class="chunk-meta-cell-pre">' +
                escapeChunkMetaHtml(formatMetaCellValue(meta[k])) +
                '</pre></td></tr>'
              );
            })
            .join('');
          return (
            '<table class="chunk-meta-table"><thead><tr><th>Key</th><th>Value</th></tr></thead><tbody>' +
            rows +
            '</tbody></table>'
          );
        }

        function openChunkMetaFloat(runId, chunkId) {
          const root = document.getElementById('chunk-meta-float-root');
          const bodyEl = document.getElementById('chunk-meta-float-body');
          if (!root || !bodyEl) return;
          const runMap = CHUNK_META && CHUNK_META[runId];
          const meta = runMap && runMap[chunkId];
          if (meta === undefined || meta === null) {
            bodyEl.innerHTML = '<p class="chunk-meta-empty-msg">No metadata for this chunk.</p>';
          } else {
            bodyEl.innerHTML = metadataToTableHtml(meta);
          }
          root.classList.remove('is-hidden');
          root.setAttribute('aria-hidden', 'false');
          const closeBtn = document.getElementById('chunk-meta-float-close');
          if (closeBtn) closeBtn.focus();
        }

        // Synchronized scrolling implementation that handles scrollbar alignment
        document.addEventListener('DOMContentLoaded', () => {
          const toggleBtn = document.getElementById('toggle-chunk-only');
          if (toggleBtn) {
            toggleBtn.addEventListener('click', () => {
              const on = document.body.classList.toggle('chunk-visual--chunk-only');
              toggleBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
              toggleBtn.textContent = on ? 'Full document' : 'Chunk only';
            });
          }

          const backdrop = document.getElementById('chunk-meta-float-backdrop');
          const floatWindow = document.getElementById('chunk-meta-float-window');
          const closeBtn = document.getElementById('chunk-meta-float-close');
          if (backdrop) {
            backdrop.addEventListener('click', () => closeChunkMetaFloat());
          }
          if (closeBtn) {
            closeBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              closeChunkMetaFloat();
            });
          }
          if (floatWindow) {
            floatWindow.addEventListener('click', (e) => e.stopPropagation());
          }

          document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') closeChunkMetaFloat();
          });

          document.body.addEventListener('click', (e) => {
            const badge = e.target.closest('.chunk-only-badge[data-chunk-id]');
            if (badge) {
              e.stopPropagation();
              openChunkMetaFloat(badge.getAttribute('data-run-id'), badge.getAttribute('data-chunk-id'));
              return;
            }
            const boundary = e.target.closest('.chunk-boundary[data-kind="start"][data-chunk-id]');
            if (boundary) {
              e.stopPropagation();
              openChunkMetaFloat(boundary.getAttribute('data-run-id'), boundary.getAttribute('data-chunk-id'));
            }
          });

          document.body.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            const boundary = e.target.closest('.chunk-boundary[data-kind="start"][data-chunk-id]');
            if (boundary) {
              e.preventDefault();
              e.stopPropagation();
              openChunkMetaFloat(boundary.getAttribute('data-run-id'), boundary.getAttribute('data-chunk-id'));
            }
          });

          const textContainers = document.querySelectorAll('.text-container');
          const scrollContainer = document.querySelector('.scroll-container');
          let isScrolling = false;
          
          // Disable vertical scrolling on text containers - let scroll-container handle it
          textContainers.forEach(container => {
            container.style.overflowY = 'hidden';
            container.style.overflowX = 'auto';
            container.style.maxHeight = 'none';
          });
          
          // Function to synchronize horizontal scrolling across all text containers
          const syncHorizontalScroll = (scrolledContainer) => {
            if (isScrolling) return;
            
            isScrolling = true;
            
            const scrollLeft = scrolledContainer.scrollLeft;
            
            textContainers.forEach(container => {
              if (container !== scrolledContainer) {
                container.scrollLeft = scrollLeft;
              }
            });
            
            isScrolling = false;
          };
          
          // Add scroll event listeners for horizontal sync only
          textContainers.forEach(container => {
            container.addEventListener('scroll', (e) => {
              syncHorizontalScroll(e.target);
            });
          });
        });
      </script>
    </body>
    </html>
  `;

  return html;
}

export function openChunksWindow(parsedText, chunks, fileName, chunkRuns, existingWindow = null, parsedTextMetadata = {}) {
  const newWindow = existingWindow || window.open('', '_blank', 'width=1200,height=800');
  if (!newWindow) {
    alert('Could not open new window. Please check your popup blocker settings.');
    return;
  }

  if (!existingWindow) {
    try {
      newWindow.moveTo(0, 0);
      newWindow.resizeTo(screen.availWidth, screen.availHeight);
    } catch (e) {
      console.warn('Unable to resize visualization window:', e);
    }
  }

  const html = buildChunksVisualizationDocumentHtml(parsedText, chunks, fileName, chunkRuns, parsedTextMetadata, {});
  newWindow.document.open();
  newWindow.document.write(html);
  newWindow.document.close();
}
