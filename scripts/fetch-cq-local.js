const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// Hedef: API Linki DEĞİL, Grafiğin olduğu gerçek sayfa (Pusu için)
const CHART_PAGE_URL = 'https://cryptoquant.com/asset/btc/chart/exchange-flows/exchange-netflow-total';

// Klasör Yapısı: data/local içine kaydedeceğiz
const DATA_DIR = path.join(__dirname, '..', 'data', 'local');
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

async function run() {
    console.log('🕵️‍♂️ CryptoQuant Ajanı Başlatılıyor (Stealth Modu)...');

    // GitHub'da ekran kartı olmadığı için XVFB (Sanal Ekran) kullanacağız.
    // Bu yüzden headless: false kalmalı.
    const browser = await chromium.launch({
        headless: false, 
        args: [
            '--start-maximized',
            '--disable-blink-features=AutomationControlled',
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-infobars',
            '--ignore-certificate-errors'
        ]
    });

    // Windows 10 / Chrome taklidi yapan Context
    const context = await browser.newContext({
        viewport: { width: 1920, height: 1080 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        locale: 'en-US',
        timezoneId: 'America/New_York',
        deviceScaleFactor: 1,
        isMobile: false,
        hasTouch: false,
        javaScriptEnabled: true
    });

    // Otomasyon izlerini silme (Cloudflare'i kandırmak için kritik)
    await context.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        window.chrome = { runtime: {} };
        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    });

    const page = await context.newPage();

    // --- PUSU KURULUYOR ---
    // Sayfa yüklenirken arkada API'ye atılan isteği yakala
    const responsePromise = page.waitForResponse(response => 
        response.url().includes('/live/v4/charts/') && 
        response.status() === 200,
        { timeout: 90000 } // 90 saniye bekle (GitHub bazen yavaştır)
    );

    try {
        console.log('🌐 Grafik sayfasına gidiliyor...');
        
        // Sayfaya git (Timeout süresi uzun tutuldu)
        await page.goto(CHART_PAGE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

        console.log('⏳ Veri paketinin ağa düşmesi bekleniyor...');
        
        // Biraz "insan gibi" bekleme ve mouse hareketi
        await page.waitForTimeout(2000);
        await page.mouse.move(100, 100);
        
        // Paketi yakala
        const response = await responsePromise;
        console.log('🎯 Paket yakalandı!');

        const json = await response.json();

        // Dosyaya yaz
        const filePath = path.join(DATA_DIR, 'cq-exchange-netflow.json');
        fs.writeFileSync(filePath, JSON.stringify(json, null, 2));
        
        console.log(`✅ OPERASYON BAŞARILI! Veri şurada: ${filePath}`);

        // Veri kontrolü
        if (json.result && json.result.data) {
            console.log(`📊 Çekilen Veri Noktası: ${json.result.data.length}`);
        } else {
            console.warn('⚠️ JSON indi ama beklenen formatta değil.');
        }

    } catch (err) {
        console.error('❌ HATA:', err.message);
        // Hata durumunda ekran görüntüsü al (Artifacts'ten bakmak için)
        await page.screenshot({ path: 'debug-error.png', fullPage: true });
        console.log('📸 Hata ekran görüntüsü alındı (debug-error.png)');
        process.exit(1); // Hata koduyla çık
    } finally {
        console.log('👋 Tarayıcı kapatılıyor...');
        await browser.close();
    }
}

run();
