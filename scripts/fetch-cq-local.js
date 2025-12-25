const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// --- HEDEFLER LİSTESİ ---
const TARGETS = [
    {
        // 1. MEVCUT ÇALIŞAN (Exchange Netflow)
        // Buna dokunmuyoruz, genel API yolunu (/live/v4/charts/) bekliyor.
        name: 'cq-exchange-netflow',
        pageUrl: 'https://cryptoquant.com/asset/btc/chart/exchange-flows/exchange-netflow-total',
        matcher: '/live/v4/charts/' 
    },
    {
        // 2. YENİ EKLENEN (Spent Output Age Bands)
        // Bu senin verdiğin ID'yi nokta atışı bekleyecek.
        name: 'cq-spent-output-age-bands',
        pageUrl: 'https://cryptoquant.com/asset/btc/chart/market-indicator/spent-output-age-bands',
        matcher: '62186e8661aa6b64f8a948c0' 
    }
];

// Yollar
const DATA_DIR = path.join(__dirname, '..', 'data', 'local');
const STATIC_DIR = path.join(__dirname, '..', 'data', 'static');

// Klasörleri oluştur
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(STATIC_DIR)) fs.mkdirSync(STATIC_DIR, { recursive: true });

async function run() {
    console.log('🕵️‍♂️ CryptoQuant Ajanı Başlatılıyor (Multi-Target Modu)...');

    const browser = await chromium.launch({
        headless: false, 
        args: [
            '--start-maximized',
            '--disable-blink-features=AutomationControlled',
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-infobars'
        ]
    });

    const context = await browser.newContext({
        viewport: { width: 1920, height: 1080 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        locale: 'en-US',
        timezoneId: 'America/New_York'
    });

    // Otomasyon izlerini sil
    await context.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        window.chrome = { runtime: {} };
        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    });

    const page = await context.newPage();

    // --- DÖNGÜ BAŞLIYOR ---
    for (const target of TARGETS) {
        console.log(`\n🔵 Hedef İşleniyor: ${target.name}`);
        
        let newData = [];
        let success = false;

        try {
            // --- PUSU KURULUYOR ---
            const responsePromise = page.waitForResponse(response => 
                response.url().includes(target.matcher) && 
                response.status() === 200,
                { timeout: 45000 } // Her biri için 45 sn sabır süresi
            );

            console.log(`🌍 Sayfaya gidiliyor: ${target.pageUrl}`);
            await page.goto(target.pageUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

            console.log('⏳ Veri bekleniyor (Mouse hareketleri yapılıyor)...');
            await page.waitForTimeout(2000);
            await page.mouse.move(100, 100);
            await page.waitForTimeout(1000);
            await page.mouse.move(300, 300);

            // Paketi Yakala
            const response = await responsePromise;
            console.log(`🎯 VURDUK! Paket yakalandı (${target.matcher})`);

            const json = await response.json();

            // Veriyi ayıkla
            if (json.result && json.result.data) {
                newData = json.result.data;
            } else if (json.data) {
                newData = json.data;
            }
            
            if (newData.length > 0) {
                console.log(`📥 İndirilen Satır: ${newData.length}`);
                success = true;
            }

        } catch (err) {
            console.warn(`⚠️ ${target.name} otomatik çekilemedi (Login gerekebilir veya ID değişmiş):`, err.message);
        }

        // --- HİBRİT BİRLEŞTİRME (Static History + Yeni Veri) ---
        const historyFile = path.join(STATIC_DIR, `${target.name}-history.json`);
        const outputFile = path.join(DATA_DIR, `${target.name}.json`);
        
        let finalData = newData; // Varsayılan olarak sadece yeni veri

        // Tarihçe dosyası varsa birleştir
        if (fs.existsSync(historyFile)) {
            try {
                const historyRaw = fs.readFileSync(historyFile, 'utf-8');
                const historyData = JSON.parse(historyRaw);
                
                if (Array.isArray(historyData)) {
                    console.log(`📜 Tarihsel Veri Okundu: ${historyData.length} satır`);
                    
                    if (success && newData.length > 0) {
                        // Birleştir
                        const combined = [...historyData, ...newData];
                        
                        // DEDUPLICATION (Çiftleri Temizle)
                        const uniqueMap = new Map();
                        combined.forEach(item => {
                            // item[0] = timestamp
                            if(item && item.length > 0) uniqueMap.set(item[0], item);
                        });
                        
                        // Sırala
                        finalData = Array.from(uniqueMap.values()).sort((a, b) => a[0] - b[0]);
                        console.log(`🔗 Birleştirme Başarılı! Toplam: ${finalData.length}`);
                    } else {
                        console.log('ℹ️ Yeni veri yok, sadece tarihsel veri kullanılacak.');
                        finalData = historyData;
                    }
                }
            } catch (e) {
                console.error('❌ Tarih dosyası okuma hatası:', e.message);
            }
        }

        // Kaydet
        if (finalData.length > 0) {
            const outputJSON = { result: { data: finalData } };
            fs.writeFileSync(outputFile, JSON.stringify(outputJSON, null, 2));
            console.log(`✅ KAYDEDİLDİ: ${target.name}.json`);
        } else {
            console.error(`❌ ${target.name} İÇİN HİÇ VERİ YOK!`);
        }
    }

    console.log('\n👋 Tüm operasyon tamamlandı.');
    await browser.close();
}

run();
