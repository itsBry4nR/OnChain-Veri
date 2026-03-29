const fs = require('fs');
const path = require('path');

function ensureDirForFile(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function readJsonSafe(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    console.error(`[history-utils] JSON read failed: ${filePath} -> ${err.message}`);
    return null;
  }
}

function writeJsonPretty(filePath, data) {
  ensureDirForFile(filePath);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function toTimestampMs(value) {
  if (value == null) return null;

  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value > 1e12) return Math.trunc(value); // already ms
    if (value > 1e9) return Math.trunc(value * 1000); // sec -> ms
    return null;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;

    const asNum = Number(trimmed);
    if (Number.isFinite(asNum)) return toTimestampMs(asNum);

    // handle "YYYY-MM-DD HH:mm:ss"
    const isoCandidate = trimmed.includes('T') ? trimmed : trimmed.replace(' ', 'T');
    const directMs = Date.parse(trimmed);
    if (Number.isFinite(directMs)) return directMs;
    const isoMs = Date.parse(isoCandidate);
    if (Number.isFinite(isoMs)) return isoMs;
    const isoZMs = Date.parse(`${isoCandidate}Z`);
    if (Number.isFinite(isoZMs)) return isoZMs;
    return null;
  }

  return null;
}

function getRowTimestampMs(row) {
  if (Array.isArray(row)) {
    return toTimestampMs(row[0]);
  }

  if (!row || typeof row !== 'object') return null;

  const keys = ['unixTs', 'time', 't', 'datetime', 'timestamp', 'date', 'd'];
  for (const key of keys) {
    if (key in row) {
      const ts = toTimestampMs(row[key]);
      if (Number.isFinite(ts)) return ts;
    }
  }

  return null;
}

function mergeSeriesRows(...seriesList) {
  const byTs = new Map();

  for (const series of seriesList) {
    if (!Array.isArray(series)) continue;
    for (const row of series) {
      const ts = getRowTimestampMs(row);
      if (!Number.isFinite(ts)) continue;
      byTs.set(ts, row);
    }
  }

  return Array.from(byTs.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([, row]) => row);
}

function extractSeries(json) {
  if (!json) return null;
  if (Array.isArray(json)) return json;
  if (Array.isArray(json.data)) return json.data;
  if (json.result && Array.isArray(json.result.data)) return json.result.data;
  return null;
}

function extractDataKeys(json) {
  if (!json || typeof json !== 'object') return null;
  if (Array.isArray(json.dataKeys)) return json.dataKeys;
  if (json.result && Array.isArray(json.result.dataKeys)) return json.result.dataKeys;
  return null;
}

function injectSeries(templateJson, series, dataKeys) {
  if (Array.isArray(templateJson)) return series;

  if (templateJson && typeof templateJson === 'object') {
    if (templateJson.result && Array.isArray(templateJson.result.data)) {
      return {
        ...templateJson,
        result: {
          ...templateJson.result,
          ...(Array.isArray(dataKeys) ? { dataKeys } : {}),
          data: series,
        },
      };
    }

    if (Array.isArray(templateJson.data)) {
      return {
        ...templateJson,
        ...(Array.isArray(dataKeys) ? { dataKeys } : {}),
        data: series,
      };
    }

    return {
      ...templateJson,
      ...(Array.isArray(dataKeys) ? { dataKeys } : {}),
      data: series,
    };
  }

  if (Array.isArray(dataKeys)) {
    return { result: { dataKeys, data: series } };
  }
  return series;
}

function mergeSeriesPayload(historyJson, freshJson) {
  const historySeries = extractSeries(historyJson);
  const freshSeries = extractSeries(freshJson);

  if (!Array.isArray(historySeries) && !Array.isArray(freshSeries)) {
    return freshJson ?? historyJson;
  }

  const mergedSeries = mergeSeriesRows(historySeries, freshSeries);
  const dataKeys = extractDataKeys(freshJson) || extractDataKeys(historyJson);
  const template = freshJson ?? historyJson;
  return injectSeries(template, mergedSeries, dataKeys || undefined);
}

function mergeAllMetricsBundles(historyBundle, freshBundle) {
  const out = {
    lastUpdated: Date.now(),
    metrics: {},
  };

  const hMetrics =
    historyBundle && historyBundle.metrics && typeof historyBundle.metrics === 'object'
      ? historyBundle.metrics
      : {};
  const fMetrics =
    freshBundle && freshBundle.metrics && typeof freshBundle.metrics === 'object'
      ? freshBundle.metrics
      : {};

  const allKeys = new Set([...Object.keys(hMetrics), ...Object.keys(fMetrics)]);
  for (const key of allKeys) {
    out.metrics[key] = mergeSeriesRows(hMetrics[key], fMetrics[key]);
  }

  if (!out.metrics.marketCap) {
    out.metrics.marketCap =
      out.metrics.marketcap ||
      out.metrics.market_cap ||
      out.metrics['market-cap'] ||
      [];
  }

  return out;
}

function getSeriesBounds(series) {
  if (!Array.isArray(series) || !series.length) return null;
  const ts = series
    .map((row) => getRowTimestampMs(row))
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => a - b);
  if (!ts.length) return null;
  return { first: ts[0], last: ts[ts.length - 1], count: ts.length };
}

function findDailyGaps(series) {
  if (!Array.isArray(series) || series.length < 2) return [];
  const DAY = 24 * 60 * 60 * 1000;
  const sortedTs = series
    .map((row) => getRowTimestampMs(row))
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => a - b);

  const gaps = [];
  for (let i = 1; i < sortedTs.length; i++) {
    const diff = sortedTs[i] - sortedTs[i - 1];
    if (diff > DAY * 1.5) {
      gaps.push({
        from: sortedTs[i - 1],
        to: sortedTs[i],
        missingDays: Math.max(1, Math.round(diff / DAY) - 1),
      });
    }
  }
  return gaps;
}

module.exports = {
  readJsonSafe,
  writeJsonPretty,
  mergeSeriesRows,
  mergeSeriesPayload,
  mergeAllMetricsBundles,
  extractSeries,
  injectSeries,
  extractDataKeys,
  getSeriesBounds,
  findDailyGaps,
};

