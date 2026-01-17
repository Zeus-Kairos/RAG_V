import './index.css';
import { useEffect } from 'react';
import useKnowledgebaseStore from './store';
import KnowledgebaseBrowser from './KnowledgebaseBrowser';
import EmbeddingSettings from './EmbeddingSettings';

function App() {
  const { initializeApp, authChecked } = useKnowledgebaseStore();

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
        <EmbeddingSettings />
      </div>
      <div className="main-content">
        <KnowledgebaseBrowser />
      </div>
    </div>
  );
}

export default App