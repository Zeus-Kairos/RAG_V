import './index.css';
import { useState, useEffect } from 'react';
import useKnowledgebaseStore from './store';
import KnowledgebaseBrowser from './KnowledgebaseBrowser';
import EmbeddingSettings from './EmbeddingSettings';
import SplitterSettings from './SplitterSettings';
import ParserSettings from './ParserSettings';
import ChunkBrowser from './ChunkBrowser';

function App() {
  const { initializeApp, authChecked } = useKnowledgebaseStore();
  const [activeTab, setActiveTab] = useState('knowledgebase'); // 'chunk' or 'knowledgebase'

  // Initialize the app when it loads
  useEffect(() => {
    const init = async () => {
      await initializeApp();
    };
    
    init();
  }, [initializeApp]);

  // Show loading while initialization is happening
  if (!authChecked) {
    return <div className="loading">Loading...</div>;
  }

  // Show main app with sidebar layout
  return (
    <div className="app-container">
      <div className="sidebar">
        {activeTab === 'chunk' && <SplitterSettings />}
        {activeTab === 'knowledgebase' && <ParserSettings />}
        {activeTab === 'chunk' && <EmbeddingSettings />}
      </div>
      <div className="main-content">
        {/* Tab Navigation */}
        <div className="main-tabs">
          <button 
            className={`tab-btn ${activeTab === 'knowledgebase' ? 'active' : ''}`}
            onClick={() => setActiveTab('knowledgebase')}
          >
            Knowledgebase Browser
          </button>
          <button 
            className={`tab-btn ${activeTab === 'chunk' ? 'active' : ''}`}
            onClick={() => setActiveTab('chunk')}
          >
            Chunk Browser
          </button>
        </div>
        
        {/* Tab Content */}
        <div className="tab-content">
          {activeTab === 'chunk' && <ChunkBrowser />}
          {activeTab === 'knowledgebase' && <KnowledgebaseBrowser />}
        </div>
      </div>
    </div>
  );
}

export default App