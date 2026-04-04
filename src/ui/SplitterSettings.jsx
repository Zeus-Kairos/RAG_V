import React from 'react';
import useKnowledgebaseStore from './store';
import SplitterParamFields from './SplitterParamFields';
import {
  getSplitterFrameworks,
  getLangchainPipeline,
  getChonkieChefConfig,
  getChonkieCatalog,
  getFlatFrameworkFieldBlock,
  getFlatFrameworkStoreGroup,
} from './splitterUtils';
import './SplitterSettings.css';

function mapToggleKeyToSplitterType(toggleKey) {
  if (toggleKey === 'isMarkdownEnabled') return 'markdown';
  if (toggleKey === 'isRecursiveEnabled') return 'recursive';
  return null;
}

const SplitterSettings = () => {
  const {
    splitterSettings,
    activeFramework,
    setActiveFramework,
    toggleSplitter,
    updateMarkdownSettings,
    updateRecursiveSettings,
    updateChonkieSettings,
    updateSplitterFlatFramework,
  } = useKnowledgebaseStore();

  const applyLangchainGroupChange = (storeGroup, fieldKey, value) => {
    if (storeGroup === 'markdownSettings') {
      updateMarkdownSettings({ [fieldKey]: value });
    } else if (storeGroup === 'recursiveSettings') {
      updateRecursiveSettings({ [fieldKey]: value });
    }
  };

  const chefConfig = getChonkieChefConfig();
  const chefFields = {
    chef: {
      type: chefConfig.type,
      label: chefConfig.label,
      options: chefConfig.options,
    },
  };
  const flatBlock =
    getFlatFrameworkStoreGroup(activeFramework) && getFlatFrameworkFieldBlock(activeFramework);

  return (
    <div className="splitter-settings">
      <div className="splitter-settings-header">
        <h3>Splitter Settings</h3>

        <div className="splitter-tabs">
          {getSplitterFrameworks().map(({ id, label }) => (
            <button
              key={id}
              type="button"
              className={`tab-btn ${activeFramework === id ? 'active' : ''}`}
              onClick={() => setActiveFramework(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="tab-content">
        {activeFramework === 'langchain' && (
          <>
            {getLangchainPipeline().map((stage) => {
              const groupValues = splitterSettings[stage.storeGroup] || {};
              const st = mapToggleKeyToSplitterType(stage.toggleKey);
              return (
                <div key={stage.apiChunker} className="splitter-section">
                  <div className="splitter-section-header">
                    <div className="splitter-section-title">
                      <input
                        type="checkbox"
                        id={`toggle-${stage.apiChunker}`}
                        checked={!!splitterSettings[stage.toggleKey]}
                        onChange={(e) => st && toggleSplitter(st, e.target.checked)}
                      />
                      <label htmlFor={`toggle-${stage.apiChunker}`}>{stage.sectionLabel}</label>
                    </div>
                  </div>
                  <div className="splitter-section-content">
                    {splitterSettings[stage.toggleKey] ? (
                      <SplitterParamFields
                        fields={stage.fields}
                        values={groupValues}
                        idPrefix={`lc-${stage.apiChunker}`}
                        onChange={(fieldKey, value) =>
                          applyLangchainGroupChange(stage.storeGroup, fieldKey, value)
                        }
                      />
                    ) : null}
                  </div>
                </div>
              );
            })}
          </>
        )}

        {activeFramework === 'chonkie' && (
          <div className="splitter-section">
            <div className="splitter-section-content">
              <SplitterParamFields
                fields={chefFields}
                values={{ chef: splitterSettings.chonkieSettings.chef }}
                idPrefix="chonkie-chef"
                onChange={(fieldKey, value) => updateChonkieSettings({ [fieldKey]: value })}
              />

              <div className="param-group">
                <label>Available Chunkers:</label>
                <div className="checkbox-group">
                  {getChonkieCatalog().map((entry) => (
                    <label key={entry.type} className="checkbox-item">
                      <input
                        type="checkbox"
                        checked={splitterSettings.chonkieSettings.chunkers.some(
                          (c) => c.type === entry.type
                        )}
                        onChange={() => updateChonkieSettings({ toggleChunker: entry.type })}
                      />
                      <span>{entry.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {splitterSettings.chonkieSettings.chunkers.length > 0 && (
                <div className="selected-chunkers-container">
                  <label>Selected Chunkers (Vertical Pipeline):</label>
                  {splitterSettings.chonkieSettings.chunkers.map((chunker, index) => {
                    const catalog = getChonkieCatalog().find((c) => c.type === chunker.type);
                    const fields = catalog?.fields || {
                      chunkSize: {
                        type: 'int',
                        label: 'Chunk Size',
                        ui: 'sliderWithInput',
                        min: 50,
                        max: 10000,
                      },
                    };
                    return (
                      <div key={`${chunker.type}-${index}`} className="chunker-item">
                        <div className="chunker-header">
                          <span className="chunker-type">{chunker.type} Chunker</span>
                        </div>
                        <SplitterParamFields
                          fields={fields}
                          values={chunker.params || {}}
                          idPrefix={`chonkie-${index}`}
                          onChange={(fieldKey, value) => {
                            updateChonkieSettings({
                              chunkerIndex: index,
                              params: { [fieldKey]: value },
                            });
                          }}
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {flatBlock && (
          <div className="splitter-section">
            <div className="splitter-section-content">
              <SplitterParamFields
                fields={flatBlock.fields}
                values={splitterSettings[flatBlock.storeGroup] || {}}
                idPrefix={activeFramework}
                hybridTokenizer={
                  Object.values(flatBlock.fields).some((s) => s.hybridTableSize)
                    ? splitterSettings[flatBlock.storeGroup]?.tableTokenizer || 'row'
                    : undefined
                }
                onChange={(fieldKey, value) =>
                  updateSplitterFlatFramework(activeFramework, { [fieldKey]: value })
                }
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SplitterSettings;
