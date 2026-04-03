/** Parsed-text visualization popup (shared by Parse run popup and Graph view). */
function formatTimeUsage(seconds) {
  if (seconds === null || seconds === undefined || Number.isNaN(Number(seconds))) {
    return 'N/A';
  }
  return `${Number(seconds).toFixed(3)}s`;
}

// Helper function to open a loading window
export function openLoadingParsedContentWindow(fileName) {
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
    console.warn('Unable to resize visualization window:', e);
  }

  newWindow.document.open();
  newWindow.document.write(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Loading… Parsed Content: ${fileName}</title>
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
          <div><strong>Loading parsed content…</strong></div>
        </div>
        <div class="sub">Fetching parsed text. This window will update automatically.</div>
      </div>
    </body>
    </html>
  `);
  newWindow.document.close();
  return newWindow;
}

// Helper function to open the parsed content window
export function openParsedContentWindow(parsedText, fileName, parseRun, existingWindow = null) {
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

  // Escape raw text before injecting into HTML
  const escapeHtml = (text) =>
    text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

  // Format parameters for display
  const formatParamsForDisplay = (params) => {
    if (!params || Object.keys(params).length === 0) return 'No parameters';
    
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
        displayValue = JSON.stringify(value, null, 2);
      }
      
      paramStrings.push(`${displayKey}: ${displayValue}`);
    });
    
    return paramStrings.join(', ');
  };

  // Generate HTML for the new window
  let html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Parsed Content: ${fileName}</title>
      <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css" crossorigin="anonymous">
      <script src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js" crossorigin="anonymous"><\/script>
      <script src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/contrib/auto-render.min.js" crossorigin="anonymous"><\/script>
      <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"><\/script>
      <style>
        * {
          box-sizing: border-box;
          margin: 0;
          padding: 0;
        }
        
        html, body {
          height: 100%;
          margin: 0;
          background-color: #f5f5f5;
          font-family: Arial, sans-serif;
        }
        
        body {
          min-height: 100vh;
          padding: 20px;
          overflow: hidden;
          display: flex;
          flex-direction: column;
        }
        
        h1 {
          margin-bottom: 20px;
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        
        /* Single grid container for perfect alignment */
        .main-container {
          display: flex;
          flex-direction: column;
          flex: 1;
          min-height: 0;
          width: 100%;
        }
        
        .header-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 15px;
        }
        
        .run-info {
          background: white;
          border: 1px solid #ddd;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
          border-radius: 8px;
          padding: 15px;
          margin-bottom: 20px;
        }
        
        .run-info.concise {
          padding: 10px;
          margin-bottom: 10px;
        }
        
        .run-info h2 {
          margin-bottom: 10px;
          font-size: 18px;
        }
        
        .run-info.concise h2 {
          margin-bottom: 8px;
          font-size: 16px;
        }
        
        .run-details {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
          gap: 15px;
          font-size: 14px;
        }
        
        .run-details.concise {
          display: flex;
          flex-wrap: wrap;
          gap: 15px;
          font-size: 12px;
          align-items: center;
        }
        
        .detail-item {
          display: flex;
          align-items: baseline;
          gap: 6px;
          font-size: 12px;
          line-height: 1.4;
        }
        
        .detail-item.parameters-item {
          width: 100%;
          margin-top: 5px;
        }
        
        .detail-label {
          font-weight: bold;
          color: #666;
          margin-bottom: 5px;
        }
        
        .run-details.concise .detail-label {
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: #5f6368;
          font-weight: 600;
          line-height: 1.4;
          flex-shrink: 0;
          vertical-align: baseline;
        }
        
        .detail-value {
          color: #333;
        }
        
        .run-details.concise .detail-value {
          font-size: 12px;
          color: #1976d2;
          font-weight: 500;
          line-height: 1.4;
          vertical-align: baseline;
        }
        
        .text-container {
          background: white;
          border: 1px solid #ddd;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
          border-radius: 8px;
          padding: 20px;
          flex: 1;
          min-height: 0;
          overflow: auto;
          scrollbar-width: thin;
        }
        
        .chunk-text {
          font-family: 'Courier New', Courier, monospace;
          font-size: 14px;
          line-height: 1.5;
          white-space: pre-wrap;
          word-wrap: break-word;
          margin: 0;
        }
        
        /* Rendered markdown styles */
        .markdown-content {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
          font-size: 15px;
          line-height: 1.7;
          color: #24292e;
        }
        .markdown-content h1, .markdown-content h2, .markdown-content h3,
        .markdown-content h4, .markdown-content h5, .markdown-content h6 {
          margin-top: 1.2em; margin-bottom: 0.6em; font-weight: 600; line-height: 1.3;
        }
        .markdown-content h1 { font-size: 1.8em; border-bottom: 1px solid #eaecef; padding-bottom: 0.3em; }
        .markdown-content h2 { font-size: 1.5em; border-bottom: 1px solid #eaecef; padding-bottom: 0.3em; }
        .markdown-content h3 { font-size: 1.25em; }
        .markdown-content p { margin-bottom: 0.8em; }
        .markdown-content ul, .markdown-content ol { padding-left: 2em; margin-bottom: 0.8em; }
        .markdown-content li { margin-bottom: 0.3em; }
        .markdown-content code {
          background: #f6f8fa; padding: 0.15em 0.4em; border-radius: 3px;
          font-family: 'SFMono-Regular', Consolas, 'Courier New', monospace; font-size: 0.9em;
        }
        .markdown-content pre {
          background: #f6f8fa; padding: 14px; border-radius: 6px; overflow-x: auto;
          margin-bottom: 0.8em; border: 1px solid #e1e4e8;
        }
        .markdown-content pre code { background: none; padding: 0; font-size: 0.85em; }
        .markdown-content blockquote {
          border-left: 4px solid #dfe2e5; padding: 0.5em 1em; margin: 0.8em 0; color: #6a737d;
        }
        .markdown-content table { border-collapse: collapse; margin-bottom: 0.8em; width: 100%; }
        .markdown-content th, .markdown-content td {
          border: 1px solid #dfe2e5; padding: 6px 13px; text-align: left;
        }
        .markdown-content th { background: #f6f8fa; font-weight: 600; }
        .markdown-content tr:nth-child(even) { background: #f9fafb; }
        .markdown-content img { max-width: 100%; }
        .markdown-content hr { border: none; border-top: 1px solid #eaecef; margin: 1.5em 0; }
        .markdown-content a { color: #0366d6; text-decoration: none; }
        .markdown-content a:hover { text-decoration: underline; }
        .markdown-content .katex-display { overflow-x: auto; overflow-y: hidden; margin: 0.8em 0; }
        .markdown-content .katex { font-size: 1.1em; }
        
        /* Toggle switch */
        .toggle-bar {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .toggle-label {
          font-size: 13px;
          color: #555;
          user-select: none;
          cursor: pointer;
        }
        .toggle-switch {
          position: relative;
          width: 40px;
          height: 22px;
          flex-shrink: 0;
        }
        .toggle-switch input {
          opacity: 0;
          width: 0;
          height: 0;
        }
        .toggle-slider {
          position: absolute;
          cursor: pointer;
          inset: 0;
          background-color: #ccc;
          border-radius: 22px;
          transition: background-color 0.25s;
        }
        .toggle-slider::before {
          content: "";
          position: absolute;
          height: 16px;
          width: 16px;
          left: 3px;
          bottom: 3px;
          background-color: white;
          border-radius: 50%;
          transition: transform 0.25s;
        }
        .toggle-switch input:checked + .toggle-slider {
          background-color: #1976d2;
        }
        .toggle-switch input:checked + .toggle-slider::before {
          transform: translateX(18px);
        }
        
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
        
        .params-container {
          background: #f9f9f9;
          border-radius: 4px;
          padding: 10px;
          margin-top: 5px;
          font-family: 'Courier New', Courier, monospace;
          font-size: 12px;
          white-space: pre-wrap;
          border: 1px solid #eee;
        }
        
        .params-container.concise {
          padding: 6px 8px;
          margin-top: 3px;
          font-size: 11px;
          max-height: 120px;
          overflow: auto;
          scrollbar-width: thin;
          background: #f3f4f6;
          border-color: #e5e7eb;
        }
        
        .params-container.concise::-webkit-scrollbar {
          width: 6px;
          height: 6px;
        }
        
        .params-container.concise::-webkit-scrollbar-track {
          background: #f0f0f0;
          border-radius: 3px;
        }
        
        .params-container.concise::-webkit-scrollbar-thumb {
          background: #ccc;
          border-radius: 3px;
        }
        
        /* Add separator between detail items */
        .detail-item:not(:last-child)::after {
          content: "|";
          color: #e5e7eb;
          font-size: 14px;
          margin-left: 15px;
        }
        
        /* Don't show separator before parameters section */
        .detail-item.parameters-item::before,
        .detail-item.parameters-item::after {
          display: none;
        }
      </style>
    </head>
    <body>
      <h1>
        <span>Parsed Content: ${escapeHtml(fileName)}</span>
        <div class="toggle-bar">
          <label class="toggle-label" for="mdToggle">Render Markdown</label>
          <label class="toggle-switch">
            <input type="checkbox" id="mdToggle" />
            <span class="toggle-slider"></span>
          </label>
        </div>
      </h1>
      <div class="main-container">
        <div class="run-info concise">
          <h2>Parse Run Details</h2>
          <div class="run-details concise">
            <div class="detail-item">
              <span class="detail-label">Run ID</span>
              <span class="detail-value">${parseRun.id}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">Parser</span>
              <span class="detail-value">${escapeHtml(parseRun.parser)}</span>
            </div>
            ${Object.keys(parseRun.parameters).length > 0 ? `
            <div class="detail-item">
              <span class="detail-label">Parameters</span>
              <span class="detail-value">${escapeHtml(formatParamsForDisplay(parseRun.parameters))}</span>
            </div>
            ` : ''}
            <div class="detail-item">
              <span class="detail-label">Time</span>
              <span class="detail-value">${new Date(parseRun.time).toLocaleString()}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">Time Usage</span>
              <span class="detail-value">${formatTimeUsage(parseRun.time_usage)}</span>
            </div>
          </div>
        </div>
        <div class="text-container">
          <div id="rawView" class="chunk-text">${escapeHtml(parsedText)}</div>
          <div id="mdView" class="markdown-content" style="display:none;"></div>
        </div>
      </div>
      <script>
        (function() {
          var rawText = document.getElementById('rawView').textContent;
          var mdView  = document.getElementById('mdView');
          var rawView = document.getElementById('rawView');
          var toggle  = document.getElementById('mdToggle');

          // Pre-render markdown once the library loads
          function renderMd() {
            if (typeof marked !== 'undefined') {
              mdView.innerHTML = marked.parse(rawText);
              if (typeof renderMathInElement !== 'undefined') {
                renderMathInElement(mdView, {
                  delimiters: [
                    {left: '$$', right: '$$', display: true},
                    {left: '$', right: '$', display: false},
                    {left: '\\\\[', right: '\\\\]', display: true},
                    {left: '\\\\(', right: '\\\\)', display: false}
                  ],
                  throwOnError: false
                });
              }
            } else {
              mdView.innerHTML = '<p style="color:#b00020;">Failed to load markdown renderer.</p>';
            }
          }

          toggle.addEventListener('change', function() {
            if (toggle.checked) {
              renderMd();
              rawView.style.display = 'none';
              mdView.style.display  = 'block';
            } else {
              rawView.style.display = 'block';
              mdView.style.display  = 'none';
            }
          });
        })();
      <\/script>
    </body>
    </html>
  `;
  
  // Write HTML to the new window
  newWindow.document.open();
  newWindow.document.write(html);
  newWindow.document.close();
}
