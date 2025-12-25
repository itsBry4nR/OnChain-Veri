const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// Ortam değişkeninden Cookie'yi al
const COOKIE_STRING = process.env.CQ_COOKIE;

// Yollar
const DATA_DIR = path.join(__dirname, '..', 'data', 'local');
const STATIC_DIR = path.join(__dirname, '..', 'data', 'static');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(STATIC_DIR)) fs.mkdirSync(STATIC_DIR, { recursive: true });

async function run() {
    console.log('🕵️‍♂️ CryptoQuant Ajanı Başlatılıyor (Cookie Modu)...');

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
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        locale: 'en-US',
        timezoneId: 'America/New_York'
    });

    // === COOKIE AŞILAMA (EN KRİTİK NOKTA) ===
    if (COOKIE_STRING) {
        console.log('🍪 Cookie bulundu, tarayıcıya aşılanıyor...');
        
        // Cookie stringini parçalayıp objeye çeviriyoruz
        const cookies = COOKIE_STRING.split(';')
            .map(c => c.trim())
            .filter(c => c.includes('='))
            .map(c => {
                const parts = c.split('=');
                return {
                    name: parts[0],
                    value: parts.slice(1).join('='), // İçinde = geçen değerler bozulmasın
                    domain: '.cryptoquant.com',
                    path: '/'
                };
            });

        await context.addCookies(cookies);
        console.log(`✅ ${cookies.length} adet çerez yüklendi.`);
    } else {
        console.warn('⚠️ UYARI: Cookie bulunamadı! Misafir modu çalışacak.');
    }

    // Anti-detect scriptleri
    await context.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        window.chrome = { runtime: {} };
        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    });

    const page = await context.newPage();

    // ==========================================
    // 1. GÖREV: NETFLOW (Genel)
    // ==========================================
    console.log('\n🔵 1. GÖREV: Exchange Netflow');
    await fetchAndSave(page, {
        name: 'cq-exchange-netflow',
        url: 'https://cryptoquant.com/asset/btc/chart/exchange-flows/exchange-netflow-total',
        matcher: '/live/v4/charts/' 
    });

    // ==========================================
    // 2. GÖREV: SOAB (Cookie ile Erişim)
    // ==========================================
    console.log('\n🔵 2. GÖREV: Spent Output Age Bands');
    await fetchAndSave(page, {
        name: 'cq-spent-output-age-bands',
        url: 'https://cryptoquant.com/asset/btc/chart/market-indicator/spent-output-age-bands',
        matcher: '62186e8661aa6b64f8a948c0' 
    });

    console.log('\n👋 Operasyon Bitti.');
    await browser.close();
}

async function fetchAndSave(page, target) {
    let newData = [];
    let success = false;

    try {
        const responsePromise = page.waitForResponse(response => 
            response.url().includes(target.matcher) && 
            response.status() === 200,
            { timeout: 45000 }
        );

        console.log(`🌍 Sayfaya gidiliyor: ${target.url}`);
        await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: 60000 });

        // İnsan taklidi
        await page.waitForTimeout(2000);
        await page.mouse.move(100, 200);

        const response = await responsePromise;
        console.log(`🎯 PAKET YAKALANDI! (${target.name})`);

        const json = await response.json();
        if (json.result && json.result.data) newData = json.result.data;
        else if (json.data) newData = json.data;
        
        if (newData.length > 0) success = true;

    } catch (err) {
        console.warn(`⚠️ ${target.name} CANLI ÇEKİLEMEDİ: ${err.message}`);
    }

    // --- BİRLEŞTİRME ---
    const historyFile = path.join(STATIC_DIR, `${target.name}-history.json`);
    const outputFile = path.join(DATA_DIR, `${target.name}.json`);
    let finalData = newData; 

    if (fs.existsSync(historyFile)) {
        try {
            const historyRaw = fs.readFileSync(historyFile, 'utf-8');
            const historyData = JSON.parse(historyRaw);
            if (Array.isArray(historyData)) {
                if (success && newData.length > 0) {
                    const combined = [...historyData, ...newData];
                    const uniqueMap = new Map();
                    combined.forEach(item => { if(item) uniqueMap.set(item[0], item); });
                    finalData = Array.from(uniqueMap.values()).sort((a, b) => a[0] - b[0]);
                    console.log(`🔗 Birleştirme Başarılı (${finalData.length} satır).`);
                } else {
                    console.log('ℹ️ Yeni veri yok, tarihçe kullanılıyor.');
                    finalData = historyData;
                }
            }
        } catch (e) {}
    }

    if (finalData.length > 0) {
        const outputJSON = { result: { data: finalData } };
        fs.writeFileSync(outputFile, JSON.stringify(outputJSON, null, 2));
        console.log(`✅ KAYDEDİLDİ: ${target.name}.json`);
    } else {
        console.error(`❌ ${target.name} İÇİN HİÇ VERİ YOK!`);
    }
}

run();
