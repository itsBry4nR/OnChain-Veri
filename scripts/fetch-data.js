// scripts/fetch-data.js
const fs = require('fs');
const path = require('path');

// --- EMNİYET SİBOBU ---
const MAX_PER_AGENT = 4; // 1 Ajan max 4 istek atabilir (Ban koruması)

const ALL_ENDPOINTS = {
    // --- MVRV Ailesi ---
    'mvrv-z':   'https://bitcoin-data.com/v1/mvrv-zscore', // Z-Score
    'mvrv':     'https://bitcoin-data.com/v1/mvrv',        // MVRV Ratio (Yeni Eklenen)
    'sth-mvrv': 'https://bitcoin-data.com/v1/sth-mvrv',
    'lth-mvrv': 'https://bitcoin-data.com/v1/lth-mvrv',

    // --- SOPR Ailesi (Yeni) ---
    'sopr':     'https://bitcoin-data.com/v1/sopr',
    'sth-sopr': 'https://bitcoin-data.com/v1/sth-sopr',
    'lth-sopr': 'https://bitcoin-data.com/v1/lth-sopr'
};

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const args = process.argv.slice(2);
const groupIndex = parseInt(args[args.indexOf('--group') + 1]) || 0;
const totalGroups = parseInt(args[args.indexOf('--total') + 1]) || 1;

async function fetchShard() {
    const keys = Object.keys(ALL_ENDPOINTS);
    
    // Matematiksel Dağıtım (İş Bölümü)
    const myKeys = keys.filter((_, index) => index % totalGroups === groupIndex);
    
    // --- KRİTİK KONTROL ---
    if (myKeys.length > MAX_PER_AGENT) {
        console.error(`🚨 KIRMIZI ALARM! [Ajan #${groupIndex}]`);
        console.error(`❌ Bu ajana ${myKeys.length} iş yüklendi. Maksimum izin verilen: ${MAX_PER_AGENT}`);
        console.error(`💡 ÇÖZÜM: '.github/workflows/update.yml' dosyasındaki 'group' sayısını artırmalısın!`);
        process.exit(1); 
    }
    
    console.log(`🤖 [Ajan #${groupIndex}] Güvenli modda çalışıyor. (Görev: ${myKeys.length} adet)`);
    
    const partialResult = {};

    for (const key of myKeys) {
        try {
            console.log(`📥 [Ajan #${groupIndex}] İndiriliyor: ${key}`);
            const response = await fetch(ALL_ENDPOINTS[key]);
            
            if (response.status === 429) {
                console.error(`⚠️ [Ajan #${groupIndex}] HATA: 429 Limit.`);
                partialResult[key] = null;
                continue;
            }

            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            
            partialResult[key] = await response.json();
            
            // 2 saniye bekle
            await new Promise(r => setTimeout(r, 2000));
            
        } catch (error) {
            console.error(`❌ [Ajan #${groupIndex}] HATA (${key}):`, error.message);
            partialResult[key] = null;
        }
    }
    
    const filePath = path.join(DATA_DIR, `shard-${groupIndex}.json`);
    fs.writeFileSync(filePath, JSON.stringify(partialResult, null, 2));
    console.log(`✅ [Ajan #${groupIndex}] Tamamlandı.`);
}

function mergeShards() {
    console.log('🔗 [BİRLEŞTİRİCİ] Parçalar toplanıyor...');
    const finalBundle = { lastUpdated: Date.now(), metrics: {} };
    
    const files = fs.readdirSync(DATA_DIR).filter(f => f.startsWith('shard-') && f.endsWith('.json'));
    
    files.forEach(file => {
        try {
            const content = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf-8'));
            Object.assign(finalBundle.metrics, content);
            fs.unlinkSync(path.join(DATA_DIR, file)); // Temizlik
        } catch (e) { console.error(e); }
    });
    
    fs.writeFileSync(path.join(DATA_DIR, 'all-metrics.json'), JSON.stringify(finalBundle));
    console.log(`🏆 MEGA PAKET HAZIR: ${Object.keys(finalBundle.metrics).length} metrik.`);
}

if (args.includes('--merge')) mergeShards();
else fetchShard();
