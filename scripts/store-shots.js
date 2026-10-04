// Снимки за Google Play: примерни данни → екрани на приложението → рамка с надпис (1080x1920) + графика 1024x500
// Пускане: npm i -D puppeteer-core (или от друга папка с него), после: node scripts/store-shots.js  — нужен е Microsoft Edge.
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const APP = 'file:///C:/dev/Car-tracker-app/index.html';
const OUT = 'C:/dev/Car-tracker-app/store/google-play';
const ICON = 'data:image/png;base64,' + fs.readFileSync('C:/dev/Car-tracker-app/icons/icon-1024.png').toString('base64');

const iso = d => d.toISOString().slice(0, 10);
const day = n => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const monthsAgo = (n, plusDays = 0) => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); d.setUTCMonth(d.getUTCMonth() - n); d.setUTCDate(d.getUTCDate() + plusDays); return iso(d); };

function state(lang, civilDays, active = 'car1') {
  const golf = {
    oil: { date: monthsAgo(4), km: '138500', nextKm: '148500' },
    tires: { date: monthsAgo(6), note: lang === 'bg' ? 'летни' : 'summer' },
    civil: { date: monthsAgo(12, civilDays), period: '12' },
    vignette: { vtype: 'year', date: monthsAgo(3) },
    inspection: { date: monthsAgo(5), expiry: day(210) },
    casco: { date: monthsAgo(2), expiry: day(300) },
    fuel: { list: [
      { id: 1, date: day(-30), liters: 41.2, cost: 66.5, km: 140200 },
      { id: 2, date: day(-17), liters: 38.6, cost: 62.1, km: 140860 },
      { id: 3, date: day(-6), liters: 40.1, cost: 64.9, km: 141550 },
      { id: 4, date: day(-1), liters: 39.4, cost: 63.4, km: 142290 }
    ] }
  };
  const moto = {
    chain: { date: monthsAgo(1), km: '18100', nextKm: '18600' },
    civil: { date: monthsAgo(3), period: '12' },
    inspection: { date: monthsAgo(4), expiry: day(240) }
  };
  return {
    'car-tracker-lang-v1': lang,
    'car-tracker-cars-v1': JSON.stringify([
      { id: 'car1', name: 'VW Golf VII, 2016', km: 142300, type: 'car' },
      { id: 'car2', name: 'Honda CB500F, 2021', km: 18400, type: 'moto' }
    ]),
    'car-tracker-active-v1': active,
    'car-tracker-data-car1': JSON.stringify(golf),
    'car-tracker-data-car2': JSON.stringify(moto),
    'car-tracker-premium-until-v1': 'paid',
    'car-tracker-medals-v1': JSON.stringify({ setup: day(-40), allgood: day(-30), ontime: day(-20), moto: day(-10), fleet: day(-10) }),
    'car-tracker-skin-v1': JSON.stringify({ acc: 'glasses', color: 'amber' })
  };
}

const T = {
  bg: {
    caps: [
      'Всички срокове на колата — на едно място',
      'Напомня 7 дни и 1 ден преди изтичане',
      'Разход на гориво и сметка за месеца',
      'Авария? Помощ с едно натискане',
      'Колата-талисман: медали и облекла',
      'Коли и мотори — до 10 в едно приложение'
    ],
    notifTitle: 'Гражданската изтича след 7 дни',
    notifBody: 'VW Golf VII, 2016 — отвори приложението, за да подновиш навреме.',
    app: 'Моят автомобил', now: 'сега',
    feature: ['Моят автомобил', 'Гражданска, винетка, преглед и каско — напомняне навреме']
  },
  en: {
    caps: [
      'All your car’s deadlines in one place',
      'Reminders 7 days and 1 day before expiry',
      'Fuel consumption and monthly spend',
      'Breakdown? Help in one tap',
      'Mascot car: medals and outfits',
      'Cars and motorcycles — up to 10 in one app'
    ],
    notifTitle: 'Liability insurance expires in 7 days',
    notifBody: 'VW Golf VII, 2016 — open the app to renew in time.',
    app: 'My Car', now: 'now',
    feature: ['My Car', 'Insurance, vignette, inspection and casco — reminded in time']
  }
};

const W = 390, H = 820, DPR = 3;

async function appShot(browser, lang, opts) {
  const p = await browser.newPage();
  const cdp = await p.target().createCDPSession();
  await cdp.send('Emulation.setLocaleOverride', { locale: lang === 'bg' ? 'bg-BG' : 'en-GB' });
  await p.setViewport({ width: W, height: H, deviceScaleFactor: DPR });
  const st = state(lang, opts.civilDays, opts.active);
  await p.evaluateOnNewDocument(s => { localStorage.clear(); for (const k in s) localStorage.setItem(k, s[k]); }, st);
  await p.goto(APP, { waitUntil: 'networkidle0' });
  await p.evaluate(() => document.fonts.ready);
  // Без съобщения „Нов медал“ и без превключвателя за език в кадъра
  await p.addStyleTag({ content: '.toast{display:none!important} .partsRow,.partsNote,.partsInSheet{display:none!important}' });
  if (opts.action) await opts.action(p);
  await new Promise(r => setTimeout(r, 400));
  const buf = await p.screenshot({ type: 'png' });
  await p.close();
  return 'data:image/png;base64,' + buf.toString('base64');
}

function frameHtml(img, caption, notif) {
  return `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@700&family=Inter:wght@500;600&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0}
body{width:1080px;height:1920px;overflow:hidden;background:radial-gradient(120% 70% at 50% 0%,#2a2416 0%,#14171c 55%);font-family:Inter,sans-serif;}
.cap{position:absolute;top:96px;left:70px;right:70px;text-align:center;color:#edeef0;font:700 68px/1.15 'Space Grotesk',sans-serif;letter-spacing:-.5px}
.cap b{color:#e8a33d}
.phone{position:absolute;top:400px;left:105px;width:870px;height:1600px;border-radius:64px 64px 0 0;overflow:hidden;border:10px solid #2b303a;border-bottom:none;box-shadow:0 40px 120px rgba(0,0,0,.55)}
.phone img{width:850px;display:block}
.notif{position:absolute;top:470px;left:150px;right:150px;background:#f4f4f6;border-radius:34px;padding:30px 34px;box-shadow:0 24px 70px rgba(0,0,0,.5);font-family:Inter,sans-serif;color:#1b1d22}
.notif .hd{display:flex;align-items:center;gap:14px;font-size:26px;color:#5b616e;margin-bottom:12px}
.notif .hd img{width:44px;height:44px;border-radius:12px}
.notif .t{font-weight:600;font-size:33px;margin-bottom:6px}
.notif .b{font-size:28px;color:#3b3f48;line-height:1.35}
</style></head><body>
<div class="cap">${caption}</div>
<div class="phone"><img src="${img}"></div>
${notif ? `<div class="notif"><div class="hd"><img src="${ICON}">${notif.app} · ${notif.now}</div><div class="t">${notif.title}</div><div class="b">${notif.body}</div></div>` : ''}
</body></html>`;
}

async function render(browser, html, file, w, h) {
  const p = await browser.newPage();
  await p.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
  await p.setContent(html, { waitUntil: 'networkidle0' });
  await p.evaluate(() => document.fonts.ready);
  await p.screenshot({ path: file, type: 'png' });
  await p.close();
}

// Първата дума/израз в надписа — в оранжево
const accent = s => s.replace(/^([^—:?]+)([—:?])/, '<b>$1</b>$2');

(async () => {
  const browser = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--allow-file-access-from-files'] });
  for (const lang of ['bg', 'en']) {
    const t = T[lang];
    const dir = path.join(OUT, 'screenshots', lang);
    fs.mkdirSync(dir, { recursive: true });
    const scrollTo = sel => async p => { await p.evaluate(s => { const el = document.querySelector(s); window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 12); }, sel); };
    const shots = [
      { civilDays: 120 },
      { civilDays: 7, action: async p => { await p.addStyleTag({ content: '.item[data-id=oil],.item[data-id=tires],.item[data-id=fuel],#medalBar{display:none!important}' }); }, notif: true },
      { civilDays: 120, action: async p => { await p.click('.item[data-id="fuel"]'); } },
      { civilDays: 120, action: async p => { await p.click('#sosBtn'); } },
      { civilDays: 120, action: async p => { await p.click('#medalBar'); } },
      { civilDays: 120, active: 'car2' }
    ];
    for (let i = 0; i < shots.length; i++) {
      const img = await appShot(browser, lang, shots[i]);
      const notif = shots[i].notif ? { app: t.app, now: t.now, title: t.notifTitle, body: t.notifBody } : null;
      const file = path.join(dir, `0${i + 1}.png`);
      await render(browser, frameHtml(img, accent(t.caps[i]), notif), file, 1080, 1920);
      console.log('ok', lang, file);
    }
    // Графика за страницата (feature graphic) 1024x500
    const fg = `<!doctype html><html><head><meta charset="utf-8"><link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@700&family=Inter:wght@500&display=swap" rel="stylesheet">
<style>*{margin:0;box-sizing:border-box}body{width:1024px;height:500px;overflow:hidden;background:linear-gradient(120deg,#14171c 0%,#1c2028 60%,#2a2416 100%);display:flex;align-items:center;gap:56px;padding:0 70px;font-family:Inter,sans-serif}
img{width:300px;height:300px;border-radius:68px;box-shadow:0 30px 80px rgba(0,0,0,.5)}h1{font:700 74px/1.05 'Space Grotesk',sans-serif;color:#edeef0;margin-bottom:22px}p{font-size:31px;line-height:1.35;color:#c9ccd3;max-width:540px}p b{color:#e8a33d}</style></head>
<body><img src="${ICON}"><div><h1>${t.feature[0]}</h1><p>${t.feature[1].replace(/—\s*(.*)$/, '— <b>$1</b>')}</p></div></body></html>`;
    await render(browser, fg, path.join(OUT, `feature-graphic-${lang}.png`), 1024, 500);
    console.log('ok feature', lang);
  }
  await browser.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
