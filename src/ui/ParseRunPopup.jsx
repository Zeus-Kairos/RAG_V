import React from 'react';
import { fetchWithAuth } from './store';

const ParseRunPopup = ({ show, parseRun, item, onClose, onDelete, onView, isLoading, 
  setIsLoading, setError, knowledgebases, fetchDirectoryContents, currentPath, refreshFileBrowser, 
  setSelectedFileId, setSelectedFileName, setShowChunkRunPanel }) => {
  // Delete a parse run
  const handleDeleteParseRun = async (parseRunId) => {
    setIsLoading(true);
    setError('');
    try {
      const activeKB = knowledgebases.find(kb => kb.is_active);
      if (!activeKB) {
        throw new Error('No active knowledgebase found');
      }

      const response = await fetchWithAuth(`/api/parse-run/${parseRunId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || 'Failed to delete parse run');
      }

      // Refresh current directory to show updated parse run info
      const currentViewPath = currentPath.join('/').replace(/^\//, '');
      fetchDirectoryContents(currentViewPath, true);
      refreshFileBrowser(currentViewPath);
      
      // Close the popup
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  // Helper function to open a loading window
  const openLoadingWindow = (fileName) => {
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
  };

  // Helper function to open the parsed content window
  const openParsedContentWindow = (parsedText, fileName, parseRun, existingWindow = null) => {
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
          
          .header-row {
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
        <h1>Parsed Content: ${escapeHtml(fileName)}</h1>
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
              <div class="detail-item">
                <span class="detail-label">Time</span>
                <span class="detail-value">${new Date(parseRun.time).toLocaleString()}</span>
              </div>
              ${Object.keys(parseRun.parameters).length > 0 ? `
              <div class="detail-item parameters-item">
                <span class="detail-label">Parameters</span>
                <div class="detail-value params-container concise">${escapeHtml(formatParamsForDisplay(parseRun.parameters))}</div>
              </div>
              ` : ''}
            </div>
          </div>
          <div class="text-container">
            <div class="chunk-text">${escapeHtml(parsedText)}</div>
          </div>
        </div>
      </body>
      </html>
    `;
    
    // Write HTML to the new window
    newWindow.document.open();
    newWindow.document.write(html);
    newWindow.document.close();
  };

  // Set active parse run
  const handleSetActiveParseRun = async (parseRunId) => {
    setIsLoading(true);
    setError('');
    try {
      const response = await fetchWithAuth(`/api/parse-runs/set-active/${item.id}/${parseRunId}`, {
        method: 'PUT',
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || 'Failed to set active parse run');
      }

      // Refresh the file browser to show updated active status
      const currentViewPath = currentPath.join('/').replace(/^\//, '');
      fetchDirectoryContents(currentViewPath, true);
      refreshFileBrowser(currentViewPath);
      
      // Close the popup
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  // View parsed content for a parse run
  const handleViewParseRun = async (parseRunId, item) => {
    if (item.type === 'file') {
      // Close the popup
      onClose();
      
      // Open loading window
      const loadingWindow = openLoadingWindow(item.name);
      if (!loadingWindow) return;
      
      try {
        // Fetch parsed content from the new API endpoint
        const response = await fetchWithAuth(`/api/parsed-content/${item.id}/${parseRunId}`);
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.message || 'Failed to fetch parsed content');
        }
        
        const data = await response.json();
        if (data.success && data.parsed_content && data.parsed_content.length > 0) {
          // Use the first parsed content item (assuming one per file/run)
          const parsedContent = data.parsed_content[0];
          // Open the parsed content window with the fetched data
          openParsedContentWindow(parsedContent.parsed_text, item.name, parseRun, loadingWindow);
        } else {
          throw new Error('No parsed content found');
        }
      } catch (err) {
        console.error('Error viewing parsed content:', err);
        try {
          loadingWindow.document.title = `Failed: Parsed Content: ${item.name}`;
          loadingWindow.document.body.innerHTML = `
            <div style="font-family: Arial, sans-serif; padding: 24px;">
              <h2 style="margin-bottom: 12px; color: #b00020;">Failed to load parsed content</h2>
              <div style="color:#666;">${String(err?.message ?? err)}</div>
            </div>
          `;
        } catch (e) {
          // ignore
        }
      }
    }
  };
  if (!show || !parseRun || !item) {
    return null;
  }

  return (
    <div className="kb-dialog-overlay">
      <div className="kb-dialog" style={{ maxWidth: '500px' }}>
        <div className="dialog-header">
          <h3>Parse Run Details</h3>
          <button 
            className="dialog-close"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <div className="dialog-body">
          <div className="parse-run-details">
            <div className="detail-item">
              <span className="detail-label">Item:</span>
              <span className="detail-value">
                {item.name} ({item.type})
              </span>
            </div>
            <div className="detail-item">
              <span className="detail-label">Run ID:</span>
              <span className="detail-value">{parseRun.id}</span>
            </div>
            <div className="detail-item">
              <span className="detail-label">Time:</span>
              <span className="detail-value">
                {new Date(parseRun.time).toLocaleString()}
              </span>
            </div>
            <div className="detail-item">
              <span className="detail-label">Parser:</span>
              <span className="detail-value">{parseRun.parser}</span>
            </div>
            {/* Only show Parameters if it's not an empty object */}
            {Object.keys(parseRun.parameters).length > 0 && (
              <div className="detail-item">
                <span className="detail-label">Parameters:</span>
                <div className="detail-value json-value">
                  <pre>{JSON.stringify(parseRun.parameters, null, 2)}</pre>
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="dialog-footer">
          {item.type === 'file' && (
            <button 
              className="dialog-primary"
              onClick={() => handleViewParseRun(parseRun.id, item)}
            >
              📑 View
            </button>
          )}
          <button 
            className="dialog-secondary"
            onClick={() => handleSetActiveParseRun(parseRun.id)}
            disabled={isLoading}
          >
            ✅ Set Active
          </button>
          <button 
            className="dialog-danger"
            onClick={() => handleDeleteParseRun(parseRun.id)}
            disabled={isLoading}
          >
            🗑️ Delete
          </button>
          <button 
            onClick={onClose}
            disabled={isLoading}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default ParseRunPopup;