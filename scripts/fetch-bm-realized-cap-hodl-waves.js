// scripts/fetch-bm-realized-cap-hodl-waves.js
// Bitcoin Magazine Pro Fetcher (Realized Cap HODL Waves only)

const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
const fs = require('fs');
const path = require('path');

chromium.use(stealth);

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data', 'local');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const HEADLESS = (process.env.HEADLESS ?? '1') !== '0';

const TARGET = {
  name: 'bm-realized-cap-hodl-waves',
  url: 'https://www.bitcoinmagazinepro.com/charts/realized-cap-hodl-waves/',
  matcher: '_dash-update-component',
};

const TRACE_KEYS = [
  { name: '24h', key: '24h' },
  { name: '1d-1w', key: '1d_1w' },
  { name: '1w-1m', key: '1w_1m' },
  { name: '1m-3m', key: '1m_3m' },
  { name: '3m-6m', key: '3m_6m' },
  { name: '6m-12m', key: '6m_12m' },
  { name: '1y-2y', key: '1y_2y' },
  { name: '2y-3y', key: '2y_3y' },
  { name: '3y-5y', key: '3y_5y' },
  { name: '5y-7y', key: '5y_7y' },
  { name: '7y-10y', key: '7y_10y' },
  { name: '>10y', key: 'more_10y' },
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

function cleanAndFormat(json) {
  const fig = json?.response?.chart?.figure;
  const dataArr = fig?.data;
  if (!fig || !Array.isArray(dataArr)) {
    console.log('⚠️ Beklenen path yok: response.chart.figure.data bulunamadı.');
    return null;
  }

  const traceByName = new Map();
  for (const t of dataArr) {
    const nm = (t?.name || '').trim();
    if (nm) traceByName.set(nm, t);
  }

  const missing = TRACE_KEYS.filter((t) => !traceByName.has(t.name)).map((t) => t.name);
  if (missing.length) {
    console.log(`⚠️ Eksik trace(ler): ${missing.join(', ')}`);
  }

  const rowsByTs = new Map(); // tsMs -> row
  let usedTraces = 0;

  for (const { name, key } of TRACE_KEYS) {
    const tr = traceByName.get(name);
    if (!tr || !Array.isArray(tr.x) || !Array.isArray(tr.y)) continue;
    usedTraces += 1;

    const n = Math.min(tr.x.length, tr.y.length);
    for (let i = 0; i < n; i++) {
      const ts = toMs(tr.x[i]);
      const v = Number(tr.y[i]);
      if (!Number.isFinite(ts) || !Number.isFinite(v)) continue;
      let row = rowsByTs.get(ts);
      if (!row) {
        row = { datetime: ts };
        rowsByTs.set(ts, row);
      }
      row[key] = v;
    }
  }

  if (!usedTraces) {
    console.log('⚠️ Kullanılabilir trace bulunamadı.');
    return null;
  }

  const keys = TRACE_KEYS.map((t) => t.key);
  const rows = [];
  let dropped = 0;

  for (const row of rowsByTs.values()) {
    let ok = true;
    for (const k of keys) {
      if (!Number.isFinite(row[k])) { ok = false; break; }
    }
    if (!ok) { dropped += 1; continue; }
    rows.push(row);
  }

  rows.sort((a, b) => a.datetime - b.datetime);

  if (!rows.length) {
    console.log('⚠️ Tüm satırlar eksik veri nedeniyle elendi.');
    return null;
  }

  const data = rows.map((r) => [
    r.datetime,
    r['24h'],
    r['1d_1w'],
    r['1w_1m'],
    r['1m_3m'],
    r['3m_6m'],
    r['6m_12m'],
    r['1y_2y'],
    r['2y_3y'],
    r['3y_5y'],
    r['5y_7y'],
    r['7y_10y'],
    r['more_10y'],
  ]);

  if (dropped > 0) {
    console.log(`ℹ️ Eksik veri nedeniyle düşen satır: ${dropped}`);
  }

  return {
    result: {
      dataKeys: ['datetime', ...keys],
      data,
    },
  };
}

function getLastTs(output) {
  const data = output?.result?.data;
  if (!Array.isArray(data) || !data.length) return -Infinity;
  const last = data[data.length - 1];
  const ts = Array.isArray(last) ? Number(last[0]) : NaN;
  return Number.isFinite(ts) ? ts : -Infinity;
}

async function run() {
  console.log('🕵️‍♂️ BitcoinMagazinePro Agent (Realized Cap HODL Waves)');

  const browser = await chromium.launch({
    headless: HEADLESS,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--start-maximized',
    ],
  });

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });

  const page = await context.newPage();
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  let bestOutput = null;
  let bestLastTs = -Infinity;
  let bestLen = 0;

  page.on('response', async (response) => {
    if (response.url().includes(TARGET.matcher) && response.status() === 200) {
      try {
        const j = await response.json();
        const output = cleanAndFormat(j);
        if (!output || !output?.result?.data?.length) return;
        const lastTs = getLastTs(output);
        const len = output.result.data.length;
        if (lastTs > bestLastTs || (lastTs === bestLastTs && len > bestLen)) {
          bestOutput = output;
          bestLastTs = lastTs;
          bestLen = len;
          console.log(`⚡ Aday Paket (len: ${len}, last: ${new Date(lastTs).toISOString()})`);
        }
      } catch (_) {}
    }
  });

  try {
    await page.goto(`${TARGET.url}?t=${Date.now()}`, { waitUntil: 'networkidle', timeout: 60000 });
    console.log('⏳ Grafik verisi için 15sn bekleniyor...');
    await page.waitForTimeout(15000);

    if (!bestOutput || !bestOutput?.result?.data?.length) {
      throw new Error('Veri paketi yakalanamadı veya boş.');
    }

    const outputFile = path.join(DATA_DIR, `${TARGET.name}.json`);
    fs.writeFileSync(outputFile, JSON.stringify(bestOutput, null, 2));
    console.log(`✅ KAYDEDİLDİ: ${TARGET.name}.json (${bestOutput.result.data.length} satır)`);
  } catch (err) {
    console.error(`❌ [HATA] ${err.message}`);
    try {
      const screenshotPath = path.join(DATA_DIR, `HATA-${TARGET.name}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true });
    } catch (_) {}
    process.exit(1);
  }

  await browser.close();
  console.log('👋 Operasyon Tamamlandı.');
}

run().catch((e) => {
  console.error('❌ FATAL:', e);
  process.exit(1);
});
