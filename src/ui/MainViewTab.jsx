import React, { useRef, useState, useCallback, useEffect } from 'react';
import './MainViewTab.css';

export default function MainViewTab({ mainView }) {
  const iframeRef = useRef(null);
  const [renderMd, setRenderMd] = useState(false);
  const [chunkOnly, setChunkOnly] = useState(false);

  useEffect(() => {
    if (mainView?.phase !== 'ready') return;
    setRenderMd(false);
    setChunkOnly(false);
  }, [mainView?.htmlKey, mainView?.phase]);

  const handleIframeLoad = useCallback(() => {
    const frame = iframeRef.current;
    if (!frame || mainView?.phase !== 'ready') return;
    const doc = frame.contentDocument;
    if (!doc) return;

    if (mainView.viewKind === 'parsed') {
      const t = doc.getElementById('mdToggle');
      if (t) {
        t.checked = false;
        t.dispatchEvent(new Event('change', { bubbles: true }));
      }
      setRenderMd(false);
    } else if (mainView.viewKind === 'chunks' && mainView.showChunkOnlyToggle) {
      doc.body?.classList.remove('chunk-visual--chunk-only');
      setChunkOnly(false);
    }
  }, [mainView?.phase, mainView?.viewKind, mainView?.showChunkOnlyToggle]);

  const onParsedMdChange = useCallback((e) => {
    const v = e.target.checked;
    setRenderMd(v);
    const t = iframeRef.current?.contentDocument?.getElementById('mdToggle');
    if (t && t.checked !== v) {
      t.checked = v;
      t.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }, []);

  const onChunkToggle = useCallback(() => {
    setChunkOnly((prev) => {
      const next = !prev;
      const body = iframeRef.current?.contentDocument?.body;
      if (body) {
        body.classList.toggle('chunk-visual--chunk-only', next);
      }
      return next;
    });
  }, []);

  if (!mainView) return null;

  const showParsedMd = mainView.phase === 'ready' && mainView.viewKind === 'parsed';
  const showChunkBtn =
    mainView.phase === 'ready' && mainView.viewKind === 'chunks' && mainView.showChunkOnlyToggle === true;

  return (
    <div className="main-view-tab">
      <div className="main-view-tab__bar">
        <span className="main-view-tab__title">
          {mainView.phase === 'ready'
            ? `View — ${mainView.headline}`
            : mainView.phase === 'loading'
              ? `Loading — ${mainView.headline}`
              : `Error — ${mainView.headline}`}
        </span>
        <div className="main-view-tab__actions">
          {showParsedMd && (
            <label className="main-view-tab__md-label">
              <span className="main-view-tab__md-text">Render Markdown</span>
              <span className="main-view-tab__switch">
                <input
                  type="checkbox"
                  checked={renderMd}
                  onChange={onParsedMdChange}
                  aria-label="Render Markdown"
                />
                <span className="main-view-tab__switch-slider" aria-hidden />
              </span>
            </label>
          )}
          {showChunkBtn && (
            <button
              type="button"
              className="main-view-tab__chunk-toggle"
              onClick={onChunkToggle}
              aria-pressed={chunkOnly}
            >
              {chunkOnly ? 'Full document' : 'Chunk only'}
            </button>
          )}
        </div>
      </div>
      <div className="main-view-tab__body">
        {mainView.phase === 'loading' && (
          <div className="main-view-tab__loading">
            <div className="main-view-tab__spinner" aria-hidden />
            <p className="main-view-tab__hint">{mainView.hint}</p>
          </div>
        )}
        {mainView.phase === 'error' && (
          <div className="main-view-tab__error">
            <h2 className="main-view-tab__error-title">Failed to load</h2>
            <p className="main-view-tab__error-msg">{mainView.message}</p>
          </div>
        )}
        {mainView.phase === 'ready' && (
          <iframe
            ref={iframeRef}
            key={mainView.htmlKey}
            title="Visualization"
            className="main-view-tab__iframe"
            srcDoc={mainView.html}
            sandbox="allow-scripts allow-same-origin"
            onLoad={handleIframeLoad}
          />
        )}
      </div>
    </div>
  );
}
