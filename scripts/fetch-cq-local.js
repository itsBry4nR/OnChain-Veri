const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// Ortam değişkenlerinden şifreleri al
const EMAIL = process.env.CQ_EMAIL;
const PASSWORD = process.env.CQ_PASSWORD;

// Yollar
const DATA_DIR = path.join(__dirname, '..', 'data', 'local');
const STATIC_DIR = path.join(__dirname, '..', 'data', 'static');

// Klasörleri oluştur
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

    // ==========================================
    // 1. BÖLÜM: NETFLOW (Giriş Yapmadan - Garanti Veri)
    // ==========================================
    console.log('\n🔵 1. GÖREV: Exchange Netflow (Misafir Modu)');
    
    const netflowTarget = {
        name: 'cq-exchange-netflow',
        url: 'https://cryptoquant.com/asset/btc/chart/exchange-flows/exchange-netflow-total',
        matcher: '/live/v4/charts/' // Genel API yolu
    };

    await fetchAndSave(page, netflowTarget, false); // false = ID araması yapma, genel URL bekle

    // ==========================================
    // 2. BÖLÜM: GİRİŞ DENEMESİ
    // ==========================================
    console.log('\n🔑 2. GÖREV: Giriş Yapılıyor...');
    let isLoggedIn = false;

    if (EMAIL && PASSWORD) {
        try {
            await page.goto('https://cryptoquant.com/sign-in', { waitUntil: 'domcontentloaded', timeout: 60000 });
            await page.waitForTimeout(3000);

            // Seçicileri güncelledim: name="email" genellikle daha kararlıdır
            // Eğer input gelmezse diye catch bloğuna düşer, kod patlamaz.
            await page.waitForSelector('input[name="email"]', { timeout: 10000 });
            
            console.log('📧 Email yazılıyor...');
            await page.fill('input[name="email"]', EMAIL);
            await page.waitForTimeout(1000);

            console.log('🔒 Şifre yazılıyor...');
            await page.fill('input[name="password"]', PASSWORD); // type="password" yerine name="password" deniyoruz
            await page.waitForTimeout(1000);

            console.log('🖱️ Giriş butonuna basılıyor...');
            // Buton seçicisini genelleştirdim
            await page.click('button[type="submit"]');
            
            await page.waitForTimeout(5000);
            console.log('✅ Giriş komutu gönderildi.');
            isLoggedIn = true;

        } catch (e) {
            console.warn('⚠️ Giriş BAŞARISIZ (Ama devam edilecek):', e.message);
            // Giriş başarısız olsa bile SOAB için şansımızı deneyeceğiz (Belki tarihçe kurtarır)
        }
    } else {
        console.log('ℹ️ Şifre yok, giriş atlanıyor.');
    }

    // ==========================================
    // 3. BÖLÜM: SPENT OUTPUT AGE BANDS (Login Sonrası)
    // ==========================================
    console.log('\n🔵 3. GÖREV: Spent Output Age Bands (Login Sonrası)');

    const soabTarget = {
        name: 'cq-spent-output-age-bands',
        url: 'https://cryptoquant.com/asset/btc/chart/market-indicator/spent-output-age-bands',
        matcher: '62186e8661aa6b64f8a948c0' // Senin verdiğin özel ID
    };

    // Giriş yapabildiysek ID ile, yapamadıysak belki yine de deneriz
    await fetchAndSave(page, soabTarget, true); // true = ID ile yakala

    console.log('\n👋 Tüm Operasyon Bitti.');
    await browser.close();
}

/**
 * Veriyi çeken, tarihçe ile birleştiren ve kaydeden yardımcı fonksiyon
 */
async function fetchAndSave(page, target, useIdMatch) {
    let newData = [];
    let success = false;

    try {
        // Pusu Kur
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
        
        if (newData.length > 0) {
            console.log(`📥 İndirilen Satır: ${newData.length}`);
            success = true;
        }

    } catch (err) {
        console.warn(`⚠️ ${target.name} CANLI ÇEKİLEMEDİ:`, err.message);
    }

    // --- HİBRİT BİRLEŞTİRME ---
    const historyFile = path.join(STATIC_DIR, `${target.name}-history.json`);
    const outputFile = path.join(DATA_DIR, `${target.name}.json`);
    let finalData = newData; 

    if (fs.existsSync(historyFile)) {
        try {
            const historyRaw = fs.readFileSync(historyFile, 'utf-8');
            const historyData = JSON.parse(historyRaw);
            
            if (Array.isArray(historyData)) {
                console.log(`📜 Tarihçe Okundu: ${historyData.length} satır`);
                if (success && newData.length > 0) {
                    const combined = [...historyData, ...newData];
                    const uniqueMap = new Map();
                    // Null değerleri temizle ve map'e at
                    combined.forEach(item => { if(item && item.length >= 2) uniqueMap.set(item[0], item); });
                    finalData = Array.from(uniqueMap.values()).sort((a, b) => a[0] - b[0]);
                    console.log('🔗 Birleştirme Başarılı.');
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
