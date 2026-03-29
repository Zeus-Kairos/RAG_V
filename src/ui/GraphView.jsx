import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import { forceCollide } from 'd3-force';
import useKnowledgebaseStore, { fetchWithAuth } from './store';
import './GraphView.css';

const NODE_COLORS = {
  document: '#2563eb',
  parser: '#7c3aed',
  chunker: '#059669',
  embedding: '#d97706',
  unknown: '#64748b',
};

const EDGE_COLORS = {
  // Saturated + high alpha so active edges read clearly vs gray inactive.
  parseActive: 'rgba(109, 40, 217, 0.92)',
  chunkActive: 'rgba(4, 120, 87, 0.92)',
  embedActive: 'rgba(217, 119, 6, 0.92)',
  inactive: 'rgba(148, 163, 184, 0.38)',
};

// Node highlights aligned with active edge colors (parser / chunker / embedding).
const NODE_HIGHLIGHT = {
  parser: {
    fill: '#6d28d9',
    auraRgb: '109, 40, 217',
    text: '#4c1d95',
    shadow: 'rgba(109, 40, 217, 0.5)',
  },
  chunker: {
    fill: '#047857',
    auraRgb: '4, 120, 87',
    text: '#065f46',
    shadow: 'rgba(4, 120, 87, 0.5)',
  },
  embedding: {
    fill: '#d97706',
    auraRgb: '217, 119, 6',
    text: '#92400e',
    shadow: 'rgba(217, 119, 6, 0.5)',
  },
};

function safeStringify(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatTimeUsage(seconds) {
  if (seconds === null || seconds === undefined || Number.isNaN(Number(seconds))) return '–';
  return `${Number(seconds).toFixed(3)}s`;
}

function Kv({ k, v }) {
  return (
    <div className="details-kv">
      <span className="k">{k}</span>
      <span className="v">{v ?? '–'}</span>
    </div>
  );
}

function Section({ title, children, defaultOpen = true }) {
  return (
    <details className="details-section" open={defaultOpen}>
      <summary className="details-section-title">{title}</summary>
      <div className="details-section-body">{children}</div>
    </details>
  );
}

function JsonBlock({ title, value, defaultOpen = false }) {
  return (
    <Section title={title} defaultOpen={defaultOpen}>
      <pre className="details-pre">{safeStringify(value)}</pre>
    </Section>
  );
}

function linkEndpointIds(link) {
  const s = typeof link?.source === 'string' ? link.source : link?.source?.id;
  const t = typeof link?.target === 'string' ? link.target : link?.target?.id;
  return { s, t };
}

function isEdgeActive(link) {
  const a = link?.attributes || {};
  if (link?.type === 'parse') return Boolean(a.is_active);
  if (link?.type === 'chunk') {
    const parseActive = a.parse_is_active;
    const runActive = a.chunk_run_is_active;
    // Per-edge: this link already ties one file's parse_run to a chunk_run. KB-wide
    // chunk_run.in_sync is cleared whenever any file's active parse changes, so it
    // would keep the edge gray even after explicitly activating the matching chunk run.
    const okParse = parseActive === undefined ? true : Boolean(parseActive);
    const okRun = runActive === undefined ? true : Boolean(runActive);
    return okParse && okRun;
  }
  if (link?.type === 'embed') {
    const runActive = a.chunk_run_is_active;
    // Highlight every index run tied to the active chunk run, not only the edge whose
    // embedding config is globally "active" (a chunk run can be indexed under multiple models).
    const okRun = runActive === undefined ? true : Boolean(runActive);
    return okRun;
  }
  return true;
}

function hash01(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function timeScore(isoOrStr) {
  if (isoOrStr == null || isoOrStr === '') return 0;
  const t = new Date(isoOrStr).getTime();
  return Number.isFinite(t) ? t : 0;
}

/** Latest chunk run (by run_time, then chunk_run_id) for this file + parse run. */
function pickLatestChunkLinkForParse(links, fileId, parseRunId) {
  const candidates = links.filter(
    (l) =>
      l.type === 'chunk' &&
      l.attributes?.file_id === fileId &&
      l.attributes?.parse_run_id === parseRunId
  );
  if (candidates.length === 0) return null;
  return candidates.reduce((best, l) => {
    const a = l.attributes || {};
    const b = best.attributes || {};
    const ta = timeScore(a.run_time);
    const tb = timeScore(b.run_time);
    if (ta !== tb) return ta > tb ? l : best;
    const ida = Number(a.chunk_run_id) || 0;
    const idb = Number(b.chunk_run_id) || 0;
    return ida >= idb ? l : best;
  });
}

/** Latest parse run (by parse_time, then parse_run_id) among chunk edges for this file + chunk run. */
function pickLatestParseLinkForChunkRun(links, fileId, chunkRunId) {
  const candidates = links.filter(
    (l) =>
      l.type === 'chunk' &&
      l.attributes?.file_id === fileId &&
      l.attributes?.chunk_run_id === chunkRunId
  );
  if (candidates.length === 0) return null;
  return candidates.reduce((best, l) => {
    const a = l.attributes || {};
    const b = best.attributes || {};
    const ta = timeScore(a.parse_time);
    const tb = timeScore(b.parse_time);
    if (ta !== tb) return ta > tb ? l : best;
    const ida = Number(a.parse_run_id) || 0;
    const idb = Number(b.parse_run_id) || 0;
    return ida >= idb ? l : best;
  });
}

function lightenHex(hex, amount01) {
  const s = (hex || '').replace('#', '').trim();
  if (s.length !== 6) return hex;
  const amt = clamp(amount01, 0, 1);
  const r = parseInt(s.slice(0, 2), 16);
  const g = parseInt(s.slice(2, 4), 16);
  const b = parseInt(s.slice(4, 6), 16);
  const lr = Math.round(r + (255 - r) * amt);
  const lg = Math.round(g + (255 - g) * amt);
  const lb = Math.round(b + (255 - b) * amt);
  return `rgb(${lr} ${lg} ${lb})`;
}

const GraphView = () => {
  const { knowledgebases } = useKnowledgebaseStore();
  const activeKB = knowledgebases.find(kb => kb.is_active) || knowledgebases[0];

  const fgRef = useRef(null);
  const canvasWrapRef = useRef(null);
  const hasAutoFitRef = useRef(false);
  const hasInteractedRef = useRef(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [rawGraph, setRawGraph] = useState({ nodes: [], edges: [] });
  const [selected, setSelected] = useState(null); // { kind: 'node'|'edge', data }
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 500 });
  const [filterQuery, setFilterQuery] = useState('');
  const [filterNodeIds, setFilterNodeIds] = useState([]); // node ids
  const [includeNeighbors, setIncludeNeighbors] = useState(true);
  const [onlyActive, setOnlyActive] = useState(false);
  const [opBusy, setOpBusy] = useState(false);
  const [opMessage, setOpMessage] = useState(null);
  const linkClickRef = useRef({ linkId: null, t: 0 });

  const refetchGraph = useCallback(async () => {
    if (!activeKB) return;
    try {
      const res = await fetchWithAuth(`/api/knowledgebase/${activeKB.id}/graph`);
      const data = await res.json();
      if (data.success && data.graph) {
        setRawGraph(data.graph);
      }
    } catch (e) {
      setError(e.message || 'Failed to load graph');
    }
  }, [activeKB?.id]);

  useLayoutEffect(() => {
    const el = canvasWrapRef.current;
    if (!el) return;

    const readSize = () => {
      const rect = el.getBoundingClientRect();
      const w = Math.max(el.clientWidth || 0, el.offsetWidth || 0, rect.width || 0);
      const h = Math.max(el.clientHeight || 0, el.offsetHeight || 0, rect.height || 0);
      return {
        width: Math.max(320, Math.floor(w)),
        height: Math.max(260, Math.floor(h)),
        rect,
      };
    };

    const update = () => {
      const { width, height, rect } = readSize();
      setCanvasSize(prev => (prev.width === width && prev.height === height ? prev : { width, height }));
    };

    // Initial + a few ticks: fixes cases where the container finishes layout after mount/tab switch.
    let raf = 0;
    let ticks = 0;
    const pump = () => {
      update();
      ticks += 1;
      if (ticks < 8) raf = requestAnimationFrame(pump);
    };
    update();
    raf = requestAnimationFrame(pump);

    const ro = new ResizeObserver((entries) => {
      const entry = entries?.[0];
      const cr = entry?.contentRect;
      if (cr && cr.width && cr.height) {
        const width = Math.max(320, Math.floor(cr.width));
        const height = Math.max(260, Math.floor(cr.height));
        setCanvasSize(prev => (prev.width === width && prev.height === height ? prev : { width, height }));
        return;
      }
      update();
    });
    ro.observe(el);

    window.addEventListener('resize', update, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', update);
      ro.disconnect();
    };
  }, [isLoading, rawGraph?.nodes?.length]);

  useEffect(() => {
    const fetchGraph = async () => {
      if (!activeKB) {
        setRawGraph({ nodes: [], edges: [] });
        setIsLoading(false);
        return;
      }
      setIsLoading(true);
      setError(null);
      try {
        const res = await fetchWithAuth(`/api/knowledgebase/${activeKB.id}/graph`);
        const data = await res.json();
        if (data.success && data.graph) {
          setRawGraph(data.graph);
        } else {
          setRawGraph({ nodes: [], edges: [] });
        }
      } catch (e) {
        setError(e.message || 'Failed to load graph');
        setRawGraph({ nodes: [], edges: [] });
      } finally {
        setIsLoading(false);
      }
    };
    fetchGraph();
  }, [activeKB?.id]);

  useEffect(() => {
    setOpMessage(null);
  }, [activeKB?.id]);

  const baseGraphData = useMemo(() => {
    const nodes = (rawGraph.nodes || []).map(n => {
      const type = n.type || 'unknown';
      const color = NODE_COLORS[type] || NODE_COLORS.unknown;

      // Better initial layout: document -> parser -> chunker -> embedding along X axis.
      // Keep deterministic scatter via hash so it doesn't start in a corner.
      const u = hash01(n.id || '');
      const v = hash01(`${n.id || ''}::y`);
      const xBand =
        type === 'document'
          ? -320
          : type === 'parser'
            ? -107
            : type === 'chunker'
              ? 107
              : type === 'embedding'
                ? 320
                : 0;
      const yScatter = (v - 0.5) * 240;
      const xScatter = (u - 0.5) * 120;

      return {
        ...n,
        type,
        color,
        // IMPORTANT: always reset initial positions; force-graph mutates node objects in place.
        // Reusing previous x/y can explode the bounding box and make zoomToFit look like "blank space".
        x: xBand + xScatter,
        y: yScatter,
      };
    });

    const edges = rawGraph.edges || [];
    const parallelIndex = new Map(); // key -> current index
    const parallelTotal = new Map(); // key -> total count

    for (const e of edges) {
      const key = `${e.source}→${e.target}`;
      parallelTotal.set(key, (parallelTotal.get(key) || 0) + 1);
    }

    const links = edges.map(e => {
      const key = `${e.source}→${e.target}`;
      const idx = parallelIndex.get(key) || 0;
      parallelIndex.set(key, idx + 1);
      const total = parallelTotal.get(key) || 1;
      const spread = Math.min(0.9, 0.15 * Math.max(1, total - 1));
      const curvature = total === 1 ? 0 : ((idx - (total - 1) / 2) / Math.max(1, total - 1)) * spread;

      return {
        ...e,
        source: e.source,
        target: e.target,
        curvature,
      };
    });

    return { nodes, links };
  }, [rawGraph]);

  const handleParseEdgeDoubleClick = useCallback(
    async (link) => {
      const a = link.attributes || {};
      const fileId = a.file_id;
      const parseRunId = a.parse_run_id;
      if (fileId == null || parseRunId == null) return;
      setOpMessage(null);
      setOpBusy(true);
      try {
        const res = await fetchWithAuth(`/api/parse-runs/set-active/${fileId}/${parseRunId}`, { method: 'PUT' });
        const parseBody = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(parseBody.message || parseBody.detail || 'Failed to set active parse run');
        }
        if (parseBody.success === false) {
          throw new Error(parseBody.message || 'Failed to set active parse run');
        }
        const latestChunk = pickLatestChunkLinkForParse(baseGraphData.links, fileId, parseRunId);
        const chunkRunId = latestChunk?.attributes?.chunk_run_id;
        if (chunkRunId != null && activeKB) {
          const cr = await fetchWithAuth(`/api/chunk-runs/${chunkRunId}/active`, {
            method: 'PATCH',
            body: JSON.stringify({ knowledgebase_id: activeKB.id }),
          });
          if (!cr.ok) {
            const err = await cr.json().catch(() => ({}));
            throw new Error(err.detail || 'Failed to set active chunk run');
          }
        }
        await refetchGraph();
        setOpMessage(
          chunkRunId != null
            ? 'Parse run and latest related chunk run set active.'
            : 'Parse run set active (no chunk run for this parse).'
        );
      } catch (e) {
        setOpMessage(e.message || 'Operation failed');
      } finally {
        setOpBusy(false);
      }
    },
    [activeKB, baseGraphData.links, refetchGraph]
  );

  const handleChunkEdgeDoubleClick = useCallback(
    async (link) => {
      const a = link.attributes || {};
      const fileId = a.file_id;
      const chunkRunId = a.chunk_run_id;
      if (chunkRunId == null || !activeKB) return;
      setOpMessage(null);
      setOpBusy(true);
      try {
        const res = await fetchWithAuth(`/api/chunk-runs/${chunkRunId}/active`, {
          method: 'PATCH',
          body: JSON.stringify({ knowledgebase_id: activeKB.id }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.detail || 'Failed to set active chunk run');
        }
        const best = pickLatestParseLinkForChunkRun(baseGraphData.links, fileId, chunkRunId);
        const parseRunId = best?.attributes?.parse_run_id;
        if (fileId != null && parseRunId != null) {
          const pr = await fetchWithAuth(`/api/parse-runs/set-active/${fileId}/${parseRunId}`, { method: 'PUT' });
          const prData = await pr.json().catch(() => ({}));
          if (!pr.ok) {
            throw new Error(prData.message || prData.detail || 'Failed to set active parse run');
          }
          if (prData.success === false) {
            throw new Error(prData.message || 'Failed to set active parse run');
          }
        }
        await refetchGraph();
        setOpMessage(
          parseRunId != null
            ? 'Chunk run and latest related parse run set active.'
            : 'Chunk run set active (could not resolve parse run).'
        );
      } catch (e) {
        setOpMessage(e.message || 'Operation failed');
      } finally {
        setOpBusy(false);
      }
    },
    [activeKB, baseGraphData.links, refetchGraph]
  );

  /**
   * Parser/chunker: from edges that count as active (active parse/chunk/index pipeline).
   * Embedding node glow: only the globally active embedding config — not every embedding
   * that has an index run on the active chunk run (embed edges can still draw as active).
   */
  const { activeParserIds, activeChunkerIds, activeEmbeddingIds } = useMemo(() => {
    const parserIds = new Set();
    const chunkerIds = new Set();
    const embeddingIds = new Set();
    for (const l of baseGraphData.links) {
      if (!isEdgeActive(l)) continue;
      const { s, t } = linkEndpointIds(l);
      if (!s || !t) continue;
      if (l.type === 'parse') {
        parserIds.add(t);
      } else if (l.type === 'chunk') {
        parserIds.add(s);
        chunkerIds.add(t);
      } else if (l.type === 'embed') {
        chunkerIds.add(s);
      }
    }
    for (const l of baseGraphData.links) {
      if (l.type !== 'embed') continue;
      const a = l.attributes || {};
      if (!a.embedding_is_active) continue;
      const { t } = linkEndpointIds(l);
      if (t) embeddingIds.add(t);
    }
    return { activeParserIds: parserIds, activeChunkerIds: chunkerIds, activeEmbeddingIds: embeddingIds };
  }, [baseGraphData.links]);

  const nodeIndex = useMemo(() => {
    const byId = new Map();
    for (const n of baseGraphData.nodes) byId.set(n.id, n);
    return byId;
  }, [baseGraphData.nodes]);

  const nodeOptions = useMemo(() => {
    const nodes = [...baseGraphData.nodes];
    const typeRank = { document: 0, parser: 1, chunker: 2, embedding: 3, unknown: 4 };
    nodes.sort((a, b) => {
      const tr = (typeRank[a.type] ?? 9) - (typeRank[b.type] ?? 9);
      if (tr !== 0) return tr;
      return String(a.label || a.id).localeCompare(String(b.label || b.id));
    });
    return nodes;
  }, [baseGraphData.nodes]);

  const filteredGraphData = useMemo(() => {
    const baseLinks = onlyActive ? baseGraphData.links.filter(isEdgeActive) : baseGraphData.links;

    // No node filter: optionally still filter by active links
    if (!filterNodeIds || filterNodeIds.length === 0) {
      if (!onlyActive) return baseGraphData;

      const keep = new Set();
      for (const l of baseLinks) {
        const s = typeof l.source === 'string' ? l.source : l.source?.id;
        const t = typeof l.target === 'string' ? l.target : l.target?.id;
        if (s) keep.add(s);
        if (t) keep.add(t);
      }
      return {
        nodes: baseGraphData.nodes.filter(n => keep.has(n.id)),
        links: baseLinks,
      };
    }

    const seed = new Set(filterNodeIds);
    const keep = new Set(filterNodeIds);

    if (includeNeighbors) {
      for (const l of baseLinks) {
        const s = typeof l.source === 'string' ? l.source : l.source?.id;
        const t = typeof l.target === 'string' ? l.target : l.target?.id;
        if (!s || !t) continue;
        if (seed.has(s) || seed.has(t)) {
          keep.add(s);
          keep.add(t);
        }
      }
    }

    const nodes = baseGraphData.nodes.filter(n => keep.has(n.id));

    const links = baseLinks.filter(l => {
      const s = typeof l.source === 'string' ? l.source : l.source?.id;
      const t = typeof l.target === 'string' ? l.target : l.target?.id;
      if (!s || !t) return false;
      if (!keep.has(s) || !keep.has(t)) return false;
      // keep links that touch the selected nodes (or fully inside selection)
      return seed.has(s) || seed.has(t);
    });

    return { nodes, links };
  }, [baseGraphData, filterNodeIds, includeNeighbors, onlyActive]);

  const searchMatches = useMemo(() => {
    const q = filterQuery.trim().toLowerCase();
    if (!q) return [];
    const matches = [];
    for (const n of nodeOptions) {
      const hay = `${n.label || ''} ${n.id || ''}`.toLowerCase();
      if (hay.includes(q)) matches.push(n);
      if (matches.length >= 10) break;
    }
    return matches;
  }, [filterQuery, nodeOptions]);

  const addFilterNode = (nodeId) => {
    if (!nodeId) return;
    setFilterNodeIds(prev => (prev.includes(nodeId) ? prev : [...prev, nodeId]));
    setFilterQuery('');
  };

  const removeFilterNode = (nodeId) => {
    setFilterNodeIds(prev => prev.filter(id => id !== nodeId));
  };

  const clearFilters = () => setFilterNodeIds([]);

  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    try {
      // Baseline forces (compact but readable)
      fg.d3Force('charge')?.strength(-820);
      fg.d3Force('link')
        ?.distance((l) => (l.type === 'parse' ? 220 : l.type === 'embed' ? 150 : 170))
        ?.strength(0.9);
      fg.d3Force(
        'collide',
        forceCollide()
          .radius((n) => {
            const t = n?.type || 'unknown';
            if (t === 'document') return 34;
            if (t === 'parser') return 26;
            if (t === 'chunker') return 26;
            if (t === 'embedding') return 26;
            return 24;
          })
          .strength(0.9)
          .iterations(4)
      );
      fg.d3ReheatSimulation();
    } catch {
      // ignore
    }
  }, [filteredGraphData.nodes.length, filteredGraphData.links.length]);

  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    hasAutoFitRef.current = false;
    hasInteractedRef.current = false;
    const t = setTimeout(() => {
      try {
        // Don't fit immediately; wait for the simulation to spread out.
        if (!hasInteractedRef.current && !hasAutoFitRef.current) {
          fg.zoomToFit(900, 48);
          hasAutoFitRef.current = true;
        }
      } catch {
        // ignore
      }
    }, 250);
    return () => clearTimeout(t);
  }, [activeKB?.id, filteredGraphData.nodes.length, filteredGraphData.links.length]);

  if (!activeKB) {
    return (
      <div className="graph-view">
        <div className="graph-empty">No active knowledgebase. Select or create one first.</div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="graph-view">
        <div className="graph-loading">Loading graph…</div>
      </div>
    );
  }

  return (
    <div className="graph-view">
      {error && <div className="graph-error">{error}</div>}
      {opMessage && <div className={`graph-op-message ${opBusy ? 'graph-op-message-pending' : ''}`}>{opMessage}</div>}
      {opBusy && !opMessage && <div className="graph-op-message graph-op-message-pending">Updating active runs…</div>}

      {baseGraphData.nodes.length === 0 ? (
        <div className="graph-empty">No graph data (parse some documents and run chunking first).</div>
      ) : (
        <>
          <div className="filter-panel">
            <div className="filter-row">
              <div className="filter-search">
                <input
                  className="filter-input"
                  placeholder="Search nodes… (e.g. filename / parser / chunker / embedding)"
                  value={filterQuery}
                  onChange={(e) => setFilterQuery(e.target.value)}
                />
                {searchMatches.length > 0 && (
                  <div className="filter-suggestions">
                    {searchMatches.map(n => (
                      <button
                        key={n.id}
                        type="button"
                        className="filter-suggestion"
                        onClick={() => addFilterNode(n.id)}
                        title={n.id}
                      >
                        <span className={`badge badge-${n.type || 'unknown'}`}>{n.type}</span>
                        <span className="filter-suggestion-label">{n.label || n.id}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <select className="filter-select" defaultValue="" onChange={(e) => { addFilterNode(e.target.value); e.target.value = ''; }}>
                <option value="" disabled>+ Document</option>
                {nodeOptions.filter(n => n.type === 'document').map(n => (
                  <option key={n.id} value={n.id}>{n.label || n.id}</option>
                ))}
              </select>

              <select className="filter-select" defaultValue="" onChange={(e) => { addFilterNode(e.target.value); e.target.value = ''; }}>
                <option value="" disabled>+ Parser</option>
                {nodeOptions.filter(n => n.type === 'parser').map(n => (
                  <option key={n.id} value={n.id}>{n.label || n.id}</option>
                ))}
              </select>

              <select className="filter-select" defaultValue="" onChange={(e) => { addFilterNode(e.target.value); e.target.value = ''; }}>
                <option value="" disabled>+ Chunker</option>
                {nodeOptions.filter(n => n.type === 'chunker').map(n => (
                  <option key={n.id} value={n.id}>{n.label || n.id}</option>
                ))}
              </select>

              <select className="filter-select" defaultValue="" onChange={(e) => { addFilterNode(e.target.value); e.target.value = ''; }}>
                <option value="" disabled>+ Embedding</option>
                {nodeOptions.filter(n => n.type === 'embedding').map(n => (
                  <option key={n.id} value={n.id}>{n.label || n.id}</option>
                ))}
              </select>

              <label className="filter-toggle">
                <input type="checkbox" checked={includeNeighbors} onChange={(e) => setIncludeNeighbors(e.target.checked)} />
                <span>Include neighbors</span>
              </label>

              <label className="filter-toggle">
                <input type="checkbox" checked={onlyActive} onChange={(e) => setOnlyActive(e.target.checked)} />
                <span>Only active</span>
              </label>

              <button type="button" className="filter-clear" onClick={clearFilters} disabled={filterNodeIds.length === 0}>
                Clear
              </button>
            </div>

            {filterNodeIds.length > 0 && (
              <div className="filter-chips">
                {filterNodeIds.map(id => {
                  const n = nodeIndex.get(id);
                  const label = n?.label || id;
                  const type = n?.type || 'unknown';
                  return (
                    <span key={id} className="chip" title={id}>
                      <span className={`badge badge-${type}`}>{type}</span>
                      <span className="chip-label">{label}</span>
                      <button type="button" className="chip-x" onClick={() => removeFilterNode(id)}>×</button>
                    </span>
                  );
                })}
              </div>
            )}
          </div>

        <div className="graph-body">
          <div className="graph-canvas" ref={canvasWrapRef}>
            <ForceGraph2D
              ref={fgRef}
              graphData={filteredGraphData}
              width={canvasSize.width}
              height={canvasSize.height}
              cooldownTime={12000}
              warmupTicks={80}
              nodeRelSize={5}
              nodeId="id"
              nodeLabel={(n) => `${n.label || n.id}\n(${n.type || 'node'})`}
              linkLabel={(l) => {
                if (l.type === 'parse') {
                  const a = l.attributes || {};
                  return `parse | ${a.filename || ''} → ${a.parser || ''}\nrun: ${a.parse_run_id ?? '–'} | time: ${formatTimeUsage(a.time_usage)}`;
                }
                if (l.type === 'chunk') {
                  const a = l.attributes || {};
                  return `chunk | ${a.parser || ''} → ${(a.framework && a.chunker) ? `${a.framework}/${a.chunker}` : (a.framework || '')}\nchunk_run: ${a.chunk_run_id ?? '–'} | chunks: ${a.chunks_count ?? '–'}`;
                }
                if (l.type === 'embed') {
                  const a = l.attributes || {};
                  return `embed | chunk_run: ${a.chunk_run_id ?? '–'} → embedding: ${a.embedding_configure_id ?? '–'}\nindex_run: ${a.index_run_id ?? '–'}`;
                }
                return l.id || 'edge';
              }}
              nodeCanvasObject={(node, ctx, globalScale) => {
                const label = node.label || node.id;
                const t = node.type || 'unknown';
                const isHlParser = t === 'parser' && activeParserIds.has(node.id);
                const isHlChunker = t === 'chunker' && activeChunkerIds.has(node.id);
                const isHlEmbedding = t === 'embedding' && activeEmbeddingIds.has(node.id);
                const highlighted = isHlParser || isHlChunker || isHlEmbedding;

                const hlStyle = isHlParser
                  ? NODE_HIGHLIGHT.parser
                  : isHlEmbedding
                    ? NODE_HIGHLIGHT.embedding
                    : NODE_HIGHLIGHT.chunker;
                const base = highlighted
                  ? hlStyle.fill
                  : (node.color || NODE_COLORS.unknown);
                const radius = highlighted ? 8.5 : 7;
                const fontSize = Math.max(10, (highlighted ? 13.5 : 12) / globalScale);

                // Active parser/chunker/embedding: soft color wash behind the sphere (no outer stroke ring).
                if (highlighted) {
                  const rgb = hlStyle.auraRgb;
                  ctx.save();
                  const aura = ctx.createRadialGradient(
                    node.x,
                    node.y,
                    radius * 0.15,
                    node.x,
                    node.y,
                    radius + 14
                  );
                  aura.addColorStop(0, `rgba(${rgb}, 0.42)`);
                  aura.addColorStop(0.45, `rgba(${rgb}, 0.14)`);
                  aura.addColorStop(1, 'rgba(255, 255, 255, 0)');
                  ctx.fillStyle = aura;
                  ctx.beginPath();
                  ctx.arc(node.x, node.y, radius + 14, 0, 2 * Math.PI, false);
                  ctx.fill();
                  ctx.restore();
                }

                // Soft ambient shadow for depth
                ctx.save();
                ctx.shadowColor = highlighted ? hlStyle.shadow : 'rgba(15, 23, 42, 0.22)';
                ctx.shadowBlur = highlighted ? 18 : 10;
                ctx.shadowOffsetX = 0;
                ctx.shadowOffsetY = highlighted ? 6 : 5;

                // Main sphere with radial highlight
                const grad = ctx.createRadialGradient(
                  node.x - radius * 0.35,
                  node.y - radius * 0.35,
                  1,
                  node.x,
                  node.y,
                  radius + 1
                );
                grad.addColorStop(0, lightenHex(base, highlighted ? 0.68 : 0.55));
                grad.addColorStop(0.55, base);
                grad.addColorStop(1, 'rgba(0, 0, 0, 0.12)');

                ctx.beginPath();
                ctx.fillStyle = grad;
                ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI, false);
                ctx.fill();
                ctx.restore();

                // Subtle white rim only for non-highlighted nodes (no colored outer ring).
                if (!highlighted) {
                  ctx.save();
                  ctx.beginPath();
                  ctx.strokeStyle = 'rgba(255, 255, 255, 0.65)';
                  ctx.lineWidth = 1.2;
                  ctx.arc(node.x, node.y, radius + 0.6, 0, 2 * Math.PI, false);
                  ctx.stroke();
                  ctx.restore();
                }

                ctx.font = `${highlighted ? '600 ' : ''}${fontSize}px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial`;
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                ctx.fillStyle = highlighted ? hlStyle.text : 'rgba(15, 23, 42, 0.85)';
                if (highlighted) {
                  ctx.save();
                  ctx.shadowColor = isHlParser
                    ? 'rgba(109, 40, 217, 0.35)'
                    : isHlEmbedding
                      ? 'rgba(217, 119, 6, 0.35)'
                      : 'rgba(4, 120, 87, 0.35)';
                  ctx.shadowBlur = 6;
                  ctx.shadowOffsetX = 0;
                  ctx.shadowOffsetY = 0;
                  ctx.fillText(label, node.x + 9, node.y);
                  ctx.restore();
                } else {
                  ctx.fillText(label, node.x + 9, node.y);
                }
              }}
              linkWidth={(l) => {
                if (!isEdgeActive(l)) return 0.85;
                if (l.type === 'parse') return 2.6;
                return 2.1;
              }}
              linkColor={(l) => {
                const active = isEdgeActive(l);
                if (!active) return EDGE_COLORS.inactive;
                if (l.type === 'parse') return EDGE_COLORS.parseActive;
                if (l.type === 'embed') return EDGE_COLORS.embedActive;
                return EDGE_COLORS.chunkActive;
              }}
              linkDirectionalParticles={(l) => {
                if (!isEdgeActive(l)) return 0;
                if (l.type === 'parse') return 4;
                return 3;
              }}
              linkDirectionalParticleWidth={(l) => (isEdgeActive(l) ? 2.8 : 0)}
              linkDirectionalParticleSpeed={(l) => (isEdgeActive(l) ? 0.014 : 0)}
              linkDirectionalArrowLength={(l) => (isEdgeActive(l) ? 8 : 3)}
              linkDirectionalArrowRelPos={1}
              linkCurvature={(l) => l.curvature || 0}
              onNodeDrag={() => {
                hasInteractedRef.current = true;
                try {
                  fgRef.current?.d3ReheatSimulation();
                } catch {
                  // ignore
                }
              }}
              onNodeDragEnd={(node) => {
                // Ensure nodes don't remain pinned together after drag.
                hasInteractedRef.current = true;
                if (node) {
                  node.fx = undefined;
                  node.fy = undefined;
                }
                try {
                  fgRef.current?.d3ReheatSimulation();
                } catch {
                  // ignore
                }
              }}
              onNodeClick={(node) => {
                linkClickRef.current = { linkId: null, t: 0 };
                setSelected({ kind: 'node', data: node });
              }}
              onLinkClick={(link) => {
                const now = Date.now();
                const lid = link.id;
                const prev = linkClickRef.current;
                const isDbl = prev.linkId === lid && now - prev.t < 450;
                if (isDbl) {
                  linkClickRef.current = { linkId: null, t: 0 };
                  if (link.type === 'parse') {
                    void handleParseEdgeDoubleClick(link);
                  } else if (link.type === 'chunk') {
                    void handleChunkEdgeDoubleClick(link);
                  }
                  return;
                }
                linkClickRef.current = { linkId: lid, t: now };
                setSelected({ kind: 'edge', data: link });
              }}
              onBackgroundClick={() => {
                linkClickRef.current = { linkId: null, t: 0 };
                setSelected(null);
              }}
            />
          </div>

          <div className="graph-details">
            <div className="details-header">
              <div className="details-title">Details</div>
              {selected && (
                <button className="details-clear" onClick={() => setSelected(null)}>Clear</button>
              )}
            </div>

            {!selected ? (
              <div className="details-empty">
                Click a node or an edge to inspect attributes.
                <div className="details-hint">Double-click a parse or chunk edge to set that run active (and sync the latest related chunk/parse run).</div>
              </div>
            ) : selected.kind === 'node' ? (
              <div className="details-content">
                <Section title="Basic" defaultOpen>
                  <Kv k="Type" v={selected.data.type} />
                  <Kv k="Label" v={selected.data.label} />
                  <Kv k="ID" v={selected.data.id} />
                </Section>

                {selected.data.type === 'document' && (
                  <Section title="Document" defaultOpen>
                    <Kv k="file_id" v={selected.data.file_id} />
                    <Kv k="filepath" v={selected.data.filepath} />
                  </Section>
                )}

                {selected.data.type === 'chunker' && (
                  <Section title="Chunker" defaultOpen>
                    <Kv k="framework" v={selected.data.framework} />
                    <Kv k="chunker" v={selected.data.chunker} />
                  </Section>
                )}

                {selected.data.type === 'embedding' && (
                  <Section title="Embedding" defaultOpen>
                    <Kv k="embedding_config_id" v={selected.data.embedding_config_id} />
                    <Kv k="embedding_provider" v={selected.data.embedding_provider} />
                    <Kv k="embedding_model" v={selected.data.embedding_model} />
                  </Section>
                )}

                <JsonBlock title="Raw JSON" value={selected.data} defaultOpen={false} />
              </div>
            ) : (
              <div className="details-content">
                <Section title="Basic" defaultOpen>
                  <Kv k="Edge Type" v={selected.data.type} />
                  <Kv k="Edge ID" v={selected.data.id} />
                  <Kv k="From" v={selected.data.source?.id || selected.data.source} />
                  <Kv k="To" v={selected.data.target?.id || selected.data.target} />
                </Section>

                {selected.data.type === 'parse' && (
                  <>
                    <Section title="Document" defaultOpen>
                      <Kv k="file_id" v={selected.data.attributes?.file_id} />
                      <Kv k="filename" v={selected.data.attributes?.filename} />
                      <Kv k="filepath" v={selected.data.attributes?.filepath} />
                    </Section>
                    <Section title="Parser" defaultOpen>
                      <Kv k="parser" v={selected.data.attributes?.parser} />
                      <Kv k="parse_run_id" v={selected.data.attributes?.parse_run_id} />
                      <Kv k="parse_id" v={selected.data.attributes?.parse_id} />
                      <Kv k="is_active" v={String(selected.data.attributes?.is_active ?? '–')} />
                    </Section>
                    <Section title="Timing" defaultOpen>
                      <Kv k="time_usage" v={formatTimeUsage(selected.data.attributes?.time_usage)} />
                      <Kv k="time" v={selected.data.attributes?.time} />
                    </Section>
                    <JsonBlock title="Parser parameters" value={selected.data.attributes?.parameters || {}} defaultOpen />
                  </>
                )}

                {selected.data.type === 'chunk' && (
                  <>
                    <Section title="Link context" defaultOpen>
                      <Kv k="parser" v={selected.data.attributes?.parser} />
                      <Kv k="framework" v={selected.data.attributes?.framework} />
                      <Kv k="chunker" v={selected.data.attributes?.chunker} />
                    </Section>
                    <Section title="Run" defaultOpen>
                      <Kv k="chunk_run_id" v={selected.data.attributes?.chunk_run_id} />
                      <Kv k="run_time" v={selected.data.attributes?.run_time} />
                      <Kv k="chunks_count" v={selected.data.attributes?.chunks_count} />
                    </Section>
                    <Section title="Document/parse" defaultOpen={false}>
                      <Kv k="file_id" v={selected.data.attributes?.file_id} />
                      <Kv k="filename" v={selected.data.attributes?.filename} />
                      <Kv k="filepath" v={selected.data.attributes?.filepath} />
                      <Kv k="parse_run_id" v={selected.data.attributes?.parse_run_id} />
                      <Kv k="parse_time_usage" v={formatTimeUsage(selected.data.attributes?.parse_time_usage)} />
                      <Kv k="parse_time" v={selected.data.attributes?.parse_time} />
                    </Section>
                    <JsonBlock title="Chunker parameters" value={selected.data.attributes?.chunker_parameters || {}} defaultOpen />
                    <JsonBlock title="Chunk run parameters" value={selected.data.attributes?.run_parameters || {}} defaultOpen={false} />
                    <JsonBlock title="Parser parameters (from parse run)" value={selected.data.attributes?.parser_parameters || {}} defaultOpen={false} />
                  </>
                )}

                {selected.data.type === 'embed' && (
                  <>
                    <Section title="Index run" defaultOpen>
                      <Kv k="index_run_id" v={selected.data.attributes?.index_run_id} />
                      <Kv k="chunk_run_id" v={selected.data.attributes?.chunk_run_id} />
                      <Kv k="embedding_configure_id" v={selected.data.attributes?.embedding_configure_id} />
                      <Kv k="run_time" v={selected.data.attributes?.run_time} />
                    </Section>
                    <Section title="Active flags" defaultOpen>
                      <Kv k="chunk_run_is_active" v={String(selected.data.attributes?.chunk_run_is_active ?? '–')} />
                      <Kv k="chunk_run_in_sync" v={String(selected.data.attributes?.chunk_run_in_sync ?? '–')} />
                      <Kv k="embedding_is_active" v={String(selected.data.attributes?.embedding_is_active ?? '–')} />
                    </Section>
                  </>
                )}

                <JsonBlock
                  title="Raw JSON"
                  value={{ ...selected.data, source: selected.data.source?.id || selected.data.source, target: selected.data.target?.id || selected.data.target }}
                  defaultOpen={false}
                />
              </div>
            )}
          </div>
        </div>
        </>
      )}
    </div>
  );
};

export default GraphView;

