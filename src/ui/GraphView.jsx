import React, { useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import { forceCollide } from 'd3-force';
import useKnowledgebaseStore, { fetchWithAuth } from './store';
import './GraphView.css';

const NODE_COLORS = {
  document: '#2563eb',
  parser: '#7c3aed',
  chunker: '#059669',
  unknown: '#64748b',
};

const EDGE_COLORS = {
  parseActive: 'rgba(124, 58, 237, 0.55)',
  chunkActive: 'rgba(5, 150, 105, 0.55)',
  inactive: 'rgba(148, 163, 184, 0.55)', // slate-400
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

function isEdgeActive(link) {
  const a = link?.attributes || {};
  if (link?.type === 'parse') return Boolean(a.is_active);
  if (link?.type === 'chunk') {
    const parseActive = a.parse_is_active;
    const runActive = a.chunk_run_is_active;
    const inSync = a.chunk_run_in_sync;
    // if flags missing, assume active (backward compatible)
    const okParse = parseActive === undefined ? true : Boolean(parseActive);
    const okRun = runActive === undefined ? true : Boolean(runActive);
    const okSync = inSync === undefined ? true : Boolean(inSync);
    return okParse && okRun && okSync;
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
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [rawGraph, setRawGraph] = useState({ nodes: [], edges: [] });
  const [selected, setSelected] = useState(null); // { kind: 'node'|'edge', data }
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 500 });
  const [filterQuery, setFilterQuery] = useState('');
  const [filterNodeIds, setFilterNodeIds] = useState([]); // node ids
  const [includeNeighbors, setIncludeNeighbors] = useState(true);
  const [onlyActive, setOnlyActive] = useState(false);

  useEffect(() => {
    const el = canvasWrapRef.current;
    if (!el) return;

    const update = () => {
      const rect = el.getBoundingClientRect();
      const width = Math.max(320, Math.floor(rect.width));
      const height = Math.max(260, Math.floor(rect.height));
      setCanvasSize(prev => (prev.width === width && prev.height === height ? prev : { width, height }));
    };

    update();
    const ro = new ResizeObserver(() => update());
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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

  const baseGraphData = useMemo(() => {
    const nodes = (rawGraph.nodes || []).map(n => {
      const type = n.type || 'unknown';
      const color = NODE_COLORS[type] || NODE_COLORS.unknown;

      // Better initial layout: document -> parser -> chunker along X axis.
      // Keep deterministic scatter via hash so it doesn't start in a corner.
      const u = hash01(n.id || '');
      const v = hash01(`${n.id || ''}::y`);
      const xBand = type === 'document' ? -240 : type === 'parser' ? 0 : type === 'chunker' ? 240 : 0;
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

  const nodeIndex = useMemo(() => {
    const byId = new Map();
    for (const n of baseGraphData.nodes) byId.set(n.id, n);
    return byId;
  }, [baseGraphData.nodes]);

  const nodeOptions = useMemo(() => {
    const nodes = [...baseGraphData.nodes];
    const typeRank = { document: 0, parser: 1, chunker: 2, unknown: 3 };
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
      fg.d3Force('charge')?.strength(-420);
      fg.d3Force('link')?.distance((l) => (l.type === 'parse' ? 170 : 130))?.strength(0.95);
      fg.d3Force(
        'collide',
        forceCollide()
          .radius((n) => {
            const t = n?.type || 'unknown';
            if (t === 'document') return 34;
            if (t === 'parser') return 26;
            if (t === 'chunker') return 26;
            return 24;
          })
          .strength(0.9)
          .iterations(2)
      );
      fg.d3ReheatSimulation();
    } catch {
      // ignore
    }
  }, [filteredGraphData.nodes.length, filteredGraphData.links.length]);

  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    const t = setTimeout(() => {
      try {
        fg.zoomToFit(450, 24);
      } catch {
        // ignore
      }
    }, 50);
    return () => clearTimeout(t);
  }, [activeKB?.id, filteredGraphData.nodes.length, filteredGraphData.links.length, canvasSize.width, canvasSize.height]);

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

      {baseGraphData.nodes.length === 0 ? (
        <div className="graph-empty">No graph data (parse some documents and run chunking first).</div>
      ) : (
        <>
          <div className="filter-panel">
            <div className="filter-row">
              <div className="filter-search">
                <input
                  className="filter-input"
                  placeholder="Search nodes… (e.g. filename / parser / chunker)"
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
                return l.id || 'edge';
              }}
              nodeCanvasObject={(node, ctx, globalScale) => {
                const label = node.label || node.id;
                const base = node.color || NODE_COLORS.unknown;
                const radius = 7;
                const fontSize = Math.max(10, 12 / globalScale);

                // Soft ambient shadow for depth
                ctx.save();
                ctx.shadowColor = 'rgba(15, 23, 42, 0.22)';
                ctx.shadowBlur = 10;
                ctx.shadowOffsetX = 0;
                ctx.shadowOffsetY = 5;

                // Main sphere with radial highlight
                const grad = ctx.createRadialGradient(
                  node.x - radius * 0.35,
                  node.y - radius * 0.35,
                  1,
                  node.x,
                  node.y,
                  radius + 1
                );
                grad.addColorStop(0, lightenHex(base, 0.55));
                grad.addColorStop(0.55, base);
                grad.addColorStop(1, 'rgba(0, 0, 0, 0.12)');

                ctx.beginPath();
                ctx.fillStyle = grad;
                ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI, false);
                ctx.fill();
                ctx.restore();

                // Outer glow ring
                ctx.save();
                ctx.beginPath();
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.65)';
                ctx.lineWidth = 1.2;
                ctx.arc(node.x, node.y, radius + 0.6, 0, 2 * Math.PI, false);
                ctx.stroke();
                ctx.restore();

                ctx.font = `${fontSize}px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial`;
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
                ctx.fillText(label, node.x + 9, node.y);
              }}
              linkWidth={(l) => (l.type === 'parse' ? 1.4 : 1.2)}
              linkColor={(l) => {
                const active = isEdgeActive(l);
                if (!active) return EDGE_COLORS.inactive;
                return l.type === 'parse' ? EDGE_COLORS.parseActive : EDGE_COLORS.chunkActive;
              }}
              linkDirectionalParticles={(l) => {
                if (!isEdgeActive(l)) return 0;
                return l.type === 'parse' ? 2 : 1;
              }}
              linkDirectionalParticleWidth={2}
              linkDirectionalParticleSpeed={0.010}
              linkDirectionalArrowLength={4}
              linkDirectionalArrowRelPos={1}
              linkCurvature={(l) => l.curvature || 0}
              onEngineStop={() => {
                try {
                  fgRef.current?.zoomToFit(450, 24);
                } catch {
                  // ignore
                }
              }}
              onNodeDrag={() => {
                try {
                  fgRef.current?.d3ReheatSimulation();
                } catch {
                  // ignore
                }
              }}
              onNodeClick={(node) => setSelected({ kind: 'node', data: node })}
              onLinkClick={(link) => setSelected({ kind: 'edge', data: link })}
              onBackgroundClick={() => setSelected(null)}
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
              <div className="details-empty">Click a node or an edge to inspect attributes.</div>
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

