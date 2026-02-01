import { create } from 'zustand';
import { fetchWithAuth } from './store';

const useRetrievalStore = create((set, get) => {
  return {
    // Initial state
    retrievalResults: [],
    indexRuns: [],
    isIndexing: false,
    currentQuery: '',
    activeKnowledgebase: { name: 'default' }, // Default knowledgebase
    activeChunkRun: null,
    activeEmbeddingConfig: null,
    // Retriever settings
    retrieverType: 'vector',
    k: 5,
    
    // Action functions
    setCurrentQuery: (query) => {
      set({ currentQuery: query });
    },
    
    setRetrieverType: (type) => {
      set({ retrieverType: type });
    },
    
    setK: (value) => {
      set({ k: value });
    },
    
    runIndexing: async () => {
      try {
        set({ isIndexing: true, error: null });
        
        let { activeKnowledgebase, activeChunkRun, activeEmbeddingConfig } = get();
        
        // Ensure we have all required parameters
        if (!activeKnowledgebase || !activeKnowledgebase.name) {
          throw new Error('No active knowledgebase selected');
        }
        
        // Always fetch the latest active chunk run to ensure we're using the most recent one
        await get().fetchActiveChunkRun(activeKnowledgebase.id);
        // Get updated state
        ({ activeChunkRun } = get());
        if (!activeChunkRun || !activeChunkRun.id) {
          throw new Error('No active chunk run selected');
        }
        
        // Always fetch the latest active embedding config to ensure we're using the most recent one
        await get().fetchActiveEmbeddingConfig();
        // Get updated state
        ({ activeEmbeddingConfig } = get());
        if (!activeEmbeddingConfig || !activeEmbeddingConfig.id) {
          throw new Error('No active embedding configuration selected');
        }
        
        // Call the API endpoint
        const kbName = activeKnowledgebase.name;
        const chunkRunId = activeChunkRun.id;
        const embeddingConfigId = activeEmbeddingConfig.id;
        
        const response = await fetchWithAuth(`/api/index-files/${kbName}/${chunkRunId}/${embeddingConfigId}`, {
          method: 'POST'
        });
        
        if (!response.ok) {
          throw new Error(`API error: ${response.statusText}`);
        }
        
        // Process the streaming response
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        
        let result = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          result += chunk;
          
          // Process each line as a JSON object
          const lines = result.split('\n');
          for (const line of lines) {
            if (line.trim()) {
              try {
                const data = JSON.parse(line);
                // Handle the data as needed
                console.log('Indexing progress:', data);
                // Check if data has an error key
                if (data.error) {
                  // Set the error and break out of the loop
                  set({ 
                    error: data.error, 
                    isIndexing: false 
                  });
                  // Close the reader and break
                  reader.cancel();
                  return;
                }
              } catch (e) {
                console.error('Error parsing JSON:', e);
              }
            }
          }
          result = lines[lines.length - 1];
        }
        
        try {
          // Fetch the updated index runs from the API
          await get().fetchIndexRuns(activeKnowledgebase?.id);
          
          set({ 
            isIndexing: false 
          });
        } catch (fetchError) {
          console.error('Error fetching updated index runs:', fetchError);
          set({ 
            error: 'Failed to fetch updated index runs: ' + fetchError.message, 
            isIndexing: false 
          });
        }
      } catch (error) {
        console.error('Error running indexing:', error);
        // Don't overwrite the error if we already set it from the API response
        if (error.name === 'AbortError') {
          // This error is expected when we cancel the reader
          // Just ensure isIndexing is set to false
          set({ isIndexing: false });
        } else {
          // Set the error only if we haven't already set it
          set({ 
            error: 'Failed to run indexing: ' + error.message, 
            isIndexing: false 
          });
        }
      }
    },
    
    queryDocuments: async (query) => {
      try {
        set({ isLoading: true, error: null });
        
        const { activeKnowledgebase, indexRuns, retrieverType, k } = get();
        
        // Ensure we have all required parameters
        if (!activeKnowledgebase || !activeKnowledgebase.name) {
          throw new Error('No active knowledgebase selected');
        }
        
        // Get the latest index run if none is selected
        if (indexRuns.length === 0) {
          throw new Error('No index runs found');
        }
        
        // Use the first index run for now (in UI we'll let user select)
        const selectedIndexRun = indexRuns[0];
        
        // Call the API endpoint
        const response = await fetchWithAuth(
          `/api/retrieve/${activeKnowledgebase.name}/${selectedIndexRun.id}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              query,
              retriever_type: retrieverType,
              k
            })
          }
        );
        
        if (!response.ok) {
          throw new Error(`API error: ${response.statusText}`);
        }
        
        const data = await response.json();
        
        if (data.success) {
          set({ 
            retrievalResults: data.results || [],
            currentQuery: query,
            isLoading: false 
          });
        } else {
          throw new Error(data.message || 'Failed to retrieve documents');
        }
      } catch (error) {
        console.error('Error querying documents:', error);
        set({ 
          error: 'Failed to query documents: ' + error.message, 
          isLoading: false 
        });
      }
    },
    
    fetchIndexRuns: async (kbId = null) => {
      try {
        set({ isLoading: true, error: null });
        
        const { activeKnowledgebase } = get();
        const knowledgebaseId = kbId || activeKnowledgebase?.id || 1; // Use provided ID, then knowledgebase ID, then default to 1
        
        // Call the API endpoint
        const response = await fetchWithAuth(`/api/index-runs/${knowledgebaseId}`);
        
        if (!response.ok) {
          throw new Error(`API error: ${response.statusText}`);
        }
        
        const data = await response.json();
        
        if (data.success) {
          // Use the actual index runs from the API
          set({ 
            indexRuns: data.index_runs || [],
            isLoading: false 
          });
        } else {
          throw new Error(data.message || 'Failed to fetch index runs');
        }
      } catch (error) {
        console.error('Error fetching index runs:', error);
        set({ 
          error: 'Failed to fetch index runs: ' + error.message, 
          isLoading: false 
        });
      }
    },
    
    clearRetrievalResults: () => {
      set({ retrievalResults: [], currentQuery: '' });
    },
    
    clearError: () => {
      set({ error: null });
    },
    
    fetchActiveChunkRun: async (knowledgebaseId = 1) => {
      try {
        const response = await fetchWithAuth(`/api/chunk-runs/${knowledgebaseId}`);
        
        if (!response.ok) {
          throw new Error(`API error: ${response.statusText}`);
        }
        
        const data = await response.json();
        
        if (data.success && data.chunk_runs && data.chunk_runs.length > 0) {
          // Find the active chunk run
          const activeRun = data.chunk_runs.find(run => run.is_active === 1);
          if (activeRun) {
            set({ activeChunkRun: activeRun });
          }
        }
      } catch (error) {
        console.error('Error fetching active chunk run:', error);
      }
    },
    
    fetchActiveEmbeddingConfig: async () => {
      try {
        const response = await fetchWithAuth('/api/embedding_config');
        
        if (!response.ok) {
          throw new Error(`API error: ${response.statusText}`);
        }
        
        const data = await response.json();
        
        if (data.success && data.active_config) {
          set({ activeEmbeddingConfig: data.active_config });
        }
      } catch (error) {
        console.error('Error fetching active embedding config:', error);
      }
    }
  };
});

export default useRetrievalStore;