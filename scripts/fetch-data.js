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
    'supply-current': 'https://bitcoin-data.com/v1/supply-current',
    'realized-price': 'https://bitcoin-data.com/v1/realized-price',
    'sth-realized-price':  'https://bitcoin-data.com/v1/sth-realized-price',
    'lth-realized-price':  'https://bitcoin-data.com/v1/lth-realized-price',
    'true-market-mean':     'https://bitcoin-data.com/v1/true-market-mean'
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
            
            partialResult[key] = await response.json();
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
