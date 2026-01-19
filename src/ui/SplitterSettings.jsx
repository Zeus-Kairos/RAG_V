import React, { useState, useEffect } from 'react';
import useKnowledgebaseStore from './store';
import './SplitterSettings.css';

const SplitterSettings = () => {
  const [activeTab, setActiveTab] = useState('Langchain');
  // Local state for input values to prevent immediate sync on every keystroke
  const [localChunkSize, setLocalChunkSize] = useState('');
  const [localChunkOverlap, setLocalChunkOverlap] = useState('');
  
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
  
  // Sync local state with store when store values change
  useEffect(() => {
    setLocalChunkSize(recursiveSettings.chunkSize.toString());
  }, [recursiveSettings.chunkSize]);
  
  useEffect(() => {
    setLocalChunkOverlap(recursiveSettings.chunkOverlap.toString());
  }, [recursiveSettings.chunkOverlap]);
  
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
        
        {/* Tab Navigation */}
        <div className="splitter-tabs">
          <button 
            className={`tab-btn ${activeTab === 'Langchain' ? 'active' : ''}`}
            onClick={() => setActiveTab('Langchain')}
          >
            Langchain
          </button>
          <button 
            className={`tab-btn ${activeTab === 'Chonkie' ? 'active' : ''}`}
            onClick={() => setActiveTab('Chonkie')}
          >
            Chonkie
          </button>
        </div>
      </div>
      
      {/* Tab Content */}
      <div className="tab-content">
        {/* Langchain Tab Content */}
        {activeTab === 'Langchain' && (
          <>
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
                  <label htmlFor="chunk-size" className="param-label-with-input">
                    Chunk Size: 
                    <input
                      type="number"
                      id="chunk-size-input"
                      className="param-text-input-inline"
                      min="50"
                      max="10000"
                      value={localChunkSize}
                      onChange={(e) => setLocalChunkSize(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          let value = parseInt(localChunkSize);
                          if (isNaN(value) || value < 50) value = 50;
                          if (value > 10000) value = 10000;
                          handleRecursiveSettingChange('chunkSize', value);
                        }
                      }}
                      onBlur={() => {
                        let value = parseInt(localChunkSize);
                        if (isNaN(value) || value < 50) value = 50;
                        if (value > 10000) value = 10000;
                        handleRecursiveSettingChange('chunkSize', value);
                      }}
                    />
                  </label>
                  <input
                    type="range"
                    id="chunk-size"
                    className="param-slider"
                    min="50"
                    max="10000"
                    value={recursiveSettings.chunkSize}
                    onChange={(e) => handleRecursiveSettingChange('chunkSize', parseInt(e.target.value))}
                  />
                </div>
                
                <div className="param-group">
                  <label htmlFor="chunk-overlap" className="param-label-with-input">
                    Chunk Overlap: 
                    <input
                      type="number"
                      id="chunk-overlap-input"
                      className="param-text-input-inline"
                      min="0"
                      max={Math.floor(recursiveSettings.chunkSize / 2)}
                      value={localChunkOverlap}
                      onChange={(e) => setLocalChunkOverlap(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          let value = parseInt(localChunkOverlap);
                          const maxOverlap = Math.floor(recursiveSettings.chunkSize / 2);
                          if (isNaN(value) || value < 0) value = 0;
                          if (value > maxOverlap) value = maxOverlap;
                          handleRecursiveSettingChange('chunkOverlap', value);
                        }
                      }}
                      onBlur={() => {
                        let value = parseInt(localChunkOverlap);
                        const maxOverlap = Math.floor(recursiveSettings.chunkSize / 2);
                        if (isNaN(value) || value < 0) value = 0;
                        if (value > maxOverlap) value = maxOverlap;
                        handleRecursiveSettingChange('chunkOverlap', value);
                      }}
                    />
                    <span className="param-max-value"> (max: {Math.floor(recursiveSettings.chunkSize / 2)})</span>
                  </label>
                  <input
                    type="range"
                    id="chunk-overlap"
                    className="param-slider"
                    min="0"
                    max={Math.floor(recursiveSettings.chunkSize / 2)}
                    value={recursiveSettings.chunkOverlap}
                    onChange={(e) => handleRecursiveSettingChange('chunkOverlap', parseInt(e.target.value))}
                  />
                </div>
              </div>
            </div>
          </>
        )}
        
        {/* Chonkie Tab Content - Blank Placeholder */}
        {activeTab === 'Chonkie' && (
          <div className="chonkie-placeholder">
            <p>Chonkie framework settings will be available soon.</p>
          </div>
        )}
      </div>
      

    </div>
  );
};

export default SplitterSettings;
