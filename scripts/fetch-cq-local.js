const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// Ortam değişkenlerinden şifreleri al
const EMAIL = process.env.CQ_EMAIL;
const PASSWORD = process.env.CQ_PASSWORD;

// --- HEDEFLER LİSTESİ ---
const TARGETS = [
    {
        name: 'cq-exchange-netflow',
        pageUrl: 'https://cryptoquant.com/asset/btc/chart/exchange-flows/exchange-netflow-total',
        matcher: '/live/v4/charts/' 
    },
    {
        name: 'cq-spent-output-age-bands',
        pageUrl: 'https://cryptoquant.com/asset/btc/chart/market-indicator/spent-output-age-bands',
        matcher: '62186e8661aa6b64f8a948c0' 
    }
];

// Yollar
const DATA_DIR = path.join(__dirname, '..', 'data', 'local');
const STATIC_DIR = path.join(__dirname, '..', 'data', 'static');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(STATIC_DIR)) fs.mkdirSync(STATIC_DIR, { recursive: true });

async function run() {
    console.log('🕵️‍♂️ CryptoQuant Ajanı Başlatılıyor (Login Modu)...');

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

    // --- LOGİN İŞLEMİ (Eğer şifre tanımlıysa) ---
    if (EMAIL && PASSWORD) {
        try {
            console.log('🔑 Giriş yapılıyor...');
            // Giriş sayfasına git
            await page.goto('https://cryptoquant.com/sign-in', { waitUntil: 'domcontentloaded' });
            await page.waitForTimeout(3000);

            // Email yaz (İnsan gibi yavaş yaz)
            console.log('📧 Email yazılıyor...');
            await page.fill('input[type="email"]', EMAIL);
            await page.waitForTimeout(1000);

            // Şifre yaz
            console.log('🔒 Şifre yazılıyor...');
            await page.fill('input[type="password"]', PASSWORD);
            await page.waitForTimeout(1000);

            // Giriş butonuna bas (Genellikle type="submit" olur)
            console.log('🖱️ Giriş butonuna basılıyor...');
            await page.click('button[type="submit"]');
            
            // Login sonrası yönlendirmeyi bekle (Örn: Profil ikonu görünene kadar)
            // Sabit bir bekleme yapıyoruz ki site kendine gelsin
            await page.waitForTimeout(10000); 
            console.log('✅ Giriş işlemi tamamlandı (veya denendi).');

        } catch (e) {
            console.warn('⚠️ Giriş sırasında sorun oluştu (Captcha çıkmış olabilir):', e.message);
        }
    } else {
        console.log('ℹ️ Şifre tanımlanmamış, misafir modunda devam ediliyor.');
    }

    // --- VERİ TOPLAMA DÖNGÜSÜ ---
    for (const target of TARGETS) {
        console.log(`\n🔵 Hedef: ${target.name}`);
        
        let newData = [];
        let success = false;

        try {
            const responsePromise = page.waitForResponse(response => 
                response.url().includes(target.matcher) && 
                response.status() === 200,
                { timeout: 45000 }
            );

            console.log(`🌍 Sayfaya gidiliyor: ${target.pageUrl}`);
            await page.goto(target.pageUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

            console.log('⏳ Veri bekleniyor...');
            await page.waitForTimeout(2000);
            await page.mouse.move(100, 100);
            await page.waitForTimeout(1000);
            await page.mouse.move(300, 300);

            const response = await responsePromise;
            console.log(`🎯 PAKET YAKALANDI! (${target.matcher})`);

            const json = await response.json();
            
            if (json.result && json.result.data) newData = json.result.data;
            else if (json.data) newData = json.data;
            
            if (newData.length > 0) {
                console.log(`📥 Veri: ${newData.length} satır`);
                success = true;
            }

        } catch (err) {
            console.warn(`⚠️ ${target.name} çekilemedi:`, err.message);
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
                    if (success && newData.length > 0) {
                        const combined = [...historyData, ...newData];
                        const uniqueMap = new Map();
                        combined.forEach(item => { if(item) uniqueMap.set(item[0], item); });
                        finalData = Array.from(uniqueMap.values()).sort((a, b) => a[0] - b[0]);
                        console.log('🔗 Tarihçe + Yeni Veri birleştirildi.');
                    } else {
                        console.log('ℹ️ Sadece tarihsel veri kullanılıyor.');
                        finalData = historyData;
                    }
                }
            } catch (e) { console.error('❌ Tarih okuma hatası:', e.message); }
        }

        if (finalData.length > 0) {
            const outputJSON = { result: { data: finalData } };
            fs.writeFileSync(outputFile, JSON.stringify(outputJSON, null, 2));
            console.log(`✅ KAYDEDİLDİ: ${target.name}.json`);
        }
    }

    console.log('\n👋 Operasyon bitti.');
    await browser.close();
}

run();
