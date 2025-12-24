// scripts/fetch-data.js
const fs = require('fs');
const path = require('path');

// --- EMNİYET SİBOBU ---
const MAX_PER_AGENT = 4;

const ALL_ENDPOINTS = {
    // --- MEVCUT GRAFİĞİN ÇALIŞMASI İÇİN GEREKENLER ---
    // DİKKAT: Sol taraftaki isimleri (mvrv, sth, lth) değiştirmemelisin!
    'mvrv':     'https://bitcoin-data.com/v1/mvrv-zscore', 
    'sth':      'https://bitcoin-data.com/v1/sth-mvrv',
    'lth':      'https://bitcoin-data.com/v1/lth-mvrv',
    'mvrv-ratio': 'https://bitcoin-data.com/v1/mvrv',

    // --- Sopr Ailesi ---
    'sopr':       'https://bitcoin-data.com/v1/sopr',
    'sth-sopr':   'https://bitcoin-data.com/v1/sth-sopr',
    'lth-sopr':   'https://bitcoin-data.com/v1/lth-sopr',
    'asopr':      'https://bitcoin-data.com/v1/asopr',

    // --- NUPL Ailesi ---
    'nupl':       'https://bitcoin-data.com/v1/nupl',
    'sth-nupl':   'https://bitcoin-data.com/v1/nupl-sth',
    'lth-nupl':   'https://bitcoin-data.com/v1/nupl-lth',   

    // --- Realized Price Ailesi ve Delta Price İçin gerekli apiler
    'market-cap':     'https://bitcoin-data.com/v1/market-cap',
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

    /// --- Rhodl Ratio ---
    'rhodl-ratio': 'https://bitcoin-data.com/v1/rhodl-ratio',

    // --- Puell Multiple ---
    'puell-multiple': 'https://bitcoin-data.com/v1/puell-multiple',

    // --- Dynamic NVTS ---
    'nvts': 'https://bitcoin-data.com/v1/nvts',

    // --- Reverse Risk & MVOCDD ---
    'reverse-risk': 'https://bitcoin-data.com/v1/reserve-risk',
    'mvocdd': 'https://bitcoin-data.com/v1/mvocdd',

    //--- NRPL Family ---
    'nrpl-usd': 'https://bitcoin-data.com/v1/nrpl-usd',
    'nrpl-btc': 'https://bitcoin-data.com/v1/nrpl-btc',

    // --- Liveliness için gerekli apiler ---
    'supply-current': 'https://bitcoin-data.com/v1/supply-current',
    'cdd': 'https://bitcoin-data.com/v1/cdd',

    // --- Aviv Ratio ---
    'aviv': 'https://bitcoin-data.com/v1/aviv',

    // --- HashRibbons ---
    'hashribbons': 'https://bitcoin-data.com/v1/hashribbons',

    // --- VDD Multiple ---
    'vdd-multiple': 'https://bitcoin-data.com/v1/vdd-multiple',

    // --- Realized Profit/Loss Ratio ---
    'realizedProfitLth': 'https://bitcoin-data.com/v1/realized_profit_lth',
    'realizedProfitSth': 'https://bitcoin-data.com/v1/realized_profit_sth',
    'realizedLossLth': 'https://bitcoin-data.com/v1/realized_loss_lth',
    'realizedLossSth': 'https://bitcoin-data.com/v1/realized_loss_sth',

    // --- Stablecoin Supply 39.api ---
    'stablecoin-supply': 'https://bitcoin-data.com/v1/stablecoin-supply',

    //Exchange Net Position Change 40.api ---
'cq-exchange-netflow': 'https://api.cryptoquant.com/live/v4/charts/61a5fbaf45de34521f1dcad1?window=DAY&from=1135375200000&to=1766575363174&limit=70000'
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

      const url = ALL_ENDPOINTS[key];

      const headers = {
        'accept': 'application/json, text/plain, */*',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
      };

      if (url.includes('api.cryptoquant.com')) {
        const tokenRaw = process.env.CRYPTOQUANT_BEARER || '';
        const token = tokenRaw.replace(/^Bearer\s+/i, '').trim();
        if (!token) throw new Error('Missing env CRYPTOQUANT_BEARER');

        headers['authorization'] = `Bearer ${token}`;
        headers['origin'] = 'https://cryptoquant.com';
        headers['referer'] = 'https://cryptoquant.com/';
        headers['cache-control'] = 'no-cache';
        headers['pragma'] = 'no-cache';

        const cqCookie = (process.env.CRYPTOQUANT_COOKIE || '').trim();
        if (cqCookie) headers['cookie'] = cqCookie;
      }

      const response = await fetch(url, { headers });

      console.log(`➡️ ${key} status: ${response.status}`);

      const text = await response.text();
      console.log(`➡️ ${key} first200:`, text.slice(0, 200));

      if (response.status === 429) {
        console.error(`⚠️ 429 Limit Hatası: ${key}`);
        partialResult[key] = null;
        continue;
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} body=${text.slice(0, 200)}`);
      }

      partialResult[key] = JSON.parse(text);

      // Bekleme süresi
      await new Promise(r => setTimeout(r, 2000));
    } catch (error) {
      console.error(`❌ Hata (${key}):`, error.message);
      partialResult[key] = null;
    }
  }

  const filePath = path.join(DATA_DIR, `shard-${groupIndex}.json`);
  fs.writeFileSync(filePath, JSON.stringify(partialResult, null, 2));
}

function mergeShards() {
    console.log('🔗 Parçalar birleştiriliyor...');
    const finalBundle = { lastUpdated: Date.now(), metrics: {} };
    
    const files = fs.readdirSync(DATA_DIR).filter(f => f.startsWith('shard-') && f.endsWith('.json'));
    
    if (files.length === 0) console.warn('⚠️ Uyarı: Hiç parça dosyası bulunamadı.');

    files.forEach(file => {
        try {
            const content = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf-8'));
            Object.assign(finalBundle.metrics, content);
            fs.unlinkSync(path.join(DATA_DIR, file)); // Temizlik
        } catch (e) { console.error(e); }
    });
    
    fs.writeFileSync(path.join(DATA_DIR, 'all-metrics.json'), JSON.stringify(finalBundle));
    console.log(`🏆 Mega Paket Hazır. Toplam Metrik: ${Object.keys(finalBundle.metrics).length}`);
}

if (args.includes('--merge')) mergeShards();
else fetchShard();
