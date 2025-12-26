const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// Ortam değişkeninden Cookie'yi al
const COOKIE_DATA = process.env.CQ_COOKIE;

// Yollar
const DATA_DIR = path.join(__dirname, '..', 'data', 'local');
const STATIC_DIR = path.join(__dirname, '..', 'data', 'static');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(STATIC_DIR)) fs.mkdirSync(STATIC_DIR, { recursive: true });

async function run() {
    console.log('🕵️‍♂️ CryptoQuant Ajanı Başlatılıyor (Metadata Modu)...');

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

    // === COOKIE ENJEKSİYONU ===
    if (COOKIE_DATA) {
        try {
            console.log('🍪 Cookie verisi işleniyor...');
            let cookies = [];
            if (COOKIE_DATA.trim().startsWith('[')) {
                const parsedCookies = JSON.parse(COOKIE_DATA);
                cookies = parsedCookies.map(c => {
                    const { hostOnly, session, storeId, id, expirationDate, sameSite, ...rest } = c;
                    if (!rest.domain) rest.domain = '.cryptoquant.com';
                    // SameSite Fix
                    if (sameSite === 'no_restriction' || sameSite === 'unspecified') rest.sameSite = 'None';
                    else if (sameSite) {
                        const lower = sameSite.toLowerCase();
                        if (lower === 'lax') rest.sameSite = 'Lax';
                        else if (lower === 'strict') rest.sameSite = 'Strict';
                        else rest.sameSite = 'None';
                    } else rest.sameSite = 'None';
                    if (rest.sameSite === 'None') rest.secure = true;
                    if (expirationDate) rest.expires = expirationDate;
                    delete rest.url; 
                    return rest;
                });
            } else {
                cookies = COOKIE_DATA.split(';')
                    .map(c => c.trim())
                    .filter(c => c.includes('='))
                    .map(c => ({
                        name: c.split('=')[0],
                        value: c.split('=')[1],
                        domain: '.cryptoquant.com',
                        path: '/',
                        sameSite: 'None',
                        secure: true
                    }));
            }
            if (cookies.length > 0) await context.addCookies(cookies);
        } catch (e) { console.error('❌ Cookie hatası:', e.message); }
    }

    await context.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        window.chrome = { runtime: {} };
    });

    const page = await context.newPage();

    // 1. GÖREV: NETFLOW
    console.log('\n🔵 1. GÖREV: Exchange Netflow');
    await fetchAndSave(page, {
        name: 'cq-exchange-netflow',
        url: 'https://cryptoquant.com/asset/btc/chart/exchange-flows/exchange-netflow-total',
        matcher: '/live/v4/charts/' 
    });

    // 2. GÖREV: SOAB
    console.log('\n🔵 2. GÖREV: Spent Output Age Bands');
    await fetchAndSave(page, {
        name: 'cq-spent-output-age-bands',
        url: 'https://cryptoquant.com/asset/btc/chart/network-indicator/spent-output-age-bands?window=DAY&priceScale=log&metricScale=linear',
        matcher: '/live/v4/charts/' 
    });

    console.log('\n👋 Operasyon Bitti.');
    await browser.close();
}

async function fetchAndSave(page, target) {
    let newData = [];
    let capturedKeys = null; // Sütun isimlerini tutacak değişken
    let success = false;

    try {
        const responsePromise = page.waitForResponse(response => 
            response.url().includes(target.matcher) && 
            response.status() === 200,
            { timeout: 35000 }
        );

        console.log(`🌍 Sayfaya gidiliyor: ${target.url}`);
        await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        console.log('⏳ Veri bekleniyor...');
        await page.waitForTimeout(5000); 
        await page.mouse.move(100, 200);

        const response = await responsePromise;
        console.log(`🎯 PAKET YAKALANDI! (${target.name})`);

        const json = await response.json();
        
        // Veriyi Çek
        if (json.result && json.result.data) newData = json.result.data;
        else if (json.data) newData = json.data;

        // Metadata (dataKeys) Çek - BU YENİ EKLENDİ
        if (json.result && json.result.dataKeys) capturedKeys = json.result.dataKeys;
        else if (json.dataKeys) capturedKeys = json.dataKeys;
        
        if (newData.length > 0) success = true;

    } catch (err) {
        console.warn(`⚠️ ${target.name} CANLI ÇEKİLEMEDİ: ${err.message}`);
        const screenshotPath = path.join(DATA_DIR, `debug-${target.name}.png`);
        await page.screenshot({ path: screenshotPath, fullPage: true });
    }

    // --- BİRLEŞTİRME ---
    const historyFile = path.join(STATIC_DIR, `${target.name}-history.json`);
    const outputFile = path.join(DATA_DIR, `${target.name}.json`);
    let finalData = newData; 
    
    // Eğer canlı çekimden key gelmediyse, belki dosyada kayıtlıdır diye kontrol edeceğiz
    let finalKeys = capturedKeys; 

    if (fs.existsSync(historyFile)) {
        try {
            const historyRaw = fs.readFileSync(historyFile, 'utf-8');
            const historyJSON = JSON.parse(historyRaw);
            
            // Tarihçe dosyası bazen sadece array, bazen { result: { data: [] } } olabilir.
            // Bizim eski formatımız sadece array idi.
            let historyData = [];

            if (Array.isArray(historyJSON)) {
                historyData = historyJSON;
            } else if (historyJSON.result && historyJSON.result.data) {
                historyData = historyJSON.result.data;
                // Eğer tarihçede keys varsa ve biz yenisini bulamadıysak onu kullan
                if (!finalKeys && historyJSON.result.dataKeys) finalKeys = historyJSON.result.dataKeys;
            }

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
        } catch (e) { console.error('❌ Tarihçe hatası:', e.message); }
    }

    if (finalData.length > 0) {
        // ARTIK FORMATIMIZ DAHA ZENGİN
        const outputJSON = { 
            result: { 
                dataKeys: finalKeys || ["datetime", "value"], // Eğer key bulamazsa varsayılan salla
                data: finalData 
            } 
        };
        fs.writeFileSync(outputFile, JSON.stringify(outputJSON, null, 2));
        console.log(`✅ KAYDEDİLDİ: ${target.name}.json (Keys: ${finalKeys ? 'VAR' : 'YOK'})`);
    }
}

run();
