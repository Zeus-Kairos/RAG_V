import React from 'react';
import useKnowledgebaseStore from './store';
import './ParserSettings.css';

const ParserSettings = () => {
  const {
    parserSettings,
    updateParserFramework,
    updateParserParams
  } = useKnowledgebaseStore();

  // Handle framework change
  const handleFrameworkChange = (fileType, framework) => {
    updateParserFramework(fileType, framework);
  };

  // Handle parameter change
  const handleParamChange = (fileType, paramName, value) => {
    updateParserParams(fileType, { [paramName]: value });
  };

  return (
    <div className="parser-settings">
      <div className="parser-settings-header">
        <h3>Parser Settings</h3>
      </div>

      {/* PDF Parser Section */}
      <div className="parser-section">
        <div className="parser-section-header">
          <h4>PDF Parser</h4>
        </div>
        <div className="parser-section-content">
          <div className="param-group">
            <label htmlFor="pdf-framework">Framework:</label>
            <select
              id="pdf-framework"
              value={parserSettings.pdf.framework}
              onChange={(e) => handleFrameworkChange('pdf', e.target.value)}
            >
              <option value="MarkitDown">MarkitDown</option>
              <option value="unstructured">unstructured</option>
              <option value="pymupdf4llm">pymupdf4llm</option>
            </select>
          </div>

          {/* pymupdf4llm specific parameters */}
          {parserSettings.pdf.framework === 'pymupdf4llm' && (
            <div className="params-subsection">
              <div className="param-group checkbox">
                <input
                  type="checkbox"
                  id="pdf-detect-layout"
                  checked={parserSettings.pdf.params.detectLayout}
                  onChange={(e) => handleParamChange('pdf', 'detectLayout', e.target.checked)}
                />
                <label htmlFor="pdf-detect-layout">Detect Layout</label>
              </div>

              <div className="param-group checkbox">
                <input
                  type="checkbox"
                  id="pdf-use-ocr"
                  checked={parserSettings.pdf.params.useOcr}
                  onChange={(e) => handleParamChange('pdf', 'useOcr', e.target.checked)}
                />
                <label htmlFor="pdf-use-ocr">Use OCR</label>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* DOCX Parser Section */}
      <div className="parser-section">
        <div className="parser-section-header">
          <h4>DOCX Parser</h4>
        </div>
        <div className="parser-section-content">
          <div className="param-group">
            <label htmlFor="docx-framework">Framework:</label>
            <select
              id="docx-framework"
              value={parserSettings.docx.framework}
              onChange={(e) => handleFrameworkChange('docx', e.target.value)}
            >
              <option value="MarkitDown">MarkitDown</option>
              <option value="unstructured">unstructured</option>
            </select>
          </div>
        </div>
      </div>

      {/* PPTX Parser Section */}
      <div className="parser-section">
        <div className="parser-section-header">
          <h4>PPTX Parser</h4>
        </div>
        <div className="parser-section-content">
          <div className="param-group">
            <label htmlFor="pptx-framework">Framework:</label>
            <select
              id="pptx-framework"
              value={parserSettings.pptx.framework}
              onChange={(e) => handleFrameworkChange('pptx', e.target.value)}
            >
              <option value="MarkitDown">MarkitDown</option>
              <option value="unstructured">unstructured</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ParserSettings;
