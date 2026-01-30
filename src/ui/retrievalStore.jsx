import { create } from 'zustand';
import { fetchWithAuth } from './store';

// Mock data for demonstration purposes
const mockIndexRuns = [
  {
    id: 1,
    time: new Date().toISOString(),
    status: 'completed',
    files_indexed: 5,
    embedding_config: 'text-embedding-ada-002',
    duration: '10 seconds'
  },
  {
    id: 2,
    time: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    status: 'completed',
    files_indexed: 3,
    embedding_config: 'text-embedding-ada-002',
    duration: '5 seconds'
  },
  {
    id: 3,
    time: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
    status: 'failed',
    files_indexed: 0,
    embedding_config: 'text-embedding-ada-002',
    duration: '2 seconds',
    error: 'API key not found'
  }
];

const mockRetrievalResults = [
  {
    id: 1,
    document_id: 123,
    document_name: 'Sample Document 1',
    relevance_score: 0.95,
    snippet: 'This is a sample document about artificial intelligence and machine learning techniques...',
    file_path: 'documents/sample1.pdf'
  },
  {
    id: 2,
    document_id: 124,
    document_name: 'Sample Document 2',
    relevance_score: 0.87,
    snippet: 'Machine learning models require large amounts of data to train effectively...',
    file_path: 'documents/sample2.pdf'
  },
  {
    id: 3,
    document_id: 125,
    document_name: 'Sample Document 3',
    relevance_score: 0.75,
    snippet: 'Natural language processing is a subfield of artificial intelligence...',
    file_path: 'documents/sample3.pdf'
  }
];

const useRetrievalStore = create((set, get) => {
  return {
    // Initial state
    retrievalResults: [],
    indexRuns: mockIndexRuns,
    isIndexing: false,
    currentQuery: '',
    
    // Action functions
    setCurrentQuery: (query) => {
      set({ currentQuery: query });
    },
    
    runIndexing: async () => {
      try {
        set({ isIndexing: true, error: null });
        
        // Simulate API call with delay
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Add new mock index run
        const newRun = {
          id: mockIndexRuns.length + 1,
          time: new Date().toISOString(),
          status: 'completed',
          files_indexed: Math.floor(Math.random() * 10) + 1,
          embedding_config: 'text-embedding-ada-002',
          duration: `${Math.floor(Math.random() * 15) + 1} seconds`
        };
        
        set({ 
          indexRuns: [newRun, ...get().indexRuns],
          isIndexing: false 
        });
      } catch (error) {
        console.error('Error running indexing:', error);
        set({ 
          error: 'Failed to run indexing: ' + error.message, 
          isIndexing: false 
        });
      }
    },
    
    queryDocuments: async (query) => {
      try {
        set({ isLoading: true, error: null });
        
        // Simulate API call with delay
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Use mock data for results
        set({ 
          retrievalResults: mockRetrievalResults,
          currentQuery: query,
          isLoading: false 
        });
      } catch (error) {
        console.error('Error querying documents:', error);
        set({ 
          error: 'Failed to query documents: ' + error.message, 
          isLoading: false 
        });
      }
    },
    
    fetchIndexRuns: async () => {
      try {
        set({ isLoading: true, error: null });
        
        // Simulate API call with delay
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Use mock data for index runs
        set({ 
          indexRuns: mockIndexRuns,
          isLoading: false 
        });
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
    }
  };
});

export default useRetrievalStore;