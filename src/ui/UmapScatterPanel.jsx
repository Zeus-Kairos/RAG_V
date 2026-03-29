import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { fetchWithAuth } from './store';
import ChunkDetailPopover from './ChunkDetailPopover';

const DISPLAY_LABEL_MAX = 44;
const PLOT_W = 640;
const PLOT_H = 400;

function truncateLabel(text, maxLen = DISPLAY_LABEL_MAX) {
  const t = String(text ?? '')
    .trim()
    .replace(/\s+/g, ' ');
  if (t.length <= maxLen) return t;
  return `${t.slice(0, maxLen - 1)}…`;
}

function clientPointToSvg(svgEl, clientX, clientY) {
  if (!svgEl) return { x: 0, y: 0 };
  const rect = svgEl.getBoundingClientRect();
  const b = svgEl.viewBox.baseVal;
  if (!rect.width || !rect.height || !b.width || !b.height) {
    return { x: 0, y: 0 };
  }
  const scaleX = b.width / rect.width;
  const scaleY = b.height / rect.height;
  return {
    x: b.x + (clientX - rect.left) * scaleX,
    y: b.y + (clientY - rect.top) * scaleY,
  };
}

function clampViewBox(vb, w, h) {
  const ar = h / w;
  let { x, y, vw } = vb;
  vw = Math.min(w * 8, Math.max(w / 16, vw));
  const vh = vw * ar;
  return { x, y, vw, vh };
}

function zoomViewBoxAroundPoint(prev, anchorX, anchorY, zoomFactor, w, h) {
  const ar = h / w;
  const { x, y, vw, vh } = prev;
  const relX = (anchorX - x) / vw;
  const relY = (anchorY - y) / vh;
  const nvw = vw / zoomFactor;
  const nvh = nvw * ar;
  const nx = anchorX - relX * nvw;
  const ny = anchorY - relY * nvh;
  return clampViewBox({ x: nx, y: ny, vw: nvw, vh: nvh }, w, h);
}

/** SVG plot with pan (drag) and zoom (wheel). */
function UmapSvgView({ kbName, indexRunId, data, bounds, queryKey }) {
  const svgRef = useRef(null);
  const dragRef = useRef(false);
  const [popover, setPopover] = useState(null);
  const [chunkDetail, setChunkDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState(null);

  const w = PLOT_W;
  const h = PLOT_H;
  const { minX, maxX, minY, maxY } = bounds;

  const tx = useCallback(
    (x) => ((x - minX) / (maxX - minX)) * w,
    [minX, maxX, w],
  );
  const ty = useCallback(
    (y) => h - ((y - minY) / (maxY - minY)) * h,
    [minY, maxY, h],
  );

  const [vb, setVb] = useState({ x: 0, y: 0, vw: w, vh: h });

  useEffect(() => {
    setVb({ x: 0, y: 0, vw: w, vh: h });
    setPopover(null);
    setChunkDetail(null);
    setDetailError(null);
  }, [data, minX, maxX, minY, maxY, w, h]);

  useEffect(() => {
    if (!popover || popover.type !== 'chunk') {
      setChunkDetail(null);
      setDetailError(null);
      setDetailLoading(false);
      return undefined;
    }
    let cancelled = false;
    (async () => {
      setDetailLoading(true);
      setDetailError(null);
      setChunkDetail(null);
      try {
        const res = await fetchWithAuth(
          `/api/retrieve/${encodeURIComponent(kbName)}/${indexRunId}/chunk/${encodeURIComponent(popover.chunkId)}`,
        );
        const text = await res.text();
        let json;
        try {
          json = JSON.parse(text);
        } catch {
          throw new Error(text || res.statusText);
        }
        if (!res.ok) {
          throw new Error(json.detail || json.message || res.statusText);
        }
        if (cancelled) return;
        if (!json.success) {
          throw new Error(json.message || 'Failed to load');
        }
        setChunkDetail({
          content: json.content ?? '',
          metadata: json.metadata ?? {},
          document_name: json.document_name ?? '',
        });
      } catch (e) {
        if (!cancelled) setDetailError(e.message || String(e));
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [popover, kbName, indexRunId]);

  const closePopover = useCallback(() => {
    setPopover(null);
    setChunkDetail(null);
    setDetailError(null);
  }, []);

  const openChunkPopover = useCallback((chunkId, e) => {
    e?.preventDefault?.();
    e?.stopPropagation?.();
    setPopover({
      type: 'chunk',
      chunkId,
      clientX: e.clientX,
      clientY: e.clientY,
    });
  }, []);

  const openQueryPopover = useCallback(
    (e) => {
      e?.preventDefault?.();
      e?.stopPropagation?.();
      const q = (data.query_label || queryKey || '').trim();
      setPopover({
        type: 'query',
        clientX: e.clientX,
        clientY: e.clientY,
        queryText: q || '(No query text)',
      });
    },
    [data.query_label, queryKey],
  );

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      e.preventDefault();
      const zf = e.deltaY > 0 ? 0.92 : 1 / 0.92;
      const { x: ax, y: ay } = clientPointToSvg(el, e.clientX, e.clientY);
      setVb((prev) => zoomViewBoxAroundPoint(prev, ax, ay, zf, w, h));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [w, h]);

  const resetView = useCallback(() => {
    setVb({ x: 0, y: 0, vw: w, vh: h });
  }, [w, h]);

  const onPanLayerPointerDown = (e) => {
    if (e.button !== 0) return;
    dragRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPanLayerPointerUp = (e) => {
    dragRef.current = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };
  const onPanLayerPointerLeave = (e) => {
    if (!e.buttons) dragRef.current = false;
  };
  const onPanLayerPointerMove = (e) => {
    if (!dragRef.current || !svgRef.current) return;
    const el = svgRef.current;
    const rect = el.getBoundingClientRect();
    setVb((v) => {
      const sx = v.vw / rect.width;
      const sy = v.vh / rect.height;
      return {
        ...v,
        x: v.x - e.movementX * sx,
        y: v.y - e.movementY * sy,
      };
    });
  };

  const qx = data.query_point ? tx(data.query_point.x) : null;
  const qy = data.query_point ? ty(data.query_point.y) : null;

  const otherPoints = useMemo(
    () => (data.points || []).filter((p) => !p.is_hit),
    [data.points],
  );
  const hitPoints = useMemo(
    () => (data.points || []).filter((p) => p.is_hit),
    [data.points],
  );

  const renderPointGroup = (p) => {
    const raw = p.label_text || p.document_name || p.id;
    const shown = truncateLabel(raw);
    const labelClass = p.is_hit ? 'umap-label-hit' : 'umap-label';
    const cx = tx(p.x);
    const cy = ty(p.y);
    const vr = p.is_hit ? 6 : 3;
    return (
      <g key={p.id} className="umap-point-group">
        <title>{raw}</title>
        <circle
          cx={cx}
          cy={cy}
          r={Math.max(14, vr + 10)}
          fill="transparent"
          className="umap-hit-area"
          style={{ cursor: 'pointer' }}
          onClick={(e) => openChunkPopover(p.id, e)}
        />
        <circle
          cx={cx}
          cy={cy}
          r={vr}
          className={p.is_hit ? 'umap-dot-hit' : 'umap-dot'}
          style={{ pointerEvents: 'none' }}
        />
        <text
          x={cx + 9}
          y={cy}
          dominantBaseline="middle"
          className={labelClass}
          style={{ pointerEvents: 'none' }}
        >
          {shown}
        </text>
      </g>
    );
  };

  return (
    <div className="umap-svg-wrap">
      <div className="umap-svg-toolbar">
        <span className="umap-svg-hint">
          Wheel: zoom · Drag empty area: pan · Click a dot: full text and metadata
        </span>
        <button type="button" className="umap-svg-reset" onClick={resetView}>
          Reset view
        </button>
      </div>
      <svg
        ref={svgRef}
        viewBox={`${vb.x} ${vb.y} ${vb.vw} ${vb.vh}`}
        className="umap-svg umap-svg--pannable"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Vector map"
      >
        <rect
          x={0}
          y={0}
          width={w}
          height={h}
          fill="transparent"
          className="umap-pan-layer"
          onPointerDown={onPanLayerPointerDown}
          onPointerMove={onPanLayerPointerMove}
          onPointerUp={onPanLayerPointerUp}
          onPointerCancel={onPanLayerPointerUp}
          onPointerLeave={onPanLayerPointerLeave}
        />
        {otherPoints.map(renderPointGroup)}
        {hitPoints.map(renderPointGroup)}
        {qx != null && qy != null && (
          <g className="umap-query-group">
            <title>{`Query: ${data.query_label || queryKey || ''}`}</title>
            <circle
              cx={qx}
              cy={qy}
              r={16}
              fill="transparent"
              className="umap-query-hit"
              style={{ cursor: 'pointer' }}
              onClick={openQueryPopover}
            />
            <path
              d={`M ${qx} ${qy - 8} L ${qx + 7} ${qy + 5} L ${qx - 7} ${qy + 5} Z`}
              className="umap-query-marker"
              style={{ pointerEvents: 'none' }}
            />
            {(data.query_label || queryKey.trim()) ? (
              <text
                x={qx + 11}
                y={qy}
                dominantBaseline="middle"
                className="umap-label-query"
                style={{ pointerEvents: 'none' }}
              >
                {truncateLabel(data.query_label || queryKey)}
              </text>
            ) : null}
          </g>
        )}
      </svg>
      <ChunkDetailPopover
        popover={popover}
        onClose={closePopover}
        chunkDetail={chunkDetail}
        detailLoading={detailLoading}
        detailError={detailError}
      />
    </div>
  );
}

/**
 * Fetches UMAP 2D projection for one index run and renders an SVG scatter plot.
 * Query point and top-hit chunks are styled distinctly when `query` / `highlightIds` are set.
 */
export default function UmapScatterPanel({
  kbName,
  indexRunId,
  query,
  highlightIds,
}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  const highlightKey = JSON.stringify(
    (highlightIds ?? []).map(String).sort(),
  );
  const queryKey = String(query ?? '');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!kbName || indexRunId == null) {
        if (!cancelled) setLoading(false);
        return;
      }
      setLoading(true);
      setErr(null);
      try {
        const res = await fetchWithAuth(
          `/api/retrieve/${encodeURIComponent(kbName)}/${indexRunId}/umap`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              query: query && String(query).trim() ? String(query).trim() : null,
              highlight_chunk_ids: highlightIds || [],
            }),
          },
        );
        const text = await res.text();
        if (!res.ok) {
          let detail = text;
          try {
            const j = JSON.parse(text);
            detail = j.detail || j.message || text;
          } catch {
            /* use raw text */
          }
          throw new Error(detail || res.statusText);
        }
        const json = JSON.parse(text);
        if (cancelled) return;
        if (!json.success) {
          throw new Error(json.message || 'UMAP request failed');
        }
        setData(json);
      } catch (e) {
        if (!cancelled) setErr(e.message || String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [kbName, indexRunId, queryKey, highlightKey]);

  const bounds = useMemo(() => {
    if (!data) return null;
    const pts = data.points || [];
    const xs = [];
    const ys = [];
    pts.forEach((p) => {
      xs.push(p.x);
      ys.push(p.y);
    });
    if (data.query_point) {
      xs.push(data.query_point.x);
      ys.push(data.query_point.y);
    }
    if (!xs.length) return null;
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const span = Math.max(maxX - minX, maxY - minY, 1e-9);
    const pad = span * 0.08;
    return {
      minX: minX - pad,
      maxX: maxX + pad + span * 0.28,
      minY: minY - pad,
      maxY: maxY + pad,
    };
  }, [data]);

  if (loading) {
    return <div className="umap-panel-loading">Computing UMAP…</div>;
  }
  if (err) {
    return <div className="umap-panel-error">{err}</div>;
  }
  if (!data || !data.points || data.points.length === 0) {
    return <div className="umap-panel-empty">No vectors in index</div>;
  }

  return (
    <div className="umap-panel">
      <div className="umap-legend">
        <span className="umap-legend-item umap-legend-query">
          <span className="umap-legend-swatch umap-swatch-query" /> Query vector
        </span>
        <span className="umap-legend-item umap-legend-hit">
          <span className="umap-legend-swatch umap-swatch-hit" /> Hit
        </span>
        <span className="umap-legend-item umap-legend-base">
          <span className="umap-legend-swatch umap-swatch-base" /> Other chunks
        </span>
        <span className="umap-method">{data.method === 'umap' ? 'UMAP' : data.method === 'pca' ? 'PCA' : data.method}</span>
      </div>
      <UmapSvgView
        kbName={kbName}
        indexRunId={indexRunId}
        data={data}
        bounds={bounds}
        queryKey={queryKey}
      />
    </div>
  );
}
