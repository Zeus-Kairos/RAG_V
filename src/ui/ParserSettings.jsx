import React from 'react';
import useKnowledgebaseStore from './store';
import './ParserSettings.css';
import parserConfig from './parserConfig.json';

const ParserSettings = () => {
  const {
    parserSettings,
    updateParserFramework,
    updateParserParams,
    resetParserParams
  } = useKnowledgebaseStore();

  // Get default parameters for a framework
  const getDefaultParams = (fileType, framework) => {
    const parser = parserConfig.parsers[fileType];
    if (!parser) return {};
    
    const frameworkConfig = parser.frameworks.find(f => f.name === framework);
    if (!frameworkConfig || !frameworkConfig.params) return {};
    
    const defaultParams = {};
    Object.entries(frameworkConfig.params).forEach(([paramName, paramConfig]) => {
      defaultParams[paramName] = paramConfig.default;
    });
    return defaultParams;
  };

  // Handle framework change
  const handleFrameworkChange = (fileType, framework) => {
    updateParserFramework(fileType, framework);
    // Reset parameters when framework changes
    resetParserParams(fileType);
    // Set default parameters for the new framework
    const defaultParams = getDefaultParams(fileType, framework);
    updateParserParams(fileType, defaultParams);
  };

  // Handle parameter change
  const handleParamChange = (fileType, paramName, value) => {
    updateParserParams(fileType, { [paramName]: value });
  };

  // Render parameter input based on type
  const renderParamInput = (fileType, paramName, paramConfig) => {
    const currentValue = parserSettings[fileType]?.params?.[paramName] ?? paramConfig.default;
    
    switch (paramConfig.type) {
      case 'boolean':
        return (
          <div className="param-group checkbox">
            <input
              type="checkbox"
              id={`${fileType}-${paramName}`}
              checked={currentValue}
              onChange={(e) => handleParamChange(fileType, paramName, e.target.checked)}
            />
            <label htmlFor={`${fileType}-${paramName}`}>{paramConfig.label}</label>
          </div>
        );
      case 'number':
        return (
          <div className="param-group">
            <label htmlFor={`${fileType}-${paramName}`}>{paramConfig.label}:</label>
            <input
              type="number"
              id={`${fileType}-${paramName}`}
              value={currentValue}
              onChange={(e) => handleParamChange(fileType, paramName, parseInt(e.target.value, 10))}
            />
          </div>
        );
      case 'string':
        return (
          <div className="param-group">
            <label htmlFor={`${fileType}-${paramName}`}>{paramConfig.label}:</label>
            <input
              type="text"
              id={`${fileType}-${paramName}`}
              value={currentValue}
              onChange={(e) => handleParamChange(fileType, paramName, e.target.value)}
            />
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="parser-settings">
      <div className="parser-settings-header">
        <h3>Parser Settings</h3>
      </div>

      {Object.entries(parserConfig.parsers).map(([fileType, parser]) => (
        <div key={fileType} className="parser-section">
          <div className="parser-section-header">
            <h4>{parser.name}</h4>
          </div>
          <div className="parser-section-content">
            <div className="param-group">
              <label htmlFor={`${fileType}-framework`}>Framework:</label>
              <select
                id={`${fileType}-framework`}
                value={parserSettings[fileType]?.framework || parser.defaultFramework}
                onChange={(e) => handleFrameworkChange(fileType, e.target.value)}
              >
                {parser.frameworks.map(framework => (
                  <option key={framework.name} value={framework.name}>
                    {framework.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Framework specific parameters */}
            {parserSettings[fileType]?.framework && (
              <div className="params-subsection">
                {parser.frameworks
                  .find(f => f.name === parserSettings[fileType].framework)
                  ?.params && Object.entries(
                    parser.frameworks
                      .find(f => f.name === parserSettings[fileType].framework)
                      .params
                  ).map(([paramName, paramConfig]) => (
                    <div key={paramName}>
                      {renderParamInput(fileType, paramName, paramConfig)}
                    </div>
                  ))}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
};

export default ParserSettings;
