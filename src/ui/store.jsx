import { create } from 'zustand';

// Helper function to get token from localStorage
const getToken = () => {
  return localStorage.getItem('token');
};

// Helper function to add auth header to fetch requests
export const fetchWithAuth = async (url, options = {}) => {
  const token = getToken();
  let headers = {
    ...options.headers
  };

  // Don't set Content-Type if body is FormData - browser handles it automatically
  if (!options.body || !(options.body instanceof FormData)) {
    headers['Content-Type'] = headers['Content-Type'] || 'application/json';
  }

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // Use direct backend URL instead of proxy
  const fullUrl = url.startsWith('http') ? url : `http://localhost:8000${url}`;
  
  console.debug('Making API request to:', fullUrl);

  try {
    const response = await fetch(fullUrl, {
      ...options,
      headers
    });

    // Check if response is 401 Unauthorized
    if (response.status === 401) {
      // Token is invalid or expired, remove it and log out
      localStorage.removeItem('token');
      
      // Get the store instance and call logout to reset state
      const store = useKnowledgebaseStore.getState();
      if (store.logout) {
        store.logout();
      }
    }

    return response;
  } catch (fetchError) {
    console.error('Fetch failed for URL:', fullUrl, 'Error:', fetchError);
    throw fetchError;
  }
};

const useKnowledgebaseStore = create((set, get) => {
  return {
    // Initial state
    user_id: null,
    username: null,
    knowledgebases: [],
    isLoading: false,
    isInitializing: false,
    authChecked: false,
    error: null,
    showErrorModal: false,
    fileBrowserRefreshTrigger: 0,
    fileBrowserLastModifiedPath: '',
    // Embedding settings state
    embeddingConfigs: [],
    activeEmbeddingConfig: null,
    // Splitter settings state
    splitterSettings: {
      isMarkdownEnabled: false,
      isRecursiveEnabled: true,
      markdownSettings: {
        headerLevels: 3,
        stripHeaders: false
      },
      recursiveSettings: {
        chunkSize: 1000,
        chunkOverlap: 100
      }
    },

    // Initialize app by getting knowledgebases and embedding configs
    initializeApp: async () => {
      try {
        // Check if we're already initializing or initialized
        const currentState = get();
        if (currentState.isInitializing || currentState.authChecked) {
          // Already initializing or initialized, no need to proceed
          return;
        }
        
        set({ isLoading: true, error: null, isInitializing: true });
        
        // For simplicity, we'll skip auth check for now
        // and directly fetch knowledgebases
        
        // Get all knowledgebases
        const knowledgebasesResponse = await fetchWithAuth('/api/knowledgebase');
        
        let knowledgebases = [];
        if (knowledgebasesResponse.ok) {
          const knowledgebasesData = await knowledgebasesResponse.json();
          knowledgebases = knowledgebasesData.knowledgebases || [];
        }
        
        // Create default knowledgebase if none exist
        if (knowledgebases.length === 0) {
          const createDefaultKBResponse = await fetchWithAuth('/api/knowledgebase', {
            method: 'POST',
            body: JSON.stringify({
              name: 'default',
              description: 'Default knowledgebase'
            })
          });
          
          if (createDefaultKBResponse.ok) {
            // Fetch knowledgebases again to get the newly created one
            const updatedKBsResponse = await fetchWithAuth('/api/knowledgebase');
            if (updatedKBsResponse.ok) {
              const updatedKBsData = await updatedKBsResponse.json();
              knowledgebases = updatedKBsData.knowledgebases || [];
            }
          }
        }
        
        // Get embedding configurations
        const embeddingConfigResponse = await fetchWithAuth('/api/embedding_config');
        let embeddingConfigs = [];
        let activeEmbeddingConfig = null;
        
        if (embeddingConfigResponse.ok) {
          const embeddingConfigData = await embeddingConfigResponse.json();
          embeddingConfigs = embeddingConfigData.configs || [];
          activeEmbeddingConfig = embeddingConfigData.active_config || null;
        }
        
        // Update state with knowledgebases and embedding configs
        set({ 
          knowledgebases,
          embeddingConfigs,
          activeEmbeddingConfig,
          isLoading: false,
          isInitializing: false,
          authChecked: true
        });
        
      } catch (err) {
        console.error('Failed to initialize app:', err);
        set({ 
          isLoading: false, 
          isInitializing: false,
          authChecked: true,
          error: err.message
        });
      }
    },

    // Update the active knowledgebase
    setActiveKnowledgebase: async (kbId) => {
      try {
        set({ isLoading: true, error: null });
        
        // Call API to update active knowledgebase
        const response = await fetchWithAuth(`/api/knowledgebase/${kbId}/active`, {
          method: 'PATCH'
        });
        
        if (response.ok) {
          // Fetch updated knowledgebases
          const kbsResponse = await fetchWithAuth('/api/knowledgebase');
          if (kbsResponse.ok) {
            const kbsData = await kbsResponse.json();
            set({ 
              knowledgebases: kbsData.knowledgebases || [],
              isLoading: false
            });
          }
        }
      } catch (error) {
        console.error('Error updating active knowledgebase:', error);
        set({ 
          error: 'Failed to update active knowledgebase: ' + error.message, 
          isLoading: false,
          showErrorModal: true
        });
        throw error;
      }
    },

    // Set error message
    setError: (error) => {
      set({ error });
    },

    // Show error modal
    showError: (error) => {
      set({ error, showErrorModal: true });
    },

    // Hide error modal
    hideErrorModal: () => {
      set({ showErrorModal: false });
    },
    
    // Reset the store
    resetStore: () => {
      set({
        user_id: null,
        username: null,
        knowledgebases: [],
        isLoading: false,
        error: null,
        authChecked: false
      });
    },
    
    // Trigger file browser refresh
    refreshFileBrowser: (path = '') => {
      set((state) => ({
        fileBrowserRefreshTrigger: (state.fileBrowserRefreshTrigger || 0) + 1,
        fileBrowserLastModifiedPath: path
      }));
    },
    
    // Embedding settings management functions
    fetchEmbeddingConfigs: async () => {
      try {
        set({ isLoading: true, error: null });
        const response = await fetchWithAuth('/api/embedding_config');
        
        if (response.ok) {
          const data = await response.json();
          set({
            embeddingConfigs: data.configs || [],
            activeEmbeddingConfig: data.active_config || null,
            isLoading: false
          });
        }
      } catch (err) {
        console.error('Failed to fetch embedding configs:', err);
        set({ 
          error: 'Failed to fetch embedding configs: ' + err.message, 
          isLoading: false
        });
      }
    },
    
    createEmbeddingConfig: async (config) => {
      try {
        set({ isLoading: true, error: null });
        // Map config_id to id as expected by the API
        const apiConfig = {
          ...config,
          id: config.config_id
        };
        const response = await fetchWithAuth('/api/embedding_config', {
          method: 'PATCH',
          body: JSON.stringify(apiConfig)
        });
        
        if (response.ok) {
          // Fetch updated configs
          await get().fetchEmbeddingConfigs();
        }
      } catch (err) {
        console.error('Failed to create embedding config:', err);
        set({ 
          error: 'Failed to create embedding config: ' + err.message, 
          isLoading: false
        });
        throw err;
      }
    },
    
    updateEmbeddingConfig: async (config) => {
      try {
        set({ isLoading: true, error: null });
        // Map config_id to id as expected by the API
        const apiConfig = {
          ...config,
          id: config.config_id
        };
        const response = await fetchWithAuth('/api/embedding_config', {
          method: 'PATCH',
          body: JSON.stringify(apiConfig)
        });
        
        if (response.ok) {
          // Fetch updated configs
          await get().fetchEmbeddingConfigs();
        }
      } catch (err) {
        console.error('Failed to update embedding config:', err);
        set({ 
          error: 'Failed to update embedding config: ' + err.message, 
          isLoading: false
        });
        throw err;
      }
    },
    
    deleteEmbeddingConfig: async (configId) => {
      try {
        set({ isLoading: true, error: null });
        // Properly encode the configId to handle slashes
        const encodedConfigId = encodeURIComponent(configId);
        const response = await fetchWithAuth(`/api/embedding_config/${encodedConfigId}`, {
          method: 'DELETE'
        });
        
        if (response.ok) {
          // Fetch updated configs after deletion
          await get().fetchEmbeddingConfigs();
        }
      } catch (err) {
        console.error('Failed to delete embedding config:', err);
        set({ 
          error: 'Failed to delete embedding config: ' + err.message, 
          isLoading: false
        });
      }
    },
    
    setActiveEmbeddingConfig: async (configId) => {
      try {
        set({ isLoading: true, error: null });
        // Properly encode the configId to handle slashes
        const encodedConfigId = encodeURIComponent(configId);
        const response = await fetchWithAuth(`/api/embedding_config/${encodedConfigId}/active`, {
          method: 'PATCH'
        });
        
        if (response.ok) {
          // Fetch updated configs
          await get().fetchEmbeddingConfigs();
        }
      } catch (err) {
        console.error('Failed to set active embedding config:', err);
        set({ 
          error: 'Failed to set active embedding config: ' + err.message, 
          isLoading: false
        });
      }
    },
    
    // Splitter settings management functions
    updateSplitterSettings: (newSettings) => {
      set(prev => ({
        splitterSettings: {
          ...prev.splitterSettings,
          ...newSettings
        }
      }));
    },
    
    toggleSplitter: (splitterType, isEnabled) => {
      set(prev => ({
        splitterSettings: {
          ...prev.splitterSettings,
          [splitterType === 'markdown' ? 'isMarkdownEnabled' : 'isRecursiveEnabled']: isEnabled
        }
      }));
    },
    
    updateMarkdownSettings: (settings) => {
      set(prev => ({
        splitterSettings: {
          ...prev.splitterSettings,
          markdownSettings: {
            ...prev.splitterSettings.markdownSettings,
            ...settings
          }
        }
      }));
    },
    
    updateRecursiveSettings: (settings) => {
      set(prev => {
        let updatedSettings = {
          ...prev.splitterSettings,
          recursiveSettings: {
            ...prev.splitterSettings.recursiveSettings,
            ...settings
          }
        };
        
        // Ensure chunkOverlap doesn't exceed half of chunkSize
        if (settings.chunkSize !== undefined) {
          updatedSettings.splitterSettings.recursiveSettings.chunkOverlap = Math.min(
            updatedSettings.splitterSettings.recursiveSettings.chunkOverlap,
            Math.floor(updatedSettings.splitterSettings.recursiveSettings.chunkSize / 2)
          );
        } else if (settings.chunkOverlap !== undefined) {
          updatedSettings.splitterSettings.recursiveSettings.chunkOverlap = Math.min(
            updatedSettings.splitterSettings.recursiveSettings.chunkOverlap,
            Math.floor(updatedSettings.splitterSettings.recursiveSettings.chunkSize / 2)
          );
        }
        
        return updatedSettings;
      });
    },
    
    // Logout function
    logout: () => {
      // Remove token from localStorage
      localStorage.removeItem('token');
      // Reset store state
      set({
        user_id: null,
        username: null,
        knowledgebases: [],
        embeddingConfigs: [],
        activeEmbeddingConfig: null,
        splitterSettings: {
          isMarkdownEnabled: false,
          isRecursiveEnabled: true,
          markdownSettings: {
            headerLevels: 3,
            stripHeaders: false
          },
          recursiveSettings: {
            chunkSize: 1000,
            chunkOverlap: 100
          }
        },
        isLoading: false,
        isInitializing: false,
        authChecked: true,
        error: null
      });
    }
  };
});

export default useKnowledgebaseStore;
