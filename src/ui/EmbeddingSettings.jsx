import React, { useState, useEffect } from 'react';
import useKnowledgebaseStore from './store';
import useRetrievalStore from './retrievalStore';
import './EmbeddingSettings.css';

const EmbeddingSettings = () => {
  const { 
    embeddingConfigs, 
    activeEmbeddingConfig, 
    fetchEmbeddingConfigs, 
    createEmbeddingConfig, 
    updateEmbeddingConfig, 
    deleteEmbeddingConfig, 
    setActiveEmbeddingConfig 
  } = useKnowledgebaseStore();
  
  // Retriever settings
  const { 
    retrieverType, 
    setRetrieverType, 
    k, 
    setK 
  } = useRetrievalStore();
  
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingConfig, setEditingConfig] = useState(null);
  const [configForm, setConfigForm] = useState({
    config_id: 'text-embedding-ada-002',
    embedding_provider: 'openai',
    embedding_model: 'text-embedding-ada-002',
    embedding_api_key: '',
    embedding_base_url: ''
  });
  
  // No need to fetch embedding configs on mount - they're already fetched in initializeApp()
  
  const handleAddConfig = () => {
    const defaultModel = 'text-embedding-ada-002';
    setConfigForm({
      config_id: defaultModel,
      embedding_provider: 'openai',
      embedding_model: defaultModel,
      embedding_api_key: '',
      embedding_base_url: ''
    });
    setShowAddModal(true);
  };
  
  const handleEditConfig = (config) => {
    setEditingConfig(config);
    setConfigForm({
      config_id: config.config_id || config.embedding_model,
      embedding_provider: config.embedding_provider,
      embedding_model: config.embedding_model,
      embedding_api_key: config.embedding_api_key,
      embedding_base_url: config.embedding_base_url || ''
    });
    setShowEditModal(true);
  };
  
  const handleSaveConfig = async () => {
    try {
      if (editingConfig) {
        await updateEmbeddingConfig({
          id: editingConfig.id,
          ...configForm
        });
        setShowEditModal(false);
      } else {
        await createEmbeddingConfig(configForm);
        setShowAddModal(false);
      }
      setEditingConfig(null);
    } catch (error) {
      console.error('Failed to save embedding config:', error);
    }
  };
  
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [configToDelete, setConfigToDelete] = useState(null);

  const handleDeleteConfig = (configId) => {
    setConfigToDelete(configId);
    setShowDeleteDialog(true);
  };

  const confirmDeleteConfig = async () => {
    if (configToDelete) {
      await deleteEmbeddingConfig(configToDelete);
      setShowDeleteDialog(false);
      setConfigToDelete(null);
    }
  };

  const cancelDeleteConfig = () => {
    setShowDeleteDialog(false);
    setConfigToDelete(null);
  };
  
  const handleSetActive = async (configId) => {
    await setActiveEmbeddingConfig(configId);
  };
  
  const handleProviderChange = (provider) => {
    const defaultModel = provider === 'openai' ? 'text-embedding-ada-002' :
                      provider === 'huggingface' ? 'sentence-transformers/all-MiniLM-L6-v2' :
                      provider === 'ollama' ? 'nomic-embed-text' : '';
    setConfigForm(prev => ({
      ...prev,
      embedding_provider: provider,
      // Set default model based on provider
      embedding_model: defaultModel,
      // Update config_id to match new default model
      config_id: defaultModel
    }));
  };
  
  return (
    <>
      {/* Embedding Settings */}
      <div className="embedding-settings">
        <div className="embedding-settings-header">
          <h3>Embedding Settings</h3>
          <button 
            className="embedding-icon-btn add"
            onClick={handleAddConfig}
            title="Add Embedding Configuration"
          >
            +
          </button>
        </div>
        
        <div className="embedding-configs-list">
          {embeddingConfigs.length === 0 ? (
            <div className="embedding-empty">No embedding configurations found</div>
          ) : (
            embeddingConfigs.map(config => (
              <div 
                key={config.id} 
                className={`embedding-config-item ${activeEmbeddingConfig?.id === config.id ? 'active' : ''}`}
                onClick={() => handleSetActive(config.id)}
              >
                <div className="embedding-config-header">
                  <div className="embedding-config-info">
                    <div className="embedding-config-name">{config.embedding_model}</div>
                    <div className="embedding-config-provider">{config.embedding_provider}</div>
                  </div>
                  <div className="embedding-config-actions">
                    <button 
                      className="embedding-icon-btn edit"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleEditConfig(config);
                      }}
                      title="Edit"
                    >
                      ✏️
                    </button>
                    <button 
                      className="embedding-icon-btn delete"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteConfig(config.id);
                      }}
                      title="Delete"
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
      
      {/* Retriever Settings */}
      <div className="retriever-section">
        <div className="retriever-section-header">
          <h3>Retriever Settings</h3>
        </div>
        <div className="retriever-section-content">
          <div className="retriever-setting-item">
            <span className="retriever-setting-label">Retriever Type:</span>
            <div className="retriever-setting-control">
              <select
                className="retriever-type-select"
                value={retrieverType}
                onChange={(e) => setRetrieverType(e.target.value)}
              >
                <option value="vector">Vector</option>
                <option value="bm25">BM25</option>
                <option value="fusion">Fusion</option>
              </select>
            </div>
          </div>
          <div className="retriever-setting-item">
            <span className="retriever-setting-label">k:</span>
            <div className="retriever-setting-control">
              <div className="k-control">
                <input
                  type="range"
                  className="k-slider"
                  min="1"
                  max="50"
                  value={k}
                  onChange={(e) => setK(parseInt(e.target.value))}
                />
                <input
                  type="number"
                  className="k-input"
                  min="1"
                  max="50"
                  value={k}
                  onChange={(e) => setK(parseInt(e.target.value))}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
      
      {/* Add/Edit Modal */}
      {(showAddModal || showEditModal) && (
        <div className="embedding-modal-overlay">
          <div className="embedding-modal">
            <div className="embedding-modal-header">
              <h4>{editingConfig ? 'Edit Embedding Configuration' : 'Add Embedding Configuration'}</h4>
              <button 
                className="embedding-modal-close"
                onClick={() => {
                  setShowAddModal(false);
                  setShowEditModal(false);
                  setEditingConfig(null);
                }}
              >
                ×
              </button>
            </div>
            
            <div className="embedding-modal-body">
              <div className="embedding-form-group">
                <label>Configuration ID</label>
                <input 
                  type="text" 
                  className="embedding-form-input"
                  value={configForm.config_id}
                  onChange={(e) => setConfigForm(prev => ({ ...prev, config_id: e.target.value }))}
                  placeholder="Enter configuration ID"
                  disabled={!!editingConfig}
                />
                {editingConfig && (
                  <div className="embedding-form-hint">
                    Configuration ID cannot be changed after creation
                  </div>
                )}
              </div>
              
              <div className="embedding-form-group">
                <label>Provider</label>
                <select 
                  className="embedding-form-input"
                  value={configForm.embedding_provider}
                  onChange={(e) => handleProviderChange(e.target.value)}
                >
                  <option value="openai">OpenAI</option>
                  <option value="huggingface">Hugging Face</option>
                  <option value="ollama">Ollama</option>
                </select>
              </div>
              
              <div className="embedding-form-group">
                <label>Model</label>
                <input 
                  type="text" 
                  className="embedding-form-input"
                  value={configForm.embedding_model}
                  onChange={(e) => setConfigForm(prev => ({ ...prev, embedding_model: e.target.value }))}
                  placeholder="Enter model name"
                />
              </div>
              
              <div className="embedding-form-group">
                <label>API Key</label>
                <input 
                  type="password" 
                  className="embedding-form-input"
                  value={configForm.embedding_api_key}
                  onChange={(e) => setConfigForm(prev => ({ ...prev, embedding_api_key: e.target.value }))}
                  placeholder="Enter API key"
                />
              </div>
              
              <div className="embedding-form-group">
                <label>Base URL (Optional)</label>
                <input 
                  type="text" 
                  className="embedding-form-input"
                  value={configForm.embedding_base_url}
                  onChange={(e) => setConfigForm(prev => ({ ...prev, embedding_base_url: e.target.value }))}
                  placeholder="Enter custom base URL"
                />
              </div>
            </div>
            
            <div className="embedding-modal-footer">
              <button 
                className="embedding-btn embedding-btn-secondary"
                onClick={() => {
                  setShowAddModal(false);
                  setShowEditModal(false);
                  setEditingConfig(null);
                }}
              >
                Cancel
              </button>
              <button 
                className="embedding-btn embedding-btn-primary"
                onClick={handleSaveConfig}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      {showDeleteDialog && (
        <div className="embedding-modal-overlay">
          <div className="embedding-modal">
            <div className="embedding-modal-header">
              <h4>Delete Embedding Configuration</h4>
              <button 
                className="embedding-modal-close"
                onClick={cancelDeleteConfig}
              >
                ×
              </button>
            </div>
            
            <div className="embedding-modal-body">
              <p>Are you sure you want to delete this embedding configuration?</p>
            </div>
            
            <div className="embedding-modal-footer">
              <button 
                className="embedding-btn embedding-btn-secondary"
                onClick={cancelDeleteConfig}
              >
                Cancel
              </button>
              <button 
                className="embedding-btn embedding-btn-danger"
                onClick={confirmDeleteConfig}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default EmbeddingSettings;
