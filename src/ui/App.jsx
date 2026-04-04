import './index.css';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import useKnowledgebaseStore from './store';
import KnowledgebaseBrowser from './KnowledgebaseBrowser';
import EmbeddingSettings from './EmbeddingSettings';
import SplitterSettings from './SplitterSettings';
import ParserSettings from './ParserSettings';
import ChunkBrowser from './ChunkBrowser';
import RetrievalBrowser from './RetrievalBrowser';
import Dashboard from './Dashboard';
import MainViewTab from './MainViewTab';
import ErrorBoundary from './ErrorBoundary';

function SidebarToggleIcon({ collapsed }) {
  return (
    <svg
      className={`app-sidebar-toggle-icon${collapsed ? ' app-sidebar-toggle-icon--collapsed' : ''}`}
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <path
        fill="currentColor"
        d="M11.41 7.41L10 6l-6 6 6 6 1.41-1.41L5.83 12zm4.59 0L15 6l-6 6 6 6 1.41-1.41L10.42 12z"
      />
    </svg>
  );
}

function App() {
  const { initializeApp, authChecked } = useKnowledgebaseStore();
  const [activeTab, setActiveTab] = useState('knowledgebase'); // 'chunk', 'knowledgebase', or 'retrieval'
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  /** Inline visualization (parsed text / chunk viz) opened from Dashboard graph — top-level tab after Dashboard. */
  const [mainView, setMainView] = useState(null);
  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;

  const beginParsedMainView = useCallback((fileName) => {
    setMainView({
      phase: 'loading',
      headline: fileName,
      hint: 'Fetching parsed text…',
    });
    setActiveTab('view');
  }, []);

  const beginChunksMainView = useCallback((fileName) => {
    setMainView({
      phase: 'loading',
      headline: fileName,
      hint: 'Fetching file text and chunk runs…',
    });
    setActiveTab('view');
  }, []);

  const setMainViewReady = useCallback((html, headline, viewKind, options = {}) => {
    if (activeTabRef.current !== 'view') return;
    setMainView({
      phase: 'ready',
      html,
      headline,
      htmlKey: Date.now(),
      viewKind,
      showChunkOnlyToggle: options.showChunkOnlyToggle === true,
    });
  }, []);

  const setMainViewError = useCallback((headline, message) => {
    if (activeTabRef.current !== 'view') return;
    setMainView({
      phase: 'error',
      headline,
      message,
    });
    setActiveTab('view');
  }, []);

  const mainViewApi = useMemo(
    () => ({
      beginParsedMainView,
      beginChunksMainView,
      setMainViewReady,
      setMainViewError,
    }),
    [beginParsedMainView, beginChunksMainView, setMainViewReady, setMainViewError]
  );

  /** Leaving View clears inline visualization so the View tab disappears. */
  useEffect(() => {
    if (activeTab !== 'view') {
      setMainView(null);
    }
  }, [activeTab]);

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

  const showSidebar = activeTab !== 'dashboard' && activeTab !== 'view';

  // Show main app with sidebar layout
  return (
    <div className={`app-container ${!showSidebar ? 'app-container-no-sidebar' : ''}`}>
      {showSidebar && (
        <aside
          className={`app-sidebar-shell ${sidebarCollapsed ? 'app-sidebar-shell--collapsed' : ''}`}
          aria-label="设置侧边栏"
        >
          <div className="app-sidebar-header">
            <button
              type="button"
              className="app-sidebar-toggle"
              onClick={() => setSidebarCollapsed((c) => !c)}
              aria-expanded={!sidebarCollapsed}
              aria-controls="app-settings-sidebar-panel"
              title={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
            >
              <span className="app-sidebar-toggle__sr">
                {sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
              </span>
              <SidebarToggleIcon collapsed={sidebarCollapsed} />
            </button>
          </div>
          <div id="app-settings-sidebar-panel" className="sidebar app-sidebar-panel">
            {activeTab === 'chunk' && <SplitterSettings />}
            {activeTab === 'knowledgebase' && <ParserSettings />}
            {activeTab === 'retrieval' && <EmbeddingSettings />}
          </div>
        </aside>
      )}
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
          <button 
            className={`tab-btn ${activeTab === 'retrieval' ? 'active' : ''}`}
            onClick={() => setActiveTab('retrieval')}
          >
            Retrieval Browser
          </button>
          <button 
            className={`tab-btn ${activeTab === 'dashboard' ? 'active' : ''}`}
            onClick={() => setActiveTab('dashboard')}
          >
            Dashboard
          </button>
          {mainView && (
            <button
              type="button"
              className={`tab-btn ${activeTab === 'view' ? 'active' : ''}`}
              onClick={() => setActiveTab('view')}
            >
              View
            </button>
          )}
        </div>
        
        {/* Tab Content */}
        <div className="tab-content">
          {activeTab === 'dashboard' && (
            <ErrorBoundary>
              <Dashboard mainViewApi={mainViewApi} />
            </ErrorBoundary>
          )}
          {activeTab === 'view' && mainView && <MainViewTab mainView={mainView} />}
          {activeTab === 'chunk' && <ChunkBrowser />}
          {activeTab === 'knowledgebase' && (
            <ErrorBoundary>
              <KnowledgebaseBrowser mainViewApi={mainViewApi} />
            </ErrorBoundary>
          )}
          {activeTab === 'retrieval' && (
            <ErrorBoundary>
              <RetrievalBrowser />
            </ErrorBoundary>
          )}
        </div>
      </div>
    </div>
  );
}

export default App