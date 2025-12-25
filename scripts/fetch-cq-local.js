const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// Ortam değişkenlerinden şifreleri al
const EMAIL = process.env.CQ_EMAIL;
const PASSWORD = process.env.CQ_PASSWORD;

// Yollar
const DATA_DIR = path.join(__dirname, '..', 'data', 'local');
const STATIC_DIR = path.join(__dirname, '..', 'data', 'static');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(STATIC_DIR)) fs.mkdirSync(STATIC_DIR, { recursive: true });

async function run() {
    console.log('🕵️‍♂️ CryptoQuant Ajanı Başlatılıyor...');

    const browser = await chromium.launch({
        headless: false,
        args: [
            '--start-maximized',
            '--disable-blink-features=AutomationControlled',
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-infobars',
            '--window-size=1920,1080' // Pencere boyutunu sabitle
        ]
    });

    const context = await browser.newContext({
        viewport: { width: 1920, height: 1080 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
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

    // ==========================================
    // 1. BÖLÜM: NETFLOW (Misafir Modu - Garanti)
    // ==========================================
    console.log('\n🔵 1. GÖREV: Exchange Netflow (Misafir Modu)');
    const netflowTarget = {
        name: 'cq-exchange-netflow',
        url: 'https://cryptoquant.com/asset/btc/chart/exchange-flows/exchange-netflow-total',
        matcher: '/live/v4/charts/' 
    };
    await fetchAndSave(page, netflowTarget); 

    // ==========================================
    // 2. BÖLÜM: GİRİŞ DENEMESİ
    // ==========================================
    console.log('\n🔑 2. GÖREV: Giriş Yapılıyor...');
    
    if (EMAIL && PASSWORD) {
        try {
            // Taktik: Önce anasayfaya git, cookieleri ısıt
            await page.goto('https://cryptoquant.com', { waitUntil: 'domcontentloaded' });
            await page.waitForTimeout(2000);
            
            console.log('🌍 Giriş sayfasına yöneliniyor...');
            await page.goto('https://cryptoquant.com/sign-in', { waitUntil: 'domcontentloaded' });
            
            // Cloudflare kontrolü için biraz bekle
            console.log('⏳ Sayfa yükleniyor (Cloudflare engeli var mı?)...');
            await page.waitForTimeout(5000);

            // Email kutusunu bekle (Çoklu deneme)
            // type="email" veya name="email" veya placeholder içinde Email geçen
            const emailInput = await page.waitForSelector('input[type="email"], input[name="email"]', { timeout: 15000 });
            
            if (emailInput) {
                console.log('📧 Email yazılıyor...');
                await emailInput.fill(EMAIL);
                await page.waitForTimeout(1000);

                console.log('🔒 Şifre yazılıyor...');
                await page.fill('input[type="password"]', PASSWORD);
                await page.waitForTimeout(1000);

                console.log('🖱️ Giriş butonuna basılıyor...');
                await page.click('button[type="submit"]');
                await page.waitForTimeout(5000);
                console.log('✅ Giriş işlemi tamamlandı (Butona basıldı).');
            }

        } catch (e) {
            console.warn('⚠️ Giriş BAŞARISIZ:', e.message);
            // HATA ANINDA FOTOĞRAF ÇEK!
            await page.screenshot({ path: 'login-fail.png', fullPage: true });
            console.log('📸 Hata ekran görüntüsü alındı: login-fail.png');
        }
    } else {
        console.log('ℹ️ Şifre yok, giriş atlanıyor.');
    }

    // ==========================================
    // 3. BÖLÜM: SPENT OUTPUT AGE BANDS
    // ==========================================
    console.log('\n🔵 3. GÖREV: Spent Output Age Bands (Login Sonrası)');
    const soabTarget = {
        name: 'cq-spent-output-age-bands',
        url: 'https://cryptoquant.com/asset/btc/chart/market-indicator/spent-output-age-bands',
        matcher: '62186e8661aa6b64f8a948c0' 
    };
    await fetchAndSave(page, soabTarget);

    console.log('\n👋 Tüm Operasyon Bitti.');
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

        console.log('⏳ Veri bekleniyor...');
        await page.waitForTimeout(2000);
        await page.mouse.move(150, 150);
        await page.waitForTimeout(1000);
        await page.mouse.move(300, 300);

        const response = await responsePromise;
        console.log(`🎯 PAKET YAKALANDI! (${target.name})`);

        const json = await response.json();
        if (json.result && json.result.data) newData = json.result.data;
        else if (json.data) newData = json.data;
        
        if (newData.length > 0) success = true;

    } catch (err) {
        console.warn(`⚠️ ${target.name} CANLI ÇEKİLEMEDİ:`, err.message);
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
        } catch (e) { console.error('❌ Tarihçe hatası:', e.message); }
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
