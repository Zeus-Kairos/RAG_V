import splitterConfig from './splitterConfig.json';

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Single-field default from splitter field spec (for store + chonkie param objects).
 */
export function fieldDefaultFromSpec(spec) {
  if (!spec || typeof spec !== 'object') return undefined;
  if (Object.prototype.hasOwnProperty.call(spec, 'default')) return spec.default;
  if (spec.type === 'boolean') return false;
  if (spec.type === 'enum') return spec.options?.[0]?.value;
  if (spec.type === 'string') return '';
  if (spec.type === 'int') return spec.min ?? 0;
  if (spec.type === 'float') return spec.min ?? 0;
  return undefined;
}

function capOverlapToHalfChunkSize(settings) {
  if (!settings?.chunkSize || settings.chunkOverlap == null) return settings;
  return {
    ...settings,
    chunkOverlap: Math.min(
      settings.chunkOverlap,
      Math.floor(settings.chunkSize / 2)
    ),
  };
}

/** camelCase -> snake_case for API keys */
export function camelToSnake(key) {
  return key.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '');
}

export function getSplitterFrameworks() {
  return splitterConfig.frameworkOrder.map((id) => ({
    id,
    label: splitterConfig.frameworks[id]?.label || id,
  }));
}

export function getLangchainPipeline() {
  return splitterConfig.frameworks.langchain.pipeline;
}

export function getChonkieChefConfig() {
  return splitterConfig.frameworks.chonkie.chef;
}

export function getChonkieCatalog() {
  return splitterConfig.frameworks.chonkie.chunkerCatalog;
}

export function getChonkieCatalogEntry(type) {
  return getChonkieCatalog().find((c) => c.type === type);
}

export function getFallbackNewChonkieChunkerParams() {
  const rec = getChonkieCatalogEntry('Recursive');
  const chunkSpec = rec?.fields?.chunkSize;
  return { chunkSize: fieldDefaultFromSpec(chunkSpec) ?? 1000 };
}

export function getDefaultChonkieParamsForType(type) {
  const entry = getChonkieCatalogEntry(type);
  if (!entry) {
    return getFallbackNewChonkieChunkerParams();
  }
  const params = {};
  Object.entries(entry.fields).forEach(([k, spec]) => {
    const v = fieldDefaultFromSpec(spec);
    if (v !== undefined) params[k] = v;
  });
  return params;
}

export function getKnownChonkieTypes() {
  return getChonkieCatalog().map((c) => c.type);
}

/**
 * After merging partial params for a chonkie chunker, cap fields with maxFromHalfOf.
 */
export function applyChonkieOverlapCaps(chunkerType, params) {
  const entry = getChonkieCatalogEntry(chunkerType);
  if (!entry) return { ...params };
  const next = { ...params };
  Object.entries(entry.fields).forEach(([fieldKey, spec]) => {
    if (!spec.maxFromHalfOf) return;
    const baseKey = spec.maxFromHalfOf;
    const baseVal = next[baseKey];
    if (typeof baseVal !== 'number' || Number.isNaN(baseVal)) return;
    const cap = Math.floor(baseVal / 2);
    if (typeof next[fieldKey] === 'number' && next[fieldKey] > cap) {
      next[fieldKey] = cap;
    }
  });
  return next;
}

/** True for docling/hybrid-style frameworks: `storeGroup` + `fields`, not pipeline/chonkie. */
export function getFlatFrameworkStoreGroup(frameworkId) {
  const fw = splitterConfig.frameworks[frameworkId];
  if (!fw?.storeGroup || !fw.fields) return null;
  if (fw.pipeline || fw.chunkerCatalog) return null;
  return fw.storeGroup;
}

export function getFlatFrameworkFieldBlock(frameworkId) {
  const sg = getFlatFrameworkStoreGroup(frameworkId);
  if (!sg) return null;
  const fw = splitterConfig.frameworks[frameworkId];
  return { storeGroup: fw.storeGroup, fields: fw.fields };
}

function buildFlatGroupDefaultsFromFields(fields) {
  const group = {};
  Object.entries(fields || {}).forEach(([key, spec]) => {
    if (spec.hybridTableSize) {
      group.tableChunkSizeRow = spec.defaultRow ?? 3;
      group.tableChunkSizeCharacter = spec.defaultCharacter ?? 200;
      return;
    }
    group[key] = fieldDefaultFromSpec(spec);
  });
  return group;
}

/**
 * Merge partial update into a flat framework store object (hybrid table enable side-effect).
 */
export function mergeFlatFrameworkSettingsPatch(frameworkId, prevGroup, partial) {
  const next = { ...prevGroup, ...partial };
  if (frameworkId === 'hybrid' && partial.tableChunkEnabled === true) {
    next.tableChunkSizeRow =
      (prevGroup.tableChunkSizeRow ?? 0) > 0 ? prevGroup.tableChunkSizeRow : 3;
    next.tableChunkSizeCharacter =
      (prevGroup.tableChunkSizeCharacter ?? 0) > 0
        ? prevGroup.tableChunkSizeCharacter
        : 200;
  }
  return next;
}

/**
 * Full splitterSettings object for Zustand initial state and logout reset (deep clone).
 */
export function getInitialSplitterSettingsFromConfig() {
  const out = {};

  for (const stage of splitterConfig.frameworks.langchain.pipeline) {
    out[stage.toggleKey] = stage.defaultEnabled !== false;
    const g = stage.storeGroup;
    if (!out[g]) out[g] = {};
    Object.entries(stage.fields || {}).forEach(([key, spec]) => {
      out[g][key] = fieldDefaultFromSpec(spec);
    });
  }

  out.markdownSettings = { ...out.markdownSettings };
  out.recursiveSettings = capOverlapToHalfChunkSize({
    ...out.recursiveSettings,
  });

  const ch = splitterConfig.frameworks.chonkie;
  const chefDefault = ch.chef?.default ?? ch.chef?.options?.[0]?.value ?? 'markdown';
  const initialTypes = ch.initialChunkerTypes?.length
    ? ch.initialChunkerTypes
    : ['Sentence'];
  const chunkers = initialTypes.map((type) => ({
    type,
    params: applyChonkieOverlapCaps(type, getDefaultChonkieParamsForType(type)),
  }));
  out.chonkieSettings = { chef: chefDefault, chunkers };

  for (const frameworkId of splitterConfig.frameworkOrder) {
    if (frameworkId === 'langchain' || frameworkId === 'chonkie') continue;
    const sg = getFlatFrameworkStoreGroup(frameworkId);
    if (!sg) continue;
    const fw = splitterConfig.frameworks[frameworkId];
    out[sg] = buildFlatGroupDefaultsFromFields(fw.fields);
  }

  return deepClone(out);
}

function buildLangchainChunkers(splitterSettings) {
  const chunkers = [];
  for (const stage of getLangchainPipeline()) {
    if (!splitterSettings[stage.toggleKey]) continue;
    const group = splitterSettings[stage.storeGroup] || {};
    const params = {};
    Object.entries(stage.fields).forEach(([storeKey, spec]) => {
      const v = group[storeKey];
      if (v === undefined) return;
      params[camelToSnake(storeKey)] = v;
    });
    chunkers.push({ chunker: stage.apiChunker, params });
  }
  return chunkers;
}

function buildChonkieChunkers(splitterSettings) {
  const { chef, chunkers } = splitterSettings.chonkieSettings || { chunkers: [] };
  const list = (chunkers || []).map((c) => {
    const apiParams = {};
    Object.entries(c.params || {}).forEach(([k, v]) => {
      if (v === undefined) return;
      apiParams[camelToSnake(k)] = v;
    });
    return {
      chunker: String(c.type || '').toLowerCase(),
      params: apiParams,
    };
  });
  return { chef: chef || 'markdown', chunkers: list };
}

function shouldSkipFieldForForm(spec, fieldKey, values) {
  if (spec.formSkipWhen) {
    const { field, equals } = spec.formSkipWhen;
    if (values[field] === equals) return true;
  }
  if (spec.formSkipWhenEmpty) {
    const v = values[fieldKey];
    if (v === undefined || v === null || v === '') return true;
  }
  return false;
}

function appendScalarFormField(formData, apiKey, value) {
  if (value === undefined || value === null) return;
  if (typeof value === 'boolean') {
    formData.append(apiKey, value ? 'true' : 'false');
  } else if (typeof value === 'object') {
    formData.append(apiKey, JSON.stringify(value));
  } else {
    formData.append(apiKey, String(value));
  }
}

/**
 * Table chunk extras (table_chunk_size + table_tokenizer) for fields marked hybridTableSize.
 * Matches previous appendHybridFields behavior.
 */
function appendHybridTableChunkExtras(formData, values, spec) {
  if (values.tableChunkEnabled !== true) return;
  const tokenizer = values.tableTokenizer || 'row';
  const rowKey = spec.tableSizeRowStoreKey || 'tableChunkSizeRow';
  const charKey = spec.tableSizeCharacterStoreKey || 'tableChunkSizeCharacter';
  const size =
    tokenizer === 'character'
      ? values[charKey] ?? spec.defaultCharacter ?? 200
      : values[rowKey] ?? spec.defaultRow ?? 3;
  const sizeKey = spec.formTableChunkSizeApiKey || 'table_chunk_size';
  const tokKey = spec.formTableTokenizerApiKey || 'table_tokenizer';
  if (size > 0) {
    formData.append(sizeKey, String(size));
    formData.append(tokKey, tokenizer);
  }
}

/**
 * Flat multipart mapping: store keys → snake_case API keys (or formApiKey), driven by splitterConfig.
 * Use for any framework with `storeGroup` + `fields` (docling, hybrid, and new frameworks of the same shape).
 */
function appendFlatFrameworkFields(formData, frameworkId, splitterSettings) {
  const fw = splitterConfig.frameworks[frameworkId];
  if (!fw?.storeGroup || !fw.fields) return;

  const values = splitterSettings[fw.storeGroup] || {};
  let hybridTableSpec = null;

  for (const [fieldKey, spec] of Object.entries(fw.fields)) {
    if (spec.hybridTableSize) {
      hybridTableSpec = spec;
      continue;
    }
    if (shouldSkipFieldForForm(spec, fieldKey, values)) continue;
    const v = values[fieldKey];
    if (v === undefined) continue;
    const apiKey = spec.formApiKey || camelToSnake(fieldKey);
    appendScalarFormField(formData, apiKey, v);
  }

  if (hybridTableSpec) {
    appendHybridTableChunkExtras(formData, values, hybridTableSpec);
  }
}

/**
 * Build multipart form fields for POST /api/chunk-files (same shape as ChunkBrowser).
 */
export function buildChunkingFormData(activeFramework, splitterSettings) {
  const formData = new FormData();
  formData.append('framework', activeFramework);

  if (activeFramework === 'langchain') {
    formData.append('chunkers', JSON.stringify(buildLangchainChunkers(splitterSettings)));
  } else if (activeFramework === 'chonkie') {
    const { chef, chunkers } = buildChonkieChunkers(splitterSettings);
    formData.append('chef', chef);
    formData.append('chunkers', JSON.stringify(chunkers));
  } else {
    appendFlatFrameworkFields(formData, activeFramework, splitterSettings);
  }

  return formData;
}

export function getDoclingFieldConfig() {
  return getFlatFrameworkFieldBlock('docling');
}

export function getHybridFieldConfig() {
  return getFlatFrameworkFieldBlock('hybrid');
}
