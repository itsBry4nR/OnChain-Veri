// scripts/fetch-data.js
const fs = require('fs');
const path = require('path');

// --- TÜM METRİKLER LİSTESİ ---
// Buraya istediğin kadar metrik ekle.
// Script otomatik olarak bu listeyi çalışan makine sayısına (örn: 6) bölecek.
const ALL_ENDPOINTS = {
    'mvrv': 'https://bitcoin-data.com/v1/mvrv-zscore',
    'sth':  'https://bitcoin-data.com/v1/sth-mvrv',
    'lth':  'https://bitcoin-data.com/v1/lth-mvrv',
    
    // Test için aynı linkleri çoğaltıyorum, sen gerçeklerini eklersin:
    'nupl': 'https://bitcoin-data.com/v1/mvrv-zscore', 
    'sopr': 'https://bitcoin-data.com/v1/sth-mvrv',
    'rhodl':'https://bitcoin-data.com/v1/lth-mvrv',
    'puell':'https://bitcoin-data.com/v1/mvrv-zscore',
    'cdx':  'https://bitcoin-data.com/v1/sth-mvrv',
    // ... 50 tane de olsa fark etmez ...
};

// Verilerin kaydedileceği klasör
const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Komut satırı argümanlarını al (Github Action bunları otomatik yollar)
// Örnek: node fetch-data.js --group 0 --total 6
const args = process.argv.slice(2);
const groupIndex = parseInt(args[args.indexOf('--group') + 1]) || 0;
const totalGroups = parseInt(args[args.indexOf('--total') + 1]) || 1;

// --- GÖREV 1: PARÇA İNDİRME (SHARDING) ---
async function fetchShard() {
    const keys = Object.keys(ALL_ENDPOINTS);
    
    // Matematiksel olarak iş bölümü yapıyoruz.
    // Örneğin 60 dosya varsa ve 6 grup varsa, her gruba 10 dosya düşer.
    // index % totalGroups formülü ile adil dağıtım yapılır.
    const myKeys = keys.filter((_, index) => index % totalGroups === groupIndex);
    
    console.log(`🤖 [Ajan #${groupIndex}] Başlıyor! (Sorumlu olduğu dosya sayısı: ${myKeys.length})`);
    
    const partialResult = {};

    for (const key of myKeys) {
        try {
            const url = ALL_ENDPOINTS[key];
            console.log(`📥 [Ajan #${groupIndex}] İndiriliyor: ${key}`);
            
            const response = await fetch(url);
            
            if (response.status === 429) {
                console.error(`⚠️ [Ajan #${groupIndex}] HATA: API Limit (429) - ${key}`);
                partialResult[key] = null;
                continue;
            }

            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            
            const json = await response.json();
            partialResult[key] = json;
            
            console.log(`✅ [Ajan #${groupIndex}] Başarılı: ${key}`);

            // Ne olur ne olmaz, kendi içinde de 2 saniye beklesin.
            await new Promise(r => setTimeout(r, 2000));
            
        } catch (error) {
            console.error(`❌ [Ajan #${groupIndex}] HATA (${key}):`, error.message);
            partialResult[key] = null;
        }
    }
    
    // Bu ajan kendi parçasını (shard) kaydeder
    const fileName = `shard-${groupIndex}.json`;
    const filePath = path.join(DATA_DIR, fileName);
    
    fs.writeFileSync(filePath, JSON.stringify(partialResult, null, 2));
    console.log(`🏁 [Ajan #${groupIndex}] Görev tamamlandı. Parça kaydedildi: ${fileName}`);
}

// --- GÖREV 2: BİRLEŞTİRME (MERGE) ---
function mergeShards() {
    console.log('🔗 [BİRLEŞTİRİCİ] Tüm parçalar toplanıyor...');
    
    const finalBundle = {
        lastUpdated: Date.now(),
        metrics: {}
    };
    
    // data klasöründeki shard-*.json dosyalarını bul
    const files = fs.readdirSync(DATA_DIR).filter(f => f.startsWith('shard-') && f.endsWith('.json'));
    
    if (files.length === 0) {
        console.warn('⚠️ Uyarı: Hiçbir parça dosyası (shard) bulunamadı!');
    }

    files.forEach(file => {
        const filePath = path.join(DATA_DIR, file);
        try {
            const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
            
            // Parçadaki metrikleri ana pakete ekle
            Object.assign(finalBundle.metrics, content);
            
            console.log(`Checking off: ${file} (${Object.keys(content).length} metrik eklendi)`);
            
            // İşlenen parçayı sil (Temizlik)
            fs.unlinkSync(filePath);
            
        } catch (err) {
            console.error(`❌ Dosya okuma hatası (${file}):`, err);
        }
    });
    
    // Mega paketi yaz
    const outputPath = path.join(DATA_DIR, 'all-metrics.json');
    fs.writeFileSync(outputPath, JSON.stringify(finalBundle));
    
    console.log(`🏆 [BİRLEŞTİRİCİ] İŞLEM TAMAM! Mega Paket hazır: ${outputPath}`);
    console.log(`📊 Toplam Metrik Sayısı: ${Object.keys(finalBundle.metrics).length}`);
}

// --- ANA AKIŞ ---
if (args.includes('--merge')) {
    mergeShards();
} else {
    fetchShard();
}
