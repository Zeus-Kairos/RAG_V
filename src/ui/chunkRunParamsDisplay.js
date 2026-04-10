/**
 * Plain-text formatting of chunk run `parameters` to match Chunk Browser / Chunk Run History
 * (`ChunkBrowser.jsx`, `ChunkRunHistoryPanel.jsx`): same keys, chunkers handling, and value formatting.
 */

function formatParamKey(key) {
  return String(key)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (l) => l.toUpperCase());
}

function formatParamValue(value) {
  if (typeof value === 'boolean') return value ? 'Enabled' : 'Disabled';
  if (typeof value === 'object' && value !== null) return JSON.stringify(value);
  return String(value);
}

/**
 * @param {Record<string, unknown>} parameters - same shape as chunk run `parameters` from API
 * @returns {string} newline-separated lines for tooltips / plain display
 */
export function formatChunkRunParamsForTooltip(parameters) {
  if (!parameters || typeof parameters !== 'object') return '';

  const lines = [];

  if (Array.isArray(parameters.chunkers)) {
    for (const chunker of parameters.chunkers) {
      if (!chunker || typeof chunker !== 'object') continue;
      const typeName = chunker.chunker != null ? String(chunker.chunker) : '';
      if (!typeName) continue;
      const label = typeName.charAt(0).toUpperCase() + typeName.slice(1);
      lines.push(`${label}: Enabled`);
      const params = chunker.params && typeof chunker.params === 'object' ? chunker.params : {};
      for (const [paramName, paramValue] of Object.entries(params)) {
        lines.push(`${formatParamKey(paramName)}: ${formatParamValue(paramValue)}`);
      }
    }
  }

  for (const [key, value] of Object.entries(parameters)) {
    if (key === 'chunkers') continue;
    lines.push(`${formatParamKey(key)}: ${formatParamValue(value)}`);
  }

  return lines.join('\n');
}
