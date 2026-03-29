const fs = require('fs');
const path = require('path');
const {
  readJsonSafe,
  writeJsonPretty,
  mergeSeriesPayload,
  mergeAllMetricsBundles,
  getSeriesBounds,
  findDailyGaps,
} = require('./history-utils');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const LOCAL_DIR = path.join(DATA_DIR, 'local');
const STATIC_DIR = path.join(DATA_DIR, 'static');
const ALL_METRICS_PATH = path.join(DATA_DIR, 'all-metrics.json');
const ALL_METRICS_HISTORY_PATH = path.join(STATIC_DIR, 'all-metrics-history.json');
const args = process.argv.slice(2);
const FULL_REBUILD = args.includes('--full-rebuild');

function formatDate(ms) {
  if (!Number.isFinite(ms)) return 'n/a';
  return new Date(ms).toISOString().slice(0, 10);
}

function syncAllMetrics() {
  const live = readJsonSafe(ALL_METRICS_PATH);
  const history = readJsonSafe(ALL_METRICS_HISTORY_PATH);
  const merged = mergeAllMetricsBundles(history, live);
  // CQ-only metrikleri all-metrics tarafinda tutma
  if (merged?.metrics && typeof merged.metrics === 'object') {
    delete merged.metrics.exchangeInflowBtc;
    delete merged.metrics.exchangeOutflowBtc;
  }

  writeJsonPretty(ALL_METRICS_PATH, merged);
  writeJsonPretty(ALL_METRICS_HISTORY_PATH, merged);

  const keyMetrics = ['btc-ohlc', 'btc-price', 'mvrv-ratio', 'sopr', 'nupl'];
  for (const key of keyMetrics) {
    const liveBounds = getSeriesBounds(live?.metrics?.[key]);
    const historyBounds = getSeriesBounds(history?.metrics?.[key]);
    const bounds = getSeriesBounds(merged?.metrics?.[key]);
    if (!bounds) {
      console.log(`[all-metrics] ${key}: no data`);
      continue;
    }
    const gaps = findDailyGaps(merged.metrics[key]);
    const boundaryGapDays =
      liveBounds && historyBounds
        ? Math.max(
            0,
            Math.round((liveBounds.first - historyBounds.last) / (24 * 60 * 60 * 1000)) - 1
          )
        : 0;
    console.log(
      `[all-metrics] ${key}: ${bounds.count} rows ${formatDate(bounds.first)} -> ${formatDate(bounds.last)} gaps=${gaps.length} boundaryGap=${boundaryGapDays}`
    );
  }

  return merged;
}

function buildCqCddSourceFromAllMetrics(allMetricsBundle) {
  const cddSeries = allMetricsBundle?.metrics?.cdd;
  if (!Array.isArray(cddSeries)) return null;
  return {
    result: {
      dataKeys: ['datetime', 'value'],
      data: cddSeries,
    },
  };
}

function getDefaultCqDataKeys(baseName) {
  if (baseName === 'cq-exchange-netflow') return ['datetime', 'netflow_total'];
  if (baseName === 'cq-exchange-inflow') return ['datetime', 'inflow_total'];
  if (baseName === 'cq-exchange-outflow') return ['datetime', 'outflow_total'];
  return ['datetime', 'value'];
}

function normalizeHistoryPayload(baseName, payload) {
  if (!baseName.startsWith('cq-')) return payload;

  if (Array.isArray(payload)) {
    return {
      result: {
        dataKeys: getDefaultCqDataKeys(baseName),
        data: payload,
      },
    };
  }

  if (
    payload &&
    typeof payload === 'object' &&
    payload.result &&
    Array.isArray(payload.result.data) &&
    !Array.isArray(payload.result.dataKeys)
  ) {
    return {
      ...payload,
      result: {
        ...payload.result,
        dataKeys: getDefaultCqDataKeys(baseName),
      },
    };
  }

  return payload;
}

function syncStaticHistoryFile(historyFileName, allMetricsBundle, options = {}) {
  const historyPath = path.join(STATIC_DIR, historyFileName);
  const baseName = historyFileName.replace(/-history\.json$/i, '');

  const historyJson = readJsonSafe(historyPath);
  let sourceJson = null;
  let sourcePath = null;

  if (baseName === 'all-metrics') {
    sourcePath = ALL_METRICS_PATH;
    sourceJson = readJsonSafe(sourcePath);
  } else if (baseName === 'cq-cdd') {
    sourcePath = 'all-metrics.metrics.cdd';
    sourceJson = buildCqCddSourceFromAllMetrics(allMetricsBundle);
  } else {
    sourcePath = path.join(LOCAL_DIR, `${baseName}.json`);
    sourceJson = readJsonSafe(sourcePath);
  }

  if (!sourceJson && !historyJson) {
    console.log(`[history-sync] ${historyFileName}: skipped (no source/history).`);
    return;
  }

  const merged = mergeSeriesPayload(historyJson, sourceJson);
  const normalizedMerged = normalizeHistoryPayload(baseName, merged);
  writeJsonPretty(historyPath, normalizedMerged);

  if (sourcePath && sourcePath.endsWith('.json')) {
    writeJsonPretty(sourcePath, normalizedMerged);
  }

  const series =
    Array.isArray(normalizedMerged) ? normalizedMerged :
    Array.isArray(normalizedMerged?.data) ? normalizedMerged.data :
    Array.isArray(normalizedMerged?.result?.data) ? normalizedMerged.result.data :
    null;

  const bounds = getSeriesBounds(series);
  const gaps = findDailyGaps(series);
  if (!bounds) {
    console.log(`[history-sync] ${historyFileName}: written (no rows)`);
    return;
  }

  console.log(
    `[history-sync] ${historyFileName}: ${bounds.count} rows ${formatDate(bounds.first)} -> ${formatDate(bounds.last)} gaps=${gaps.length}`
  );
}

function main() {
  if (!fs.existsSync(STATIC_DIR)) {
    console.log('[history-sync] data/static not found, nothing to do.');
    return;
  }

  console.log(`[history-sync] mode=${FULL_REBUILD ? 'full-rebuild' : 'daily-merge'}`);

  const mergedAllMetrics = syncAllMetrics();

  const historyFiles = fs
    .readdirSync(STATIC_DIR)
    .filter((f) => f.endsWith('-history.json'))
    .filter((f) => f !== 'all-metrics-history.json')
    .sort();

  for (const file of historyFiles) {
    syncStaticHistoryFile(file, mergedAllMetrics, { fullRebuild: FULL_REBUILD });
  }

  console.log(`[history-sync] done. processed=${historyFiles.length}`);
}

main();
