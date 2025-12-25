const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// Hedef: Grafik Sayfası (Pusu için)
const CHART_PAGE_URL = 'https://cryptoquant.com/asset/btc/chart/exchange-flows/exchange-netflow-total';

// Yollar
const DATA_DIR = path.join(__dirname, '..', 'data', 'local');
const STATIC_DIR = path.join(__dirname, '..', 'data', 'static');
const HISTORY_FILE = path.join(STATIC_DIR, 'cq-history.json');
const OUTPUT_FILE = path.join(DATA_DIR, 'cq-exchange-netflow.json');

// Klasörleri oluştur
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(STATIC_DIR)) fs.mkdirSync(STATIC_DIR, { recursive: true });

async function run() {
    console.log('🕵️‍♂️ CryptoQuant Ajanı Başlatılıyor (Tarihçi Modu)...');

    const browser = await chromium.launch({
        headless: false, // XVFB (Sanal Ekran) için false kalmalı
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

    await context.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        window.chrome = { runtime: {} };
        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    });

    const page = await context.newPage();

    // API Yanıtını Bekle
    const responsePromise = page.waitForResponse(response => 
        response.url().includes('/live/v4/charts/') && 
        response.status() === 200,
        { timeout: 90000 }
    );

    try {
        console.log('🌐 Grafik sayfasına gidiliyor...');
        await page.goto(CHART_PAGE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

        console.log('⏳ Veri bekleniyor...');
        await page.waitForTimeout(3000);
        await page.mouse.move(200, 200);

        const response = await responsePromise;
        console.log('🎯 Yeni veri paketi yakalandı!');

        const json = await response.json();
        let newData = [];

        // Yeni veriyi çıkar
        if (json.result && json.result.data) {
            newData = json.result.data;
        } else if (json.data) {
            newData = json.data;
        } else {
            throw new Error('Gelen JSON formatı bilinmiyor!');
        }
        
        console.log(`📥 Güncel Veri: ${newData.length} satır (CryptoQuant'tan geldi)`);

        // --- BİRLEŞTİRME OPERASYONU ---
        
        let finalData = newData;
        
        if (fs.existsSync(HISTORY_FILE)) {
            try {
                const historyRaw = fs.readFileSync(HISTORY_FILE, 'utf-8');
                const historyData = JSON.parse(historyRaw);
                
                if (Array.isArray(historyData)) {
                    console.log(`📜 Tarihsel Veri: ${historyData.length} satır (Arşivden okundu)`);
                    
                    // Hepsini bir havuza at
                    const combined = [...historyData, ...newData];
                    
                    // DEDUPLICATION (Çift Kayıt Temizliği)
                    // Aynı zamana (timestamp) ait veri varsa, YENİ olanı (günceli) koru.
                    // Map kullanarak zamanı anahtar yapıyoruz.
                    const uniqueMap = new Map();
                    
                    combined.forEach(item => {
                        // item[0] timestamp, item[1] value varsayıyoruz
                        const timestamp = item[0];
                        uniqueMap.set(timestamp, item);
                    });
                    
                    // Map'ten tekrar diziye çevir ve Tarihe Göre Sırala
                    finalData = Array.from(uniqueMap.values()).sort((a, b) => a[0] - b[0]);
                    
                    console.log(`🔗 BİRLEŞTİRME BAŞARILI: Toplam ${finalData.length} satır.`);
                } else {
                    console.warn('⚠️ Tarih dosyası var ama dizi formatında değil. Sadece yeni veri kullanılacak.');
                }
            } catch (e) {
                console.error('❌ Tarih dosyası okuma hatası:', e.message);
            }
        } else {
            console.log('ℹ️ Tarihsel veri dosyası (cq-history.json) bulunamadı, sadece yeni veri kaydedilecek.');
        }

        // --- KAYDETME ---
        // Formatı orijinal CQ yapısında tutuyoruz ki dataManager.js bozulmasın
        const outputJSON = {
            result: {
                data: finalData
            }
        };

        fs.writeFileSync(OUTPUT_FILE, JSON.stringify(outputJSON, null, 2));
        console.log(`✅ DOSYA KAYDEDİLDİ: ${OUTPUT_FILE}`);
        
        // Son bir kontrol
        console.log(`📊 Başlangıç Tarihi: ${new Date(finalData[0][0]).toLocaleDateString()}`);
        console.log(`📊 Bitiş Tarihi:     ${new Date(finalData[finalData.length-1][0]).toLocaleDateString()}`);

    } catch (err) {
        console.error('❌ HATA:', err.message);
        await page.screenshot({ path: 'debug-error.png', fullPage: true });
        process.exit(1);
    } finally {
        await browser.close();
    }
}

run();
