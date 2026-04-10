import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import useKnowledgebaseStore, { fetchWithAuth } from './store';
import useRetrievalStore from './retrievalStore';
import './Evaluation.css';

const QUERY_ENHANCEMENT_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: 'multi-query', label: 'Multi-Query' },
  { value: 'decomposition', label: 'Decomposition' },
  { value: 'step-back', label: 'Step-Back' },
  { value: 'hype', label: 'HyPE' },
  { value: 'hyde', label: 'HyDE' },
];

function toErrMsg(e) {
  return e?.message || String(e);
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function MetricGrid({ metrics }) {
  const keys = useMemo(() => Object.keys(metrics || {}), [metrics]);
  if (!metrics || keys.length === 0) return null;
  return (
    <div className="eval-metric-grid" role="group" aria-label="Evaluation metrics summary">
      {keys.map((k) => (
        <div key={k} className="eval-metric-card">
          <div className="eval-metric-name">{k}</div>
          <div className="eval-metric-value">
            {metrics[k] === null || metrics[k] === undefined
              ? '—'
              : Number.isFinite(Number(metrics[k]))
                ? Number(metrics[k]).toFixed(4)
                : String(metrics[k])}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function Evaluation() {
  const { knowledgebases, activeEmbeddingConfig } = useKnowledgebaseStore(
    useShallow((s) => ({
      knowledgebases: s.knowledgebases,
      activeEmbeddingConfig: s.activeEmbeddingConfig,
    })),
  );
  const activeKB = knowledgebases.find((kb) => kb.is_active) || knowledgebases[0] || null;

  const { retrieverType, setRetrieverType, k, setK, queryEnhancement, setQueryEnhancement } = useRetrievalStore(
    useShallow((s) => ({
      retrieverType: s.retrieverType,
      setRetrieverType: s.setRetrieverType,
      k: s.k,
      setK: s.setK,
      queryEnhancement: s.queryEnhancement,
      setQueryEnhancement: s.setQueryEnhancement,
    })),
  );

  const [activeSubTab, setActiveSubTab] = useState('dataset'); // dataset | evaluation | history

  // Dataset state
  const [datasetFile, setDatasetFile] = useState(null);
  const [datasets, setDatasets] = useState([]);
  const [datasetsLoading, setDatasetsLoading] = useState(false);
  const [datasetsError, setDatasetsError] = useState(null);
  const [selectedDatasetId, setSelectedDatasetId] = useState('');
  const [selectedDatasetMeta, setSelectedDatasetMeta] = useState(null);
  const [datasetRows, setDatasetRows] = useState([]);
  const [datasetTotal, setDatasetTotal] = useState(0);
  const [rowsOffset, setRowsOffset] = useState(0);
  const [rowsLimit, setRowsLimit] = useState(50);
  const [rowsLoading, setRowsLoading] = useState(false);
  const [rowsError, setRowsError] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);

  // Evaluation state
  const [chunkRuns, setChunkRuns] = useState([]);
  const [indexRuns, setIndexRuns] = useState([]);
  const [availableRetrievers, setAvailableRetrievers] = useState([]);

  // Evaluation history (persisted runs)
  const [evalRuns, setEvalRuns] = useState([]);
  const [evalRunsLoading, setEvalRunsLoading] = useState(false);
  const [evalRunsError, setEvalRunsError] = useState(null);
  const [selectedRunId, setSelectedRunId] = useState('');
  const [selectedRunMeta, setSelectedRunMeta] = useState(null);
  const [runTitleDraft, setRunTitleDraft] = useState('');
  const [runNoteDraft, setRunNoteDraft] = useState('');
  const [runMetaSaving, setRunMetaSaving] = useState(false);
  const [runMetaSaveError, setRunMetaSaveError] = useState(null);
  const [runDeleting, setRunDeleting] = useState(false);

  const [selectedChunkRunId, setSelectedChunkRunId] = useState('');
  const [selectedIndexRunId, setSelectedIndexRunId] = useState('');
  const [maxRows, setMaxRows] = useState('');

  const [evalRunning, setEvalRunning] = useState(false);
  const [evalError, setEvalError] = useState(null);
  const [evalSummary, setEvalSummary] = useState(null);
  const [evalRows, setEvalRows] = useState([]);
  const [llmInfo, setLlmInfo] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchWithAuth('/api/llm/info');
        const json = await res.json().catch(() => null);
        if (cancelled) return;
        if (res.ok && json?.success) setLlmInfo(json);
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const fetchEvaluationRuns = useCallback(async () => {
    if (!activeKB?.name) return;
    setEvalRunsLoading(true);
    setEvalRunsError(null);
    try {
      const qs = new URLSearchParams({ kb_name: String(activeKB.name), limit: '200' });
      const res = await fetchWithAuth(`/api/evaluation/runs?${qs.toString()}`);
      const text = await res.text();
      const json = safeJsonParse(text);
      if (!res.ok) throw new Error(json?.detail || json?.message || text || res.statusText);
      if (!json?.success) throw new Error(json?.message || 'Failed to load evaluation runs');
      const runs = Array.isArray(json.runs) ? json.runs : [];
      setEvalRuns(runs);
      const picked = selectedRunId ? runs.find((r) => String(r.run_id) === String(selectedRunId)) : null;
      setSelectedRunMeta(picked || null);
      if (picked) {
        setRunTitleDraft(String(picked.title ?? ''));
        setRunNoteDraft(String(picked.note ?? ''));
      }
    } catch (e) {
      setEvalRunsError(toErrMsg(e));
    } finally {
      setEvalRunsLoading(false);
    }
  }, [activeKB?.name, selectedRunId]);

  useEffect(() => {
    if (!selectedRunMeta) {
      setRunTitleDraft('');
      setRunNoteDraft('');
      return;
    }
    setRunTitleDraft(String(selectedRunMeta.title ?? ''));
    setRunNoteDraft(String(selectedRunMeta.note ?? ''));
  }, [selectedRunMeta]);

  const saveRunMeta = useCallback(async () => {
    if (!selectedRunId) return;
    setRunMetaSaving(true);
    setRunMetaSaveError(null);
    try {
      const res = await fetchWithAuth(`/api/evaluation/runs/${encodeURIComponent(String(selectedRunId))}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: runTitleDraft, note: runNoteDraft }),
      });
      const text = await res.text();
      const json = safeJsonParse(text);
      if (!res.ok) throw new Error(json?.detail || json?.message || text || res.statusText);
      if (!json?.success) throw new Error(json?.message || 'Failed to save run metadata');
      await fetchEvaluationRuns();
    } catch (e) {
      setRunMetaSaveError(toErrMsg(e));
    } finally {
      setRunMetaSaving(false);
    }
  }, [fetchEvaluationRuns, runNoteDraft, runTitleDraft, selectedRunId]);

  const deleteRun = useCallback(async () => {
    if (!selectedRunId) return;
    const ok = window.confirm('Delete this evaluation run? This cannot be undone.');
    if (!ok) return;
    setRunDeleting(true);
    setRunMetaSaveError(null);
    try {
      const res = await fetchWithAuth(`/api/evaluation/runs/${encodeURIComponent(String(selectedRunId))}`, {
        method: 'DELETE',
      });
      const text = await res.text();
      const json = safeJsonParse(text);
      if (!res.ok) throw new Error(json?.detail || json?.message || text || res.statusText);
      if (!json?.success) throw new Error(json?.message || 'Failed to delete run');
      setSelectedRunId('');
      setSelectedRunMeta(null);
      await fetchEvaluationRuns();
    } catch (e) {
      setRunMetaSaveError(toErrMsg(e));
    } finally {
      setRunDeleting(false);
    }
  }, [fetchEvaluationRuns, selectedRunId]);

  const exportRunJson = useCallback(async () => {
    if (!selectedRunId) return;
    setEvalError(null);
    try {
      const res = await fetchWithAuth(`/api/evaluation/runs/${encodeURIComponent(String(selectedRunId))}`);
      const text = await res.text();
      const json = safeJsonParse(text);
      if (!res.ok) throw new Error(json?.detail || json?.message || text || res.statusText);
      if (!json?.success) throw new Error(json?.message || 'Failed to export run');
      const run = json.run || {};
      const blob = new Blob([JSON.stringify(run, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `evaluation-run-${String(selectedRunId)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setEvalError(toErrMsg(e));
    }
  }, [selectedRunId]);

  const loadEvaluationRun = useCallback(async () => {
    if (!selectedRunId) return;
    setEvalError(null);
    try {
      const res = await fetchWithAuth(`/api/evaluation/runs/${encodeURIComponent(String(selectedRunId))}`);
      const text = await res.text();
      const json = safeJsonParse(text);
      if (!res.ok) throw new Error(json?.detail || json?.message || text || res.statusText);
      if (!json?.success) throw new Error(json?.message || 'Failed to load evaluation run');
      const run = json.run || null;
      const req = run?.request || {};

      if (req?.dataset_id != null) setSelectedDatasetId(String(req.dataset_id));
      if (req?.chunk_run_id != null) setSelectedChunkRunId(String(req.chunk_run_id));
      if (req?.index_run_id != null) setSelectedIndexRunId(String(req.index_run_id));
      if (req?.retriever_type != null) setRetrieverType(String(req.retriever_type));
      if (req?.query_enhancement != null) setQueryEnhancement(String(req.query_enhancement));
      if (req?.k != null) setK(Math.max(1, Math.min(50, Number(req.k) || 1)));
      setMaxRows(req?.max_rows == null ? '' : String(req.max_rows));

      setEvalSummary(run?.summary || null);
      setEvalRows(Array.isArray(run?.rows) ? run.rows : []);
    } catch (e) {
      setEvalError(toErrMsg(e));
    }
  }, [selectedRunId, setK, setQueryEnhancement, setRetrieverType]);

  const fetchDatasets = useCallback(async () => {
    setDatasetsLoading(true);
    setDatasetsError(null);
    try {
      const res = await fetchWithAuth('/api/evaluation/datasets');
      const text = await res.text();
      const json = safeJsonParse(text);
      if (!res.ok) {
        throw new Error(json?.detail || json?.message || text || res.statusText);
      }
      if (!json?.success) throw new Error(json?.message || 'Failed to load datasets');
      setDatasets(Array.isArray(json.datasets) ? json.datasets : []);
    } catch (e) {
      setDatasetsError(toErrMsg(e));
    } finally {
      setDatasetsLoading(false);
    }
  }, []);

  const fetchDatasetRows = useCallback(
    async (datasetId, offset, limit) => {
      if (!datasetId) return;
      setRowsLoading(true);
      setRowsError(null);
      try {
        const qs = new URLSearchParams({ offset: String(offset || 0), limit: String(limit || 50) });
        const res = await fetchWithAuth(`/api/evaluation/datasets/${encodeURIComponent(datasetId)}?${qs.toString()}`);
        const text = await res.text();
        const json = safeJsonParse(text);
        if (!res.ok) {
          throw new Error(json?.detail || json?.message || text || res.statusText);
        }
        if (!json?.success) throw new Error(json?.message || 'Failed to load dataset');
        setSelectedDatasetMeta(json.dataset || null);
        setDatasetRows(Array.isArray(json.rows) ? json.rows : []);
        setDatasetTotal(Number(json.total || 0));
      } catch (e) {
        setRowsError(toErrMsg(e));
      } finally {
        setRowsLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    void fetchDatasets();
  }, [fetchDatasets]);

  useEffect(() => {
    void fetchEvaluationRuns();
  }, [fetchEvaluationRuns]);

  useEffect(() => {
    if (!selectedDatasetId) return;
    void fetchDatasetRows(selectedDatasetId, rowsOffset, rowsLimit);
  }, [selectedDatasetId, rowsOffset, rowsLimit, fetchDatasetRows]);

  const uploadDataset = useCallback(async () => {
    if (!datasetFile) return;
    setUploading(true);
    setUploadError(null);
    try {
      const fd = new FormData();
      fd.append('file', datasetFile);
      const res = await fetchWithAuth('/api/evaluation/datasets/upload', { method: 'POST', body: fd });
      const text = await res.text();
      const json = safeJsonParse(text);
      if (!res.ok) {
        throw new Error(json?.detail || json?.message || text || res.statusText);
      }
      if (!json?.success) throw new Error(json?.message || 'Upload failed');

      await fetchDatasets();
      const newId = json?.dataset?.dataset_id;
      if (newId) {
        setSelectedDatasetId(String(newId));
        setRowsOffset(0);
      }
      setDatasetFile(null);
    } catch (e) {
      setUploadError(toErrMsg(e));
    } finally {
      setUploading(false);
    }
  }, [datasetFile, fetchDatasets]);

  // Load evaluation parameter options
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [retrRes, chunkRes, idxRes] = await Promise.all([
          fetchWithAuth('/api/retrievers'),
          activeKB?.id ? fetchWithAuth(`/api/chunk-runs/${activeKB.id}`) : Promise.resolve(null),
          activeKB?.id ? fetchWithAuth(`/api/index-runs/${activeKB.id}`) : Promise.resolve(null),
        ]);

        if (retrRes) {
          const j = await retrRes.json().catch(() => null);
          if (!cancelled && retrRes.ok && j?.success && Array.isArray(j.retrievers)) {
            setAvailableRetrievers(j.retrievers);
          }
        }
        if (chunkRes) {
          const j = await chunkRes.json().catch(() => null);
          if (!cancelled && chunkRes.ok && j?.success && Array.isArray(j.chunk_runs)) {
            setChunkRuns(j.chunk_runs);
            const activeRun =
              j.chunk_runs.find((r) => r.is_active === 1) || j.chunk_runs.find((r) => r.is_active) || null;
            if (activeRun?.id) setSelectedChunkRunId(String(activeRun.id));
          }
        }
        if (idxRes) {
          const j = await idxRes.json().catch(() => null);
          if (!cancelled && idxRes.ok && j?.success && Array.isArray(j.index_runs)) {
            setIndexRuns(j.index_runs);
          }
        }
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeKB?.id]);

  // Filter index runs by chunk run and active embedding config (like Playground resolveIndexRunId does)
  const filteredIndexRuns = useMemo(() => {
    const crid = selectedChunkRunId ? Number(selectedChunkRunId) : null;
    const embId = activeEmbeddingConfig?.id ? String(activeEmbeddingConfig.id) : null;
    return (indexRuns || []).filter((r) => {
      if (crid && Number(r.chunk_run_id) !== crid) return false;
      if (embId && String(r.embedding_configure_id) !== embId) return false;
      return true;
    });
  }, [indexRuns, selectedChunkRunId, activeEmbeddingConfig?.id]);

  useEffect(() => {
    if (!selectedIndexRunId && filteredIndexRuns.length > 0) {
      setSelectedIndexRunId(String(filteredIndexRuns[0].id));
    }
  }, [filteredIndexRuns, selectedIndexRunId]);

  const runEvaluation = useCallback(async () => {
    setEvalRunning(true);
    setEvalError(null);
    setEvalSummary(null);
    setEvalRows([]);
    try {
      if (!selectedDatasetId) throw new Error('Please select a dataset');
      if (!activeKB?.name) throw new Error('No active knowledgebase');
      if (!selectedChunkRunId) throw new Error('Please select a chunk run');
      if (!selectedIndexRunId) throw new Error('Please select an index run');
      if (!retrieverType) throw new Error('Please select a retriever');
      const kInt = Math.max(1, Number(k) || 1);

      const body = {
        dataset_id: String(selectedDatasetId),
        kb_name: String(activeKB.name),
        chunk_run_id: Number(selectedChunkRunId),
        index_run_id: Number(selectedIndexRunId),
        retriever_type: String(retrieverType),
        query_enhancement: String(queryEnhancement || 'none'),
        k: kInt,
      };
      if (String(maxRows || '').trim()) {
        const m = Number(maxRows);
        if (Number.isFinite(m) && m > 0) body.max_rows = Math.floor(m);
      }

      const res = await fetchWithAuth('/api/evaluation/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      const json = safeJsonParse(text);
      if (!res.ok) throw new Error(json?.detail || json?.message || text || res.statusText);
      if (!json?.success) throw new Error(json?.message || 'Evaluation failed');

      setEvalSummary(json.summary || null);
      setEvalRows(Array.isArray(json.rows) ? json.rows : []);
      if (json?.run?.run_id) {
        const rid = String(json.run.run_id);
        setSelectedRunId(rid);
        await fetchEvaluationRuns();
      }
    } catch (e) {
      setEvalError(toErrMsg(e));
    } finally {
      setEvalRunning(false);
    }
  }, [
    selectedDatasetId,
    activeKB?.name,
    selectedChunkRunId,
    selectedIndexRunId,
    retrieverType,
    queryEnhancement,
    k,
    maxRows,
  ]);

  const datasetColumns = useMemo(() => {
    if (selectedDatasetMeta?.columns && Array.isArray(selectedDatasetMeta.columns)) return selectedDatasetMeta.columns;
    const cols = new Set();
    for (const r of datasetRows || []) Object.keys(r || {}).forEach((k) => cols.add(k));
    return [...cols];
  }, [selectedDatasetMeta?.columns, datasetRows]);

  if (!activeKB) {
    return <div className="evaluation-page eval-error">No active knowledgebase. Select or create one first.</div>;
  }

  return (
    <div className="evaluation-page">
      <div className="evaluation-header">
        <div className="evaluation-header-text">
          <div className="evaluation-title">Knowledgebase: {activeKB.name}</div>
        </div>
        <div className="evaluation-tabs" role="tablist" aria-label="Evaluation sections">
          <button
            type="button"
            role="tab"
            aria-selected={activeSubTab === 'dataset'}
            className={`eval-tab-btn evaluation-tab ${activeSubTab === 'dataset' ? 'active' : ''}`}
            onClick={() => setActiveSubTab('dataset')}
          >
            Dataset
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeSubTab === 'evaluation'}
            className={`eval-tab-btn evaluation-tab ${activeSubTab === 'evaluation' ? 'active' : ''}`}
            onClick={() => setActiveSubTab('evaluation')}
          >
            Evaluation
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeSubTab === 'history'}
            className={`eval-tab-btn evaluation-tab ${activeSubTab === 'history' ? 'active' : ''}`}
            onClick={() => setActiveSubTab('history')}
          >
            History
          </button>
        </div>
      </div>

      {activeSubTab === 'dataset' ? (
        <div className="eval-panel">
          <div className="eval-section">
            <div className="eval-section-title">Upload dataset (.json)</div>
            <div className="eval-upload-row">
              <label className="eval-file-label">
                <span className="eval-file-label-text">JSON file</span>
                <input
                  type="file"
                  accept=".json,application/json"
                  onChange={(e) => setDatasetFile(e.target.files?.[0] || null)}
                  disabled={uploading}
                  className="eval-file-input"
                />
              </label>
              <button
                type="button"
                className="eval-btn eval-btn--primary"
                onClick={() => void uploadDataset()}
                disabled={!datasetFile || uploading}
              >
                {uploading ? 'Uploading…' : 'Upload'}
              </button>
            </div>
            {uploadError ? <div className="eval-error">{uploadError}</div> : null}
          </div>

          <div className="eval-section">
            <div className="eval-section-title">Datasets</div>
            {datasetsError ? <div className="eval-error">{datasetsError}</div> : null}
            <div className="eval-row eval-row--dataset-toolbar">
              <select
                className="eval-select"
                value={selectedDatasetId}
                onChange={(e) => {
                  setSelectedDatasetId(e.target.value);
                  setRowsOffset(0);
                }}
                disabled={datasetsLoading}
              >
                <option value="">Select a dataset…</option>
                {(datasets || []).map((d) => (
                  <option key={d.dataset_id} value={String(d.dataset_id)}>
                    {d.name} (v{String(d.version ?? '')}) — {d.row_count} rows
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="eval-btn eval-btn--primary"
                onClick={() => void fetchDatasets()}
                disabled={datasetsLoading}
              >
                {datasetsLoading ? 'Refreshing…' : 'Refresh'}
              </button>
            </div>

            {selectedDatasetMeta ? (
              <div className="eval-dataset-meta">
                <div className="eval-meta-item">
                  <span className="eval-meta-k">Name</span>
                  <span className="eval-meta-v">{selectedDatasetMeta.name}</span>
                </div>
                <div className="eval-meta-item">
                  <span className="eval-meta-k">Version</span>
                  <span className="eval-meta-v">{String(selectedDatasetMeta.version ?? '')}</span>
                </div>
                <div className="eval-meta-item">
                  <span className="eval-meta-k">Rows</span>
                  <span className="eval-meta-v">{selectedDatasetMeta.row_count}</span>
                </div>
                <div className="eval-meta-item">
                  <span className="eval-meta-k">Columns</span>
                  <span className="eval-meta-v">{(selectedDatasetMeta.columns || []).join(', ')}</span>
                </div>
              </div>
            ) : null}

            {rowsError ? <div className="eval-error">{rowsError}</div> : null}
            <div className="eval-row eval-row--pagination">
              <div className="eval-pagination">
                <button
                  type="button"
                  className="eval-btn eval-btn--primary"
                  onClick={() => setRowsOffset((o) => Math.max(0, (o || 0) - rowsLimit))}
                  disabled={rowsLoading || rowsOffset <= 0}
                >
                  Prev
                </button>
                <span>
                  Offset {rowsOffset} / {datasetTotal}
                </span>
                <button
                  type="button"
                  className="eval-btn eval-btn--primary"
                  onClick={() => setRowsOffset((o) => Math.min(Math.max(0, datasetTotal - 1), (o || 0) + rowsLimit))}
                  disabled={rowsLoading || rowsOffset + rowsLimit >= datasetTotal}
                >
                  Next
                </button>
              </div>
              <label className="eval-inline">
                Limit
                <input
                  type="number"
                  min="10"
                  max="500"
                  value={rowsLimit}
                  onChange={(e) => setRowsLimit(Math.max(10, Math.min(500, Number(e.target.value) || 50)))}
                  disabled={rowsLoading}
                />
              </label>
            </div>

            <div className="eval-table-wrap">
              {rowsLoading ? (
                <div className="eval-muted">Loading rows…</div>
              ) : datasetRows.length === 0 ? (
                <div className="eval-muted">No rows to display.</div>
              ) : (
                <table className="eval-table">
                  <thead>
                    <tr>
                      {datasetColumns.map((c) => (
                        <th key={c}>{c}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {datasetRows.map((r, idx) => (
                      <tr key={idx}>
                        {datasetColumns.map((c) => (
                          <td key={c}>
                            <div className="eval-cell">{String(r?.[c] ?? '')}</div>
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      ) : activeSubTab === 'history' ? (
        <div className="eval-panel">
          <div className="eval-section">
            <div className="eval-section-title">History</div>
            {evalRunsError ? <div className="eval-error">{evalRunsError}</div> : null}
            <div className="eval-row eval-row--dataset-toolbar">
              <select
                className="eval-select"
                value={selectedRunId}
                onChange={(e) => {
                  const v = e.target.value;
                  setSelectedRunId(v);
                  const m = (evalRuns || []).find((r) => String(r.run_id) === String(v)) || null;
                  setSelectedRunMeta(m);
                }}
                disabled={evalRunsLoading}
              >
                <option value="">Select a saved run…</option>
                {(evalRuns || []).map((r) => {
                  const when = r.created_at ? new Date(r.created_at).toLocaleString() : '';
                  const ds = r.dataset_name || r.dataset_id || '';
                  const rt = r.retriever_type ? String(r.retriever_type) : '';
                  const qe = r.query_enhancement ? String(r.query_enhancement) : '';
                  const kk = r.k != null ? `k=${String(r.k)}` : '';
                  const score = r.metrics_mean?.faithfulness;
                  const scoreTxt =
                    score === null || score === undefined || !Number.isFinite(Number(score)) ? '' : `faith=${Number(score).toFixed(3)}`;
                  const title = r.title ? String(r.title) : '';
                  const label = [title, when, ds, rt && `${rt}/${qe}`, kk, scoreTxt].filter(Boolean).join(' · ');
                  return (
                    <option key={r.run_id} value={String(r.run_id)}>
                      {label || String(r.run_id)}
                    </option>
                  );
                })}
              </select>
              <button
                type="button"
                className="eval-btn eval-btn--primary"
                onClick={() => void fetchEvaluationRuns()}
                disabled={evalRunsLoading}
              >
                {evalRunsLoading ? 'Refreshing…' : 'Refresh'}
              </button>
              <button
                type="button"
                className="eval-btn eval-btn--primary"
                onClick={() => void loadEvaluationRun()}
                disabled={!selectedRunId}
              >
                Load
              </button>
              <button
                type="button"
                className="eval-btn eval-btn--primary"
                onClick={() => void exportRunJson()}
                disabled={!selectedRunId}
              >
                Export JSON
              </button>
              <button
                type="button"
                className="eval-btn eval-btn--primary"
                onClick={() => void deleteRun()}
                disabled={!selectedRunId || runDeleting}
              >
                {runDeleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
            {runMetaSaveError ? <div className="eval-error">{runMetaSaveError}</div> : null}
            {selectedRunMeta ? (
              <>
                <div className="eval-form-grid" style={{ marginTop: 12 }}>
                  <label>
                    Title
                    <input value={runTitleDraft} onChange={(e) => setRunTitleDraft(e.target.value)} placeholder="Optional name…" />
                  </label>
                  <label>
                    Note
                    <input value={runNoteDraft} onChange={(e) => setRunNoteDraft(e.target.value)} placeholder="Optional note…" />
                  </label>
                </div>
                <div className="eval-run-row">
                  <button
                    type="button"
                    className="eval-btn eval-btn--primary"
                    onClick={() => void saveRunMeta()}
                    disabled={!selectedRunId || runMetaSaving}
                  >
                    {runMetaSaving ? 'Saving…' : 'Save title/note'}
                  </button>
                  <div className="eval-muted">Tip: title/note are stored with the run and shown in the dropdown.</div>
                </div>
                <div className="eval-dataset-meta">
                <div className="eval-meta-item">
                  <span className="eval-meta-k">Run ID</span>
                  <span className="eval-meta-v eval-mono">{String(selectedRunMeta.run_id)}</span>
                </div>
                <div className="eval-meta-item">
                  <span className="eval-meta-k">Created</span>
                  <span className="eval-meta-v">{selectedRunMeta.created_at ? new Date(selectedRunMeta.created_at).toLocaleString() : '—'}</span>
                </div>
                <div className="eval-meta-item">
                  <span className="eval-meta-k">Dataset</span>
                  <span className="eval-meta-v">{String(selectedRunMeta.dataset_name || selectedRunMeta.dataset_id || '—')}</span>
                </div>
                <div className="eval-meta-item">
                  <span className="eval-meta-k">Rows scored</span>
                  <span className="eval-meta-v">{String(selectedRunMeta.row_count_scored ?? '—')}</span>
                </div>
                </div>
              </>
            ) : null}
          </div>

          {evalError ? <div className="eval-error">{evalError}</div> : null}

          {evalSummary ? (
            <div className="eval-section">
              <div className="eval-section-title">Summary</div>
              <MetricGrid metrics={evalSummary.metrics_mean || {}} />
              {evalSummary?.notes ? <div className="eval-muted">{String(evalSummary.notes)}</div> : null}
            </div>
          ) : null}

          <div className="eval-section">
            <div className="eval-section-title">Results</div>
            {evalRows.length === 0 ? (
              <div className="eval-muted">No results loaded.</div>
            ) : (
              <div className="eval-results-list">
                {evalRows.map((r, idx) => (
                  <details key={idx} className="eval-result-item">
                    <summary className="eval-result-summary">
                      <span className="eval-result-idx">#{idx + 1}</span>
                      <span className="eval-result-query">{String(r.query || '')}</span>
                    </summary>
                    <div className="eval-result-body">
                      <div className="eval-kv">
                        <div className="eval-k">Answer (reference)</div>
                        <div className="eval-v eval-pre">{String(r.answer ?? '')}</div>
                      </div>
                      <div className="eval-kv">
                        <div className="eval-k">Response (LLM)</div>
                        <div className="eval-v eval-pre">{String(r.response ?? '')}</div>
                      </div>
                      <div className="eval-kv">
                        <div className="eval-k">Retrieved contexts</div>
                        <div className="eval-v">
                          {(r.retrieved_contexts || []).length === 0 ? (
                            <div className="eval-muted">None</div>
                          ) : (
                            (r.retrieved_contexts || []).map((c, i) => (
                              <div key={i} className="eval-context">
                                <div className="eval-context-head">
                                  <span className="eval-context-idx">[{i + 1}]</span>
                                  {r.retrieved_chunk_ids?.[i] ? (
                                    <span className="eval-mono">chunk:{String(r.retrieved_chunk_ids[i])}</span>
                                  ) : null}
                                </div>
                                <div className="eval-context-body">{String(c)}</div>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                      {r.metrics ? (
                        <div className="eval-kv">
                          <div className="eval-k">Metrics</div>
                          <div className="eval-v">
                            <MetricGrid metrics={r.metrics} />
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </details>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="eval-panel">

          <div className="eval-section">
            <div className="eval-section-title">Parameters</div>
            <div className="eval-form-grid">
              <label>
                Dataset
                <select value={selectedDatasetId} onChange={(e) => setSelectedDatasetId(e.target.value)}>
                  <option value="">Select a dataset…</option>
                  {(datasets || []).map((d) => (
                    <option key={d.dataset_id} value={String(d.dataset_id)}>
                      {d.name} (v{String(d.version ?? '')}) — {d.row_count} rows
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Chunk run
                <select value={selectedChunkRunId} onChange={(e) => setSelectedChunkRunId(e.target.value)}>
                  <option value="">Select…</option>
                  {(chunkRuns || []).map((r) => (
                    <option key={r.id} value={String(r.id)}>
                      #{r.id} {r.framework || ''} {r.is_active === 1 ? '(active)' : ''}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Index run
                <select value={selectedIndexRunId} onChange={(e) => setSelectedIndexRunId(e.target.value)}>
                  <option value="">Select…</option>
                  {filteredIndexRuns.map((r) => (
                    <option key={r.id} value={String(r.id)}>
                      #{r.id} (chunk_run:{r.chunk_run_id}, embed:{String(r.embedding_configure_id).slice(0, 12)})
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Retriever
                <select value={retrieverType} onChange={(e) => setRetrieverType(e.target.value)}>
                  {(availableRetrievers.length ? availableRetrievers : ['vector', 'bm25', 'fusion', 'rerank']).map((r) => (
                    <option key={r} value={r}>
                      {String(r).charAt(0).toUpperCase() + String(r).slice(1)}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Query enhancement
                <select value={queryEnhancement} onChange={(e) => setQueryEnhancement(e.target.value)}>
                  {QUERY_ENHANCEMENT_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                k
                <input
                  type="number"
                  min="1"
                  max="50"
                  value={k}
                  onChange={(e) => setK(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
                />
              </label>

              <label>
                Max rows (optional)
                <input
                  type="number"
                  min="1"
                  placeholder="e.g. 50"
                  value={maxRows}
                  onChange={(e) => setMaxRows(e.target.value)}
                />
              </label>
            </div>

            <div className="eval-run-row">
              <button
                type="button"
                className="eval-btn eval-btn--primary eval-btn--cta"
                onClick={() => void runEvaluation()}
                disabled={evalRunning}
              >
                {evalRunning ? 'Running…' : 'Run evaluation'}
              </button>
              <div className="eval-models" role="group" aria-label="Models used in evaluation">
                <div className="eval-model-chip">
                  <span className="eval-model-chip__label">Judge LLM</span>
                  <span className="eval-model-chip__value eval-mono">
                    {llmInfo?.judge_llm?.model ? String(llmInfo.judge_llm.model) : 'unknown'}
                  </span>
                </div>
                <div className="eval-model-chip">
                  <span className="eval-model-chip__label">Response LLM</span>
                  <span className="eval-model-chip__value eval-mono">
                    {llmInfo?.response_llm?.model ? String(llmInfo.response_llm.model) : 'unknown'}
                  </span>
                </div>
                <div className="eval-model-chip">
                  <span className="eval-model-chip__label">Embedding</span>
                  <span className="eval-model-chip__value eval-mono">
                    {activeEmbeddingConfig?.embedding_model
                      ? String(activeEmbeddingConfig.embedding_model)
                      : activeEmbeddingConfig?.embedding_provider
                        ? String(activeEmbeddingConfig.embedding_provider)
                        : 'unknown'}
                  </span>
                </div>
              </div>
            </div>
            {evalError ? <div className="eval-error">{evalError}</div> : null}
          </div>

          {evalSummary ? (
            <div className="eval-section">
              <div className="eval-section-title">Summary</div>
              <MetricGrid metrics={evalSummary.metrics_mean || {}} />
              {evalSummary?.notes ? <div className="eval-muted">{String(evalSummary.notes)}</div> : null}
            </div>
          ) : null}

          <div className="eval-section">
            <div className="eval-section-title">Results</div>
            {evalRows.length === 0 ? (
              <div className="eval-muted">No results yet.</div>
            ) : (
              <div className="eval-results-list">
                {evalRows.map((r, idx) => (
                  <details key={idx} className="eval-result-item">
                    <summary className="eval-result-summary">
                      <span className="eval-result-idx">#{idx + 1}</span>
                      <span className="eval-result-query">{String(r.query || '')}</span>
                    </summary>
                    <div className="eval-result-body">
                      <div className="eval-kv">
                        <div className="eval-k">Answer (reference)</div>
                        <div className="eval-v eval-pre">{String(r.answer ?? '')}</div>
                      </div>
                      <div className="eval-kv">
                        <div className="eval-k">Response (LLM)</div>
                        <div className="eval-v eval-pre">{String(r.response ?? '')}</div>
                      </div>
                      <div className="eval-kv">
                        <div className="eval-k">Retrieved contexts</div>
                        <div className="eval-v">
                          {(r.retrieved_contexts || []).length === 0 ? (
                            <div className="eval-muted">None</div>
                          ) : (
                            (r.retrieved_contexts || []).map((c, i) => (
                              <div key={i} className="eval-context">
                                <div className="eval-context-head">
                                  <span className="eval-context-idx">[{i + 1}]</span>
                                  {r.retrieved_chunk_ids?.[i] ? (
                                    <span className="eval-mono">chunk:{String(r.retrieved_chunk_ids[i])}</span>
                                  ) : null}
                                </div>
                                <div className="eval-context-body">{String(c)}</div>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                      {r.metrics ? (
                        <div className="eval-kv">
                          <div className="eval-k">Metrics</div>
                          <div className="eval-v">
                            <MetricGrid metrics={r.metrics} />
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </details>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

