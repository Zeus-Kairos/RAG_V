import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import useKnowledgebaseStore, { fetchWithAuth } from './store';
import useRetrievalStore from './retrievalStore';
import ChunkDetailPopover from './ChunkDetailPopover';
import GraphView from './GraphView';
import { isEdgeActive } from './graphEdgeActive';
import './Playground.css';

function uniqSortedNums(arr) {
  return [...new Set((arr || []).map((x) => Number(x)).filter((n) => Number.isFinite(n)))]
    .sort((a, b) => a - b);
}

function extractBracketRefs(answerText) {
  const s = String(answerText || '');
  const out = [];
  const re = /\[(\d+)\]/g;
  let m;
  while ((m = re.exec(s))) {
    out.push(Number(m[1]));
  }
  return uniqSortedNums(out);
}

export default function Playground({ mainViewApi = null }) {
  const { knowledgebases } = useKnowledgebaseStore();
  const activeKB = knowledgebases.find((kb) => kb.is_active) || knowledgebases[0];

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

  const queryEnhancementOptions = [
    { value: 'none', label: 'None' },
    { value: 'multi-query', label: 'Multi-Query' },
    { value: 'decomposition', label: 'Decomposition' },
    { value: 'step-back', label: 'Step-Back' },
    { value: 'hype', label: 'HyPE' },
    { value: 'hyde', label: 'HyDE' },
  ];

  const [availableRetrievers, setAvailableRetrievers] = useState(['vector', 'bm25', 'fusion', 'rerank']);
  const [draft, setDraft] = useState('');
  const [messages, setMessages] = useState([]); // { role: 'user'|'assistant', content: string }
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [preprocessedQueries, setPreprocessedQueries] = useState([]);

  const [topKChunks, setTopKChunks] = useState([]); // { chunkIndex, chunkId, documentName, snippet, score }
  const [highlightedChunkIndices, setHighlightedChunkIndices] = useState([]);
  const [chunkTypeById, setChunkTypeById] = useState({}); // { [chunkId]: chunk_type }

  const [lastIndexCtx, setLastIndexCtx] = useState(null); // { kbName, indexRunId }
  const [listChunkPopover, setListChunkPopover] = useState(null);
  const [listChunkDetail, setListChunkDetail] = useState(null);
  const [listDetailLoading, setListDetailLoading] = useState(false);
  const [listDetailError, setListDetailError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchWithAuth('/api/retrievers');
        if (!res.ok) return;
        const data = await res.json().catch(() => null);
        if (cancelled) return;
        if (data?.success && Array.isArray(data.retrievers) && data.retrievers.length > 0) {
          setAvailableRetrievers(data.retrievers);
        }
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!listChunkPopover) {
      setListChunkDetail(null);
      setListDetailError(null);
      setListDetailLoading(false);
      return undefined;
    }
    const { kbName, indexRunId, chunkId } = listChunkPopover;
    let cancelled = false;
    (async () => {
      setListDetailLoading(true);
      setListDetailError(null);
      setListChunkDetail(null);
      try {
        const res = await fetchWithAuth(
          `/api/retrieve/${encodeURIComponent(kbName)}/${indexRunId}/chunk/${encodeURIComponent(String(chunkId))}`,
        );
        const text = await res.text();
        let json;
        try {
          json = JSON.parse(text);
        } catch {
          throw new Error(text || res.statusText);
        }
        if (!res.ok) {
          const d = json.detail;
          const msg =
            typeof d === 'string' ? d : Array.isArray(d) ? d.map((x) => x.msg || JSON.stringify(x)).join('; ') : JSON.stringify(d);
          throw new Error(msg || json.message || res.statusText);
        }
        if (cancelled) return;
        if (!json.success) {
          throw new Error(json.message || 'Failed to load');
        }
        setListChunkDetail({
          content: json.content ?? '',
          metadata: json.metadata ?? {},
          document_name: json.document_name ?? '',
        });
      } catch (e) {
        if (!cancelled) setListDetailError(e.message || String(e));
      } finally {
        if (!cancelled) setListDetailLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [listChunkPopover]);

  const closeListChunkPopover = useCallback(() => {
    setListChunkPopover(null);
    setListChunkDetail(null);
    setListDetailError(null);
  }, []);

  const openListChunkPopover = useCallback(
    (chunkId, e) => {
      e?.stopPropagation?.();
      if (!lastIndexCtx?.kbName || !lastIndexCtx?.indexRunId) {
        setError('No active retrieval context yet. Run a query first.');
        return;
      }
      setListChunkPopover({
        kbName: lastIndexCtx.kbName,
        indexRunId: Number(lastIndexCtx.indexRunId),
        chunkId: String(chunkId),
        clientX: e.clientX,
        clientY: e.clientY,
      });
    },
    [lastIndexCtx?.kbName, lastIndexCtx?.indexRunId],
  );

  const highlightedSet = useMemo(() => new Set(highlightedChunkIndices.map((n) => Number(n))), [highlightedChunkIndices]);

  const resolveIndexRunId = useCallback(async () => {
    if (!activeKB?.id || !activeKB?.name) {
      throw new Error('No active knowledgebase');
    }

    const [chunkRunsRes, embRes, indexRunsRes] = await Promise.all([
      fetchWithAuth(`/api/chunk-runs/${activeKB.id}`),
      fetchWithAuth('/api/embedding_config'),
      fetchWithAuth(`/api/index-runs/${activeKB.id}`),
    ]);

    const chunkRunsJson = await chunkRunsRes.json();
    const embJson = await embRes.json();
    const indexRunsJson = await indexRunsRes.json();

    const chunkRuns = chunkRunsJson?.success ? chunkRunsJson.chunk_runs || [] : [];
    const activeChunkRun = chunkRuns.find((r) => r.is_active === 1) || chunkRuns.find((r) => r.is_active) || null;
    const activeEmbeddingConfigId = embJson?.success ? embJson.active_config?.id : null;

    if (!activeChunkRun?.id) throw new Error('No active chunk run (please run chunking and set one active)');
    if (!activeEmbeddingConfigId) throw new Error('No active embedding config');

    const indexRuns = indexRunsJson?.success ? indexRunsJson.index_runs || [] : [];
    const match = indexRuns.find(
      (r) => Number(r.chunk_run_id) === Number(activeChunkRun.id) && String(r.embedding_configure_id) === String(activeEmbeddingConfigId),
    );

    if (!match?.id) {
      throw new Error('No index run found for active chunk run + active embedding config (run indexing first)');
    }
    return { kbName: activeKB.name, indexRunId: Number(match.id) };
  }, [activeKB?.id, activeKB?.name]);

  const runOnce = useCallback(async () => {
    const query = String(draft || '').trim();
    if (!query) return;

    setLoading(true);
    setError(null);
    setHighlightedChunkIndices([]);
    setTopKChunks([]);
    setChunkTypeById({});
    setPreprocessedQueries([]);

    // single-turn: reset messages
    setMessages([{ role: 'user', content: query }]);

    try {
      const graphRes = await fetchWithAuth(`/api/knowledgebase/${activeKB.id}/graph`);
      const graphJson = await graphRes.json().catch(() => null);
      if (!graphRes.ok || !graphJson?.success || !graphJson?.graph) {
        throw new Error('Failed to load the knowledgebase graph; cannot verify index edges.');
      }
      const graphLinks = Array.isArray(graphJson.graph.edges) ? graphJson.graph.edges : [];
      const hasActiveEmbedEdge = graphLinks.some(
        (l) => l.type === 'embed' && isEdgeActive(l, graphLinks),
      );
      if (!hasActiveEmbedEdge) {
        throw new Error(
          'No active index (embed) edge: the parse → chunk → embed chain is not aligned for retrieval. Activate the full pipeline in the graph on the left and run indexing before sending.',
        );
      }

      const { kbName, indexRunId } = await resolveIndexRunId();
      setLastIndexCtx({ kbName, indexRunId });

      const retrieveRes = await fetchWithAuth(`/api/retrieve/${encodeURIComponent(kbName)}/${indexRunId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          retriever_type: retrieverType,
          k,
          query_enhancement: queryEnhancement,
        }),
      });

      const retrieveJson = await retrieveRes.json();
      if (!retrieveRes.ok) {
        throw new Error(retrieveJson?.detail || retrieveJson?.message || retrieveRes.statusText);
      }
      if (!retrieveJson?.success) {
        throw new Error(retrieveJson?.message || 'Retrieve failed');
      }

      if (String(queryEnhancement || '') !== 'none' && Array.isArray(retrieveJson.queries_used)) {
        setPreprocessedQueries(retrieveJson.queries_used.map((x) => String(x)).filter((s) => s.trim()));
      } else {
        setPreprocessedQueries([]);
      }

      const results = Array.isArray(retrieveJson.results) ? retrieveJson.results : [];
      const sliced = results.slice(0, Math.max(1, Number(k) || 1));

      const mapped = sliced.map((r, idx) => ({
        chunkIndex: idx + 1,
        chunkId: String(r.id),
        documentName: r.document_name || '',
        snippet: r.snippet || '',
        score: typeof r.relevance_score === 'number' ? r.relevance_score : Number(r.relevance_score),
      }));
      setTopKChunks(mapped);

      const chunkDetailPromises = mapped.map(async (it) => {
        const res = await fetchWithAuth(
          `/api/retrieve/${encodeURIComponent(kbName)}/${indexRunId}/chunk/${encodeURIComponent(String(it.chunkId))}`,
        );
        const text = await res.text();
        let json;
        try {
          json = JSON.parse(text);
        } catch {
          json = null;
        }
        if (!res.ok) {
          const d = json?.detail;
          throw new Error(typeof d === 'string' ? d : text || res.statusText);
        }
        if (!json?.success) throw new Error(json?.message || 'Failed to load chunk detail');
        const meta = json.metadata ?? {};
        const chunkType = String(meta.chunk_type ?? '');
        const contentForChat =
          chunkType === 'augment' && typeof meta.source_chunk_content === 'string' && meta.source_chunk_content.trim()
            ? meta.source_chunk_content
            : (json.content ?? '');
        return { index: it.chunkIndex, content: contentForChat, chunkId: it.chunkId, chunkType };
      });

      const chunksForLlm = await Promise.all(chunkDetailPromises);
      setChunkTypeById(() => {
        const next = {};
        for (const c of chunksForLlm) {
          if (c?.chunkId) next[String(c.chunkId)] = String(c.chunkType || '');
        }
        return next;
      });

      const chatRes = await fetchWithAuth('/api/chat/playground', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          chunks: chunksForLlm.map((c) => ({ index: c.index, content: c.content })),
        }),
      });
      const chatText = await chatRes.text();
      let chatJson;
      try {
        chatJson = JSON.parse(chatText);
      } catch {
        chatJson = null;
      }
      if (!chatRes.ok) {
        const d = chatJson?.detail;
        throw new Error(typeof d === 'string' ? d : chatText || chatRes.statusText);
      }
      if (!chatJson?.success) {
        throw new Error(chatJson?.message || 'Chat failed');
      }

      const answer = chatJson.answer ?? '';
      setMessages([{ role: 'user', content: query }, { role: 'assistant', content: answer }]);

      const refs = Array.isArray(chatJson.referenced_chunk_indices)
        ? uniqSortedNums(chatJson.referenced_chunk_indices)
        : extractBracketRefs(answer);
      setHighlightedChunkIndices(refs);
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [activeKB?.id, draft, k, queryEnhancement, resolveIndexRunId, retrieverType]);

  if (!activeKB) {
    return <div className="playground-error">No active knowledgebase. Select or create one first.</div>;
  }

  return (
    <div className="playground">
      <div className="playground-pane playground-left">
        <GraphView hideNodeTypeDropdowns hideDetailsPanel mainViewApi={mainViewApi} />
      </div>

      <div className="playground-pane playground-right">
        <div className="playground-toolbar">
          <label>Retriever</label>
          <select value={retrieverType} onChange={(e) => setRetrieverType(e.target.value)}>
            {availableRetrievers.map((r) => (
              <option key={r} value={r}>
                {String(r).charAt(0).toUpperCase() + String(r).slice(1)}
              </option>
            ))}
          </select>

          <label>Query Enhancement</label>
          <select value={queryEnhancement} onChange={(e) => setQueryEnhancement(e.target.value)}>
            {queryEnhancementOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>

          <label>k</label>
          <div className="k-control">
            <input
              type="range"
              min="1"
              max="50"
              value={k}
              onChange={(e) => setK(parseInt(e.target.value, 10))}
            />
            <input
              type="number"
              min="1"
              max="50"
              value={k}
              onChange={(e) => setK(parseInt(e.target.value, 10))}
            />
          </div>
        </div>

        {error ? <div className="playground-error">{error}</div> : null}

        <div className="playground-bottom">
          <div className="playground-chat">
            <div className="playground-panel-title">Chat (single turn)</div>
            <div className="playground-messages" role="log" aria-label="Chat messages">
              {messages.length === 0 ? (
                <div className="playground-msg">Enter a query and send. Answers use only the chunks on the right; cite with `[n]`.</div>
              ) : (
                messages.map((m, idx) => (
                  <div
                    key={idx}
                    className={`playground-msg ${m.role === 'user' ? 'playground-msg--user' : 'playground-msg--assistant'}`}
                  >
                    {m.content}
                  </div>
                ))
              )}
            </div>
            <div className="playground-composer">
              {String(queryEnhancement || '') !== 'none' && preprocessedQueries.length > 0 ? (
                <div className="playground-preprocess">
                  <div className="playground-preprocess-title">Queries (preprocess)</div>
                  <div className="playground-preprocess-list">
                    {preprocessedQueries.map((q, idx) => (
                      <div key={idx} className="playground-preprocess-item">
                        {q}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Ask something…"
                disabled={loading}
              />
              <button type="button" onClick={() => void runOnce()} disabled={loading || !String(draft || '').trim()}>
                {loading ? 'Running…' : 'Send'}
              </button>
            </div>
          </div>

          <div className="playground-chunks">
            <div className="playground-panel-title">Top-k chunks</div>
            <div className="playground-chunk-list" aria-label="Top-k chunks list">
              {topKChunks.length === 0 ? (
                <div className="playground-msg">No results yet. Top-k chunks will appear here after you send a query.</div>
              ) : (
                topKChunks.map((c) => {
                  const isHl = highlightedSet.has(Number(c.chunkIndex));
                  const chunkType = String(chunkTypeById?.[String(c.chunkId)] || '');
                  const isAugment = chunkType === 'augment';
                  return (
                    <div
                      key={c.chunkIndex}
                      className={`playground-chunk-item ${isHl ? 'playground-chunk-item--highlighted' : ''}`}
                    >
                      <div className="playground-chunk-meta">
                        <span className="playground-chunk-idx">#{c.chunkIndex}</span>
                        {isAugment ? <span className="playground-chunk-badge">Augment</span> : null}
                        <span className="playground-chunk-id">
                          ID:{' '}
                          <button
                            type="button"
                            className="result-chunk-id-btn"
                            title="Full text and metadata"
                            onClick={(e) => openListChunkPopover(c.chunkId, e)}
                          >
                            {c.chunkId}
                          </button>
                        </span>
                        {Number.isFinite(Number(c.score)) ? (
                          <span className="playground-score">{Number(c.score).toFixed(2)}</span>
                        ) : null}
                        <span className="playground-chunk-title">{c.documentName}</span>
                      </div>
                      <div className="playground-chunk-snippet">{c.snippet}</div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>

      <ChunkDetailPopover
        popover={
          listChunkPopover
            ? {
                type: 'chunk',
                chunkId: listChunkPopover.chunkId,
                clientX: listChunkPopover.clientX,
                clientY: listChunkPopover.clientY,
              }
            : null
        }
        onClose={closeListChunkPopover}
        chunkDetail={listChunkDetail}
        detailLoading={listDetailLoading}
        detailError={listDetailError}
      />
    </div>
  );
}

