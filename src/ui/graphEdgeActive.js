/**
 * Graph link "active" rules shared by GraphView and Playground (retrieve gate).
 * @param {object} link
 * @param {object[]|null} allLinks Full graph edges; required for embed/index checks.
 */
export function isEdgeActive(link, allLinks = null) {
  const a = link?.attributes || {};
  if (link?.type === 'parse') return Boolean(a.is_active);
  if (link?.type === 'chunk') {
    const parseActive = a.parse_is_active;
    const runActive = a.chunk_run_is_active;
    const okParse = parseActive === undefined ? true : Boolean(parseActive);
    const okRun = runActive === undefined ? true : Boolean(runActive);
    return okParse && okRun;
  }
  if (link?.type === 'embed') {
    const runActive = a.chunk_run_is_active;
    const okRun = runActive === undefined ? true : Boolean(runActive);
    const okEmbedding = a.embedding_is_active === undefined ? true : Boolean(a.embedding_is_active);
    if (!okRun || !okEmbedding) return false;
    if (allLinks && Array.isArray(allLinks)) {
      const crId = a.chunk_run_id;
      if (crId == null) return false;
      const hasActiveParseChunkBridge = allLinks.some((l2) => {
        if (l2.type !== 'chunk') return false;
        const ca = l2.attributes || {};
        if (Number(ca.chunk_run_id) !== Number(crId)) return false;
        return Boolean(ca.parse_is_active);
      });
      if (!hasActiveParseChunkBridge) return false;
    }
    return true;
  }
  return true;
}
