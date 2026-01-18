import React from 'react';
import useKnowledgebaseStore from './store';
import './SplitterSettings.css';

const SplitterSettings = () => {
  const { 
    splitterSettings, 
    toggleSplitter, 
    updateMarkdownSettings, 
    updateRecursiveSettings 
  } = useKnowledgebaseStore();
  
  const { 
    isMarkdownEnabled, 
    isRecursiveEnabled, 
    markdownSettings, 
    recursiveSettings 
  } = splitterSettings;
  
  // Handle splitter toggle
  const handleSplitterToggle = (splitterType, isEnabled) => {
    toggleSplitter(splitterType, isEnabled);
  };
  
  // Handle markdown settings change
  const handleMarkdownSettingChange = (setting, value) => {
    updateMarkdownSettings({ [setting]: value });
  };
  
  // Handle recursive settings change
  const handleRecursiveSettingChange = (setting, value) => {
    updateRecursiveSettings({ [setting]: value });
  };
  
  return (
    <div className="splitter-settings">
      <div className="splitter-settings-header">
        <h3>Splitter Settings</h3>
      </div>
      
      {/* Markdown Splitter Section */}
      <div className="splitter-section">
        <div className="splitter-section-header">
          <div className="splitter-section-title">
            <input
              type="checkbox"
              id="markdown-splitter"
              checked={isMarkdownEnabled}
              onChange={(e) => handleSplitterToggle('markdown', e.target.checked)}
            />
            <label htmlFor="markdown-splitter">Markdown Splitter</label>
          </div>
        </div>
        
        <div className="splitter-section-content">
          <div className="param-group">
            <label htmlFor="header-levels">Header Levels: {markdownSettings.headerLevels}</label>
            <input
              type="range"
              id="header-levels"
              min="1"
              max="10"
              value={markdownSettings.headerLevels}
              onChange={(e) => handleMarkdownSettingChange('headerLevels', parseInt(e.target.value))}
            />
          </div>
          
          <div className="param-group checkbox">
            <input
              type="checkbox"
              id="strip-headers"
              checked={markdownSettings.stripHeaders}
              onChange={(e) => handleMarkdownSettingChange('stripHeaders', e.target.checked)}
            />
            <label htmlFor="strip-headers">Strip Headers</label>
          </div>
        </div>
      </div>
      
      {/* Recursive Character Splitter Section */}
      <div className="splitter-section">
        <div className="splitter-section-header">
          <div className="splitter-section-title">
            <input
              type="checkbox"
              id="recursive-splitter"
              checked={isRecursiveEnabled}
              onChange={(e) => handleSplitterToggle('recursive', e.target.checked)}
            />
            <label htmlFor="recursive-splitter">Recursive Character Splitter</label>
          </div>
        </div>
        
        <div className="splitter-section-content">
          <div className="param-group">
            <label htmlFor="chunk-size">Chunk Size: {recursiveSettings.chunkSize}</label>
            <input
              type="range"
              id="chunk-size"
              min="50"
              max="10000"
              value={recursiveSettings.chunkSize}
              onChange={(e) => handleRecursiveSettingChange('chunkSize', parseInt(e.target.value))}
            />
          </div>
          
          <div className="param-group">
            <label htmlFor="chunk-overlap">Chunk Overlap: {recursiveSettings.chunkOverlap} (max: {Math.floor(recursiveSettings.chunkSize / 2)})</label>
            <input
              type="range"
              id="chunk-overlap"
              min="0"
              max={Math.floor(recursiveSettings.chunkSize / 2)}
              value={recursiveSettings.chunkOverlap}
              onChange={(e) => handleRecursiveSettingChange('chunkOverlap', parseInt(e.target.value))}
            />
          </div>
        </div>
      </div>
      
      <div className="splitter-actions">
        <button className="splitter-btn splitter-btn-primary">
          Save Settings
        </button>
      </div>
    </div>
  );
};

export default SplitterSettings;
