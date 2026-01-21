import React, { useState, useEffect } from 'react';
import useKnowledgebaseStore from './store';
import './SplitterSettings.css';

const SplitterSettings = () => {
  // Local state for input values to prevent immediate sync on every keystroke
  const [localChunkSize, setLocalChunkSize] = useState('');
  const [localChunkOverlap, setLocalChunkOverlap] = useState('');
  
  const { 
    splitterSettings, 
    activeFramework,
    setActiveFramework,
    toggleSplitter, 
    updateMarkdownSettings, 
    updateRecursiveSettings,
    updateChonkieSettings 
  } = useKnowledgebaseStore();
  
  const { 
    isMarkdownEnabled, 
    isRecursiveEnabled, 
    markdownSettings, 
    recursiveSettings,
    chonkieSettings
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
  
  // Handle Chonkie settings change
  const handleChonkieSettingChange = (setting, value, chunkerIndex) => {
    if (setting === 'params') {
      // Update individual chunker parameters
      updateChonkieSettings({
        chunkerIndex,
        params: value
      });
    } else {
      // Update other settings like toggleChunker
      updateChonkieSettings({ [setting]: value });
    }
  };
  
  return (
    <div className="splitter-settings">
      <div className="splitter-settings-header">
        <h3>Splitter Settings</h3>
        
        {/* Tab Navigation */}
        <div className="splitter-tabs">
          <button 
            className={`tab-btn ${activeFramework === 'langchain' ? 'active' : ''}`}
            onClick={() => setActiveFramework('langchain')}
          >
            Langchain
          </button>
          <button 
            className={`tab-btn ${activeFramework === 'chonkie' ? 'active' : ''}`}
            onClick={() => setActiveFramework('chonkie')}
          >
            Chonkie
          </button>
        </div>
      </div>
      
      {/* Tab Content */}
      <div className="tab-content">
        {/* Langchain Tab Content */}
        {activeFramework === 'langchain' && (
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
        
        {/* Chonkie Tab Content */}
        {activeFramework === 'chonkie' && (
          <div className="splitter-section">
            <div className="splitter-section-header">
              <div className="splitter-section-title">
                <h4>Chonkie Splitter Settings</h4>
              </div>
            </div>
            
            <div className="splitter-section-content">
              {/* Chunker Selection */}
              <div className="param-group">
                <label>Available Chunkers:</label>
                <div className="checkbox-group">
                  <label className="checkbox-item">
                    <input
                      type="checkbox"
                      checked={chonkieSettings.chunkers.some(chunker => chunker.type === 'Sentence')}
                      onChange={(e) => {
                        handleChonkieSettingChange('toggleChunker', 'Sentence');
                      }}
                    />
                    <span>Sentence</span>
                  </label>
                  <label className="checkbox-item">
                    <input
                      type="checkbox"
                      checked={chonkieSettings.chunkers.some(chunker => chunker.type === 'Recursive')}
                      onChange={(e) => {
                        handleChonkieSettingChange('toggleChunker', 'Recursive');
                      }}
                    />
                    <span>Recursive</span>
                  </label>
                  <label className="checkbox-item">
                    <input
                      type="checkbox"
                      checked={chonkieSettings.chunkers.some(chunker => chunker.type === 'Semantic')}
                      onChange={(e) => {
                        handleChonkieSettingChange('toggleChunker', 'Semantic');
                      }}
                    />
                    <span>Semantic</span>
                  </label>
                </div>
              </div>
              
              {/* Selected Chunkers with Individual Parameters - Vertical Layout */}
              {chonkieSettings.chunkers.length > 0 && (
                <div className="selected-chunkers-container">
                  <label>Selected Chunkers (Vertical Pipeline):</label>
                  
                  {chonkieSettings.chunkers.map((chunker, index) => (
                    <div key={index} className="chunker-item">
                      <div className="chunker-header">
                        <span className="chunker-type">{chunker.type} Chunker</span>
                      </div>
                      
                      {/* Chunk Size for this chunker */}
                      <div className="param-group chunker-param">
                        <label className="param-label-with-input">
                          Chunk Size: 
                          <input
                            type="number"
                            className="param-text-input-inline"
                            min="50"
                            max="10000"
                            value={chunker.params.chunkSize}
                            onChange={(e) => {
                              const value = parseInt(e.target.value);
                              if (!isNaN(value)) {
                                handleChonkieSettingChange('params', {
                                  chunkSize: value
                                }, index);
                              }
                            }}
                          />
                        </label>
                        <input
                          type="range"
                          className="param-slider"
                          min="50"
                          max="10000"
                          value={chunker.params.chunkSize}
                          onChange={(e) => {
                            handleChonkieSettingChange('params', {
                              chunkSize: parseInt(e.target.value)
                            }, index);
                          }}
                        />
                      </div>
                      
                      {/* Chunk Overlap - Only for Sentence Chunker */}
                      {chunker.type === 'Sentence' && (
                        <div className="param-group chunker-param">
                          <label className="param-label-with-input">
                            Chunk Overlap: 
                            <input
                              type="number"
                              className="param-text-input-inline"
                              min="0"
                              max={Math.floor(chunker.params.chunkSize / 2)}
                              value={chunker.params.chunkOverlap}
                              onChange={(e) => {
                                const value = parseInt(e.target.value);
                                if (!isNaN(value)) {
                                  handleChonkieSettingChange('params', {
                                    chunkOverlap: value
                                  }, index);
                                }
                              }}
                            />
                            <span className="param-max-value"> (max: {Math.floor(chunker.params.chunkSize / 2)})</span>
                          </label>
                          <input
                            type="range"
                            className="param-slider"
                            min="0"
                            max={Math.floor(chunker.params.chunkSize / 2)}
                            value={chunker.params.chunkOverlap}
                            onChange={(e) => {
                              handleChonkieSettingChange('params', {
                                chunkOverlap: parseInt(e.target.value)
                              }, index);
                            }}
                          />
                        </div>
                      )}
                      
                      {/* Semantic Chunker Parameters */}
                      {chunker.type === 'Semantic' && (
                        <>
                          {/* Threshold */}
                          <div className="param-group chunker-param">
                            <label className="param-label-with-input">
                              Threshold: 
                              <input
                                type="number"
                                className="param-text-input-inline"
                                min="0"
                                max="1"
                                step="0.1"
                                value={chunker.params.threshold}
                                onChange={(e) => {
                                  const value = parseFloat(e.target.value);
                                  if (!isNaN(value)) {
                                    handleChonkieSettingChange('params', {
                                      threshold: value
                                    }, index);
                                  }
                                }}
                              />
                            </label>
                            <input
                              type="range"
                              className="param-slider"
                              min="0"
                              max="1"
                              step="0.1"
                              value={chunker.params.threshold}
                              onChange={(e) => {
                                handleChonkieSettingChange('params', {
                                  threshold: parseFloat(e.target.value)
                                }, index);
                              }}
                            />
                          </div>
                          
                          {/* Similarity Window */}
                          <div className="param-group chunker-param">
                            <label className="param-label-with-input">
                              Similarity Window: 
                              <input
                                type="number"
                                className="param-text-input-inline"
                                min="1"
                                max="10"
                                value={chunker.params.similarityWindow}
                                onChange={(e) => {
                                  const value = parseInt(e.target.value);
                                  if (!isNaN(value)) {
                                    handleChonkieSettingChange('params', {
                                      similarityWindow: value
                                    }, index);
                                  }
                                }}
                              />
                            </label>
                            <input
                              type="range"
                              className="param-slider"
                              min="1"
                              max="10"
                              value={chunker.params.similarityWindow}
                              onChange={(e) => {
                                handleChonkieSettingChange('params', {
                                  similarityWindow: parseInt(e.target.value)
                                }, index);
                              }}
                            />
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      

    </div>
  );
};

export default SplitterSettings;
