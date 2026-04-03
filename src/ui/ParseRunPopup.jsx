import React from 'react';
import { fetchWithAuth } from './store';
import {
  openLoadingParsedContentWindow as openLoadingWindow,
  openParsedContentWindow,
  buildParsedContentDocumentHtml,
} from './parsedContentWindow';

const ParseRunPopup = ({
  show,
  parseRun,
  item,
  onClose,
  onDelete,
  onView,
  isLoading,
  setIsLoading,
  setError,
  knowledgebases,
  fetchDirectoryContents,
  currentPath,
  refreshFileBrowser,
  setSelectedFileId,
  setSelectedFileName,
  setShowChunkRunPanel,
  directoryCache,
  setDirectoryCache,
  directoryCacheRef,
  mainViewApi = null,
}) => {
  const formatTimeUsage = (seconds) => {
    if (seconds === null || seconds === undefined || Number.isNaN(Number(seconds))) {
      return 'N/A';
    }
    return `${Number(seconds).toFixed(3)}s`;
  };

  // Delete a parse run
  const handleDeleteParseRun = async (parseRunId) => {
    setIsLoading(true);
    setError('');
    try {
      const activeKB = knowledgebases.find(kb => kb.is_active);
      if (!activeKB) {
        throw new Error('No active knowledgebase found');
      }

      // Construct the path for the DELETE endpoint
      let endpointUrl;
      let fullPath = '';
      
      if (item.name === 'Root' && item.type === 'folder') {
        // For root, use the endpoint without path parameter
        endpointUrl = `/api/parse-runs/${activeKB.name}/${parseRunId}`;
        fullPath = '';
      } else {
        // For other items, construct the full path
        const pathSegments = [...currentPath.slice(1), item.name];
        fullPath = pathSegments.map(segment => encodeURIComponent(segment)).join('/');
        endpointUrl = `/api/parse-runs/${activeKB.name}/${parseRunId}/${fullPath}`;
      }

      const response = await fetchWithAuth(endpointUrl, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || 'Failed to delete parse run');
      }

      // Clear cache for the item and its subitems if it's a folder
      if (item.type === 'folder' && directoryCache && setDirectoryCache && directoryCacheRef) {
        // Build cache key prefix for the folder
        const cachePrefix = `${activeKB.id}:${fullPath}`;
        
        // Function to recursively clear cache for this folder and all subfolders
        const clearCacheRecursively = (cache) => {
          const updatedCache = { ...cache };
          Object.keys(updatedCache).forEach(key => {
            // Delete if the key matches:
            // 1. For root (fullPath is empty): all keys starting with `${activeKB.id}:`
            // 2. For non-root: exact key match or keys starting with `${cachePrefix}/`
            if (fullPath === '' && key.startsWith(cachePrefix)) {
              // Root case: clear all keys for this knowledgebase
              delete updatedCache[key];
            } else if (key === cachePrefix || key.startsWith(`${cachePrefix}/`)) {
              // Non-root case: clear exact match and subfolders
              delete updatedCache[key];
            }
          });
          return updatedCache;
        };
        
        // Clear from state
        setDirectoryCache(prev => clearCacheRecursively(prev));
        
        // Also clear from the ref immediately
        directoryCacheRef.current = clearCacheRecursively(directoryCacheRef.current);
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
    if (item.type !== 'file') return;
    onClose();

    const fetchParsedPayload = async () => {
      const response = await fetchWithAuth(`/api/parsed-content/${item.id}/${parseRunId}`);
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || 'Failed to fetch parsed content');
      }
      const data = await response.json();
      if (data.success && data.parsed_content && data.parsed_content.length > 0) {
        const parsedContent = data.parsed_content[0];
        const parseRunWithContentData = {
          ...parseRun,
          id: parseRunId,
          parser: parsedContent.parser ?? parseRun.parser,
          parameters: parsedContent.parameters ?? parseRun.parameters ?? {},
          time: parsedContent.time ?? parseRun.time,
          time_usage: parsedContent.time_usage ?? parseRun.time_usage,
        };
        return { parsedText: parsedContent.parsed_text, parseRunWithContentData };
      }
      throw new Error('No parsed content found');
    };

    if (mainViewApi) {
      mainViewApi.beginParsedMainView(item.name);
      try {
        const { parsedText, parseRunWithContentData } = await fetchParsedPayload();
        const html = buildParsedContentDocumentHtml(parsedText, item.name, parseRunWithContentData, {
          controlsInParent: true,
        });
        mainViewApi.setMainViewReady(html, item.name, 'parsed');
      } catch (err) {
        console.error('Error viewing parsed content:', err);
        mainViewApi.setMainViewError(item.name, String(err?.message ?? err));
      }
      return;
    }

    const loadingWindow = openLoadingWindow(item.name);
    if (!loadingWindow) return;

    try {
      const { parsedText, parseRunWithContentData } = await fetchParsedPayload();
      openParsedContentWindow(parsedText, item.name, parseRunWithContentData, loadingWindow);
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
            <div className="detail-item">
              <span className="detail-label">Time Usage:</span>
              <span className="detail-value">{formatTimeUsage(parseRun.time_usage)}</span>
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
          {parseRun.is_active ? (
            <div className="dialog-active-badge">
              ✅ Active
            </div>
          ) : (
            <button 
              className="dialog-secondary"
              onClick={() => handleSetActiveParseRun(parseRun.id)}
              disabled={isLoading}
            >
              ✅ Set Active
            </button>
          )}
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