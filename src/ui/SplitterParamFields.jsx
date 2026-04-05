import React, { useEffect, useMemo, useState } from 'react';

function isDisabled(spec, values) {
  if (!spec.disabledWhen) return false;
  const { field, equals } = spec.disabledWhen;
  return values[field] === equals;
}

function parseNumeric(type, raw, fallback) {
  if (type === 'float') {
    const n = parseFloat(raw);
    return Number.isNaN(n) ? fallback : n;
  }
  const n = parseInt(raw, 10);
  return Number.isNaN(n) ? fallback : n;
}

function clamp(n, min, max) {
  let x = n;
  if (typeof min === 'number') x = Math.max(min, x);
  if (typeof max === 'number') x = Math.min(max, x);
  return x;
}

/**
 * Renders splitter param controls from splitterConfig field definitions (same shape as parser params).
 */
export default function SplitterParamFields({
  fields,
  values,
  onChange,
  idPrefix = 'split',
  hybridTokenizer,
}) {
  const [localNumericText, setLocalNumericText] = useState({});

  const sliderInputFingerprint = useMemo(() => {
    const keys = Object.entries(fields || {})
      .filter(([, s]) => s.ui === 'sliderWithInput' && (s.type === 'int' || s.type === 'float'))
      .map(([k]) => k);
    return keys.map((k) => `${k}:${values[k]}`).join('|');
  }, [fields, values]);

  useEffect(() => {
    const patch = {};
    Object.entries(fields || {}).forEach(([key, spec]) => {
      if (spec.ui === 'sliderWithInput' && (spec.type === 'int' || spec.type === 'float')) {
        const v = values[key];
        patch[key] = String(v ?? spec.default ?? spec.min ?? 0);
      }
    });
    setLocalNumericText((prev) => ({ ...prev, ...patch }));
  }, [sliderInputFingerprint, fields]);

  const setLocal = (key, text) => {
    setLocalNumericText((prev) => ({ ...prev, [key]: text }));
  };

  const commitNumeric = (key, spec) => {
    const raw = localNumericText[key] ?? String(values[key] ?? '');
    const min = spec.min;
    const max = resolveMax(spec, values);
    const fallback = values[key] ?? spec.default ?? min ?? 0;
    let v = parseNumeric(spec.type, raw, fallback);
    v = clamp(v, min, max);
    onChange(key, v);
    setLocal(key, String(v));
  };

  const entries = Object.entries(fields || {});

  return (
    <>
      {entries.map(([fieldKey, spec]) => {
        const disabled = isDisabled(spec, values);
        const id = `${idPrefix}-${fieldKey}`;

        if (spec.hybridTableSize) {
          const tok = hybridTokenizer || 'row';
          const storeKey = tok === 'character' ? 'tableChunkSizeCharacter' : 'tableChunkSizeRow';
          const v = values[storeKey] ?? (tok === 'character' ? 200 : 3);
          const maxInput = tok === 'character' ? spec.maxInputCharacter ?? 20000 : spec.maxInputRow ?? 1000;
          const sliderMax = tok === 'character' ? spec.sliderMaxCharacter ?? 2000 : spec.sliderMaxRow ?? 50;
          const suffix = tok === 'character' ? 'chars' : 'rows';

          return (
            <div key={fieldKey} className="param-group">
              <label htmlFor={id} className="param-label-with-input">
                {spec.label} ({suffix}):
                <input
                  type="number"
                  id={id}
                  className="param-text-input-inline"
                  min={0}
                  max={maxInput}
                  value={v}
                  disabled={disabled}
                  onChange={(e) => {
                    const n = parseInt(e.target.value, 10);
                    if (!Number.isNaN(n) && n >= 0) {
                      onChange(storeKey, Math.min(n, maxInput));
                    }
                  }}
                />
              </label>
              <input
                type="range"
                className="param-slider"
                min={0}
                max={sliderMax}
                value={Math.min(Math.max(v, 0), sliderMax)}
                disabled={disabled}
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10);
                  onChange(storeKey, n);
                }}
              />
              {spec.description ? <p className="param-description">{spec.description}</p> : null}
            </div>
          );
        }

        if (spec.type === 'boolean') {
          return (
            <div key={fieldKey} className="param-group checkbox">
              <div className="param-checkbox-row">
                <input
                  type="checkbox"
                  id={id}
                  checked={!!values[fieldKey]}
                  disabled={disabled}
                  onChange={(e) => onChange(fieldKey, e.target.checked)}
                />
                <label htmlFor={id}>{spec.label}</label>
              </div>
              {spec.description ? (
                <p className="param-description param-description-below-checkbox">{spec.description}</p>
              ) : null}
            </div>
          );
        }

        if (spec.type === 'enum') {
          return (
            <div key={fieldKey} className="param-group">
              <label htmlFor={id}>{spec.label}</label>
              <select
                id={id}
                className="param-select"
                value={values[fieldKey] ?? spec.options?.[0]?.value ?? ''}
                disabled={disabled}
                onChange={(e) => onChange(fieldKey, e.target.value)}
              >
                {(spec.options || []).map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          );
        }

        if (spec.type === 'string' && spec.ui === 'text') {
          return (
            <div key={fieldKey} className="param-group">
              <label htmlFor={id} className="param-label-with-input">
                {spec.label}:
                <input
                  type="text"
                  id={id}
                  className="param-text-input"
                  placeholder={spec.placeholder || ''}
                  value={values[fieldKey] ?? ''}
                  disabled={disabled}
                  onChange={(e) => onChange(fieldKey, e.target.value)}
                />
              </label>
              {spec.description ? <p className="param-description">{spec.description}</p> : null}
            </div>
          );
        }

        if (spec.ui === 'slider' && spec.type === 'int') {
          return (
            <div key={fieldKey} className="param-group">
              <label htmlFor={id}>
                {spec.label}: {values[fieldKey] ?? spec.min}
              </label>
              <input
                type="range"
                id={id}
                className="param-slider"
                min={spec.min}
                max={spec.max}
                value={values[fieldKey] ?? spec.min}
                disabled={disabled}
                onChange={(e) => onChange(fieldKey, parseInt(e.target.value, 10))}
              />
            </div>
          );
        }

        if (spec.ui === 'sliderWithInput' && (spec.type === 'int' || spec.type === 'float')) {
          const max = resolveMax(spec, values);
          const step = spec.step ?? (spec.type === 'float' ? 0.1 : 1);
          const v = values[fieldKey] ?? spec.default ?? spec.min ?? 0;
          const textVal = localNumericText[fieldKey] ?? String(v);

          return (
            <div key={fieldKey} className="param-group chunker-param">
              <label htmlFor={`${id}-input`} className="param-label-with-input">
                {spec.label}:
                <input
                  type="number"
                  id={`${id}-input`}
                  className="param-text-input-inline"
                  min={spec.min}
                  max={max}
                  step={step}
                  value={textVal}
                  disabled={disabled}
                  onChange={(e) => setLocal(fieldKey, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitNumeric(fieldKey, spec);
                  }}
                  onBlur={() => commitNumeric(fieldKey, spec)}
                />
                {spec.maxFromHalfOf ? (
                  <span className="param-max-value"> (max: {Math.floor((values[spec.maxFromHalfOf] ?? 0) / 2)})</span>
                ) : null}
              </label>
              <input
                type="range"
                id={`${id}-slider`}
                className="param-slider"
                min={spec.min}
                max={max}
                step={step}
                value={clamp(v, spec.min, max)}
                disabled={disabled}
                onChange={(e) => {
                  const n =
                    spec.type === 'float'
                      ? parseFloat(e.target.value)
                      : parseInt(e.target.value, 10);
                  onChange(fieldKey, n);
                  setLocal(fieldKey, String(n));
                }}
              />
              {spec.description ? <p className="param-description">{spec.description}</p> : null}
            </div>
          );
        }

        return null;
      })}
    </>
  );
}

function resolveMax(spec, values) {
  if (spec.maxFromHalfOf) {
    const base = values[spec.maxFromHalfOf];
    if (typeof base === 'number' && !Number.isNaN(base)) {
      return Math.floor(base / 2);
    }
    return spec.max ?? 0;
  }
  return spec.max;
}
