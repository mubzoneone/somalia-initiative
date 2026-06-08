/* Somalia Initiative Tracker — shared data layer */
(function () {
  'use strict';

  const SCHEMA_VERSION = 3;
  const LEGACY_DEFAULT_NOTE = '4 families received £40 each';
  const LEGACY_STORAGE_KEY = 'si_data';
  const CACHE_KEY = 'si_remote_cache';
  const CACHE_TTL_MS = 5 * 60 * 1000;
  const SAVE_DEBOUNCE_MS = 1500;
  const DISK_WRITE_DEBOUNCE_MS = 300;

  const SEED = {
    version: SCHEMA_VERSION,
    donors: [
      { id: 'd1', name: 'Amina Hassan' },
      { id: 'd2', name: 'Omar Farah' },
      { id: 'd3', name: 'Hodan Warsame' },
    ],
    recipients: [
      { id: 'r1', name: 'Zaynab Munye' },
      { id: 'r2', name: 'Farhia Mohamed' },
      { id: 'r3', name: 'Umi Ali Cadow' },
      { id: 'r4', name: 'Aisha Jeylani' },
    ],
    months: {
      '2025-04': {
        donations: [
          { id: 'a1', donorId: 'd1', amount: 60 },
          { id: 'a2', donorId: 'd2', amount: 60 },
          { id: 'a3', donorId: 'd3', amount: 41 },
        ],
        distributions: [
          { id: 'b1', recipientId: 'r1', amount: 40 },
          { id: 'b2', recipientId: 'r2', amount: 40 },
          { id: 'b3', recipientId: 'r3', amount: 40 },
          { id: 'b4', recipientId: 'r4', amount: 40 },
        ],
        notes: [],
        reserves: 1,
      },
      '2025-03': {
        donations: [
          { id: 'c1', donorId: 'd1', amount: 60 },
          { id: 'c2', donorId: 'd2', amount: 60 },
        ],
        distributions: [
          { id: 'e1', recipientId: 'r1', amount: 40 },
          { id: 'e2', recipientId: 'r2', amount: 40 },
          { id: 'e3', recipientId: 'r3', amount: 40 },
        ],
        notes: ['3 families supported this month'],
        reserves: 0,
      },
      '2025-02': {
        donations: [
          { id: 'f1', donorId: 'd1', amount: 35 },
          { id: 'f2', donorId: 'd2', amount: 35 },
        ],
        distributions: [
          { id: 'g1', recipientId: 'r1', amount: 35 },
          { id: 'g2', recipientId: 'r2', amount: 35 },
        ],
        notes: ['Reduced contributions due to fewer donations received'],
        reserves: 0,
      },
      '2025-01': {
        donations: [
          { id: 'h1', donorId: 'd1', amount: 50 },
          { id: 'h2', donorId: 'd2', amount: 50 },
          { id: 'h3', donorId: 'd3', amount: 50 },
        ],
        distributions: [
          { id: 'i1', recipientId: 'r1', amount: 50 },
          { id: 'i2', recipientId: 'r2', amount: 50 },
          { id: 'i3', recipientId: 'r3', amount: 50 },
        ],
        notes: ['Strong start to the year — 3 families supported', 'Extra funds rolled into reserves'],
        reserves: 0,
      },
    },
  };

  let _cache = null;
  let _ready = false;
  let _loadError = null;
  let _fetchPromise = null;
  let _putPromise = null;
  let _onSaveStatus = null;
  let _onDataChange = null;
  let _saveTimer = null;
  let _pendingSaveData = null;
  let _diskWriteTimer = null;
  let _revision = 0;
  let _cacheSavedAt = 0;
  let _skipNetworkUntil = 0;

  const API_DATA_URL = '/api/data';

  function apiFetchOptions(keepalive) {
    return {
      credentials: 'include',
      keepalive: !!keepalive,
    };
  }

  async function parseApiError(res, fallback) {
    try {
      const text = await res.text();
      if (!text) return fallback;
      try {
        const body = JSON.parse(text);
        return body?.error || text;
      } catch {
        return text;
      }
    } catch {
      return fallback;
    }
  }

  function cloneSeed() {
    return JSON.parse(JSON.stringify(SEED));
  }

  function deepClone(data) {
    return JSON.parse(JSON.stringify(data));
  }

  function bumpRevision() {
    _revision += 1;
  }

  function getCacheSavedAt() {
    if (_cacheSavedAt) return _cacheSavedAt;
    const disk = readLocalCache();
    return disk?.savedAt || 0;
  }

  function isNetworkRevalidationFresh() {
    return Date.now() < _skipNetworkUntil;
  }

  function markNetworkFresh() {
    _skipNetworkUntil = Date.now() + CACHE_TTL_MS;
    _cacheSavedAt = Date.now();
  }

  function removeDefaultMonthlyNotes(data) {
    if (data._defaultNotesRemoved) return false;
    let changed = false;
    for (const key of Object.keys(data.months || {})) {
      const month = data.months[key];
      if (!month.notes) continue;
      const filtered = month.notes.filter((note) => note !== LEGACY_DEFAULT_NOTE);
      if (filtered.length !== month.notes.length) {
        month.notes = filtered;
        changed = true;
      }
    }
    data._defaultNotesRemoved = true;
    return changed;
  }

  function getLatestMonthKey(months) {
    const keys = Object.keys(months || {}).sort();
    return keys.length ? keys[keys.length - 1] : null;
  }

  function newDistributionId() {
    return 'd' + Math.random().toString(36).slice(2, 11);
  }

  function activeRecipients(data) {
    return (data.recipients || []).filter(r => !r?.archived);
  }

  function ensureMonthHidden(month) {
    if (!month.hiddenDonors) month.hiddenDonors = [];
    if (!month.hiddenRecipients) month.hiddenRecipients = [];
  }

  function isRecipientHidden(month, recipientId) {
    ensureMonthHidden(month);
    return month.hiddenRecipients.includes(recipientId);
  }

  function normalizeMonthRecipients(month, recipients) {
    const active = (recipients || []).filter(r => !r?.archived);
    if (!active.length) return;

    ensureMonthHidden(month);
    if (!month.distributions) month.distributions = [];

    const configured = month.hiddenRecipients.length > 0;
    const uninitialized = !configured && month.distributions.length === 0;

    if (uninitialized) {
      active.forEach(r => {
        if (!month.distributions.some(d => d.recipientId === r.id)) {
          month.distributions.push({ id: newDistributionId(), recipientId: r.id, amount: 0 });
        }
      });
      return;
    }

    active.forEach(r => {
      if (isRecipientHidden(month, r.id)) return;
      if (!month.distributions.some(d => d.recipientId === r.id)) {
        month.distributions.push({ id: newDistributionId(), recipientId: r.id, amount: 0 });
      }
    });
  }

  function normalizeMonthFields(data) {
    if (!data || typeof data !== 'object') return;
    const months = data.months || {};
    const rootReserves = typeof data.reserves === 'number' ? data.reserves : null;
    const latestKey = getLatestMonthKey(months);
    const recipients = data.recipients || [];

    for (const key of Object.keys(months)) {
      const month = months[key];
      if (month.reserves == null) month.reserves = 0;
      normalizeMonthRecipients(month, recipients);
    }

    if (rootReserves != null && latestKey) {
      const latest = months[latestKey];
      if (latest && latest.reserves === 0) latest.reserves = rootReserves;
    }

    delete data.reserves;
    delete data.legacyFunds;
  }

  function normalizeRaw(raw) {
    if (!raw || typeof raw !== 'object') return null;
    if (raw.version === SCHEMA_VERSION || raw.version === 2 || raw.version === 3) {
      raw.version = SCHEMA_VERSION;
      if (!raw.donors) raw.donors = [];
      if (!raw.recipients) raw.recipients = [];
      normalizeMonthFields(raw);
      return raw;
    }
    if (raw.months) {
      const migrated = cloneSeed();
      migrated.months = raw.months;
      if (raw.donors?.length) migrated.donors = raw.donors;
      if (raw.recipients?.length) migrated.recipients = raw.recipients;
      if (typeof raw.reserves === 'number') migrated.reserves = raw.reserves;
      normalizeMonthFields(migrated);
      return migrated;
    }
    return null;
  }

  function isEmptyRecord(record) {
    if (!record || typeof record !== 'object') return true;
    const months = record.months;
    if (months && typeof months === 'object' && Object.keys(months).length > 0) return false;
    if (Array.isArray(record.donors) && record.donors.length > 0) return false;
    if (Array.isArray(record.recipients) && record.recipients.length > 0) return false;
    return true;
  }

  function isCacheWithinTTL(savedAt) {
    return typeof savedAt === 'number' && Date.now() - savedAt < CACHE_TTL_MS;
  }

  function readLocalCache() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed?.data || typeof parsed.savedAt !== 'number') return null;
      return parsed;
    } catch {
      return null;
    }
  }

  function writeLocalCacheNow(data) {
    try {
      const savedAt = Date.now();
      localStorage.setItem(
        CACHE_KEY,
        JSON.stringify({ data: deepClone(data), savedAt })
      );
      _cacheSavedAt = savedAt;
    } catch { /* ignore quota errors */ }
  }

  function scheduleWriteLocalCache(data) {
    clearTimeout(_diskWriteTimer);
    _diskWriteTimer = setTimeout(() => {
      _diskWriteTimer = null;
      if (_cache) writeLocalCacheNow(_cache);
    }, DISK_WRITE_DEBOUNCE_MS);
  }

  function flushLocalCache() {
    clearTimeout(_diskWriteTimer);
    _diskWriteTimer = null;
    if (_cache) writeLocalCacheNow(_cache);
  }

  function readLegacyLocalStorage() {
    try {
      const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function clearLegacyLocalStorage() {
    try {
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch { /* ignore */ }
  }

  function setSaveStatus(status, message) {
    if (typeof _onSaveStatus === 'function') _onSaveStatus(status, message);
  }

  function applyCacheUpdate(data, notify) {
    const changed = !_cache || JSON.stringify(_cache) !== JSON.stringify(data);
    data.version = SCHEMA_VERSION;
    _cache = data;
    _ready = true;
    if (changed) bumpRevision();
    writeLocalCacheNow(data);
    if (changed && notify && typeof _onDataChange === 'function') {
      _onDataChange(data);
    }
    return changed;
  }

  function syncHydrateFromDisk() {
    const disk = readLocalCache();
    if (!disk?.data) return;
    const data = normalizeRaw(deepClone(disk.data));
    if (data) {
      _cache = data;
      _ready = true;
      _cacheSavedAt = disk.savedAt;
      if (isCacheWithinTTL(disk.savedAt)) {
        _skipNetworkUntil = disk.savedAt + CACHE_TTL_MS;
      }
    }
  }

  async function fetchBinRecord() {
    const res = await fetch(API_DATA_URL, apiFetchOptions(false));
    if (res.status === 404) return null;
    if (!res.ok) {
      const message = await parseApiError(res, `Data read failed (${res.status})`);
      throw new Error(message);
    }
    const body = await res.json();
    return body.record;
  }

  function fetchBinRecordDeduped() {
    if (_fetchPromise) return _fetchPromise;
    _fetchPromise = fetchBinRecord().finally(() => {
      _fetchPromise = null;
    });
    return _fetchPromise;
  }

  async function putBinRecord(data, keepalive) {
    const res = await fetch(API_DATA_URL, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
      ...apiFetchOptions(keepalive),
    });
    if (res.status === 401) {
      throw new Error('Admin session required. Sign in again on the admin page.');
    }
    if (!res.ok) {
      const message = await parseApiError(res, `Data save failed (${res.status})`);
      throw new Error(message);
    }
  }

  function resolveDataFromRecord(record) {
    let data = null;
    let needsPersist = false;

    if (record && !isEmptyRecord(record)) {
      data = normalizeRaw(deepClone(record));
    }

    const legacy = readLegacyLocalStorage();
    if (!data && legacy) {
      data = normalizeRaw(legacy);
      needsPersist = true;
    } else if (legacy) {
      clearLegacyLocalStorage();
    }

    if (!data) {
      data = cloneSeed();
      needsPersist = true;
    }

    if (removeDefaultMonthlyNotes(data)) needsPersist = true;

    return { data, needsPersist };
  }

  async function persistImmediate(data) {
    data.version = SCHEMA_VERSION;
    setSaveStatus('saving');
    try {
      await putBinRecord(data, false);
      writeLocalCacheNow(data);
      markNetworkFresh();
      setSaveStatus('saved');
    } catch (err) {
      setSaveStatus('error', err.message);
      throw err;
    }
  }

  async function revalidateFromNetwork({ silent, force } = {}) {
    if (!force && isNetworkRevalidationFresh()) {
      return _cache;
    }

    let record;
    try {
      record = await fetchBinRecordDeduped();
    } catch (err) {
      _loadError = err.message;
      if (silent && _ready && _cache) return _cache;
      throw err;
    }

    const { data, needsPersist } = resolveDataFromRecord(record);

    if (needsPersist) {
      if (window.SI_STRICT_WRITE_INIT) {
        await persistImmediate(data);
        clearLegacyLocalStorage();
      }
    }

    applyCacheUpdate(data, true);
    markNetworkFresh();
    _loadError = null;
    return data;
  }

  function scheduleDebouncedSave() {
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(() => {
      _saveTimer = null;
      runDebouncedPut(false).catch(() => {});
    }, SAVE_DEBOUNCE_MS);
  }

  async function runDebouncedPut(keepalive) {
    if (_putPromise) {
      await _putPromise.catch(() => {});
      if (!_pendingSaveData) return;
    }

    const data = _pendingSaveData;
    if (!data) return;

    const payload = deepClone(data);
    payload.version = SCHEMA_VERSION;
    _pendingSaveData = null;

    _putPromise = (async () => {
      setSaveStatus('saving');
      try {
        await putBinRecord(payload, keepalive);
        writeLocalCacheNow(payload);
        _cache = payload;
        markNetworkFresh();
        setSaveStatus('saved');
      } catch (err) {
        _pendingSaveData = data;
        setSaveStatus('error', err.message);
        throw err;
      } finally {
        _putPromise = null;
        if (_pendingSaveData) scheduleDebouncedSave();
      }
    })();

    return _putPromise;
  }

  function hydrateFromDiskCache() {
    const disk = readLocalCache();
    if (!disk?.data) return null;
    const data = normalizeRaw(deepClone(disk.data));
    if (!data) return null;
    _cache = data;
    _ready = true;
    _cacheSavedAt = disk.savedAt;
    return data;
  }

  function loadDataDiskFallback() {
    const data = hydrateFromDiskCache();
    if (data) return data;
    if (_ready && _cache) return _cache;
    return null;
  }

  async function loadData(options) {
    const opts = options || {};
    const background = !!opts.background;
    const awaitNetwork = !!opts.awaitNetwork;

    if (awaitNetwork) {
      _loadError = null;
      try {
        return await revalidateFromNetwork({ silent: false, force: true });
      } catch (err) {
        const fallback = loadDataDiskFallback();
        if (fallback) return fallback;
        throw err;
      }
    }

    if (background) {
      if (!_ready || !_cache) {
        return loadData({ ...opts, background: false });
      }
      revalidateFromNetwork({ silent: true, force: true }).catch(() => {});
      return _cache;
    }

    _loadError = null;

    if (!_ready || !_cache) {
      hydrateFromDiskCache();
    }

    if (_ready && _cache) {
      revalidateFromNetwork({ silent: true, force: true }).catch(() => {});
      return _cache;
    }

    try {
      return await revalidateFromNetwork({ silent: false, force: true });
    } catch (err) {
      const fallback = loadDataDiskFallback();
      if (fallback) return fallback;
      throw err;
    }
  }

  function getData() {
    if (!_ready || !_cache) {
      throw new Error('Data not loaded yet. Call await loadData() first.');
    }
    return _cache;
  }

  function saveData(data) {
    data.version = SCHEMA_VERSION;
    _cache = data;
    _ready = true;
    bumpRevision();
    scheduleWriteLocalCache(data);
    _pendingSaveData = data;
    scheduleDebouncedSave();
    return Promise.resolve();
  }

  function invalidateDataCache() {
    _skipNetworkUntil = 0;
    _cacheSavedAt = 0;
  }

  function getDataRevision() {
    return _revision;
  }

  async function flushPendingSave() {
    clearTimeout(_saveTimer);
    _saveTimer = null;
    if (!_pendingSaveData) return;

    const data = deepClone(_pendingSaveData);
    data.version = SCHEMA_VERSION;
    _pendingSaveData = null;
    _cache = data;
    flushLocalCache();

    if (_putPromise) {
      try {
        await _putPromise;
      } catch { /* continue with latest snapshot */ }
    }

    setSaveStatus('saving');
    try {
      await putBinRecord(data, true);
      writeLocalCacheNow(data);
      markNetworkFresh();
      setSaveStatus('saved');
    } catch (err) {
      _pendingSaveData = data;
      setSaveStatus('error', err.message);
      throw err;
    }
  }

  function flushPendingSaveOnUnload() {
    clearTimeout(_saveTimer);
    _saveTimer = null;
    clearTimeout(_diskWriteTimer);
    _diskWriteTimer = null;
    if (_pendingSaveData) {
      const data = deepClone(_pendingSaveData);
      data.version = SCHEMA_VERSION;
      _pendingSaveData = null;
      _cache = data;
      writeLocalCacheNow(data);
      putBinRecord(data, true).catch(() => {});
      return;
    }
    flushLocalCache();
  }

  function isDataReady() {
    return _ready && !!_cache;
  }

  function getLoadError() {
    return _loadError;
  }

  syncHydrateFromDisk();
  revalidateFromNetwork({ silent: true, force: true }).catch(() => {});

  window.addEventListener('beforeunload', flushPendingSaveOnUnload);
  window.addEventListener('pagehide', flushPendingSaveOnUnload);

  window.SI_SCHEMA_VERSION = SCHEMA_VERSION;
  window.SI_CACHE_TTL_MS = CACHE_TTL_MS;
  window.loadData = loadData;
  window.getData = getData;
  window.saveData = saveData;
  window.flushPendingSave = flushPendingSave;
  window.invalidateDataCache = invalidateDataCache;
  window.getDataRevision = getDataRevision;
  window.isDataReady = isDataReady;
  window.getLoadError = getLoadError;
  window.setSaveStatusHandler = function (fn) {
    _onSaveStatus = fn;
  };
  window.setDataChangeHandler = function (fn) {
    _onDataChange = fn;
  };
})();
