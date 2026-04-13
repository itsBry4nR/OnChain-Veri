// scripts/fetch-data.js
const fs = require('fs');
const path = require('path');
const {
  readJsonSafe: readJsonSafeUtil,
  writeJsonPretty,
  mergeAllMetricsBundles,
} = require('./history-utils');

// --- CDD HISTORY MERGE (CQ -> Bitcoin-Data) ---
const STATIC_DIR = path.join(__dirname, '..', 'data', 'static');
const CQ_CDD_HISTORY_PATH = path.join(STATIC_DIR, 'cq-cdd-history.json');
const ALL_METRICS_HISTORY_PATH = path.join(STATIC_DIR, 'all-metrics-history.json');

function readJsonSafe(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (err) {
    console.error('❌ History JSON okunamadı:', err.message);
    return null;
  }
}

function extractSeries(json) {
  if (!json) return null;
  if (Array.isArray(json)) return json;
  if (Array.isArray(json.data)) return json.data;
  if (json.result && Array.isArray(json.result.data)) return json.result.data;
  return null;
}

function injectSeries(json, series) {
  if (Array.isArray(json)) return series;
  if (json && typeof json === 'object') {
    if (json.result && Array.isArray(json.result.data)) {
      return { ...json, result: { ...json.result, data: series } };
    }
    if (Array.isArray(json.data)) {
      return { ...json, data: series };
    }
    // bilinmeyen format, yine de data alanı ekleyelim
    return { ...json, data: series };
  }
  return json;
}

function mergeCddHistory(fetchedJson) {
  const historyJson = readJsonSafe(CQ_CDD_HISTORY_PATH);
  if (!historyJson) return fetchedJson;

  const fetchedSeries = extractSeries(fetchedJson);
  const historySeries = extractSeries(historyJson);

  if (!Array.isArray(fetchedSeries) || !Array.isArray(historySeries)) {
    return fetchedJson;
  }

  const map = new Map();
  for (const row of fetchedSeries) {
    const ts = row?.[0];
    if (typeof ts === 'number') map.set(ts, row[1]);
  }

  const before = map.size;
  for (const row of historySeries) {
    const ts = row?.[0];
    if (typeof ts === 'number' && !map.has(ts)) {
      map.set(ts, row[1]);
    }
  }

  const merged = Array.from(map.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([ts, val]) => [ts, val]);

  const added = map.size - before;
  if (added > 0) {
    console.log(`🧩 CDD history eklendi: +${added} (toplam ${map.size})`);
  }

  return injectSeries(fetchedJson, merged);
}

// --- EMNİYET SİBOBU ---
const MAX_PER_AGENT = 4;

const ALL_ENDPOINTS = {
    // --- MEVCUT GRAFİĞİN ÇALIŞMASI İÇİN GEREKENLER ---
    // DİKKAT: Sol taraftaki isimleri (mvrv, sth, lth) değiştirmemelisin!
    'mvrvZscore': 'https://bitcoin-data.com/v1/mvrv-zscore', 
    'sth':      'https://bitcoin-data.com/v1/sth-mvrv',
    'lth':      'https://bitcoin-data.com/v1/lth-mvrv',
    'mvrv-ratio': 'https://bitcoin-data.com/v1/mvrv',

    // --- Sopr Ailesi ---
    'sopr':       'https://bitcoin-data.com/v1/sopr',
    'sth-sopr':   'https://bitcoin-data.com/v1/sth-sopr',
    'lth-sopr':   'https://bitcoin-data.com/v1/lth-sopr',

    // --- NUPL Ailesi ---
    'nupl':       'https://bitcoin-data.com/v1/nupl',
    'sth-nupl':   'https://bitcoin-data.com/v1/nupl-sth',
    'lth-nupl':   'https://bitcoin-data.com/v1/nupl-lth',   

    // --- Realized Price Ailesi ve Delta Price İçin gerekli apiler
    'market-cap':     'https://api.bitcoin-data.com/v1/marketcap-crypto-usd',
    'cap-real-usd':   'https://bitcoin-data.com/v1/cap-real-usd',
    'realized-price': 'https://bitcoin-data.com/v1/realized-price',
    'sth-realized-price':  'https://bitcoin-data.com/v1/sth-realized-price',
    'lth-realized-price':  'https://bitcoin-data.com/v1/lth-realized-price',
    'true-market-mean':     'https://bitcoin-data.com/v1/true-market-mean',
    'btc-price': 'https://bitcoin-data.com/v1/btc-price',

    // --- CDD Binary ---
    'supply-adjusted-cdd-binary':   'https://bitcoin-data.com/v1/supply-adjusted-cdd-binary',
    'supply-adjusted-cdd': 'https://bitcoin-data.com/v1/supply-adjusted-cdd',

    /// --- Supply Profit/Loss % ---
    'supply-profit': 'https://bitcoin-data.com/v1/supply-profit',
    'supply-loss': 'https://bitcoin-data.com/v1/supply-loss',

    // --- Puell Multiple ---
    'puell-multiple': 'https://bitcoin-data.com/v1/puell-multiple',

    // --- Dynamic NVTS ---
    'nvts': 'https://bitcoin-data.com/v1/nvts',

    //--- NRPL Family ---
    'nrpl-usd': 'https://bitcoin-data.com/v1/nrpl-usd',
    'nrpl-btc': 'https://bitcoin-data.com/v1/nrpl-btc',

    // --- Liveliness için gerekli apiler ---
    'supply-current': 'https://bitcoin-data.com/v1/supply-current',
    'cdd': 'https://bitcoin-data.com/v1/cdd',

    // --- Aviv Ratio ---
    // Liveliness yukarda zaten var (supply current ve cdd'den türetiliyor
    //MarketCap yukarda var
    //capRealizedCapUsd yukarda zaten var
    'thermoCap': 'https://bitcoin-data.com/v1/thermo-cap',

    // --- HashRibbons ---
    'hashribbons': 'https://bitcoin-data.com/v1/hashribbons',

    // --- VDD Multiple ---
    'vdd-multiple': 'https://bitcoin-data.com/v1/vdd-multiple',

    // --- Realized Profit/Loss Ratio ---
    'realizedLossSthUsd': 'https://api.bitcoin-data.com/v1/realized-loss-sth-usd',
    'realizedLossLthUsd': 'https://api.bitcoin-data.com/v1/realized-loss-lth-usd',
    'realizedProfitSthUsd': 'https://api.bitcoin-data.com/v1/realized-profit-sth-usd',
    'realizedProfitLthUsd': 'https://api.bitcoin-data.com/v1/realized-profit-lth-usd',

    // --- Stablecoin Supply ---
    'stablecoin-supply': 'https://bitcoin-data.com/v1/stablecoin-supply',

    // --- Asol ---
    'asol': 'https://bitcoin-data.com/v1/asol',
    
    // --- BTC Charts Price ---
    'btc-ohlc': 'https://bitcoin-data.com/v1/btc-ohlc',

    // --- Dormancy Flow 41.api ---
    'supplyAdjustedDormancy': 'https://bitcoin-data.com/v1/supply-adjusted-dormancy',
    'averageDormancy': 'https://bitcoin-data.com/v1/average-dormancy',
  
};

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const args = process.argv.slice(2);
const groupIndex = parseInt(args[args.indexOf('--group') + 1]) || 0;
const totalGroups = parseInt(args[args.indexOf('--total') + 1]) || 1;

async function fetchShard() {
    const keys = Object.keys(ALL_ENDPOINTS);
    const myKeys = keys.filter((_, index) => index % totalGroups === groupIndex);
    
    // Güvenlik Kontrolü
    if (myKeys.length > MAX_PER_AGENT) {
        console.error(`🚨 HATA: Ajan #${groupIndex} kapasitesi doldu (${myKeys.length}/${MAX_PER_AGENT}).`);
        process.exit(1);
    }
    
    console.log(`🤖 Ajan #${groupIndex} görev başında. Liste: ${myKeys.join(', ')}`);
    
    const partialResult = {};

    for (const key of myKeys) {
        try {
            console.log(`📥 İndiriliyor: ${key}`);
            const response = await fetch(ALL_ENDPOINTS[key]);
            
            if (response.status === 429) {
                console.error(`⚠️ 429 Limit Hatası: ${key}`);
                partialResult[key] = null;
                continue;
            }

            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            
            const json = await response.json();
            partialResult[key] = (key === 'cdd') ? mergeCddHistory(json) : json;

            await new Promise(r => setTimeout(r, 2000)); // Bekleme süresi
            
        } catch (error) {
            console.error(`❌ Hata (${key}):`, error.message);
            partialResult[key] = null;
        }
    }
    
    const filePath = path.join(DATA_DIR, `shard-${groupIndex}.json`);
    fs.writeFileSync(filePath, JSON.stringify(partialResult, null, 2));
}

function mergeShards() {
    console.log('Merging shard files...');
    let finalBundle = { lastUpdated: Date.now(), metrics: {} };

    const files = fs.readdirSync(DATA_DIR).filter(f => f.startsWith('shard-') && f.endsWith('.json'));

    if (files.length === 0) console.warn('Warning: no shard files found.');

    files.forEach(file => {
        try {
            const content = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf-8'));
            Object.assign(finalBundle.metrics, content);
            fs.unlinkSync(path.join(DATA_DIR, file)); // cleanup
        } catch (e) { console.error(e); }
    });

    // Safety net: merge with previous full-history sources (static history + current file)
    const prevOutput = readJsonSafeUtil(path.join(DATA_DIR, 'all-metrics.json'));
    const staticHistory = readJsonSafeUtil(ALL_METRICS_HISTORY_PATH);
    const baseBundle = mergeAllMetricsBundles(staticHistory, prevOutput);
    finalBundle = mergeAllMetricsBundles(baseBundle, finalBundle);

    writeJsonPretty(path.join(DATA_DIR, 'all-metrics.json'), finalBundle);
    writeJsonPretty(ALL_METRICS_HISTORY_PATH, finalBundle);

    console.log('Mega bundle ready. Total metrics:', Object.keys(finalBundle.metrics).length);
}

if (args.includes('--merge')) mergeShards();
else fetchShard();
