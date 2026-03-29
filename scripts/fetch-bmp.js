// scripts/fetch-bmp.js
// Bitcoin Magazine Pro Fetcher (RHODL-only: BTC Price ve diğer tüm serileri çöpe atar)

const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
const fs = require('fs');
const path = require('path');

// Stealth plugin'i aktifleştir
chromium.use(stealth);

// --- AYARLAR VE YOLLAR ---
const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data', 'local');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// Headless ayarı
const HEADLESS = (process.env.HEADLESS ?? '1') !== '0';

// Hedef Bilgileri
const TARGET = {
  name: 'bmp-rhodl-ratio',
  url: 'https://www.bitcoinmagazinepro.com/charts/rhodl-ratio/',
  matcher: '_dash-update-component',
};

// --- RAFİNERİ: SADECE RHODL TRACE'I BIRAK ---
function cleanAndFormatBMPData(json) {
  try {
    console.log('🧹 Veri Rafinerisi çalışıyor...');

    const fig = json?.response?.chart?.figure;
    const dataArr = fig?.data;

    if (!fig || !Array.isArray(dataArr)) {
      console.log('⚠️ Beklenen path yok: response.chart.figure.data bulunamadı.');
      return null;
    }

    console.log(`📊 Ham trace sayısı: ${dataArr.length}`);

    // "name": "RHODL Ratio" trace'ini bul
    const idx = dataArr.findIndex(t => (t?.name || '').trim() === 'RHODL Ratio');
    if (idx === -1) {
      console.log('⚠️ "RHODL Ratio" trace bulunamadı.');
      return null;
    }

    // Senin dediğin: "name":"RHODL Ratio" üstü BTC price zaten -> üstünü komple sil
    const rhodlTrace = dataArr[idx];

    // RHODL trace'inin x/y'si olmalı
    if (!Array.isArray(rhodlTrace.x) || !Array.isArray(rhodlTrace.y)) {
      console.log('⚠️ RHODL trace var ama x/y yok. JSON bozuk veya farklı format.');
      return null;
    }

    // 1) Artık sadece RHODL trace kalsın (BTC Price, bound vs her şey silinir)
    fig.data = [rhodlTrace];

    // 2) İstersen layout tarafında sağ yaxis (BTC Price) kalabalık yapmasın diye temizleyelim
    // (Grafiği kaydetmiyoruz ama JSON sadeleşsin diye)
    if (fig.layout) {
      // BTC Price ekseni genelde yaxis (right) idi; RHODL yaxis2 (left)
      // Tam kaldırmak yerine minimalleştirelim:
      if (fig.layout.yaxis) delete fig.layout.yaxis.title;
      // İstersen komple silebilirsin: delete fig.layout.yaxis;
      // Ama bazı dash yapıları yaxis bekliyor olabilir, o yüzden dokunmuyoruz.
    }

    console.log('✅ BTC Price ve diğer tüm trace’ler silindi. Sadece RHODL Ratio kaldı.');

    // 3) Proje standardı çıktı: [timestampMs, value]
    const toMs = (s) => {
      if (s == null) return NaN;
      if (typeof s === 'number' && Number.isFinite(s)) {
        if (s > 1e12) return s;
        if (s > 1e9) return s * 1000;
        return NaN;
      }
      if (typeof s === 'string') {
        const t = new Date(s).getTime();
        return Number.isFinite(t) ? t : NaN;
      }
      return NaN;
    };

    const len = Math.min(rhodlTrace.x.length, rhodlTrace.y.length);
    const m = new Map(); // ts -> value (duplicate varsa sonuncusu kalsın)

    for (let i = 0; i < len; i++) {
      const ts = toMs(rhodlTrace.x[i]);
      const v = Number(rhodlTrace.y[i]);
      if (!Number.isFinite(ts) || !Number.isFinite(v)) continue;
      m.set(ts, v);
    }

    const cleanData = Array.from(m.entries())
      .map(([ts, v]) => [ts, v])
      .sort((a, b) => a[0] - b[0]);

    console.log(`✨ Temizlik bitti. RHODL satır: ${cleanData.length}`);

    return {
      result: {
        dataKeys: ['datetime', 'value'],
        data: cleanData,
      },
    };
  } catch (e) {
    console.error('Temizleme Hatası:', e);
    return null;
  }
}

async function run() {
  console.log('🕵️‍♂️ BitcoinMagazinePro Ajanı Başlatılıyor... (RHODL-only)');

  const browser = await chromium.launch({
    headless: HEADLESS,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--start-maximized',
    ],
  });

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });

  const page = await context.newPage();
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  console.log(`🌍 [GİDİLİYOR] ${TARGET.url}`);

  let capturedData = null;
  let maxDataLength = 0;

  page.on('response', async (response) => {
    if (response.url().includes(TARGET.matcher) && response.status() === 200) {
      try {
        const j = await response.json();
        const s = JSON.stringify(j);
        if (s.length > maxDataLength) {
          console.log(`⚡ Aday Paket (Boyut: ${s.length})`);
          maxDataLength = s.length;
          capturedData = j;
        }
      } catch (_) {}
    }
  });

  try {
    await page.goto(TARGET.url, { waitUntil: 'networkidle', timeout: 60000 });
    console.log('⏳ Grafik verisi için 15sn bekleniyor...');
    await page.waitForTimeout(15000);

    if (!capturedData) throw new Error('Hiçbir veri paketi yakalanamadı.');

    console.log('🎯 Ham veri yakalandı, Rafineri\'ye gönderiliyor...');
    const finalOutput = cleanAndFormatBMPData(capturedData);

    if (!finalOutput || !finalOutput?.result?.data?.length) {
      throw new Error('Veri temizlendi ama sonuç boş çıktı.');
    }

    const outputFile = path.join(DATA_DIR, `${TARGET.name}.json`);
    fs.writeFileSync(outputFile, JSON.stringify(finalOutput, null, 2));
    console.log(`✅ KAYDEDİLDİ: ${TARGET.name}.json (${finalOutput.result.data.length} satır)`);
  } catch (err) {
    console.error(`❌ [HATA] ${err.message}`);
    process.exit(1);
  }

  await browser.close();
  console.log('👋 Operasyon Tamamlandı.');
}

run().catch((e) => {
  console.error('❌ FATAL:', e);
  process.exit(1);
});
