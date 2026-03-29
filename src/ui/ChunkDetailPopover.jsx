import React, { useEffect, useRef } from 'react';

export function formatMetaValue(v) {
  if (v == null) return '';
  if (typeof v === 'object') {
    try {
      return JSON.stringify(v, null, 2);
    } catch {
      return String(v);
    }
  }
  return String(v);
}

/**
 * Floating chunk / query detail panel (UMAP dot click or retrieval list ID click).
 */
export default function ChunkDetailPopover({
  popover,
  onClose,
  chunkDetail,
  detailLoading,
  detailError,
}) {
  const panelRef = useRef(null);

  useEffect(() => {
    if (!popover) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    const onDocDown = (e) => {
      if (panelRef.current?.contains(e.target)) return;
      if (
        e.target.closest?.(
          '.umap-hit-area, .umap-query-hit, .result-chunk-id-btn',
        )
      ) {
        return;
      }
      onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDocDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDocDown);
    };
  }, [popover, onClose]);

  if (!popover) return null;

  const pad = 12;
  const maxW = 440;
  const maxH = Math.min(520, typeof window !== 'undefined' ? window.innerHeight - 40 : 520);
  let left = popover.clientX + pad;
  let top = popover.clientY + pad;
  if (typeof window !== 'undefined') {
    left = Math.min(left, window.innerWidth - maxW - pad);
    top = Math.min(top, window.innerHeight - maxH - pad);
    left = Math.max(pad, left);
    top = Math.max(pad, top);
  }

  return (
    <>
      <div className="umap-detail-backdrop" aria-hidden />
      <div
        ref={panelRef}
        className="umap-detail-popover"
        style={{ left, top, maxWidth: maxW, maxHeight: maxH }}
        role="dialog"
        aria-modal="true"
        aria-label="Chunk detail"
      >
        <div className="umap-detail-popover-header">
          <h4 className="umap-detail-title">
            {popover.type === 'query' ? 'Query vector' : `Chunk: ${popover.chunkId}`}
          </h4>
          <button type="button" className="umap-detail-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="umap-detail-popover-body">
          {popover.type === 'query' ? (
            <pre className="umap-detail-content">{popover.queryText || '(No query text)'}</pre>
          ) : detailLoading ? (
            <div className="umap-detail-loading">Loading…</div>
          ) : detailError ? (
            <div className="umap-detail-error">{detailError}</div>
          ) : chunkDetail ? (
            <>
              {chunkDetail.document_name ? (
                <div className="umap-detail-filename">{chunkDetail.document_name}</div>
              ) : null}
              <div className="umap-detail-section-label">Content</div>
              <pre className="umap-detail-content">
                {chunkDetail.content?.trim() ? chunkDetail.content : '(No content)'}
              </pre>
              <div className="umap-detail-section-label">Metadata</div>
              {chunkDetail.metadata && Object.keys(chunkDetail.metadata).length > 0 ? (
                <dl className="umap-detail-meta">
                  {[...Object.entries(chunkDetail.metadata)]
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([k, v]) => (
                      <div key={k} className="umap-detail-meta-row">
                        <dt>{k}</dt>
                        <dd>{formatMetaValue(v)}</dd>
                      </div>
                    ))}
                </dl>
              ) : (
                <div className="umap-detail-empty-meta">(No metadata)</div>
              )}
            </>
          ) : null}
        </div>
      </div>
    </>
  );
}
