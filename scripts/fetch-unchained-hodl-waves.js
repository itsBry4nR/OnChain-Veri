const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();

chromium.use(stealth);

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data', 'local');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const HEADLESS = (process.env.HEADLESS ?? '1') !== '0';
const TARGET_URL = process.env.UNCHAINED_PAGE_URL || 'https://www.unchained.com/hodlwaves';
const MATCHER = process.env.UNCHAINED_MATCHER || 'hodl_waves?a=BTC&i=24h';
const WAIT_MS = Number(process.env.UNCHAINED_WAIT_MS || 15000);

if (!TARGET_URL) {
  console.error('HATA: UNCHAINED_PAGE_URL env yok. (HODL Waves sayfa URL)');
  process.exit(1);
}

const DEFAULT_KEY_ORDER = [
  '24h',
  '1d_1w',
  '1w_1m',
  '1m_3m',
  '3m_6m',
  '6m_12m',
  '1y_2y',
  '2y_3y',
  '3y_5y',
  '5y_7y',
  '7y_10y',
  'more_10y',
];

function toMs(x) {
  if (x == null) return NaN;
  if (typeof x === 'number' && Number.isFinite(x)) {
    if (x > 1e12) return x;
    if (x > 1e9) return x * 1000;
    return NaN;
  }
  if (typeof x === 'string') {
    const t = new Date(x).getTime();
    return Number.isFinite(t) ? t : NaN;
  }
  return NaN;
}

function normalizeFromObjectRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return null;

  // Glassnode widget shape: { t, o: {..} }
  const firstWithObj = rows.find((r) => r && typeof r.o === 'object');
  if (firstWithObj) {
    const apiKeys = Object.keys(firstWithObj.o || {});
    const keys = DEFAULT_KEY_ORDER.every((k) => apiKeys.includes(k))
      ? [...DEFAULT_KEY_ORDER]
      : [...apiKeys];

    for (const k of apiKeys) if (!keys.includes(k)) keys.push(k);

    const map = new Map();
    for (const row of rows) {
      if (!row || typeof row.t !== 'number' || !row.o) continue;
      const ts = Math.trunc(row.t * 1000);
      const values = keys.map((k) => {
        const v = row.o[k];
        if (v === null || v === undefined) return null;
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
      });
      map.set(ts, [ts, ...values]);
    }

    const data = Array.from(map.values()).sort((a, b) => a[0] - b[0]);
    if (!data.length) return null;

    return { result: { dataKeys: ['datetime', ...keys], data } };
  }

  // Generic object rows: { time | t | datetime | date, ...bands }
  const firstObj = rows.find((r) => r && typeof r === 'object' && !Array.isArray(r));
  if (!firstObj) return null;

  const timeKey = ['t', 'time', 'timestamp', 'datetime', 'date'].find((k) => k in firstObj);
  if (!timeKey) return null;

  const apiKeys = Object.keys(firstObj).filter((k) => k !== timeKey);
  const keys = DEFAULT_KEY_ORDER.every((k) => apiKeys.includes(k))
    ? [...DEFAULT_KEY_ORDER]
    : [...apiKeys];
  for (const k of apiKeys) if (!keys.includes(k)) keys.push(k);

  const rowsByTs = new Map();
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    const ts = toMs(r[timeKey]);
    if (!Number.isFinite(ts)) continue;
    const row = { datetime: ts };
    let ok = true;
    for (const k of keys) {
      const v = Number(r[k]);
      if (!Number.isFinite(v)) { ok = false; break; }
      row[k] = v;
    }
    if (!ok) continue;
    rowsByTs.set(ts, row);
  }

  const out = Array.from(rowsByTs.values()).sort((a, b) => a.datetime - b.datetime);
  if (!out.length) return null;

  return {
    result: {
      dataKeys: ['datetime', ...keys],
      data: out.map((r) => [r.datetime, ...keys.map((k) => r[k])]),
    },
  };
}

function normalizeHodlWaves(raw) {
  if (!raw) return null;
  if (raw?.result?.dataKeys && Array.isArray(raw?.result?.data)) return raw;
  if (raw?.dataKeys && Array.isArray(raw?.data)) {
    return { result: { dataKeys: raw.dataKeys, data: raw.data } };
  }

  if (Array.isArray(raw)) return normalizeFromObjectRows(raw);
  if (Array.isArray(raw?.data)) return normalizeFromObjectRows(raw.data);
  if (Array.isArray(raw?.result)) return normalizeFromObjectRows(raw.result);

  return null;
}

function getLastTs(output) {
  const data = output?.result?.data;
  if (!Array.isArray(data) || !data.length) return -Infinity;
  const last = data[data.length - 1];
  const ts = Array.isArray(last) ? Number(last[0]) : NaN;
  return Number.isFinite(ts) ? ts : -Infinity;
}

async function run() {
  console.log('Unchained HODL Waves fetcher baslatiliyor...');
  console.log(`Hedef sayfa: ${TARGET_URL}`);
  console.log(`Matcher: ${MATCHER}`);

  const browser = await chromium.launch({
    headless: HEADLESS,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-setuid-sandbox', '--start-maximized'],
  });

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  });

  const page = await context.newPage();
  await page.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); });

  let bestOutput = null;
  let bestLastTs = -Infinity;
  let bestLen = 0;

  page.on('response', async (response) => {
    if (!response.url().includes(MATCHER) || response.status() !== 200) return;
    try {
      const j = await response.json();
      const normalized = normalizeHodlWaves(j);
      if (!normalized) return;
      const lastTs = getLastTs(normalized);
      const len = normalized?.result?.data?.length || 0;
      if (lastTs > bestLastTs || (lastTs === bestLastTs && len > bestLen)) {
        bestOutput = normalized;
        bestLastTs = lastTs;
        bestLen = len;
        console.log(`Aday veri yakalandi: len=${len} last=${new Date(lastTs).toISOString()}`);
      }
    } catch (_) {}
  });

  try {
    await page.goto(`${TARGET_URL}${TARGET_URL.includes('?') ? '&' : '?'}t=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    console.log(`Veri icin ${WAIT_MS}ms bekleniyor...`);
    await page.waitForTimeout(WAIT_MS);

    if (!bestOutput || !bestOutput?.result?.data?.length) {
      throw new Error('HODL Waves veri paketi yakalanamadi.');
    }

    const outFile = path.join(DATA_DIR, 'unchained-hodl-waves.json');
    fs.writeFileSync(outFile, JSON.stringify(bestOutput, null, 2));
    console.log(`KAYDEDILDI: ${path.basename(outFile)} (${bestOutput.result.data.length} satir)`);
  } catch (err) {
    console.error('HATA:', err.message);
    try {
      const screenshotPath = path.join(DATA_DIR, 'HATA-unchained-hodl-waves.png');
      await page.screenshot({ path: screenshotPath, fullPage: true });
    } catch (_) {}
    process.exit(1);
  } finally {
    await browser.close();
  }
}

run().catch((err) => {
  console.error('FATAL:', err.message || err);
  process.exit(1);
});

