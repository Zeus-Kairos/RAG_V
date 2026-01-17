import './index.css';
import { useEffect } from 'react';
import useKnowledgebaseStore from './store';
import KnowledgebaseBrowser from './KnowledgebaseBrowser';

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

  // Show main app - focusing only on knowledgebase management
  return (
    <div>
      <KnowledgebaseBrowser />
    </div>
  );
}

export default App