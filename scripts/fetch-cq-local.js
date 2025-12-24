// scripts/fetch-cq-local.js
const fs = require("fs");
const path = require("path");

const CQ_URL =
  "https://api.cryptoquant.com/live/v4/charts/61a5fbaf45de34521f1dcad1?window=DAY&from=1135375200000&to=1766581469430&limit=70000";

async function main() {
  const outDir = path.join(__dirname, "..", "data", "local");
  const outFile = path.join(outDir, "cq-exchange-netflow.json");

  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  console.log("📥 CQ indiriliyor...");
  const res = await fetch(CQ_URL, {
    headers: {
      // “bypass” değil; sadece JSON istediğimizi söylüyoruz
      accept: "application/json, text/plain, */*",
    },
  });

  const text = await res.text();
  console.log("➡️ status:", res.status);
  console.log("➡️ first200:", text.slice(0, 200));

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} body=${text.slice(0, 200)}`);
  }

  let json;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new Error("JSON parse edilemedi (HTML dönmüş olabilir).");
  }

  // Basit doğrulama: beklediğimiz anahtarlar var mı?
  const ok =
    json &&
    (json.result?.data || json.data || json.chart || json.metric);

  if (!ok) {
    console.warn("⚠️ JSON geldi ama beklenen format değil. Yine de yazıyorum.");
  }

  fs.writeFileSync(
    outFile,
    JSON.stringify({ lastUpdated: Date.now(), ...json }, null, 2),
    "utf-8"
  );

  console.log("✅ Yazıldı:", outFile);
}

main().catch((err) => {
  console.error("❌ Hata:", err.message);
  process.exit(1);
});
