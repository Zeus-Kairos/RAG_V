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

  // View parsed content for a parse run
  const handleViewParseRun = (parseRunId, item) => {
    if (item.type === 'file') {
      // Set selected file for the chunk run history panel
      setSelectedFileId(item.id);
      setSelectedFileName(item.name);
      setShowChunkRunPanel(true);
      // Close the popup
      onClose();
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
              📑 View Parsed Content
            </button>
          )}
          <button 
            className="dialog-danger"
            onClick={() => handleDeleteParseRun(parseRun.id)}
            disabled={isLoading}
          >
            🗑️ Delete Parse Run
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