// scripts/fetch-cq-local.js
// Cloudflare Fix: Summary Page Warm-up + Stealth Mode

const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
const fs = require('fs');
const path = require('path');

// Stealth plugin'i aktifleştir
chromium.use(stealth);

// --- AYARLAR VE YOLLAR ---
const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data', 'local');
const STATIC_DIR = path.join(ROOT, 'data', 'static');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(STATIC_DIR)) fs.mkdirSync(STATIC_DIR, { recursive: true });

const RAW_COOKIE = process.env.CQ_COOKIE || '';
const HEADLESS = (process.env.HEADLESS ?? '1') !== '0';

// --- HEDEFLER LİSTESİ ---
const TARGETS = [
  {
    // SENİN VERDİĞİN ÖZEL URL
    name: 'cq-exchange-netflow',
    url: 'https://cryptoquant.com/asset/btc/chart/exchange-flows/exchange-netflow-total?exchange=all_exchange&window=DAY&sma=0_365&ema=0&priceScale=log&metricScale=linear&chartStyle=column',
    matcher: '/live/v4/charts/'
  },
  {
    name: 'cq-exchange-inflow',
    url: 'https://cryptoquant.com/asset/btc/chart/exchange-flows/exchange-inflow-total?exchange=all_exchange&window=DAY&sma=0&ema=0&priceScale=log&metricScale=linear&chartStyle=column',
    matcher: '/live/v4/charts/'
  },
  {
    name: 'cq-exchange-outflow',
    url: 'https://cryptoquant.com/asset/btc/chart/exchange-flows/exchange-outflow-total?exchange=all_exchange&window=DAY&sma=0&ema=0&priceScale=log&metricScale=linear&chartStyle=column',
    matcher: '/live/v4/charts/'
  },
  {
    name: 'cq-exchange-reserve',
    url: 'https://cryptoquant.com/asset/btc/chart/exchange-flows/exchange-reserve?exchange=all_exchange&window=DAY&sma=0&ema=0&priceScale=log&metricScale=linear&chartStyle=line',
    matcher: '/live/v4/charts/'
  },
  {
    name: 'cq-spent-output-age-bands',
    url: 'https://cryptoquant.com/asset/btc/chart/network-indicator/spent-output-age-bands-percent?window=DAY&priceScale=log&metricScale=linear',
    matcher: '/live/v4/charts/'
  },
  {
    name: 'cq-exchange-whale-ratio',
    url: 'https://cryptoquant.com/asset/btc/chart/flow-indicator/exchange-whale-ratio?exchange=all_exchange&window=DAY&sma=0&ema=0&priceScale=log&metricScale=linear&chartStyle=line',
    matcher: '/live/v4/charts/'
  },
  {
    name: 'cq-stablecoin-supply-ratio',
    url: 'https://cryptoquant.com/asset/btc/chart/market-indicator/stablecoin-supply-ratio-ssr?window=DAY&sma=0&ema=0&priceScale=log&metricScale=linear&chartStyle=line',
    matcher: '/live/v4/charts/'
  },
  {
    name: 'cq-miners-position-index',
    url: 'https://cryptoquant.com/asset/btc/chart/flow-indicator/miners-position-index-mpi?window=DAY&sma=0&ema=0&priceScale=log&metricScale=linear&chartStyle=line',
    matcher: '/live/v4/charts/'
  },
  {
    name: 'cq-asopr',
    url: 'https://cryptoquant.com/asset/btc/chart/market-indicator/adjusted-sopr-asopr?window=DAY&sma=0&ema=0&priceScale=log&metricScale=log&chartStyle=line',
    matcher: '/live/v4/charts/'
  },
  {
    name: 'cq-miner-reserve',
    url: 'https://cryptoquant.com/asset/btc/chart/miner-flows/miner-reserve?miner=all_miner&window=DAY&sma=0&ema=0&priceScale=log&metricScale=linear&chartStyle=line',
    matcher: '/live/v4/charts/'
  },
  {
    name: 'cq-fees-total',
    url: 'https://cryptoquant.com/asset/btc/chart/fees-and-revenue/fees-total?window=DAY&sma=0&ema=0&priceScale=log&metricScale=linear&chartStyle=line',
    matcher: '/live/v4/charts/'
  },
  {
    name: 'cq-fees-to-reward-ratio',
    url: 'https://cryptoquant.com/asset/btc/chart/fees-and-revenue/fees-to-reward-ratio?window=DAY&sma=0&ema=0&priceScale=log&metricScale=linear&chartStyle=line',
    matcher: '/live/v4/charts/'
  }
  
];

// --- AKILLI COOKIE TRANSLATOR (EditThisCookie -> Playwright) ---
function getPlaywrightCookies(rawString) {
  if (!rawString) return [];
  
  // 1. JSON Array Kontrolü
  try {
    const parsed = JSON.parse(rawString);
    if (Array.isArray(parsed)) {
      console.log('💡 Algılanan Format: EditThisCookie JSON');
      return parsed.map(c => {
        const newCookie = {
          name: c.name,
          value: c.value,
          domain: c.domain || '.cryptoquant.com', // Domain yoksa varsayılanı ata
          path: c.path || '/',
          secure: c.secure,
          httpOnly: c.httpOnly,
        };
        // Expiration ve SameSite ayarlarını Playwright'a uyarla
        if (c.expirationDate) newCookie.expires = c.expirationDate;
        if (c.sameSite === 'no_restriction') newCookie.sameSite = 'None';
        else if (c.sameSite === 'lax') newCookie.sameSite = 'Lax';
        else if (c.sameSite === 'strict') newCookie.sameSite = 'Strict';
        return newCookie;
      });
    }
  } catch (e) {}

  // 2. Header String Kontrolü
  console.log('💡 Algılanan Format: Header String');
  const cleanString = rawString.replace(/[\r\n]+/g, ';');
  return cleanString.split(';')
    .map(pair => {
      const parts = pair.trim().split('=');
      if (parts.length < 2) return null;
      return {
        name: parts[0].trim(),
        value: parts.slice(1).join('=').trim(),
        domain: '.cryptoquant.com',
        path: '/',
        secure: true
      };
    })
    .filter(c => c !== null && c.name !== '');
}

// --- KAYDETME VE BİRLEŞTİRME ---
function mergeAndSave(targetName, newData, dataKeys) {
  const historyFile = path.join(STATIC_DIR, `${targetName}-history.json`);
  const outputFile = path.join(DATA_DIR, `${targetName}.json`);
  
  let finalData = newData;
  let finalKeys = dataKeys;

  // Tarihçe varsa oku ve birleştir
  if (fs.existsSync(historyFile)) {
    try {
      const historyJSON = JSON.parse(fs.readFileSync(historyFile, 'utf-8'));
      let historyData = [];
      if (Array.isArray(historyJSON)) historyData = historyJSON;
      else if (historyJSON?.result?.data) {
        historyData = historyJSON.result.data;
        if (!finalKeys && historyJSON.result.dataKeys) finalKeys = historyJSON.result.dataKeys;
      }

      if (Array.isArray(finalData) && finalData.length > 0) {
        const combined = [...historyData, ...finalData];
        const uniqueMap = new Map();
        combined.forEach(item => { if (item) uniqueMap.set(item[0], item); });
        finalData = Array.from(uniqueMap.values()).sort((a, b) => a[0] - b[0]);
        console.log(`🔗 ${targetName}: Veri birleştirildi (Toplam: ${finalData.length}).`);
      } else {
        console.log(`ℹ️ ${targetName}: Yeni veri yok, tarihçe kullanılıyor.`);
        finalData = historyData;
      }
    } catch (e) {
      console.error(`❌ ${targetName} Tarihçe hatası:`, e.message);
    }
  }

  if (Array.isArray(finalData) && finalData.length > 0) {
    const outputJSON = {
      result: {
        dataKeys: finalKeys || ['datetime', 'value'],
        data: finalData,
      },
    };
    fs.writeFileSync(outputFile, JSON.stringify(outputJSON, null, 2));
    console.log(`✅ KAYDEDİLDİ: ${targetName}.json`);
  } else {
    console.warn(`⚠️ ${targetName} veri boş, dosya yazılmadı.`);
  }
}

// --- AĞ DİNLEME (INTERCEPT) ---
async function fetchViaIntercept(page, target) {
    console.log(`🌍 [GİDİLİYOR] ${target.name}`);
    
    // Netflow için süreyi biraz daha uzun tutalım
    const waitTime = target.name === 'cq-exchange-netflow' ? 60000 : 40000;

    const responsePromise = page.waitForResponse(
        (response) => response.url().includes(target.matcher) && response.status() === 200,
        { timeout: waitTime }
    );

    try {
        await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        
        // Anti-bot önlemi: Biraz bekle ve fare oynat
        await page.waitForTimeout(3000);
        try {
            await page.mouse.move(100, 100);
            await page.mouse.move(200, 200);
        } catch(e){}

        const response = await responsePromise;
        console.log(`🎯 [YAKALANDI] ${target.name}`);
        const json = await response.json();
        
        let newData = [], capturedKeys = null;
        if (json?.result?.data) newData = json.result.data;
        else if (json?.data) newData = json.data;
        if (json?.result?.dataKeys) capturedKeys = json.result.dataKeys;
        else if (json?.dataKeys) capturedKeys = json.dataKeys;

        mergeAndSave(target.name, newData, capturedKeys);
    } catch (err) {
        console.warn(`⚠️ [HATA] ${target.name} alınamadı: ${err.message}`);
        try {
            const screenshotPath = path.join(DATA_DIR, `HATA-${target.name}.png`);
            await page.screenshot({ path: screenshotPath, fullPage: true });
        } catch (e) {}
    }
}

async function run() {
  console.log('🕵️‍♂️ CryptoQuant Ajanı Başlatılıyor... (Summary -> Chart Flow)');
  
  if (!RAW_COOKIE) { console.error('❌ HATA: CQ_COOKIE yok!'); process.exit(1); }
  
  const cookieList = getPlaywrightCookies(RAW_COOKIE);
  if (cookieList.length === 0) { console.error('❌ HATA: Cookie parse edilemedi.'); process.exit(1); }
  console.log(`🍪 ${cookieList.length} adet cookie hazırlandı.`);

  const browser = await chromium.launch({
    headless: HEADLESS, 
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-setuid-sandbox', '--start-maximized'],
  });

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  });
  
  // 1. Cookie'leri yükle
  try {
    await context.addCookies(cookieList);
    console.log('✅ Cookie\'ler tarayıcıya yüklendi.');
  } catch (e) { console.error('❌ Cookie yükleme hatası:', e.message); }

  const page = await context.newPage();
  await page.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); });

  // 2. ÖNCE SUMMARY SAYFASINA GİT (WARM-UP + RELOAD)
  console.log('🔥 [WARM-UP] Summary sayfasına gidiliyor...');
  try {
      // İlk giriş
      await page.goto('https://cryptoquant.com/asset/btc/summary', { waitUntil: 'domcontentloaded', timeout: 60000 });
      console.log('⏳ İlk yükleme: Oturumun oturması için 15 saniye bekleniyor...');
      await page.waitForTimeout(15000);
      
      // RELOAD (F5) VURUŞU
      console.log('🔄 [RELOAD] Garanti olsun diye sayfa yenileniyor...');
      await page.reload({ waitUntil: 'domcontentloaded' });
      
      console.log('⏳ Reload sonrası 5 saniye daha bekleniyor...');
      await page.waitForTimeout(5000);
      
      console.log('✅ Warm-up tamamlandı. Operasyon başlıyor.');
  } catch (e) {
      console.warn('⚠️ Warm-up sırasında hata (önemsiz olabilir):', e.message);
  }

  // 3. ŞİMDİ HEDEFLERİ GEZ
  for (const target of TARGETS) {
      await fetchViaIntercept(page, target);
  }

  await browser.close();
  console.log('👋 Operasyon Tamamlandı.');
}

run().catch((e) => { console.error('❌ FATAL:', e); process.exit(1); });
