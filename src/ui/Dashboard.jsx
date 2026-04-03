import React, { useState, useEffect } from 'react';
import useKnowledgebaseStore, { fetchWithAuth } from './store';
import parserConfig from './parserConfig.json';
import './Dashboard.css';
import GraphView from './GraphView';
import Playground from './Playground';

// Parser order from parser settings (first occurrence across file types)
const PARSER_ORDER = (() => {
  const seen = new Set();
  const order = [];
  for (const parser of Object.values(parserConfig.parsers || {})) {
    for (const f of parser.frameworks || []) {
      if (!seen.has(f.name)) {
        seen.add(f.name);
        order.push(f.name);
      }
    }
  }
  return order;
})();

const Dashboard = ({ mainViewApi = null }) => {
  const { knowledgebases } = useKnowledgebaseStore();
  const activeKB = knowledgebases.find(kb => kb.is_active) || knowledgebases[0];

  const [activeView, setActiveView] = useState('graph'); // 'parse' | 'graph' | 'playground'
  const [parseDuration, setParseDuration] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (activeKB) {
      if (activeView === 'parse') fetchParseDuration(activeKB.id);
    } else {
      setIsLoading(false);
      setParseDuration([]);
    }
  }, [activeKB?.id, activeView]);

  const fetchParseDuration = async (kbId) => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetchWithAuth(`/api/knowledgebase/${kbId}/parse-duration`);
      const data = await response.json();
      if (data.success && data.parse_duration) {
        setParseDuration(data.parse_duration);
      } else {
        setParseDuration([]);
      }
    } catch (err) {
      console.error('Error fetching parse duration:', err);
      setError(err.message || 'Failed to load parse duration');
      setParseDuration([]);
    } finally {
      setIsLoading(false);
    }
  };

  const formatTimeUsage = (seconds) => {
    if (seconds === null || seconds === undefined || Number.isNaN(Number(seconds))) {
      return '–';
    }
    return `${Number(seconds).toFixed(3)}s`;
  };

  // Pivot: rows = files, columns = parsers (order from parser settings)
  const pivotData = () => {
    const fileMap = new Map(); // filepath -> { filename, parsers: { parser: time_usage } }
    const parserSet = new Set();
    for (const row of parseDuration) {
      parserSet.add(row.parser || 'unknown');
      if (!fileMap.has(row.filepath)) {
        fileMap.set(row.filepath, { filename: row.filename, parsers: {} });
      }
      const entry = fileMap.get(row.filepath);
      entry.parsers[row.parser || 'unknown'] = row.time_usage;
    }
    const parsers = [...PARSER_ORDER.filter(p => parserSet.has(p)), ...[...parserSet].filter(p => !PARSER_ORDER.includes(p))];
    const rows = [...fileMap.entries()].map(([filepath, { filename, parsers: p }]) => ({
      filepath,
      filename,
      parsers: p
    }));
    return { rows, parsers };
  };

  const { rows, parsers } = parseDuration.length > 0 ? pivotData() : { rows: [], parsers: [] };

  if (!activeKB) {
    return (
      <div className="dashboard">
        <div className="dashboard-empty">No active knowledgebase. Select or create one first.</div>
      </div>
    );
  }

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <div>
          <p className="dashboard-subtitle">Knowledgebase: {activeKB.name}</p>
        </div>
        <div className="dashboard-view-tabs">
          <button
            className={`view-tab ${activeView === 'graph' ? 'active' : ''}`}
            onClick={() => setActiveView('graph')}
          >
            Graph View
          </button>
          <button
            className={`view-tab ${activeView === 'playground' ? 'active' : ''}`}
            onClick={() => setActiveView('playground')}
          >
            Playground
          </button>
          <button
            className={`view-tab ${activeView === 'parse' ? 'active' : ''}`}
            onClick={() => setActiveView('parse')}
          >
            Parse Duration
          </button>
        </div>
      </div>

      {activeView === 'parse' && error && <div className="dashboard-error">{error}</div>}

      {activeView === 'playground' ? (
        <Playground />
      ) : activeView === 'graph' ? (
        <GraphView mainViewApi={mainViewApi} />
      ) : isLoading ? (
        <div className="dashboard-loading">Loading parse duration...</div>
      ) : rows.length === 0 ? (
        <div className="dashboard-empty">No parsed files in this knowledgebase.</div>
      ) : (
        <div className="dashboard-table-wrap">
          <table className="dashboard-table">
            <thead>
              <tr>
                <th>File</th>
                {parsers.map((p) => (
                  <th key={p} className="col-parser-header">{p}</th>
                ))}
                <th>Path</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => (
                <tr key={idx}>
                  <td className="col-filename">{row.filename}</td>
                  {parsers.map((p) => (
                    <td key={p} className="col-duration">{formatTimeUsage(row.parsers[p])}</td>
                  ))}
                  <td className="col-path">{row.filepath}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
