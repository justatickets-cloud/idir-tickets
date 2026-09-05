/* ==========================================================================
   איידיר כרטיסים | IDIR Tickets  -  build.js
   גרסת בדיקה (POC) עבור Cloudflare Pages
   קורא shows.json, לוקח את 10 המופעים הראשונים, ומייצר אתר סטטי לתוך dist/
   הרצה:  node build.js
   ========================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');

/* ----------------------------- הגדרות מותג ------------------------------ */
const BRAND = {
  nameHe: 'איידיר כרטיסים',
  nameEn: 'IDIR Tickets',
  domain: 'https://idir.co.il',        // דומיין ראשי
  affiliateBase: 'https://idir.kartisim.co.il', // בסיס רכישה (שותף)
  tagline: 'כל המופעים במקום אחד',
  outDir: path.join(__dirname, 'dist'),
  dataFile: path.join(__dirname, 'shows.json'),
  limit: 0, // 0 = כל המופעים ; מספר חיובי = מגבלה (למשל 10 לפיילוט)
  adsenseClient: 'ca-pub-0718695615942520',
  adsTxt: 'google.com, pub-0718695615942520, DIRECT, f08c47fec0942fa0',
  ga4: 'G-SPHBFXVSJW',
};

/* ------------------------------ עזרי טקסט ------------------------------- */
const MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
const DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

// escaping מלא לערכי תכונות (attributes) בלבד, כולל מרכאות
function esc(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// escaping לטקסט גלוי בלבד: משאיר גרשיים ומרכאות כפי שהם (פלט נקי, בלי &#39; ו-&quot;)
function escText(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// משאיר תגיות בסיסיות מהתיאור המקורי, מסיר סקריפטים ותכונות מסוכנות
function safeHtml(html) {
  return String(html || '')
    .replace(/<\s*script[^>]*>[\s\S]*?<\s*\/\s*script\s*>/gi, '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '');
}

function stripTags(html) {
  return String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatDate(iso) {
  // "2026-12-26" -> "שבת, 26 בדצמבר 2026"
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) return esc(iso);
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return `${DAYS[d.getDay()]}, ${Number(m[3])} ב${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

function formatTime(t) {
  // "12:30:00" -> "12:30"
  const m = /^(\d{2}):(\d{2})/.exec(String(t || ''));
  return m ? `${m[1]}:${m[2]}` : esc(t);
}

// מחיר פתיחה אחיד: מחיר יחיד => "X ₪" ; טווח => "החל מ-X ₪" (לעולם לא "בין X ל Y")
function priceLabel(min, max) {
  const a = Number(min), b = Number(max);
  if (!a && !b) return 'מחיר יפורסם בהמשך';
  if (!b || a === b) return `${a} ₪`;
  return `החל מ-${a} ₪`;
}

function affiliateUrl(link) {
  const l = String(link || '');
  return BRAND.affiliateBase + (l.startsWith('/') ? l : '/' + l);
}

// זמינות: מועד אזל כשאין כרטיסים (tickets===0) או אין קישור רכישה
function seanceSoldOut(s) { return Number(s.tickets) === 0 || !s.link; }
// מופע אזל לחלוטין כשכל המועדים אזלו
function showSoldOut(show) {
  const ses = show.Seances || [];
  return ses.length > 0 && ses.every(seanceSoldOut);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

/* ---- עוזרי תאריך בצד השרת (לפי אזור זמן ישראל, חסין DST) ---- */
function pad2(n) { return String(n).padStart(2, '0'); }
function ymdStr(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function addDays(base, n) { const x = new Date(base); x.setDate(x.getDate() + n); return x; }

// "היום" לפי שעון ישראל, כתאריך מקומי לצורך חישובים
function israelToday() {
  const s = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/* ---- מבנה כתובות היררכי: קטגוריה + סלאג מופע ---- */
const CATEGORY_SLUGS = {
  'הופעות': 'shows',
  'הופעות ג\'אז ובלוז': 'jazz-blues',
  'הופעות מוזיקה קלאסית': 'classical',
  'הופעות מחול ובלט': 'dance-ballet',
  'הצגות': 'plays',
  'הצגות ילדים': 'kids',
  'אופרה': 'opera',
  'סטנד אפ': 'standup',
  'קרקס': 'circus',
  'הרצאות וכיתות האמן': 'lectures',
  'סרטים': 'movies',
  'הופעות רוק': 'rock',
  'תערוכות': 'exhibitions',
  'מחזמר': 'musical',
  'קונצרטים לילדים': 'kids-concerts',
  'אטרקציות': 'attractions',
  'שעת סיפור': 'story-time',
};
function categorySlug(section) { return CATEGORY_SLUGS[section] || 'events'; }

// ניקוי שם מופע לסלאג URL: משאיר אותיות/ספרות, רווחים ומקפים -> מקף יחיד
function slugify(str) {
  return String(str || '')
    .replace(/&nbsp;|&#160;|&#x0*a0;| |﻿/gi, ' ') // רווחים לא שבירים / entities נסתרים -> רווח רגיל
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}\s-]/gu, '') // מסיר מרכאות, סלאשים, פיסוק ותווים מיוחדים
    .trim()
    .replace(/[\s-]+/g, '-')           // רווחים ומקפים כפולים -> מקף אחד
    .replace(/^-+|-+$/g, '');
}

// הגבלת אורך מקטע נתיב לפי בתים (מגבלת Linux/ext4 לשם תיקייה: 255 בתים;
// תו עברי ב-UTF-8 = 2 בתים). קיצוץ על גבול תו, בלי לשבור תו רב-בייטי.
function capSlugBytes(str, maxBytes) {
  if (Buffer.byteLength(str, 'utf8') <= maxBytes) return str;
  let out = '', bytes = 0;
  for (const ch of str) {
    const b = Buffer.byteLength(ch, 'utf8');
    if (bytes + b > maxBytes) break;
    out += ch; bytes += b;
  }
  return out.replace(/-+$/, '');
}

// מקצה לכל מופע נתיב תיקייה (_dir) וכתובת URL (_url) ייחודיים
function assignShowUrls(shows) {
  const used = new Set();
  const SUFFIX = 'כרטיסים-ולוח-הופעות';
  for (const s of shows) {
    const cat = categorySlug(s.section);
    const nameSlug = capSlugBytes(slugify(s.name) || String(s.id), 150);
    let rel = `${cat}/${nameSlug}-${SUFFIX}`;
    if (used.has(rel)) rel = `${cat}/${nameSlug}-${s.id}-${SUFFIX}`;
    used.add(rel);
    s._dir = rel;
    s._url = `/${rel}/`;
  }
}

/* --------------------------- טעינת הנתונים ----------------------------- */
// תיקון תווים משובשים מהפיד (אותיות קיריליות שהוחלפו במקף/מרכאות) + ניקוי רווחים
function fixText(v) {
  return typeof v === 'string' ? v.replace(/[ОШ]/g, '-') : v;
}
function fixCity(v) {
  return typeof v === 'string' ? v.replace(/[ОШ]/g, '-').replace(/\s+/g, ' ').trim() : v;
}

function normalizeShows(shows) {
  shows.forEach(show => {
    show.name = fixText(show.name);
    show.description = fixText(show.description);
    show.announce = fixText(show.announce);
    (show.Seances || []).forEach(se => {
      se.hall = fixText(se.hall);
      se.address = fixText(se.address);
      se.city = fixCity(se.city);
    });
  });
  return shows;
}

function loadShows() {
  const raw = JSON.parse(fs.readFileSync(BRAND.dataFile, 'utf8'));
  const all = Array.isArray(raw) ? raw : (raw.Shows || raw.shows || raw.data || []);
  const selected = BRAND.limit > 0 ? all.slice(0, BRAND.limit) : all;
  return normalizeShows(selected);
}

/* ------------------------------ תבנית עמוד ------------------------------ */
function page({ title, description, canonical, head = '', body }) {
  return `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=${BRAND.ga4}"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', '${BRAND.ga4}');
</script>
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(canonical)}">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:site_name" content="${esc(BRAND.nameHe)}">
<meta name="theme-color" content="#6d1f4b">
<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${BRAND.adsenseClient}" crossorigin="anonymous"></script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Heebo:wght@300;400;500;600;700;800&family=Assistant:wght@400;600;700&display=swap">
<link rel="stylesheet" href="/assets/styles.css">
<script>try{var _s=JSON.parse(localStorage.getItem('idir-a11y')||'{}'),_r=document.documentElement;if(_s.font)_r.style.zoom=(1+Math.max(-2,Math.min(6,_s.font))*0.1).toFixed(2);if(_s.contrast==='high')_r.classList.add('a11y-contrast-high');if(_s.contrast==='inverted')_r.classList.add('a11y-invert');if(_s.underline)_r.classList.add('a11y-underline');if(_s.readable)_r.classList.add('a11y-readable');}catch(e){}</script>
${head}
</head>
<body>
${siteHeader()}
${body}
${siteFooter()}
${a11yWidget()}
<script src="/assets/accessibility.js" defer></script>
</body>
</html>`;
}

function siteHeader() {
  return `<header class="site-header">
  <div class="wrap header-inner">
    <a class="brand" href="/" aria-label="${esc(BRAND.nameHe)}">
      <img src="/assets/logo.svg" alt="${esc(BRAND.nameHe)}" class="site-logo" width="188" height="40">
    </a>
    <nav class="top-nav">
      <a href="/">כל המופעים</a>
      <a href="/רשימת-אמנים/">רשימת אמנים</a>
      <a href="/magazine/">מגזין</a>
    </nav>
  </div>
</header>`;
}

function siteFooter() {
  const year = new Date().getFullYear();
  return `<footer class="site-footer">
  <div class="wrap footer-grid">

    <div class="footer-col footer-about">
      <div class="foot-brand">${escText(BRAND.nameHe)} · ${escText(BRAND.nameEn)}</div>
      <p class="foot-desc">
        פורטל התרבות והאירועים של ישראל. אצלנו תמצאו כרטיסים לכל מופעי המוזיקה, הצגות תיאטרון, מופעי סטנדאפ, פסטיבלים והצגות ילדים בכל רחבי הארץ עם לוח מועדים מעודכן בזמן אמת ורכישה מאובטחת.
      </p>
    </div>

    <div class="footer-col">
      <h3 class="footer-title">אירועים ותרבות</h3>
      <ul class="footer-links">
        <li><a href="/רשימת-אמנים/">רשימת אמנים ומופעים</a></li>
        <li><a href="/#section=הופעות">הופעות מוזיקה חיות</a></li>
        <li><a href="/#section=תיאטרון">הצגות תיאטרון</a></li>
        <li><a href="/#section=סטנדאפ">מופעי סטנדאפ ובידור</a></li>
        <li><a href="/#section=ילדים">הצגות ילדים ומשפחה</a></li>
        <li><a href="/#section=קלאסי">מוזיקה קלאסית וקונצרטים</a></li>
      </ul>
    </div>

    <div class="footer-col">
      <h3 class="footer-title">כרטיסים לפי אזור</h3>
      <ul class="footer-links">
        <li><a href="/הופעות-בתל-אביב/">מופעים בתל אביב והמרכז</a></li>
        <li><a href="/הופעות-בירושלים/">הופעות והצגות בירושלים</a></li>
        <li><a href="/הופעות-בחיפה/">אירועי תרבות בחיפה והצפון</a></li>
        <li><a href="/הופעות-בבאר-שבע/">מופעים בבאר שבע והדרום</a></li>
        <li><a href="/#city=לטרון">קונצרטים בלטרון ובית ג'מל</a></li>
      </ul>
    </div>

    <div class="footer-col">
      <h3 class="footer-title">אולמות מובילים</h3>
      <ul class="footer-links">
        <li><span>היכל התרבות תל אביב</span></li>
        <li><span>תיאטרון הבימה והקאמרי</span></li>
        <li><span>זאפה ומנורה מבטחים</span></li>
        <li><span>המשכן לאמנויות הבמה</span></li>
        <li><span>אמפי קיסריה</span></li>
      </ul>
    </div>

  </div>

  <div class="wrap footer-timing">
    <span class="footer-timing-label">לפי מועד:</span>
    <a href="/הופעות-היום.html">הופעות היום</a>
    <a href="/הופעות-בסוף-השבוע.html">הופעות בסוף השבוע</a>
    <a href="/הופעות-השבוע.html">הופעות השבוע</a>
    <a href="/הופעות-החודש.html">הופעות החודש</a>
    <a href="/הופעות-2026.html">הופעות 2026</a>
    <a href="/הופעות-2027.html">הופעות 2027</a>
  </div>

  <div class="footer-bottom wrap">
    <div class="foot-copy">© ${year} ${escText(BRAND.nameHe)} (idir.co.il). כל הזכויות שמורות.</div>
    <div class="footer-legal-links">
      <a href="/privacy.html">מדיניות פרטיות</a> ·
      <a href="/terms.html">תנאי שימוש</a> ·
      <a href="/magazine/${encodeURI('שאלות-נפוצות-רכישת-כרטיסים')}/">שאלות נפוצות ועזרה</a> ·
      <a href="/contact.html">יצירת קשר</a>
    </div>
    <div class="foot-disclaimer">רכישת כרטיסים | המידע, לוחות המועדים והכרטיסים מתעדכנים באופן שוטף.</div>
  </div>
</footer>`;
}

/* --------------------------- תוסף נגישות ------------------------------- */
function a11yWidget() {
  return `<!-- תוסף נגישות -->
<div id="a11y-widget" class="a11y-widget">
  <button id="a11y-trigger" class="a11y-btn" aria-label="פתח תפריט נגישות" aria-expanded="false">
    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2c1.1 0 2 .9 2 2s-.9 2-2 2-2-.9-2-2 .9-2 2-2zm9 7h-6v13h-2v-6h-2v6H9V9H3V7h18v2z"/>
    </svg>
  </button>

  <div id="a11y-modal" class="a11y-menu" role="dialog" aria-modal="false" aria-label="תפריט נגישות" hidden>
    <div class="a11y-header">
      <h3>הצהרת וכלי נגישות</h3>
      <button id="a11y-close" class="a11y-close-btn" aria-label="סגור תפריט נגישות">&times;</button>
    </div>
    <div class="a11y-tools">
      <button class="a11y-tool" data-action="font-plus">הגדלת טקסט (+)</button>
      <button class="a11y-tool" data-action="font-minus">הקטנת טקסט (-)</button>
      <button class="a11y-tool" data-action="contrast-high" aria-pressed="false">ניגודיות גבוהה</button>
      <button class="a11y-tool" data-action="contrast-inverted" aria-pressed="false">גווני אפור / הפוך</button>
      <button class="a11y-tool" data-action="underline-links" aria-pressed="false">הדגשת קישורים</button>
      <button class="a11y-tool" data-action="readable-font" aria-pressed="false">פונט קריא</button>
      <button class="a11y-tool a11y-reset" data-action="reset">איפוס הגדרות</button>
    </div>
    <div class="a11y-footer">
      <small>אתר זה מותאם לתקן ת"י 5568 ברמת AA</small>
    </div>
  </div>
</div>`;
}

/* --------------------------- כרטיס מופע (גריד) -------------------------- */
function showCard(show) {
  const cities = [...new Set((show.Seances || []).map(s => s.city).filter(Boolean))];
  const cityText = cities.slice(0, 2).join(' · ') + (cities.length > 2 ? ' ועוד' : '');
  const dates = [...new Set((show.Seances || []).map(s => s.date).filter(Boolean))];
  const halls = [...new Set((show.Seances || []).map(s => s.hall).filter(Boolean))];
  const nextDate = dates[0] || show.dateFrom;
  const sold = showSoldOut(show);
  return `<article class="card${sold ? ' is-soldout' : ''}"
    data-name="${esc(show.name)}"
    data-section="${esc(show.section)}"
    data-city="${esc(cities.join('|'))}"
    data-venue="${esc(halls.join('|'))}"
    data-date-from="${esc(show.dateFrom || dates[0] || '')}"
    data-dates="${esc(dates.join(','))}">
    <a class="card-media" href="${esc(show._url)}" aria-label="${esc(show.name)}">
      <img loading="lazy" src="${esc(show.image)}" alt="${esc(show.name)}">
      <span class="card-badge">${escText(show.section)}</span>
    </a>
    <div class="card-body">
      <h3 class="card-title"><a href="${esc(show._url)}">${escText(show.name)}</a></h3>
      <p class="card-meta">
        <span class="ico-cal">${formatDate(nextDate)}</span>
        ${cityText ? `<span class="ico-pin">${escText(cityText)}</span>` : ''}
      </p>
      <p class="card-announce">${escText(stripTags(show.announce || show.description))}</p>
      <div class="card-foot">
        <span class="card-price">${sold ? '<span class="soldout">אזלו הכרטיסים</span>' : priceLabel(show.priceMin, show.priceMax)}</span>
        ${sold ? `<a class="btn btn-soldout" href="${esc(show._url)}">אזלו הכרטיסים</a>` : `<a class="btn btn-primary" href="${esc(show._url)}">לפרטים וכרטיסים</a>`}
      </div>
    </div>
  </article>`;
}

/* --------------------- עמודי תשתית (משפטי / אודות) --------------------- */
const STATIC_SLUGS = ['privacy', 'terms', 'contact'];

function staticPage(slug, title, metaDesc, h1, contentHtml) {
  const canonical = `${BRAND.domain}/${slug}.html`;
  const body = `
<article class="static">
  <div class="wrap static-inner">
    <nav class="breadcrumb"><a href="/">בית</a> <span>›</span> <span class="current">${escText(h1)}</span></nav>
    <h1 class="static-title">${escText(h1)}</h1>
    <div class="rte static-body">${contentHtml}</div>
  </div>
</article>`;
  const html = page({ title, description: metaDesc, canonical, body });
  fs.writeFileSync(path.join(BRAND.outDir, `${slug}.html`), html, 'utf8');
}

function buildStaticPages() {
  // ----- מדיניות פרטיות -----
  staticPage('privacy',
    'מדיניות פרטיות | איידיר כרטיסים',
    'מדיניות הפרטיות של איידיר כרטיסים: איסוף מידע, שימוש בקובצי עוגיות, ומודעות Google AdSense.',
    'מדיניות פרטיות',
    `<p class="static-updated">עודכן לאחרונה: אוגוסט 2026</p>

<h2>כללי</h2>
<p>אנו באיידיר כרטיסים מכבדים את פרטיותכם. מדיניות זו מסבירה איזה מידע נאסף בעת השימוש באתר idir.co.il, כיצד נעשה בו שימוש, וכיצד מוצגות מודעות באתר.</p>

<h2>איזה מידע נאסף</h2>
<p>האתר הוא פורטל מידע ואינו דורש הרשמה. איננו אוספים פרטים אישיים מזהים ביוזמתנו. במהלך הגלישה נאסף מידע טכני אנונימי כגון סוג הדפדפן, המכשיר, כתובת IP וכתובות הדפים שנצפו, לצורכי תפעול, אבטחה ושיפור חוויית המשתמש.</p>

<h2>קובצי עוגיות (Cookies)</h2>
<p>האתר ושירותי צד שלישי הפועלים בו עושים שימוש בקובצי עוגיות. עוגיות הן קבצי טקסט קטנים הנשמרים בדפדפן ומסייעים בתפעול האתר, בשמירת העדפות (למשל הגדרות הנגישות) ובהצגת מודעות רלוונטיות. ניתן לחסום או למחוק עוגיות דרך הגדרות הדפדפן, אך הדבר עלול לפגוע בחלק מהתכונות.</p>

<h2>מודעות Google AdSense וספקי צד שלישי</h2>
<p>באתר מוצגות מודעות באמצעות שירות Google AdSense. גוגל וספקים חיצוניים משתמשים בקובצי עוגיות כדי להציג מודעות בהתאם לביקורים קודמים של המשתמש באתר זה ובאתרים אחרים. השימוש של גוגל בעוגיית הפרסום מאפשר לה ולשותפיה להציג מודעות מותאמות אישית.</p>
<p>ניתן לבטל את השימוש בעוגיות למודעות מותאמות אישית דרך <a href="https://www.google.com/settings/ads" target="_blank" rel="noopener">הגדרות המודעות של גוגל</a>. מידע נוסף על האופן שבו גוגל עושה שימוש בנתונים זמין ב<a href="https://policies.google.com/technologies/ads" target="_blank" rel="noopener">מדיניות הפרסום של גוגל</a>.</p>

<h2>קישורים לאתרים חיצוניים</h2>
<p>רכישת הכרטיסים מתבצעת באתר סליקה חיצוני ומאובטח. איננו אחראים למדיניות הפרטיות של אתרים חיצוניים, ומומלץ לעיין במדיניות הפרטיות שלהם בעת הרכישה.</p>

<h2>זכויות המשתמש</h2>
<p>באפשרותכם לנהל את העדפות העוגיות דרך הדפדפן, ולפנות אלינו בכל שאלה בנוגע לפרטיות בכתובת contact@idir.co.il.</p>

<h2>עדכונים למדיניות</h2>
<p>אנו רשאים לעדכן מדיניות זו מעת לעת. מומלץ לחזור ולעיין בעמוד זה. המשך השימוש באתר מהווה הסכמה למדיניות המעודכנת.</p>`);

  // ----- תנאי שימוש -----
  staticPage('terms',
    'תנאי שימוש | איידיר כרטיסים',
    'תנאי השימוש בפורטל איידיר כרטיסים, אחריות על מועדים ומחירים, וגילוי נאות לגבי קישורי רכישה.',
    'תנאי שימוש',
    `<p class="static-updated">עודכן לאחרונה: אוגוסט 2026</p>

<h2>כללי</h2>
<p>ברוכים הבאים לאיידיר כרטיסים. השימוש באתר idir.co.il כפוף לתנאים המפורטים להלן. עצם הגלישה והשימוש מהווים הסכמה לתנאים אלה.</p>

<h2>מהות השירות</h2>
<p>איידיר כרטיסים הוא פורטל מידע ולוח אירועים המרכז מופעים, הצגות וקונצרטים המתקיימים בישראל. האתר מציג מידע על אירועים, מועדים ומחירים, ומפנה את הגולש לרכישת כרטיסים באתר מכירות חיצוני ומאובטח.</p>

<h2>אחריות על מידע ומועדים</h2>
<p>נתוני המופעים, המועדים והמחירים מתקבלים מספק חיצוני ומתעדכנים באופן שוטף. ייתכנו שינויים, ביטולים או אי דיוקים במידע. איננו אחראים לשינויים במועדים, בהרכב האמנים או במחירים. באחריות המשתמש לוודא את הפרטים המלאים באתר המכירה בעת הרכישה.</p>

<h2>גילוי נאות וקישורי רכישה</h2>
<p>האתר כולל קישורים לרכישת כרטיסים אצל ספק חיצוני. הרכישה, התשלום, אספקת הכרטיסים והשירות ניתנים על ידי אתר המכירה, ותנאיו ומדיניותו הם החלים על העסקה. ייתכן שאיידיר כרטיסים מקבל תמורה בגין הפניות רכישה.</p>

<h2>קניין רוחני</h2>
<p>התכנים, העיצוב והמותג של האתר מוגנים בזכויות יוצרים. אין להעתיק, לשכפל או לעשות שימוש מסחרי בתכני האתר ללא אישור מראש ובכתב.</p>

<h2>שינויים בתנאים</h2>
<p>אנו רשאים לעדכן תנאים אלה מעת לעת. הנוסח המעודכן יפורסם בעמוד זה, והמשך השימוש מהווה הסכמה.</p>

<h2>יצירת קשר</h2>
<p>לשאלות בנוגע לתנאי השימוש ניתן לפנות אלינו בכתובת contact@idir.co.il.</p>`);

  // ----- אודות ויצירת קשר -----
  staticPage('contact',
    'יצירת קשר ואודות | איידיר כרטיסים',
    'אודות פורטל איידיר כרטיסים ודרכי יצירת קשר לפניות, הצעות ובירורים.',
    'יצירת קשר ואודות',
    `<h2>אודות איידיר כרטיסים</h2>
<p>איידיר כרטיסים הוא פורטל תרבות ואירועים המרכז במקום אחד את המופעים, ההצגות והקונצרטים המובילים בישראל. מטרתנו להקל על הגולשים למצוא את האירוע המתאים, לצפות במועדים ובמחירים מעודכנים, ולעבור בקלות לרכישת כרטיסים באתר מכירות מאובטח.</p>
<p>הפורטל מתעדכן באופן שוטף עם מופעים חדשים ומועדים נוספים, כדי שתמצאו תמיד מידע רלוונטי ועדכני.</p>

<h2>יצירת קשר</h2>
<p>נשמח לקבל פניות, הצעות ובירורים. ניתן ליצור עמנו קשר בדואר אלקטרוני:</p>
<p><a href="mailto:contact@idir.co.il">contact@idir.co.il</a></p>
<p>נעשה מאמץ לחזור לכל פנייה בהקדם.</p>`);
}

/* ------------------- עמודי נחיתה מבוססי עיתוי (Hub SEO) ---------------- */
const TLV = 'תל אביב-יפו';
const HUB_PAGES = [
  {
    slug: 'הופעות-היום', when: 'today',
    title: 'הופעות היום בישראל | כרטיסים להופעות והצגות היום - איידיר כרטיסים',
    desc: 'כל ההופעות, ההצגות והמופעים שמתקיימים היום בישראל במקום אחד. מועדים מעודכנים וכרטיסים לרכישה מאובטחת.',
    h1: 'כרטיסים להופעות והצגות היום 2026',
    intro: 'ריכזנו עבורכם את כל המופעים, ההצגות והקונצרטים שמתקיימים היום ברחבי הארץ. בחרו אירוע ורכשו כרטיסים בקלות.',
  },
  {
    slug: 'הופעות-בסוף-השבוע', when: 'weekend',
    title: 'הופעות בסוף השבוע הקרוב | כרטיסים לסופ"ש - איידיר כרטיסים',
    desc: 'מה עושים בסוף השבוע? כל ההופעות וההצגות לימי חמישי, שישי ושבת הקרובים, עם מועדים ומחירים מעודכנים.',
    h1: 'כרטיסים להופעות והצגות בסוף השבוע 2026',
    intro: 'כל המופעים והאירועים המתקיימים בסוף השבוע הקרוב, בימים חמישי, שישי ושבת. מצאו את הבילוי המושלם לסופ"ש.',
  },
  {
    slug: 'הופעות-השבוע', when: 'next-7',
    title: 'הופעות השבוע בישראל | לוח אירועים לשבוע הקרוב - איידיר כרטיסים',
    desc: 'לוח האירועים המלא לשבוע הקרוב: הופעות, הצגות וקונצרטים בשבעת הימים הבאים ברחבי ישראל.',
    h1: 'כרטיסים להופעות והצגות השבוע 2026',
    intro: 'כל המופעים המתקיימים בשבעת הימים הקרובים. תכננו מראש ורכשו כרטיסים לאירועים הקרובים ביותר.',
  },
  {
    slug: 'הופעות-החודש', when: 'this-month',
    title: 'הופעות החודש | כרטיסים למופעים בחודש הקרוב - איידיר כרטיסים',
    desc: 'כל ההופעות וההצגות המתקיימות בחודש הקרוב בישראל, עם מועדים מעודכנים וכרטיסים לרכישה מאובטחת.',
    h1: 'כרטיסים להופעות והצגות החודש 2026',
    intro: 'לוח המופעים המלא לשלושים הימים הקרובים. מגוון רחב של הופעות, הצגות וקונצרטים ברחבי הארץ.',
  },
  {
    slug: 'הופעות-2026', when: 'year-2026',
    title: 'הופעות 2026 בישראל | לוח מופעים, הצגות וקונצרטים 2026 - איידיר כרטיסים',
    desc: 'לוח המופעים המלא לשנת 2026: הופעות, הצגות, קונצרטים ואירועי תרבות ברחבי ישראל, מעודכן בזמן אמת.',
    h1: 'כרטיסים להופעות, הצגות וקונצרטים 2026',
    intro: 'כל המופעים, ההצגות והקונצרטים המתקיימים בשנת 2026 ברחבי ישראל. לוח אירועים מקיף שמתעדכן באופן שוטף.',
  },
  {
    slug: 'הופעות-2027', when: 'year-2027',
    title: 'הופעות 2027 בישראל | לוח מופעים, הצגות וקונצרטים 2027 - איידיר כרטיסים',
    desc: 'לוח המופעים המלא לשנת 2027: הופעות, הצגות, קונצרטים ואירועי תרבות ברחבי ישראל. הזמינו כרטיסים מראש.',
    h1: 'כרטיסים להופעות, הצגות וקונצרטים 2027',
    intro: 'כל המופעים, ההצגות והקונצרטים המתוכננים לשנת 2027 ברחבי ישראל. הקדימו והזמינו כרטיסים לאירועים הבולטים של השנה הבאה.',
  },
  {
    slug: 'הופעות-בתל-אביב-היום', when: 'today', city: TLV,
    title: 'הופעות בתל אביב היום | כרטיסים למופעים היום בתל אביב - איידיר כרטיסים',
    desc: 'כל ההופעות וההצגות שמתקיימות היום בתל אביב יפו. מועדים מעודכנים וכרטיסים לרכישה מאובטחת.',
    h1: 'הופעות ואירועים היום בתל אביב',
    intro: 'המופעים והאירועים שמתקיימים היום בתל אביב יפו. מצאו את הבילוי המושלם בעיר שלא נחה לרגע.',
  },
  {
    slug: 'הופעות-בתל-אביב-בסוף-השבוע', when: 'weekend', city: TLV,
    title: 'הופעות בתל אביב בסוף השבוע | כרטיסים לסופ"ש בתל אביב - איידיר כרטיסים',
    desc: 'כל ההופעות וההצגות בתל אביב לסוף השבוע הקרוב, לימי חמישי, שישי ושבת. מועדים וכרטיסים מעודכנים.',
    h1: 'הופעות והצגות בתל אביב בסוף השבוע',
    intro: 'כל המופעים המתקיימים בתל אביב יפו בסוף השבוע הקרוב. הבילוי המושלם לסופ"ש בעיר.',
  },
];

function breadcrumbSchema(items) {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem', position: i + 1, name: it.name, item: it.url,
    })),
  };
  return `<script type="application/ld+json">${JSON.stringify(data)}</script>`;
}

function hubEmpty() {
  return `<div class="hub-empty">
    <p>אין כרגע מופעים זמינים בקטגוריה זו. מומלץ לבדוק שוב בקרוב, או לעיין באפשרויות הבאות:</p>
    <ul class="hub-empty-links">
      <li><a href="/">כל המופעים</a></li>
      <li><a href="/הופעות-השבוע.html">הופעות השבוע</a></li>
      <li><a href="/הופעות-החודש.html">הופעות החודש</a></li>
      <li><a href="/הופעות-2026.html">כל מופעי 2026</a></li>
    </ul>
  </div>`;
}

function buildHubPages(shows) {
  const now = israelToday();
  const todayStr = ymdStr(now);
  const plus6 = ymdStr(addDays(now, 6));
  const plus29 = ymdStr(addDays(now, 29));
  const day = now.getDay(); // 0=ראשון .. 6=שבת
  const toThu = (day >= 4) ? -(day - 4) : (4 - day);
  const thu = addDays(now, toThu);
  const weekend = new Set([ymdStr(thu), ymdStr(addDays(thu, 1)), ymdStr(addDays(thu, 2))]);

  function matchWhen(dateStr, when) {
    switch (when) {
      case 'today': return dateStr === todayStr;
      case 'weekend': return weekend.has(dateStr);
      case 'next-7': return dateStr >= todayStr && dateStr <= plus6;
      case 'this-month': return dateStr >= todayStr && dateStr <= plus29;
      case 'year-2026': return dateStr.slice(0, 4) === '2026';
      case 'year-2027': return dateStr.slice(0, 4) === '2027';
      default: return false;
    }
  }

  const results = {};
  HUB_PAGES.forEach(cfg => {
    const matched = shows.filter(show =>
      (show.Seances || []).some(s =>
        (!cfg.city || s.city === cfg.city) && matchWhen(s.date, cfg.when)));

    const canonical = `${BRAND.domain}/${cfg.slug}.html`;
    const crumb = breadcrumbSchema([
      { name: 'בית', url: BRAND.domain + '/' },
      { name: cfg.h1, url: canonical },
    ]);
    const cards = matched.map(showCard).join('\n');

    const body = `
<article class="hub">
  <div class="wrap">
    <nav class="breadcrumb"><a href="/">בית</a> <span>›</span> <span class="current">${escText(cfg.h1)}</span></nav>
    <h1 class="hub-title">${escText(cfg.h1)}</h1>
    <p class="hub-intro">${escText(cfg.intro)}</p>
    <div class="results-head">
      <span class="results-count">${matched.length} מופעים</span>
    </div>
    ${matched.length ? `<div class="grid">\n${cards}\n</div>` : hubEmpty()}
  </div>
</article>`;

    const html = page({ title: cfg.title, description: cfg.desc, canonical, head: crumb, body });
    fs.writeFileSync(path.join(BRAND.outDir, `${cfg.slug}.html`), html, 'utf8');
    results[cfg.slug] = matched.length;
  });
  return results;
}

/* ------------------- עמודי נחיתה סטטיים לפי עיר (City SEO) ------------- */
const CITY_PAGES = [
  {
    slug: 'הופעות-בתל-אביב', city: 'תל אביב-יפו',
    title: 'הופעות והצגות בתל אביב | כרטיסים למופעים - איידיר כרטיסים',
    desc: 'כל ההופעות, ההצגות והקונצרטים בתל אביב יפו במקום אחד. מועדים מעודכנים וכרטיסים לרכישה מאובטחת.',
    h1: 'כרטיסים להופעות, הצגות ואירועים בתל אביב-יפו',
    intro: 'כל המופעים, ההצגות והקונצרטים המתקיימים בתל אביב יפו. עיר התרבות הגדולה בישראל, עם מגוון אירועים לכל טעם לאורך כל השנה.',
  },
  {
    slug: 'הופעות-בירושלים', city: 'ירושלים',
    title: 'הופעות והצגות בירושלים | כרטיסים למופעים - איידיר כרטיסים',
    desc: 'כל ההופעות, ההצגות והקונצרטים בירושלים במקום אחד. מועדים מעודכנים וכרטיסים לרכישה מאובטחת.',
    h1: 'כרטיסים להופעות, הצגות ואירועים בירושלים',
    intro: 'כל המופעים, ההצגות והקונצרטים המתקיימים בירושלים. עיר הבירה מציעה מגוון עשיר של אירועי תרבות, מוזיקה ובידור.',
  },
  {
    slug: 'הופעות-בחיפה', city: 'חיפה',
    title: 'הופעות והצגות בחיפה | כרטיסים למופעים - איידיר כרטיסים',
    desc: 'כל ההופעות, ההצגות והקונצרטים בחיפה ובצפון במקום אחד. מועדים מעודכנים וכרטיסים לרכישה מאובטחת.',
    h1: 'כרטיסים להופעות, הצגות ואירועים בחיפה',
    intro: 'כל המופעים, ההצגות והקונצרטים המתקיימים בחיפה ובצפון הארץ. מצאו את הבילוי המושלם בבירת הצפון.',
  },
  {
    slug: 'הופעות-בבאר-שבע', city: 'באר שבע',
    title: 'הופעות והצגות בבאר שבע | כרטיסים למופעים - איידיר כרטיסים',
    desc: 'כל ההופעות, ההצגות והקונצרטים בבאר שבע ובדרום במקום אחד. מועדים מעודכנים וכרטיסים לרכישה מאובטחת.',
    h1: 'כרטיסים להופעות, הצגות ואירועים בבאר שבע',
    intro: 'כל המופעים, ההצגות והקונצרטים המתקיימים בבאר שבע ובדרום הארץ. בילוי תרבותי מגוון בבירת הנגב.',
  },
];

// מפת עיר -> עמוד עיר (לקישוריות פנימית מעמודי מופע)
const cityUrlByCity = {};
CITY_PAGES.forEach(c => { cityUrlByCity[c.city] = `/${c.slug}/`; });

// כפתור רכישה צף אחיד לעמודי ריכוז (מובייל בלבד) — גולל לרשת התוצאות
const HUB_STICKY = `<div class="mobile-cta"><a class="mobile-cta-btn" href="#results">לכל המופעים והכרטיסים ›</a></div>`;

function buildCityPages(shows) {
  const results = {};
  CITY_PAGES.forEach(cfg => {
    const matched = shows.filter(show =>
      (show.Seances || []).some(s => s.city === cfg.city));

    // Cloudflare מגיש עמוד תיקייה עם סלאש בסוף (slug/ = 200), לכן ה-canonical עם סלאש
    const canonical = `${BRAND.domain}/${cfg.slug}/`;
    const crumb = breadcrumbSchema([
      { name: 'בית', url: BRAND.domain + '/' },
      { name: cfg.h1, url: canonical },
    ]);
    const cards = matched.map(showCard).join('\n');
    // פסקה פותחת עובדתית מותאמת AI Overviews
    const aiLede = `בעמוד זה מרוכזים ${matched.length} מופעים, הצגות וקונצרטים המתקיימים ב${cfg.city}, כולל מועדים, אולמות ומחירים. ניתן להזמין כרטיסים לכל האירועים ישירות מהעמוד.`;

    const body = `
<article class="hub">
  <div class="wrap">
    <nav class="breadcrumb"><a href="/">בית</a> <span>›</span> <span class="current">${escText(cfg.h1)}</span></nav>
    <h1 class="hub-title">${escText(cfg.h1)}</h1>
    <p class="show-lead">${escText(aiLede)}</p>
    <p class="hub-intro">${escText(cfg.intro)}</p>
    <div class="results-head">
      <span class="results-count">${matched.length} מופעים</span>
    </div>
    ${matched.length ? `<div class="grid" id="results">\n${cards}\n</div>` : hubEmpty()}
  </div>
</article>
${matched.length ? HUB_STICKY : ''}`;

    const html = page({ title: cfg.title, description: cfg.desc, canonical, head: crumb, body });
    const dir = path.join(BRAND.outDir, cfg.slug);
    ensureDir(dir);
    fs.writeFileSync(path.join(dir, 'index.html'), html, 'utf8');
    results[cfg.slug] = matched.length;
  });
  return results;
}

// ===================== עמודי ז'אנר (Genre Hubs) =====================
// עמוד ריכוז לכל סוגה תחת /[category]/index.html — קיבוץ דינמי מהפיד
let GENRE_PAGES = []; // { slug, url, section, count }
function buildGenrePages(shows) {
  const bySlug = {};
  shows.forEach(s => {
    if (!s.section) return;
    const slug = categorySlug(s.section);
    (bySlug[slug] = bySlug[slug] || { list: [], sections: {} });
    bySlug[slug].list.push(s);
    bySlug[slug].sections[s.section] = (bySlug[slug].sections[s.section] || 0) + 1;
  });
  GENRE_PAGES = [];
  const results = {};
  Object.keys(bySlug).forEach(slug => {
    const { list, sections } = bySlug[slug];
    if (!list.length) return;
    const section = Object.keys(sections).sort((a, b) => sections[b] - sections[a])[0];
    const url = `/${slug}/`;
    const canonical = BRAND.domain + url;
    const h1 = `${section}: כרטיסים ומופעים בישראל`;
    const title = `${section} - כרטיסים ומופעים 2026 | איידיר כרטיסים`;
    const desc = `כל המופעים מסוג ${section} המתקיימים בישראל במקום אחד. מועדים, אולמות, מחירים וכרטיסים לרכישה מאובטחת.`;
    const aiLede = `בעמוד זה מרוכזים ${list.length} מופעים מסוג ${section} המתקיימים בישראל, כולל מועדים, אולמות ומחירים. ניתן להזמין כרטיסים לכל המופעים ישירות מהעמוד.`;
    const cards = list.map(showCard).join('\n');
    const crumb = breadcrumbSchema([
      { name: 'בית', url: BRAND.domain + '/' },
      { name: section, url: canonical },
    ]);
    const collection = { '@context': 'https://schema.org', '@type': 'CollectionPage', name: h1, url: canonical, description: desc };
    const body = `
<article class="hub">
  <div class="wrap">
    <nav class="breadcrumb"><a href="/">בית</a> <span>›</span> <span class="current">${escText(section)}</span></nav>
    <h1 class="hub-title">${escText(h1)}</h1>
    <p class="show-lead">${escText(aiLede)}</p>
    <div class="results-head"><span class="results-count">${list.length} מופעים</span></div>
    <div class="grid" id="results">\n${cards}\n</div>
  </div>
</article>
${HUB_STICKY}`;
    const html = page({
      title, description: desc, canonical,
      head: crumb + `\n<script type="application/ld+json">${JSON.stringify(collection)}</script>`,
      body,
    });
    const dir = path.join(BRAND.outDir, slug);
    ensureDir(dir);
    fs.writeFileSync(path.join(dir, 'index.html'), html, 'utf8');
    results[slug] = list.length;
    GENRE_PAGES.push({ slug, url, section, count: list.length });
  });
  return GENRE_PAGES.length;
}

/* ---------------------- אינדקס אמנים (Artists Hub) -------------------- */
// מסננים רק שמות "נקיים" שנראים כמו אמן/הרכב, כדי למנוע עמודים דלים/רעש
const ARTIST_DESC_MARKERS = ['מארח', 'מארחת', 'עם ', 'רקוויאם', 'לאור הנרות', 'מציג',
  'מציגה', 'לכבוד', 'טריביוט', 'מחווה', 'הרצאה', 'סדנה', 'סדנת', 'פסטיבל', 'הצגת',
  'המופע', 'קונצרט', 'בישראל', 'תוכנית', 'ערב', 'סיפור', 'סדרת'];

function isCleanArtist(name) {
  const n = (name || '').trim();
  if (!n) return false;
  if (/[|\-–—:,]/.test(n)) return false;   // מפרידים / פיסוק
  if (/[A-Za-z]/.test(n)) return false;    // לועזית
  if (/[0-9]/.test(n)) return false;       // מספרים
  if (n.split(/\s+/).length > 4) return false;
  return !ARTIST_DESC_MARKERS.some(d => n.includes(d));
}

function buildArtistsIndex(shows) {
  const artistShows = shows
    .filter(s => isCleanArtist(s.name))
    .sort((a, b) => a.name.localeCompare(b.name, 'he'));

  const slug = 'רשימת-אמנים';
  const canonical = `${BRAND.domain}/${slug}/`;
  const crumb = breadcrumbSchema([
    { name: 'בית', url: BRAND.domain + '/' },
    { name: 'אינדקס אמנים ומופעים', url: canonical },
  ]);

  const cards = artistShows.map(showCard).join('\n');
  const quickList = artistShows.map(s =>
    `<li><a href="${esc(artistUrlByName[s.name] || s._url)}">${escText(s.name)} הופעות</a></li>`).join('');

  const body = `
<article class="hub">
  <div class="wrap">
    <nav class="breadcrumb"><a href="/">בית</a> <span>›</span> <span class="current">אינדקס אמנים ומופעים</span></nav>
    <h1 class="hub-title">אינדקס אמנים ומופעים לשנת 2026</h1>
    <p class="hub-intro">ריכזנו עבורכם את האמנים והמופעים המובילים המתקיימים בישראל. בחרו אמן, צפו במועדים, בערים ובמחירים, ורכשו כרטיסים בקלות במקום אחד.</p>
    <div class="results-head"><span class="results-count">${artistShows.length} אמנים ומופעים</span></div>
    <div class="grid">
${cards}
</div>
    <section class="artist-list-section">
      <h2>רשימת האמנים לפי סדר אלפביתי</h2>
      <ul class="artist-list">${quickList}</ul>
    </section>
  </div>
</article>`;

  const html = page({
    title: 'רשימת אמנים ומופעים מובילים בישראל | איידיר כרטיסים',
    description: 'רשימת האמנים והמופעים המובילים בישראל. מצאו את האמן האהוב עליכם, צפו במועדים ובמחירים ורכשו כרטיסים בקלות.',
    canonical,
    head: crumb,
    body,
  });

  const dir = path.join(BRAND.outDir, slug);
  ensureDir(dir);
  fs.writeFileSync(path.join(dir, 'index.html'), html, 'utf8');
  return artistShows.length;
}

/* ============ Evergreen: עמודי אמנים ואולמות קבועים + קישוריות ============ */
let ARTIST_REGISTRY = [];   // { name, slug, url, shows }
let VENUE_REGISTRY = [];    // { hall, slug, url, shows, city, address }
const artistUrlByName = {}; // name -> /artist/slug/
const venueUrlByHall = {};  // hall -> /venues/slug/

// מקצה מרשמי אמנים ואולמות (לפני buildShow, כדי לאפשר קישוריות פנימית)
function assignHubs(shows) {
  // אמנים: לפי שמות "נקיים"
  const byArtist = {};
  shows.forEach(s => { if (isCleanArtist(s.name)) (byArtist[s.name] = byArtist[s.name] || []).push(s); });
  const aUsed = new Set();
  ARTIST_REGISTRY = Object.keys(byArtist).sort((a, b) => a.localeCompare(b, 'he')).map(name => {
    let slug = capSlugBytes(slugify(name) || 'artist', 150);
    if (aUsed.has(slug)) slug += '-' + byArtist[name][0].id;
    aUsed.add(slug);
    const url = `/artist/${slug}/`;
    artistUrlByName[name] = url;
    return { name, slug, url, shows: byArtist[name] };
  });

  // אולמות: כל אולם עם 2+ מופעים (למניעת עמודים דלים)
  const byHall = {};
  shows.forEach(s => [...new Set((s.Seances || []).map(z => z.hall).filter(Boolean))]
    .forEach(h => (byHall[h] = byHall[h] || []).push(s)));
  const vUsed = new Set();
  VENUE_REGISTRY = Object.keys(byHall).filter(h => byHall[h].length >= 2)
    .sort((a, b) => a.localeCompare(b, 'he')).map(hall => {
      let slug = capSlugBytes(slugify(hall) || 'venue', 150);
      if (vUsed.has(slug)) slug += '-' + byHall[hall][0].id;
      vUsed.add(slug);
      const url = `/venues/${slug}/`;
      venueUrlByHall[hall] = url;
      // כתובת/עיר מייצגת מתוך מועד באולם זה
      let city = '', address = '';
      for (const s of byHall[hall]) {
        const se = (s.Seances || []).find(z => z.hall === hall);
        if (se) { city = se.city || city; address = se.address || address; if (city) break; }
      }
      return { hall, slug, url, shows: byHall[hall], city, address };
    });
}

function buildArtistPages() {
  ARTIST_REGISTRY.forEach(a => {
    const canonical = `${BRAND.domain}${a.url}`;
    const image = (a.shows.find(s => s.image) || {}).image || '';
    const cards = a.shows.map(showCard).join('\n');
    const crumb = breadcrumbSchema([
      { name: 'בית', url: BRAND.domain + '/' },
      { name: 'אמנים', url: BRAND.domain + '/רשימת-אמנים/' },
      { name: a.name, url: canonical },
    ]);
    const profile = {
      '@context': 'https://schema.org',
      '@type': 'ProfilePage',
      mainEntity: {
        '@type': 'MusicGroup',
        name: a.name,
        url: canonical,
        image: image || undefined,
      },
    };
    const empty = `<div class="hub-empty">
      <p>אין כרגע מופעים קרובים של ${escText(a.name)}. האמן צפוי לחזור בקרוב, כדאי לשוב ולבדוק.</p>
      <ul class="hub-empty-links"><li><a href="/">כל המופעים</a></li><li><a href="/רשימת-אמנים/">כל האמנים</a></li></ul>
    </div>`;
    const body = `
<article class="hub">
  <div class="wrap">
    <nav class="breadcrumb"><a href="/">בית</a> <span>›</span> <a href="/רשימת-אמנים/">אמנים</a> <span>›</span> <span class="current">${escText(a.name)}</span></nav>
    <h1 class="hub-title">${escText(a.name)} כרטיסים והופעות</h1>
    <p class="hub-intro">כל ההופעות והמופעים הקרובים של ${escText(a.name)} בישראל. מועדים, ערים ומחירים מעודכנים, ורכישת כרטיסים מאובטחת במקום אחד.</p>
    <div class="results-head"><span class="results-count">${a.shows.length} מופעים</span></div>
    ${a.shows.length ? `<div class="grid">\n${cards}\n</div>` : empty}
  </div>
</article>`;
    const html = page({
      title: `${a.name} כרטיסים למופעים והופעות | איידיר כרטיסים`,
      description: `כל ההופעות והמופעים הקרובים של ${a.name} בישראל. מועדים, מחירים וכרטיסים לרכישה מאובטחת.`,
      canonical,
      head: crumb + `\n<script type="application/ld+json">${JSON.stringify(profile)}</script>` + (image ? `\n<meta property="og:image" content="${esc(image)}">` : ''),
      body,
    });
    const dir = path.join(BRAND.outDir, 'artist', a.slug);
    ensureDir(dir);
    fs.writeFileSync(path.join(dir, 'index.html'), html, 'utf8');
  });
  return ARTIST_REGISTRY.length;
}

function buildVenuePages() {
  VENUE_REGISTRY.forEach(v => {
    const canonical = `${BRAND.domain}${v.url}`;
    const cards = v.shows.map(showCard).join('\n');
    const crumb = breadcrumbSchema([
      { name: 'בית', url: BRAND.domain + '/' },
      { name: v.hall, url: canonical },
    ]);
    const placeSchema = {
      '@context': 'https://schema.org',
      '@type': 'Place',
      name: v.hall,
      url: canonical,
      address: {
        '@type': 'PostalAddress',
        streetAddress: v.address || v.hall,
        addressLocality: v.city || undefined,
        addressCountry: 'IL',
      },
    };
    const loc = [v.address, v.city].filter(Boolean).join(', ');
    const aiLede = `בעמוד זה מרוכזים ${v.shows.length} מופעים ואירועים הקרובים ב${v.hall}${v.city ? `, ${v.city}` : ''}, כולל מועדים, מחירים וכרטיסים. ניתן להזמין כרטיסים לכל האירועים ישירות מהעמוד.`;
    const body = `
<article class="hub">
  <div class="wrap">
    <nav class="breadcrumb"><a href="/">בית</a> <span>›</span> <span>אולמות</span> <span>›</span> <span class="current">${escText(v.hall)}</span></nav>
    <h1 class="hub-title">${escText(v.hall)}</h1>
    <p class="show-lead">${escText(aiLede)}</p>
    <p class="hub-intro">לוח המופעים והאירועים הקרובים ב${escText(v.hall)}${loc ? ' · ' + escText(loc) : ''}. מועדים, מחירים וכרטיסים מעודכנים בזמן אמת.</p>
    <div class="results-head"><span class="results-count">${v.shows.length} מופעים</span></div>
    ${v.shows.length ? `<div class="grid" id="results">\n${cards}\n</div>` : hubEmpty()}
  </div>
</article>
${v.shows.length ? HUB_STICKY : ''}`;
    const html = page({
      title: `${v.hall} לוח מופעים וכרטיסים | איידיר כרטיסים`,
      description: `כל האירועים והמופעים הקרובים ב${v.hall}${v.city ? ' ב' + v.city : ''}. מועדים, מחירים וכרטיסים לרכישה מאובטחת.`,
      canonical,
      head: crumb + `\n<script type="application/ld+json">${JSON.stringify(placeSchema)}</script>`,
      body,
    });
    const dir = path.join(BRAND.outDir, 'venues', v.slug);
    ensureDir(dir);
    fs.writeFileSync(path.join(dir, 'index.html'), html, 'utf8');
  });
  return VENUE_REGISTRY.length;
}

/* ==================================================================== */
/* ========= מגזין תרבות ובילויים — מערכת תוכן עצמאית ומבודדת ========= */
/* ==== שכבה חדשה לצד אתר הכרטיסים; אינה נוגעת בלוגיקה/עמודים קיימים ==== */
/* ==================================================================== */
let MAGAZINE_ARTICLES = [];
let NEWS_ARTICLES = [];
// העשרות תוכן מאושרות (content-agent) — שכבה אדיטיבית: id -> {paragraph, faq, sources}
let ENRICHMENTS = {};
function loadEnrichments() {
  try { ENRICHMENTS = JSON.parse(fs.readFileSync(path.join(__dirname, 'content', 'enrichments', 'idir.json'), 'utf8')); }
  catch (e) { ENRICHMENTS = {}; }
}
// מקטע ההרחבה בעמוד המופע — מוצג רק אם קיים אישור לאותו id (אחרת מחזיר ריק)
function enrichmentSection(show) {
  const e = ENRICHMENTS[String(show.id)];
  if (!e || !e.paragraph) return '';
  const faq = (e.faq || []).filter(f => f && f.q && f.a);
  const faqHtml = faq.length ? faq.map(f =>
    `<details class="faq-item"><summary>${escText(f.q)}</summary><div class="faq-answer">${escText(f.a)}</div></details>`).join('\n') : '';
  const faqSchema = faq.length ? {
    '@context': 'https://schema.org', '@type': 'FAQPage',
    mainEntity: faq.map(f => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
  } : null;
  return `
  <section class="wrap show-enrichment">
    <h2>עוד על ${escText(show.name)}</h2>
    <p class="show-enrichment-lead">${escText(e.paragraph)}</p>
    ${faqHtml}
    ${faqSchema ? `<script type="application/ld+json">${JSON.stringify(faqSchema)}</script>` : ''}
  </section>`;
}
let LANDING_PAGES = [];
let LANDING_REDIRECTS = [];
let MAGAZINE_REDIRECTS = []; // { from: oldSlug, to: newSlug } — להפניית 301 מכתבות שהשם שלהן שונה

// פענוח frontmatter (--- key: value ---) מקובץ Markdown
function parseFrontmatter(raw) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!m) return { meta: {}, body: raw };
  const meta = {};
  m[1].split(/\r?\n/).forEach(line => {
    const i = line.indexOf(':');
    if (i > -1) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  });
  return { meta, body: m[2] };
}

// ממיר תת־קבוצה של Markdown ל-HTML (כותרות, פסקאות, רשימות, קישורים, תמונות, הדגשה)
function mdToHtml(md) {
  const e = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inline = s => e(s)
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" loading="lazy">')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
  return md.trim().split(/\r?\n\r?\n+/).map(b => {
    b = b.trim();
    if (/^### /.test(b)) return `<h3>${inline(b.slice(4))}</h3>`;
    if (/^## /.test(b)) return `<h2>${inline(b.slice(3))}</h2>`;
    if (/^# /.test(b)) return `<h2>${inline(b.slice(2))}</h2>`;
    if (/^> /.test(b)) return `<blockquote>${inline(b.replace(/^> ?/gm, ''))}</blockquote>`;
    if (/^([-*]) /.test(b)) return `<ul>${b.split(/\r?\n/).map(li => `<li>${inline(li.replace(/^[-*] /, ''))}</li>`).join('')}</ul>`;
    if (/^!\[[^\]]*\]\([^)]+\)$/.test(b)) return `<figure>${inline(b)}</figure>`;
    return `<p>${inline(b)}</p>`;
  }).join('\n');
}

// טעינת כתבות ידניות מ-content/magazine/*.md
function loadMdArticles() {
  const dir = path.join(__dirname, 'content', 'magazine');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith('.md')).map(f => {
    const { meta, body } = parseFrontmatter(fs.readFileSync(path.join(dir, f), 'utf8'));
    const bodyHtml = mdToHtml(body);
    return {
      slug: meta.slug || slugify(meta.title || f.replace(/\.md$/, '')),
      title: meta.title || 'ללא כותרת',
      description: meta.description || stripTags(bodyHtml).slice(0, 155),
      date: meta.date || new Date().toISOString().slice(0, 10),
      author: meta.author || BRAND.nameHe,
      image: meta.image || '',
      bodyHtml,
    };
  });
}

// מחולל כתבת סוף שבוע אוטומטי (חמישי–שבת) מתוך הפיד
function weekendArticle(shows) {
  const now = israelToday();
  const day = now.getDay();
  const toThu = (day >= 4) ? -(day - 4) : (4 - day);
  const thu = addDays(now, toThu);
  const wk = [ymdStr(thu), ymdStr(addDays(thu, 1)), ymdStr(addDays(thu, 2))];
  const wkSet = new Set(wk);
  const picks = shows.filter(s => (s.Seances || []).some(z => wkSet.has(z.date))).slice(0, 12);
  if (!picks.length) return null;
  const range = `${formatDate(wk[0])} עד ${formatDate(wk[2])}`;
  const items = picks.map(s => {
    const se = (s.Seances || []).find(z => wkSet.has(z.date)) || {};
    const buy = seanceSoldOut(se) ? ' <span class="soldout">אזלו הכרטיסים</span>'
      : ` <a class="mag-buy" href="${esc(affiliateUrl(se.link))}" target="_blank" rel="noopener sponsored">להזמנת כרטיסים ›</a>`;
    return `<li><a href="${esc(s._url)}"><strong>${escText(s.name)}</strong></a> — ${formatDate(se.date)}${se.city ? ', ' + escText(se.city) : ''}${se.hall ? ' · ' + escText(se.hall) : ''}.${buy}</li>`;
  }).join('\n');
  return {
    slug: 'מה-לעשות-בסוף-השבוע',
    title: `לאן לצאת בסוף השבוע? מדריך הבילויים ל${range}`,
    description: `המופעים, ההצגות והקונצרטים המומלצים לסוף השבוע הקרוב בישראל (${range}). כרטיסים ומועדים מעודכנים.`,
    date: ymdStr(now),
    author: BRAND.nameHe,
    image: (picks.find(s => s.image) || {}).image || '',
    bodyHtml: `<p>סוף השבוע כבר כאן, וריכזנו עבורכם את המופעים, ההצגות והקונצרטים המומלצים ביותר שמתקיימים בין ${range}. בחרו את הבילוי המושלם ורכשו כרטיסים בקלות.</p>
<h2>המומלצים לסוף השבוע</h2>
<ul class="mag-picks">${items}</ul>
<p>לרשימה המלאה של כל אירועי סוף השבוע, בקרו ב<a href="/הופעות-בסוף-השבוע.html">עמוד הופעות סוף השבוע</a> שלנו.</p>`,
  };
}

// מחולל מדריך ילדים ומשפחה לסוף השבוע (אוטומטי, מחולק לפי ערים)
const KIDS_SECTIONS = new Set(['הצגות ילדים', 'קונצרטים לילדים', 'שעת סיפור', 'קרקס', 'אטרקציות']);
function familyWeekendArticle(shows) {
  const now = israelToday();
  const day = now.getDay();
  const toThu = (day >= 4) ? -(day - 4) : (4 - day);
  const thu = addDays(now, toThu);
  const wk = [ymdStr(thu), ymdStr(addDays(thu, 1)), ymdStr(addDays(thu, 2))];
  const wkSet = new Set(wk);
  const picks = shows.filter(s => KIDS_SECTIONS.has(s.section) && (s.Seances || []).some(z => wkSet.has(z.date)));
  if (!picks.length) return null;
  const byCity = {};
  picks.forEach(s => {
    const se = (s.Seances || []).find(z => wkSet.has(z.date)) || {};
    const city = se.city || 'שונות';
    (byCity[city] = byCity[city] || []).push({ s, se });
  });
  const range = `${formatDate(wk[0])} עד ${formatDate(wk[2])}`;
  const sections = Object.keys(byCity).sort((a, b) => a.localeCompare(b, 'he')).map(city => {
    const items = byCity[city].map(({ s, se }) => {
      const buy = seanceSoldOut(se) ? ' <span class="soldout">אזלו הכרטיסים</span>'
        : ` <a class="mag-buy" href="${esc(affiliateUrl(se.link))}" target="_blank" rel="noopener sponsored">להזמנת כרטיסים ›</a>`;
      const when = `${formatDate(se.date)}${se.time ? ` בשעה ${formatTime(se.time)}` : ''}`;
      return `<li><a href="${esc(s._url)}"><strong>${escText(s.name)}</strong></a> — <span class="mag-sect">${escText(s.section)}</span> · ${when}${se.hall ? ' · ' + escText(se.hall) : ''}.${buy}</li>`;
    }).join('\n');
    return `<h2>${escText(city)}</h2>\n<ul class="mag-picks">${items}</ul>`;
  }).join('\n');
  return {
    slug: 'הצגות-ילדים-ומופעים-לסוף-השבוע',
    redirectFrom: 'family-events-weekend',
    title: `הצגות ילדים ומופעים לסוף השבוע — ${range}`,
    description: `כל הצגות הילדים, מופעי המשפחה והאטרקציות לסוף השבוע הקרוב בישראל (${range}), מחולקים לפי ערים עם שעות וכרטיסים.`,
    date: ymdStr(now),
    author: BRAND.nameHe,
    image: (picks.find(s => s.image) || {}).image || '',
    bodyHtml: `<p>סוף השבוע הוא הזמן המושלם לבילוי משפחתי, ואין דבר שמאיר את עיני הילדים כמו מופע חי. בין אם אתם מחפשים הצגת ילדים קלאסית, קרקס צבעוני, שעת סיפור מכושפת או אטרקציה מרהיבה, ריכזנו עבורכם את כל האירועים המתאימים לכל המשפחה המתקיימים בין ${range}. סידרנו הכול לפי עיר, כדי שתמצאו במהירות את הבילוי המושלם קרוב לבית, ותוכלו להזמין כרטיסים בלחיצה אחת ולצאת להרפתקה משפחתית בלתי נשכחת.</p>\n${sections}\n<p>לרשימה המלאה של כל אירועי סוף השבוע לכל הגילאים, בקרו ב<a href="/הופעות-בסוף-השבוע.html">עמוד הופעות סוף השבוע</a>. מחפשים בילוי בעיר מסוימת? עברו ל<a href="/">עמוד הבית</a> וסננו לפי קטגוריית "הצגות ילדים" והעיר שלכם.</p>`,
  };
}

// מדריך אולמות נצחי (Evergreen) — מקשר לעמודי האולמות הייעודיים
function venuesSeatingGuide() {
  const top = [...VENUE_REGISTRY].sort((a, b) => b.shows.length - a.shows.length).slice(0, 12);
  const venueLinks = top.map(v =>
    `<li><a href="${esc(v.url)}"><strong>${escText(v.hall)}</strong></a>${v.city ? ' — ' + escText(v.city) : ''} · ${v.shows.length} מופעים קרובים</li>`).join('\n');
  const image = (top[0] && (top[0].shows.find(s => s.image) || {}).image) || '';
  // קישור לעמוד אולם לפי מילת מפתח (אם קיים בנתונים), אחרת טקסט רגיל
  const linkVenue = (kw, label) => {
    const v = VENUE_REGISTRY.find(x => x.hall.includes(kw));
    return v ? `<a href="${esc(v.url)}">${escText(label)}</a>` : `<strong>${escText(label)}</strong>`;
  };
  // בדיקת זמינות דינמית: אם יש מופעים פעילים באולם — קישור קריאה לפעולה; אחרת הערה נצחית נקייה (ללא קישור שבור או רשימה ריקה)
  const venueCTA = (kw, name) => {
    const v = VENUE_REGISTRY.find(x => x.hall.includes(kw) && x.shows.length > 0);
    return v
      ? ` <a class="mag-buy" href="${esc(v.url)}">צפו בכל המופעים הקרובים ב${escText(name)} (${v.shows.length}) ›</a>`
      : ` <span class="mag-note">כרגע אין מופעים פעילים באולם זה, אך מומלץ להתעדכן לקראת האירועים הבאים או לבדוק את המופעים באולמות המרכזיים האחרים.</span>`;
  };
  const bodyHtml = `<p>בחירת מקום הישיבה הנכון יכולה לשנות לחלוטין את חוויית ההופעה או ההצגה. אותו מופע בדיוק יכול להרגיש שונה לגמרי משורה ראשונה, ממרכז האולם או מהיציע העליון, וההבדל טמון באקוסטיקה, בזווית הצפייה ובמרחק מהבמה. ריכזנו עבורכם מדריך מקצועי ומעמיק שיעזור לכם לבחור נכון באולמות ובהיכלי התרבות המובילים בישראל, כדי שתפיקו את המרב מכל אירוע.</p>

<h2>${linkVenue('היכל התרבות תל אביב', 'היכל התרבות תל אביב')}</h2>
<p>אחד ההיכלים המרכזיים בישראל, המארח קונצרטים קלאסיים, מופעי מוזיקה ומחזות זמר גדולים. האולם בנוי בשתי שכבות עיקריות: <strong>הפרטר (השכבה הראשונה)</strong> ו<strong>היציע</strong>. בפרטר, השורות האמצעיות (בערך שורות 8 עד 18) מציעות את האיזון הטוב ביותר בין קרבה לבמה לבין אקוסטיקה מאוזנת, שכן מערכת הסאונד מכוונת למרכז. השורות הראשונות מעולות לחוויה אינטימית, אך בקונצרטים סימפוניים ייתכן שהצליל יישמע פחות מלוכד. השורות האחרונות של הפרטר לעיתים נמצאות מתחת לבליטת היציע, מה שעלול "לחתוך" מעט את הצליל הגבוה. <strong>היציע</strong>, לעומת זאת, מציע ראייה פנורמית מצוינת ואקוסטיקה פתוחה ואווררית, במחיר נוח יותר, ומומלץ במיוחד למחזות זמר ולמופעים חזותיים.${venueCTA('היכל התרבות תל אביב', 'היכל התרבות תל אביב')}</p>

<h2>${linkVenue('קיסריה', 'אמפי קיסריה')}</h2>
<p>אמפיתיאטרון פתוח ומרהיב על שפת הים, עם אווירה קסומה בשקיעה. חוויית הצפייה משתנה מאוד לפי המיקום. <strong>שורות ה-VIP</strong> הקרובות לבמה מעניקות קרבה מקסימלית לאמן ואנרגיה בלתי אמצעית, אך לעיתים על חשבון מבט כולל. <strong>גוש האמצע</strong> הוא לרוב הבחירה האידיאלית: מרחק נעים, זווית צפייה נהדרת, וסאונד מאוזן שמגיע ישירות ממערכת ההגברה. <strong>היציעים העליונים</strong> מציעים מבט עוצר נשימה על הבמה ועל הים ברקע, אך שם משב רוח הים חזק יותר ולעיתים הצליל מעט פחות ממוקד. טיפ חשוב: הגיעו מוקדם, הצטיידו בשכבת לבוש חמה לשעות הערב, וקחו בחשבון שהמושבים עשויים אבן ולכן כרית ישיבה יכולה לשפר את הנוחות.${venueCTA('קיסריה', 'אמפי קיסריה')}</p>

<h2>${linkVenue('זאפ', 'מועדוני זאפה (תל אביב, הרצליה וירושלים)')}</h2>
<p>רשת מועדוני המופעים המובילה בישראל, עם אווירה אינטימית וקרובה. ברוב הסניפים הישיבה היא <strong>סביב שולחנות</strong>, ולכן ההגעה המוקדמת קריטית: הכניסה היא לרוב לפי סדר הגעה בתוך אזור המחיר שרכשתם, ומי שמקדים תופס את השולחנות הטובים ביותר מול הבמה. השורות והשולחנות הקרובים לבמה מעניקים חוויה אישית וקרובה מאוד לאמן, בעוד <strong>אזור הבר</strong> והשולחנות האחוריים נוחים יותר למי שאוהב אווירה חברתית וקצת יותר מרחק. שווה לבדוק מראש אם מדובר במופע ישיבה או עמידה, שכן חלק מההופעות הן במתכונת עמידה בלבד.${venueCTA('זאפ', 'מועדוני זאפה')}</p>

<h2>עקרונות כלליים לבחירת מקום</h2>
<ul class="mag-picks">
  <li><strong>קרוב לבמה:</strong> חוויה אינטימית, מצוין לסולו, סטנד אפ ומחול. פחות אידיאלי בקונצרטים גדולים.</li>
  <li><strong>מרכז האולם:</strong> האיזון הטוב ביותר בין קרבה לאקוסטיקה, הבחירה המומלצת למרבית המופעים.</li>
  <li><strong>יציע ומקומות אחוריים:</strong> מבט כולל במחיר נוח, מצוין למחזות זמר, אופרה ומופעים חזותיים.</li>
</ul>

<h2>האולמות המובילים אצלנו</h2>
<p>לחצו על כל אולם כדי לראות את לוח המופעים המלא והקרוב שלו, ולהזמין כרטיסים:</p>
<ul class="mag-picks">${venueLinks}</ul>
<p>מחפשים מופע ספציפי? בקרו ב<a href="/">עמוד הבית</a> וסננו לפי אולם, עיר או תאריך, או עברו ל<a href="/רשימת-אמנים/">רשימת האמנים</a>. יש לכם שאלות על ביטולים, מחירים או קבלת הכרטיסים? כל התשובות ב<a href="/magazine/${encodeURI('שאלות-נפוצות-רכישת-כרטיסים')}/">מדריך השאלות הנפוצות</a>.</p>`;
  return {
    slug: 'מדריך-אולמות-הופעות-איפה-כדאי-לשבת',
    redirectFrom: 'venues-seating-guide',
    schemaType: 'Article',
    title: 'מדריך האולמות: איפה כדאי לשבת באולמות ההופעות המובילים בישראל',
    description: 'מדריך מקצועי ומעמיק לבחירת מקומות ישיבה בהיכל התרבות תל אביב, אמפי קיסריה, מועדוני זאפה ועוד, עם טיפים וקישורים ללוחות המופעים.',
    date: '2026-08-15',
    author: BRAND.nameHe,
    image,
    bodyHtml,
  };
}

function magArticlePage(a) {
  const canonical = `${BRAND.domain}${a.url}`;
  const crumb = breadcrumbSchema([
    { name: 'בית', url: BRAND.domain + '/' },
    { name: 'מגזין', url: BRAND.domain + '/magazine/' },
    { name: a.title, url: canonical },
  ]);
  const articleSchema = {
    '@context': 'https://schema.org',
    '@type': a.schemaType || 'NewsArticle',
    headline: a.title,
    description: a.description,
    datePublished: a.date,
    dateModified: a.date,
    image: a.image || undefined,
    author: { '@type': 'Organization', name: BRAND.nameHe, url: BRAND.domain },
    publisher: { '@type': 'Organization', name: BRAND.nameHe, url: BRAND.domain, logo: { '@type': 'ImageObject', url: BRAND.domain + '/assets/logo.svg' } },
    mainEntityOfPage: canonical,
  };
  // סכמת FAQPage לעמודי שאלות ותשובות (Rich Snippets)
  const faqSchema = (a.faq && a.faq.length) ? {
    '@context': 'https://schema.org', '@type': 'FAQPage',
    mainEntity: a.faq.map(f => ({
      '@type': 'Question', name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.aText || String(f.a || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() },
    })),
  } : null;
  const body = `
<article class="mag-article">
  <div class="wrap mag-wrap">
    <nav class="breadcrumb"><a href="/">בית</a> <span>›</span> <a href="/magazine/">מגזין</a> <span>›</span> <span class="current">${escText(a.title)}</span></nav>
    <h1 class="mag-title">${escText(a.title)}</h1>
    <p class="mag-byline">מאת ${escText(a.author)} · ${formatDate(a.date)}</p>
    ${a.image ? `<figure class="mag-hero"><img src="${esc(a.image)}" alt="${esc(a.title)}"></figure>` : ''}
    <div class="mag-body rte">${a.bodyHtml}</div>
    <p class="mag-back"><a href="/magazine/">‹ חזרה למגזין</a></p>
  </div>
</article>`;
  const html = page({
    title: `${a.title} | מגזין איידיר כרטיסים`,
    description: a.description,
    canonical,
    head: crumb + `\n<script type="application/ld+json">${JSON.stringify(articleSchema)}</script>` + (faqSchema ? `\n<script type="application/ld+json">${JSON.stringify(faqSchema)}</script>` : '') + (a.image ? `\n<meta property="og:image" content="${esc(a.image)}">` : ''),
    body,
  });
  const dir = path.join(BRAND.outDir, 'magazine', a.slug);
  ensureDir(dir);
  fs.writeFileSync(path.join(dir, 'index.html'), html, 'utf8');
}

// כתבת עומק נצחית: הפסטיבלים והאירועים הגדולים של 2027 (First-mover SEO)
function festivals2027Article() {
  const linkV = (kw, label) => {
    const v = VENUE_REGISTRY.find(x => x.hall.includes(kw) && x.shows.length > 0);
    return v ? `<a href="${esc(v.url)}">${escText(label)}</a>` : `<strong>${escText(label)}</strong>`;
  };
  const image = (VENUE_REGISTRY.flatMap(v => v.shows).find(s => s.image) || {}).image || '';
  const bodyHtml = `<p>שנת 2027 מסתמנת כבר עכשיו כאחת מעונות התרבות העמוסות והמרתקות שידעה ישראל. אמנים בינלאומיים גדולים מסמנים חזרה לבמות המקומיות, פסטיבלי הענק הפתוחים ממשיכים לצבור תאוצה, והביקוש לכרטיסים למופעים המבוקשים צפוי להיות גבוה מאי פעם. מי שמכיר את עולם ההופעות יודע: ההיערכות המוקדמת היא ההבדל בין לתפוס מקום בשורה הראשונה לבין להישאר בחוץ. ריכזנו עבורכם מדריך מקיף לכל מה שצפוי בשנת 2027, לפי עונות וז'אנרים, יחד עם טיפים מנצחים להזמנת כרטיסים חכמה ומוקדמת.</p>

<h2>פסטיבלי האביב והפסח 2027</h2>
<p>עונת האביב פותחת את השנה באנרגיה מיוחדת. חופשת הפסח מביאה איתה שפע של אירועים פתוחים לכל המשפחה, פסטיבלי מוזיקה בחיק הטבע ומופעים באתרי מורשת ברחבי הארץ. זו התקופה שבה אמפיתיאטראות פתוחים ואתרים היסטוריים הופכים לבמות קסומות, עם מזג אוויר נעים שמאפשר לשבת בחוץ בשעות הערב. פסטיבלי האביב נוטים להימכר מהר במיוחד, שכן הם משלבים חופשה, טבע ותרבות במקום אחד.</p>
<p>מעבר למופעים הגדולים, האביב הוא גם עונת הפסטיבלים הקהילתיים והאזוריים, שמביאים תרבות אל לב הערים והמושבות. אלה אירועים שמשלבים מוזיקה, אוכל, אמנות רחוב ופעילויות לילדים, והם הפכו בשנים האחרונות לחלק בלתי נפרד מלוח האירועים הישראלי. שנת 2027 צפויה להרחיב את המגמה הזו עוד יותר, עם הפקות שאפתניות באתרים חדשים ברחבי הארץ.</p>
<h3>מה כדאי לתכנן מראש</h3>
<p>אם אתם מתכננים בילוי משפחתי בפסח, שריינו תאריכים מוקדם ובדקו את <a href="/">לוח האירועים הכללי</a> באופן שוטף. אירועי חג רבים נחשפים חודשים מראש, ומי שמזמין מוקדם נהנה גם ממחירי Early Bird אטרקטיביים. שימו לב במיוחד לאירועים הפתוחים, שבהם הביקוש גבוה והכמות מוגבלת לפי קיבולת האתר.</p>

<h2>עונת הקיץ והפארקים הגדולים</h2>
<p>הקיץ הישראלי הוא שיא עונת ההופעות תחת כיפת השמיים. מופעי הענק עוברים אל הפארקים והמרחבים הפתוחים, שם אלפי צופים נהנים מהופעות בלתי נשכחות בשמיים הפתוחים. ${linkV('קיסריה', 'אמפי קיסריה')}, על שפת הים, ממשיך להיות אחד מאתרי ההופעות היוקרתיים והמבוקשים בישראל, לצד המרחבים הגדולים של פארק הירקון בתל אביב ובריכת הסולטן בירושלים. חוויית ההופעה תחת השמיים הפתוחים, עם רוח ערב קלה ושקיעה ברקע, היא חוויה שקשה לשחזר באולם סגור. פארק הירקון, עם קיבולת של עשרות אלפי צופים, מתאים במיוחד להופעות הענק הבינלאומיות והישראליות הגדולות ביותר, בעוד בריכת הסולטן למרגלות חומות ירושלים מציעה אווירה היסטורית וייחודית שמתאימה להפקות אינטימיות יותר. כל אתר מביא איתו אופי משלו, ובחירת האירוע הנכון באתר הנכון היא חלק מהחוויה.</p>
<h3>טיפ לבחירת מקום בהופעות הקיץ</h3>
<p>בהופעות פתוחות, גוש האמצע מציע לרוב את האיזון הטוב ביותר בין קרבה לבמה לבין איכות סאונד. לפני שרוכשים, שווה לקרוא את <a href="/magazine/${encodeURI('מדריך-אולמות-הופעות-איפה-כדאי-לשבת')}/">מדריך האולמות המלא שלנו</a> שמפרט איפה כדאי לשבת בכל אתר.</p>

<h2>פסטיבלי הז'אנר: ג'אז, רוק, אלקטרוניקה ותיאטרון</h2>
<p>לצד המופעים ההמוניים, שנת 2027 עשירה גם באירועי בוטיק שנתיים המוקדשים לחובבי ז'אנר. פסטיבל הג'אז באילת ממשיך למשוך אליו את מיטב האמנים מהארץ ומהעולם, לצד פסטיבלי רוק, מופעי אלקטרוניקה ואירועי מחול ותיאטרון מהמובילים בישראל. אירועים אלו מציעים חוויה אינטימית ואיכותית יותר, ולעיתים קרובות הכרטיסים אליהם מוגבלים במיוחד ונחטפים במהירות. פסטיבלי הבוטיק בולטים גם בכך שהם מושכים קהל מגובש של חובבי ז'אנר, מה שהופך את האווירה בהם למיוחדת במינה.</p>
<p>לצד אלה, שנת 2027 מביאה גם את פסטיבלי המחול והתיאטרון המובילים, שמציגים הפקות מקור לצד אורחים בינלאומיים, ומהווים הזדמנות נדירה לראות יצירות עכשוויות ופורצות דרך. מעריצים של אמן מסוים יכולים לעקוב אחר לוח ההופעות המלא דרך <a href="/רשימת-אמנים/">רשימת האמנים</a> באתר, ולקבל מידע על מועדים חדשים שנחשפים לאורך השנה.</p>

<h2>המדריך המנצח להזמנת כרטיסים ל-2027</h2>
<ul class="mag-picks">
  <li><strong>הזמינו מוקדם ככל האפשר:</strong> למופעים המבוקשים, המקומות הטובים אוזלים ראשונים והמחירים נוטים לעלות ככל שמתקרב מועד האירוע.</li>
  <li><strong>נצלו מכירות Early Bird:</strong> בתחילת מכירת הכרטיסים לרוב מוצעות כמויות מוגבלות במחיר מוזל. זו ההזדמנות הטובה ביותר לשלב מחיר אטרקטיבי עם מקום מעולה.</li>
  <li><strong>הגדירו תקציב וטווח תאריכים גמיש:</strong> לעיתים אותו מופע מתקיים בכמה ערים ובכמה מועדים במחירים שונים. השוואה קצרה יכולה לחסוך לא מעט.</li>
  <li><strong>בדקו את מפת האולם:</strong> הכירו את מבנה האתר לפני הרכישה כדי לשריין את השורות הטובות ביותר עבורכם.</li>
</ul>

<p>שנת 2027 מבטיחה עונת תרבות עשירה במיוחד, וההיערכות מתחילה עכשיו. עקבו אחר <a href="/">לוח האירועים המתעדכן שלנו</a>, בדקו את עמודי האולמות והאמנים, והזמינו את הכרטיסים שלכם מוקדם כדי להבטיח את החוויה המושלמת.</p>`;
  return {
    slug: 'הפסטיבלים-והאירועים-הגדולים-של-שנת-2027',
    schemaType: 'Article',
    title: 'הפסטיבלים והאירועים הגדולים של שנת 2027: לוח תאריכים, כרטיסים וכל מה שצריך לדעת',
    description: 'מדריך מקיף לפסטיבלים ולאירועים הגדולים של 2027 בישראל, לפי עונות וז\'אנרים, עם טיפים להזמנת כרטיסים מוקדמת וקישורים ללוחות המופעים.',
    date: '2026-08-31',
    author: BRAND.nameHe,
    image,
    bodyHtml,
  };
}

// כתבת עומק עורכת מבוססת נתונים: הופעות החובה של 2027 מתוך הלוח הקיים
function mustSee2027Article(shows) {
  const itemLi = (s) => {
    const se = [...(s.Seances || [])].sort((a, b) => String(a.date).localeCompare(String(b.date)))[0] || {};
    const buy = seanceSoldOut(se) ? ' <span class="soldout">אזלו הכרטיסים</span>'
      : (se.link ? ` <a class="mag-buy" href="${esc(affiliateUrl(se.link))}" target="_blank" rel="noopener sponsored">להזמנת כרטיסים ›</a>` : '');
    const when = se.date ? ` · ${formatDate(se.date)}` : '';
    return `<li><a href="${esc(s._url)}"><strong>${escText(s.name)}</strong></a>${se.hall ? ' · ' + escText(se.hall) : ''}${when}.${buy}</li>`;
  };
  const byName = (kws) => {
    const seen = new Set(); const out = [];
    for (const s of shows) {
      const n = (s.name || '');
      if (kws.some(k => n.includes(k)) && !seen.has(s._url)) { seen.add(s._url); out.push(s); }
    }
    return out;
  };
  const bySection = (kws, limit) => {
    const out = shows.filter(s => kws.some(k => (s.section || '').includes(k)));
    out.sort((a, b) => String((a.Seances && a.Seances[0] && a.Seances[0].date) || '').localeCompare(String((b.Seances && b.Seances[0] && b.Seances[0].date) || '')));
    return out.slice(0, limit);
  };
  const list = (arr) => arr.length
    ? `<ul class="mag-picks">${arr.map(itemLi).join('\n')}</ul>`
    : `<p>הרשימה המלאה מתעדכנת כל העת. עברו ללוח <a href="/הופעות-2027.html">הופעות 2027</a> לצפייה בכל המופעים בקטגוריה זו.</p>`;

  const giants = byName(['אייפמן', 'ג׳יזל', "ג'יזל", 'גיזל', 'Malevo', 'מלבו', 'מאלבו', 'Beatles', 'ביטלס', 'בלט']);
  const theater = bySection(['תיאטרון', 'זמר', 'קומדיה', 'סטנד', 'בידור', 'מחזה'], 8);
  const music = byName(['סרנגה', 'ג׳אז', "ג'אז", 'גאז', 'בואנה ויסטה', 'סווינג', 'ברלין', 'בארוק', 'תזמורת', 'קלאסי', 'סימפונ', 'מחווה']);

  const bodyHtml = `<p>שנת 2027 הולכת להיות שנה חסרת תקדים בעולם התרבות בישראל. אמני ענק חוזרים לבמות המקומיות, פסטיבלים בינלאומיים נוחתים אצלנו, והפקות מקור מרהיבות עולות לצד קלאסיקות אהובות. ריכזנו עבורכם, בעריכה מוקפדת, את מבחר המופעים והאירועים הבולטים ביותר מתוך לוח 2027 שכבר פתוח להזמנות במערכת שלנו, מחולקים לפי קטגוריות, כדי שתוכלו לתכנן את השנה התרבותית שלכם ולתפוס כרטיסים בזמן.</p>

<h2>מופעי הענק והבכורות הבינלאומיות</h2>
<p>אלה האירועים שמייצרים את הבאזז הגדול ביותר של השנה. בראש הרשימה, מופעי הבלט המרהיבים של בוריס אייפמן, כולל בכורת "ג'יזל האדומה" הצפויה בספטמבר 2027, לצד סנסציית המחול הארגנטינאית "Malevo" שמשלבת קצב, אש ואנרגיה סוחפת, וקונצרטי המחווה הגדולים של "The Beatles legend". אלה הפקות ברמה בינלאומית שהכרטיסים אליהן נחטפים במהירות.</p>
${list(giants)}

<h2>סצנת התיאטרון, המחזמר והבידור</h2>
<p>עונת 2027 מביאה איתה את הפקות הדגל הגדולות של התיאטרון הישראלי, קומדיות שלאגר שחוזרות לבמה לאחר הצלחה מסחררת, ומחזות זמר סוחפים שמלווים אותנו לאורך כל השנה. בין אם אתם חובבי דרמה, קומדיה או מחזמר קלאסי, יש כאן שפע של חוויות במה איכותיות.</p>
${list(theater)}

<h2>מוזיקה חיה, ג'אז וקלאסיקות מיוחדות</h2>
<p>עבור אוהבי המוזיקה החיה, 2027 עשירה במיוחד. שלומי סרנגה עולה למופע ענק, סדרות "ג'אז חם" ממשיכות לסחוף עם ערבי מחווה מרגשים כמו מחווה ל"בואנה ויסטה סושיאל קלאב" ולסווינג מברלין, ולצדם קונצרטי בארוק ותזמורות מהמובילות בישראל. זהו מגוון שמשלב אנרגיה, נוסטלגיה ואיכות נדירה.</p>
${list(music)}

<h2>למה כדאי להזמין כרטיסים כבר עכשיו</h2>
<p>עונת 2027 כבר פתוחה להזמנות, וההיערכות המוקדמת משתלמת. למופעים המבוקשים המקומות הטובים אוזלים ראשונים, והמחירים נוטים לעלות ככל שמתקרב מועד האירוע. הזמנה מוקדמת מבטיחה לכם לא רק כרטיס, אלא את המקום הנכון: מרכז האולם לאיזון הסאונד הטוב ביותר, או השורות הקדמיות לחוויה אינטימית. לפני הרכישה, שווה לעיין ב<a href="/magazine/${encodeURI('מדריך-אולמות-הופעות-איפה-כדאי-לשבת')}/">מדריך האולמות שלנו</a> כדי לבחור בדיוק איפה לשבת.</p>
<p>לרשימה המלאה והמתעדכנת של כל האירועים, בקרו בלוח <a href="/הופעות-2027.html">הופעות 2027</a>, או עברו ל<a href="/">עמוד הבית</a> וסננו לפי אמן, אולם, עיר ותאריך. לפני הרכישה, כדאי לעיין ב<a href="/magazine/${encodeURI('שאלות-נפוצות-רכישת-כרטיסים')}/">שאלות הנפוצות על רכישת כרטיסים</a>.</p>`;

  return {
    slug: 'הופעות-החובה-והאירועים-הגדולים-של-2027',
    schemaType: 'Article',
    title: 'הופעות החובה והאירועים הגדולים של 2027: המדריך המלא לעונת התרבות',
    description: 'סקירה עורכת של מופעי החובה של 2027 בישראל: בכורות בלט בינלאומיות, מחזות זמר, ג\'אז וקונצרטים גדולים, עם קישורים ישירים לכרטיסים.',
    date: '2026-08-31',
    author: BRAND.nameHe,
    image: (giants.concat(music, theater).find(s => s.image) || {}).image || '',
    bodyHtml,
  };
}

// עמוד שאלות ותשובות נצחי (FAQ) — מבוסס על הנהלים הרשמיים של מערכת ההזמנות
function faqArticle() {
  const faq = [
    { q: 'מתי ואיך מקבלים את הכרטיסים לאחר ההזמנה?', a: `רוב הכרטיסים במערכת הם כרטיסים דיגיטליים עם ברקוד. מיד לאחר התשלום נשלח לכתובת המייל שהזנתם אישור הזמנה הכולל כפתור לצפייה בכרטיסים, כאשר הברקודים עצמם נפתחים ביום המופע. בנוסף, יום לפני המועד או ביום המופע נשלחת הודעת SMS עם הכרטיסים האלקטרוניים למספר הנייד שהוזן בהזמנה. בכל שלב אפשר לפתוח את הכרטיסים גם דרך אזור "ההזמנות שלי" באתר ההזמנות. אין צורך באיסוף פיזי מקופה.` },
    { q: 'איך מזמינים ומשלמים, והאם אפשר לפרוס לתשלומים?', a: `בעמוד המופע לוחצים על הכפתור "רכישת כרטיסים". קיימים שני סוגי כרטיסים: מקומות מסומנים, שבהם בוחרים את המושב במפת האולם, או כרטיסי כניסה חופשית ללא מקום שמור, שבהם בוחרים את כמות הכרטיסים. התשלום מתבצע בכרטיס אשראי בלבד, דרך עמוד תשלום מאובטח ומוצפן המועבר ישירות לחברת האשראי, כך שפרטי הכרטיס אינם נשמרים במערכת. ניתן לפרוס את הסכום למספר תשלומים ללא ריבית.` },
    { q: 'מהי מדיניות הביטולים וההחזר הכספי?', a: `ניתן לבטל הזמנה ביוזמת הרוכש לא יאוחר מ־<strong>8 ימים קלנדריים</strong> לפני מועד האירוע. לדוגמה, לאירוע שמתקיים ב־9 בחודש, היום האחרון לביטול הוא ה־1 בחודש. בעת ביטול מנוכים דמי ביטול בשיעור <strong>5% מסכום ההזמנה, אך לא יותר מ־100 ₪</strong>. שינוי מועד, כמות כרטיסים או מקומות ישיבה מתבצע באמצעות ביטול ההזמנה הקיימת וביצוע הזמנה חדשה.` },
    { q: 'מה קורה לכרטיסים שלי אם המופע בוטל או נדחה?', a: `הקופה תיצור עמכם קשר באמצעות הפרטים שמסרתם בהזמנה. באזור "ההזמנות שלי" תוכלו לאשר את השינוי או לבטל את ההזמנה. כאשר מופע מבוטל או משתנה ביוזמת המפיק, <strong>מלוא סכום ההזמנה מוחזר</strong>.` },
    { q: 'לא הצלחתי להגיע לאירוע, האם מגיע לי החזר?', a: `אם האירוע התקיים כמתוכנן ולא הגעתם אליו מיוזמתכם, לא יינתן החזר בגין כרטיסים שלא נוצלו.` },
    { q: 'האם יש הנחות לחיילים, סטודנטים או אזרחים ותיקים?', a: `כל סוגי הכרטיסים והמחירים, לרבות קטגוריות מוזלות כשהן מוצעות למופע מסוים, מוצגים ישירות בעמוד רכישת הכרטיסים של אותו מופע. המידע באתר אחיד לכל הרוכשים, ולכן מומלץ לבדוק את עמוד המופע הרלוונטי ב<a href="/">לוח ההופעות</a>, שם יופיעו כל אפשרויות הכרטיסים והמחירים המעודכנים.` },
    { q: 'הזמנתי ולא קיבלתי אישור במייל, מה עליי לעשות?', a: `האישור נשלח באופן אוטומטי מיד לאחר התשלום. אם אינכם רואים אותו בתיבת הדואר הנכנס, בדקו בתיקיית דואר הזבל (SPAM). ייתכן גם שהוזנה כתובת מייל שגויה, ובמקרה כזה היכנסו לאזור "ההזמנות שלי" ושלחו את השובר למייל שלכם בשנית.` },
    { q: 'האם אפשר לשנות פרטים בהזמנה?', a: `ניתן לשנות את פרטי מקבל הכרטיסים עד <strong>24 שעות</strong> לפני תחילת המופע, דרך אזור "ההזמנות שלי", או להעביר את אישור ההזמנה לאדם אחר. שינוי מקומות ישיבה בהזמנה ששולמה כרוך בביטול ההזמנה הקיימת וביצוע הזמנה חדשה.` },
    { q: 'מתי כדאי להתקשר לשירות הלקוחות?', a: `כל המידע על המופעים והכרטיסים מופיע באתר בזמן אמת, כולל תאריכים, מיקום, מחירים וזמינות. שירות הלקוחות אינו מוקד בירורים, והטלפון מיועד בעיקר לתשלום עבור הזמנה שכבר בוצעה או לביטול הזמנה. לפני פנייה מומלץ לעיין בעמוד המופע, ב<a href="/רשימת-אמנים/">רשימת האמנים</a> או ב<a href="/">לוח ההופעות המלא</a>.` },
  ];
  const bodyHtml = `<p>ריכזנו עבורכם את התשובות לשאלות הנפוצות ביותר על רכישת כרטיסים, קבלתם, ביטולים והחזרים, בהתבסס על הנהלים הרשמיים של מערכת ההזמנות. כך תוכלו להזמין בביטחון ולדעת בדיוק למה לצפות בכל שלב.</p>
${faq.map(f => `<details class="faq-item"><summary>${escText(f.q)}</summary><div class="faq-answer">${f.a}</div></details>`).join('\n')}
<p class="faq-foot">לא מצאתם תשובה לשאלה שלכם? כל המידע המעודכן על כל מופע, כולל מחירים, מועדים וזמינות, מופיע בעמוד המופע עצמו ב<a href="/">לוח ההופעות</a>.</p>`;
  return {
    slug: 'שאלות-נפוצות-רכישת-כרטיסים',
    schemaType: 'Article',
    faq,
    title: 'שאלות נפוצות על רכישת כרטיסים להופעות',
    description: 'כל מה שצריך לדעת על רכישת כרטיסים, קבלתם, מדיניות ביטולים והחזרים, הנחות ויצירת קשר, לפי הנהלים הרשמיים של מערכת ההזמנות.',
    date: '2026-08-20',
    author: BRAND.nameHe,
    image: '',
    bodyHtml,
  };
}

/* ===================== עמודי נחיתה SEO בתוך המגזין =====================
   8 עמודי מפתח לשאילתות מדויקות בעברית, עם סינון אוטומטי מהפיד. */
const TLV_RE = /תל אביב/;
function landingContext() {
  const t = israelToday();
  const day = t.getDay();
  const untilSat = (6 - day + 7) % 7;
  return {
    today: ymdStr(t), tomorrow: ymdStr(addDays(t, 1)),
    saturday: ymdStr(addDays(t, untilSat)), weekEnd: ymdStr(addDays(t, 7)),
  };
}
function landingMatch(shows, { sectionRe, cityRe, dateTest }, ctx) {
  const out = [];
  for (const s of shows) {
    if (sectionRe && !sectionRe.test(s.section || '')) continue;
    let nd = null;
    for (const z of (s.Seances || [])) {
      if (cityRe && !cityRe.test(z.city || '')) continue;
      if (!dateTest(String(z.date || ''), ctx)) continue;
      if (nd === null || String(z.date) < nd) nd = String(z.date);
    }
    if (nd !== null) out.push({ s, nd });
  }
  out.sort((a, b) => a.nd.localeCompare(b.nd));
  return out.map(x => x.s);
}
function buildLandingPages(shows) {
  const ctx = landingContext();
  const MUSIC = /הופעות|מחזמר|מוזיקה|ג'אז|אופרה|מחול|קונצרט/;
  const defs = [
    { slug: 'הופעות-מוזיקה-היום', h1: 'הופעות מוזיקה היום',
      title: 'הופעות מוזיקה היום — לוח הופעות לערב', desc: 'כל הופעות המוזיקה שמתקיימות היום בישראל: מועדים, אולמות, מחירים וכרטיסים. הלוח מתעדכן אוטומטית מדי יום.',
      intro: 'כל הופעות המוזיקה שמתקיימות היום ברחבי הארץ. בחרו מופע, בדקו מחיר ומיקום, והזמינו כרטיסים בלחיצה.',
      f: { sectionRe: MUSIC, dateTest: (d, c) => d === c.today } },
    { slug: 'הופעות-זמרים-היום-הערב', h1: 'הופעות זמרים היום והערב',
      title: 'הופעות זמרים היום והערב — כרטיסים', desc: 'הופעות של זמרים ואמני מוזיקה היום והערב בישראל, עם מועדים, אולמות וכרטיסים. מתעדכן אוטומטית.',
      intro: 'הופעות של זמרים ואמני מוזיקה שמתקיימות היום והערב. תפסו כרטיס למופע חי כבר הערב.',
      f: { sectionRe: MUSIC, dateTest: (d, c) => d === c.today } },
    { slug: 'הופעות-היום-בערב-בתל-אביב', h1: 'הופעות היום בערב בתל אביב',
      title: 'הופעות היום בערב בתל אביב — מה קורה הערב', desc: 'כל ההופעות והאירועים שמתקיימים היום בערב בתל אביב: הצגות, קונצרטים ומופעים, עם כרטיסים בהזמנה מיידית.',
      intro: 'כל ההופעות והאירועים שמתקיימים היום בערב בתל אביב, במקום אחד. מצאו מה לעשות הערב בעיר.',
      f: { cityRe: TLV_RE, dateTest: (d, c) => d === c.today } },
    { slug: 'הופעות-מוזיקה-לפי-תאריך', h1: 'הופעות מוזיקה לפי תאריך',
      title: 'הופעות מוזיקה לפי תאריך — לוח מלא', desc: 'לוח הופעות המוזיקה הקרובות בישראל, מסודר לפי תאריך: קונצרטים, ג\'אז, קלאסי ומחזות זמר. מועדים וכרטיסים.',
      intro: 'לוח הופעות המוזיקה הקרובות בישראל, מסודר לפי תאריך. מצאו את המופע המתאים למועד שנוח לכם.',
      f: { sectionRe: MUSIC, dateTest: (d, c) => d >= c.today } },
    { slug: 'הופעות-זמרים-2026', h1: 'הופעות זמרים 2026',
      title: 'הופעות זמרים 2026 — לוח מלא וכרטיסים', desc: 'כל הופעות הזמרים ואמני המוזיקה של 2026 בישראל: מועדים, אולמות ומחירים. הזמנת כרטיסים מוקדמת במקום אחד.',
      intro: 'כל הופעות הזמרים ואמני המוזיקה שיתקיימו בישראל במהלך 2026. תכננו מראש ותפסו מקום.',
      f: { sectionRe: MUSIC, dateTest: d => d.startsWith('2026') } },
    { slug: 'לוח-הופעות-תל-אביב', h1: 'לוח הופעות תל אביב',
      title: 'לוח הופעות תל אביב — הצגות, קונצרטים ואירועים', desc: 'לוח ההופעות המלא של תל אביב: קונצרטים, הצגות, מופעי ילדים ואירועים. מועדים קרובים, אולמות וכרטיסים.',
      intro: 'לוח ההופעות המלא של תל אביב לזמן הקרוב — קונצרטים, הצגות, מופעי ילדים ואירועי תרבות בעיר.',
      f: { cityRe: TLV_RE, dateTest: (d, c) => d >= c.today } },
    { slug: 'הופעות-סטאנדאפ-היום-הערב-השבוע', h1: 'הופעות סטנד אפ היום, הערב והשבוע',
      title: 'הופעות סטנד אפ היום, הערב והשבוע — כרטיסים', desc: 'כל הופעות הסטנד אפ הקרובות בישראל, מהיום ולאורך השבוע: מועדים, אולמות וכרטיסים. מתעדכן אוטומטית.',
      intro: 'כל הופעות הסטנד אפ הקרובות בישראל, מהערב ולאורך השבוע הקרוב. צחוק מובטח, כרטיסים בלחיצה.',
      f: { sectionRe: /סטנד/, dateTest: (d, c) => d >= c.today && d <= c.weekEnd } },
    { slug: 'הופעות-לפי-תאריך-2027', h1: 'הופעות לפי תאריך 2027',
      title: 'הופעות לפי תאריך 2027 — לוח מוקדם וכרטיסים', desc: 'לוח ההופעות והאירועים של 2027 בישראל, מסודר לפי תאריך: קונצרטים, הצגות ופסטיבלים. הזמנה מוקדמת.',
      intro: 'לוח ההופעות והאירועים של 2027 בישראל, מסודר לפי תאריך. היערכות מוקדמת לעונת התרבות הבאה.',
      f: { dateTest: d => d.startsWith('2027') } },
  ];

  const results = [];
  for (const def of defs) {
    let matched = landingMatch(shows, def.f, ctx).slice(0, 60);
    let fallbackNote = '';
    if (!matched.length) {
      const fb = landingMatch(shows, { cityRe: def.f.cityRe || null, dateTest: (d, c) => d >= c.today }, ctx);
      matched = fb.slice(0, 12);
      fallbackNote = `<p class="landing-empty">לא נמצאו אירועים למועד המבוקש כרגע. בהמשך מוצגים האירועים הקרובים שכדאי לא לפספס.</p>`;
    }
    const url = `/magazine/${def.slug}/`;
    const canonical = BRAND.domain + url;
    const heroImage = (matched.find(s => s.image) || {}).image || '';
    const cards = matched.map(showCard).join('\n');
    const itemList = {
      '@context': 'https://schema.org', '@type': 'ItemList',
      itemListElement: matched.slice(0, 15).map((s, i) => ({
        '@type': 'ListItem', position: i + 1, url: BRAND.domain + s._url, name: s.name,
      })),
    };
    const crumb = breadcrumbSchema([
      { name: 'בית', url: BRAND.domain + '/' },
      { name: 'מגזין', url: BRAND.domain + '/magazine/' },
      { name: def.h1, url: canonical },
    ]);
    const body = `
<article class="hub landing-page">
  <div class="wrap">
    <nav class="breadcrumb"><a href="/">בית</a> <span>›</span> <a href="/magazine/">מגזין</a> <span>›</span> <span class="current">${escText(def.h1)}</span></nav>
    <h1 class="hub-title">${escText(def.h1)}</h1>
    <p class="hub-intro">${escText(def.intro)}</p>
    <p class="landing-count">נמצאו אירועים: <strong>${matched.length}</strong></p>
    ${fallbackNote}
    <div class="grid card-grid">${cards || '<p>בקרוב יופיעו כאן אירועים. חזרו בקרוב.</p>'}</div>
    <p class="landing-related">כדאי גם: <a href="/">לוח ההופעות המלא</a> · <a href="/הופעות-2027.html">הופעות 2027</a> · <a href="/magazine/">מגזין</a> · <a href="/magazine/${encodeURI('שאלות-נפוצות-רכישת-כרטיסים')}/">שאלות נפוצות</a></p>
  </div>
</article>`;
    const html = page({
      title: def.title + ' | איידיר כרטיסים',
      description: def.desc,
      canonical,
      head: crumb + `\n<script type="application/ld+json">${JSON.stringify(itemList)}</script>`,
      body,
    });
    const dir = path.join(BRAND.outDir, 'magazine', def.slug);
    ensureDir(dir);
    fs.writeFileSync(path.join(dir, 'index.html'), html, 'utf8');
    results.push({ slug: def.slug, url, title: def.h1, description: def.desc, image: heroImage, count: matched.length });
  }
  LANDING_PAGES = results;
  return results.length;
}

function buildMagazine(shows) {
  const mdArticles = loadMdArticles();
  const generated = [weekendArticle(shows), familyWeekendArticle(shows), venuesSeatingGuide(), festivals2027Article(), mustSee2027Article(shows), faqArticle()].filter(Boolean);
  const genSlugs = new Set(generated.map(a => a.slug));
  let articles = [...generated, ...mdArticles.filter(a => !genSlugs.has(a.slug))];
  articles.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));

  const used = new Set();
  articles.forEach(a => {
    let s = a.slug || 'article';
    if (used.has(s)) s += '-2';
    used.add(s);
    a.slug = s;
    a.url = `/magazine/${s}/`;
  });

  articles.forEach(magArticlePage);

  const cardsHtml = articles.map(a => `
    <article class="mag-card">
      <a class="mag-card-media" href="${esc(a.url)}">${a.image ? `<img loading="lazy" src="${esc(a.image)}" alt="${esc(a.title)}">` : ''}</a>
      <div class="mag-card-body">
        <span class="mag-card-date">${formatDate(a.date)}</span>
        <h3 class="mag-card-title"><a href="${esc(a.url)}">${escText(a.title)}</a></h3>
        <p class="mag-card-desc">${escText(a.description)}</p>
        <a class="mag-card-link" href="${esc(a.url)}">קראו עוד ›</a>
      </div>
    </article>`).join('\n');
  const idxBody = `
<article class="hub mag-index">
  <div class="wrap">
    <nav class="breadcrumb"><a href="/">בית</a> <span>›</span> <span class="current">מגזין</span></nav>
    <h1 class="hub-title">מגזין תרבות ובילויים</h1>
    <p class="hub-intro">מדריכי בילוי, המלצות לסוף השבוע וכתבות תרבות של איידיר כרטיסים. כל מה שכדאי לדעת על עולם ההופעות, ההצגות והתרבות בישראל.</p>
    ${LANDING_PAGES.length ? `<h2 class="mag-section-title">חיפושים מובילים</h2>
    <div class="mag-grid">${LANDING_PAGES.map(p => `
      <article class="mag-card">
        <a class="mag-card-media" href="${esc(p.url)}">${p.image ? `<img loading="lazy" src="${esc(p.image)}" alt="${esc(p.title)}">` : ''}</a>
        <div class="mag-card-body">
          <span class="mag-card-date">${formatDate(ymdStr(israelToday()))}</span>
          <h3 class="mag-card-title"><a href="${esc(p.url)}">${escText(p.title)}</a></h3>
          <p class="mag-card-desc">${escText(p.description)}</p>
          <a class="mag-card-link" href="${esc(p.url)}">קראו עוד ›</a>
        </div>
      </article>`).join('\n')}</div>` : ''}
    <nav class="mag-subnav"><a class="mag-subnav-link" href="/magazine/news/">📰 חדשות ועדכונים שוטפים ›</a></nav>
    <h2 class="mag-section-title">כתבות ומדריכים</h2>
    <div class="mag-grid">${cardsHtml}</div>
  </div>
</article>`;
  const idxHtml = page({
    title: 'מגזין תרבות ובילויים | איידיר כרטיסים',
    description: 'מדריכי בילוי, המלצות לסוף השבוע וכתבות תרבות. המגזין של איידיר כרטיסים.',
    canonical: BRAND.domain + '/magazine/',
    head: breadcrumbSchema([{ name: 'בית', url: BRAND.domain + '/' }, { name: 'מגזין', url: BRAND.domain + '/magazine/' }]),
    body: idxBody,
  });
  const md = path.join(BRAND.outDir, 'magazine');
  ensureDir(md);
  fs.writeFileSync(path.join(md, 'index.html'), idxHtml, 'utf8');

  MAGAZINE_ARTICLES = articles;
  MAGAZINE_REDIRECTS = articles.filter(a => a.redirectFrom).map(a => ({ from: a.redirectFrom, to: a.slug }));
  return articles.length;
}

/* ===================== מנוע חדשות ועדכונים (News Engine) ===================
   שכבה עצמאית: כתבות אייטם עיתונאיות קצרות על סצנת התרבות והבידור, מעוגנות
   בנתוני הפיד כדי שהקישורים יהיו חיים והמידע אמיתי. לא רשימת מופעים גולמית. */

// המרת pubDate ("2026-08-31 14:58:45") ליום; חלון "טרי" יחסית ליום העדכני בפיד
function newsPubDay(s) { return String(s.pubDate || '').slice(0, 10); }
function firstSentence(txt) {
  const t = String(txt || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  const m = t.match(/^(.{30,190}?[.!?…])(\s|$)/);
  return m ? m[1].trim() : (t.length > 170 ? t.slice(0, 167).trim() + '…' : t);
}
function newsKicker(section) {
  const s = section || '';
  if (/ילד|קרקס|סיפור|משפח/.test(s)) return 'חדשות ילדים ומשפחה';
  if (/סטנד|בידור|קומ/.test(s)) return 'חדשות בידור';
  if (/מחול|בלט/.test(s)) return 'חדשות מחול';
  if (/קלאסי|תזמור|אופרה|בארוק/.test(s)) return 'חדשות מוזיקה קלאסית';
  if (/מחזמר|תיאטרון|הצג|מחזה/.test(s)) return 'חדשות תיאטרון';
  return 'חדשות מוזיקה';
}
function firstUpcomingSeance(s) {
  const today = ymdStr(israelToday());
  const list = [...(s.Seances || [])].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  return list.find(z => String(z.date) >= today && z.link) || list.find(z => z.link) || list[0] || {};
}

// יצירת פריטי חדשות עריכתיים מתוך הפיד (הכרזות טריות + כותרות מגמה)
function newsItems(shows) {
  const items = [];
  const withPub = shows.filter(s => s.pubDate && s.image && (s.Seances || []).length);
  if (!withPub.length) return items;
  const maxPub = withPub.reduce((m, s) => newsPubDay(s) > m ? newsPubDay(s) : m, '0000-00-00');
  const thr = new Date(maxPub + 'T00:00:00'); thr.setDate(thr.getDate() - 21);
  const thrStr = ymdStr(thr);
  const fresh = withPub
    .filter(s => newsPubDay(s) >= thrStr)
    .sort((a, b) => String(b.pubDate).localeCompare(String(a.pubDate)))
    .slice(0, 12);

  // כתבות אייטם: הכרזה על מופע שנחשף/נפתח למכירה
  for (const s of fresh) {
    const se = firstUpcomingSeance(s);
    const kicker = newsKicker(s.section);
    const city = se.city ? ` ב${se.city}` : '';
    const tpls = [
      `${s.name} עולה לבמה${city}: הכרטיסים נפתחו למכירה`,
      `הוכרז: ${s.name} מגיע לבמה${city}`,
      `${s.name} יוצא לדרך${city} — פתיחת מכירת כרטיסים`,
    ];
    const title = tpls[Number(s.id || 0) % tpls.length];
    const lede = firstSentence(s.announce || s.description) || `${s.name} מצטרף ללוח ההופעות המתעדכן שלנו.`;
    const when = se.date ? `${formatDate(se.date)}${se.time ? ` בשעה ${formatTime(se.time)}` : ''}` : '';
    const venue = se.hall ? escText(se.hall + (se.city ? `, ${se.city}` : '')) : (se.city ? escText(se.city) : '');
    const v = VENUE_REGISTRY.find(x => se.hall && x.hall === se.hall && x.shows.length > 0);
    const venueHtml = v ? `<a href="${esc(v.url)}">${venue}</a>` : venue;
    const buy = seanceSoldOut(se) ? '<span class="soldout">אזלו הכרטיסים</span>'
      : (se.link ? `<a class="news-cta" href="${esc(affiliateUrl(se.link))}" target="_blank" rel="noopener sponsored">להזמנת כרטיסים ›</a>` : '');
    const bodyHtml = `<p class="news-lede">${escText(lede)}</p>
<p>${venueHtml ? `המופע צפוי לעלות ב${venueHtml}` : 'המופע'}${when ? ` ב־${escText(when)}` : ''}, והכרטיסים כבר פתוחים להזמנה. לכל המועדים, המחירים והזמנת מקומות אפשר לעבור לעמוד המופע המלא: <a href="${esc(s._url)}"><strong>${escText(s.name)}</strong></a>.</p>
<p>${buy}</p>
<p class="news-related">עוד בקטגוריה: <a href="/">לוח ההופעות המלא</a> · <a href="/magazine/">כל כתבות המגזין</a></p>`;
    items.push({
      slug: capSlugBytes(slugify(s.name), 150),
      kicker,
      title,
      date: newsPubDay(s),
      description: `${kicker}: ${lede}`.slice(0, 155),
      image: s.image,
      bodyHtml,
    });
  }

  // כותרת מגמה: עונת 2027 מתמלאת
  const c2027 = shows.filter(s => (s.Seances || []).some(z => String(z.date).startsWith('2027'))).length;
  if (c2027 >= 3) {
    items.unshift({
      slug: 'לוח-2027-נפתח-למכירה',
      kicker: 'כותרת חמה',
      title: `לוח 2027 ממריא: ${c2027} מופעים כבר פתוחים להזמנה`,
      date: maxPub,
      description: `עונת התרבות של 2027 כבר כאן: ${c2027} מופעים ואירועים נפתחו להזמנה מוקדמת.`,
      image: (shows.find(s => (s.Seances || []).some(z => String(z.date).startsWith('2027')) && s.image) || {}).image || '',
      bodyHtml: `<p class="news-lede">עונת התרבות של 2027 כבר מתחילה להתמלא, ומעריצים שאוהבים לתכנן מראש כבר יכולים לתפוס מקום. ${c2027} מופעים ואירועים נפתחו להזמנה מוקדמת במערכת שלנו.</p>
<p>מבכורות בלט בינלאומיות ועד קונצרטי ענק, פסטיבלים והפקות מקור — ההיצע לשנה הבאה הולך וגדל מדי שבוע. ההיערכות המוקדמת משתלמת: המקומות הטובים והמחירים האטרקטיביים נתפסים ראשונים.</p>
<p>לסקירה המלאה קראו את <a href="/magazine/${encodeURI('הופעות-החובה-והאירועים-הגדולים-של-2027')}/">הופעות החובה של 2027</a> ואת <a href="/magazine/${encodeURI('הפסטיבלים-והאירועים-הגדולים-של-שנת-2027')}/">מדריך הפסטיבלים</a>, או עברו ישירות ללוח <a href="/הופעות-2027.html"><strong>הופעות 2027</strong></a>.</p>
<p class="news-related"><a href="/magazine/">כל כתבות המגזין</a></p>`,
    });
  }
  return items;
}

// תבנית עמוד חדשות ייעודית (News Layout) + סכמת NewsArticle
function newsArticlePage(a) {
  const canonical = `${BRAND.domain}${a.url}`;
  const crumb = breadcrumbSchema([
    { name: 'בית', url: BRAND.domain + '/' },
    { name: 'מגזין', url: BRAND.domain + '/magazine/' },
    { name: 'חדשות', url: BRAND.domain + '/magazine/news/' },
    { name: a.title, url: canonical },
  ]);
  const schema = {
    '@context': 'https://schema.org', '@type': 'NewsArticle',
    headline: a.title, description: a.description,
    datePublished: a.date, dateModified: a.date,
    image: a.image || undefined,
    author: { '@type': 'Organization', name: BRAND.nameHe, url: BRAND.domain },
    publisher: { '@type': 'Organization', name: BRAND.nameHe, url: BRAND.domain, logo: { '@type': 'ImageObject', url: BRAND.domain + '/assets/logo.svg' } },
    mainEntityOfPage: canonical,
  };
  const body = `
<article class="news-article">
  <div class="wrap news-wrap">
    <nav class="breadcrumb"><a href="/">בית</a> <span>›</span> <a href="/magazine/">מגזין</a> <span>›</span> <a href="/magazine/news/">חדשות</a> <span>›</span> <span class="current">${escText(a.title)}</span></nav>
    <span class="news-kicker">${escText(a.kicker || 'חדשות')}</span>
    <h1 class="news-headline">${escText(a.title)}</h1>
    <p class="news-dateline">עודכן ${formatDate(a.date)} · ${escText(BRAND.nameHe)}</p>
    ${a.image ? `<figure class="news-hero"><img src="${esc(a.image)}" alt="${esc(a.title)}"></figure>` : ''}
    <div class="news-body rte">${a.bodyHtml}</div>
    <p class="news-back"><a href="/magazine/news/">‹ לכל החדשות</a></p>
  </div>
</article>`;
  const html = page({
    title: `${a.title} | חדשות איידיר כרטיסים`,
    description: a.description,
    canonical,
    head: crumb + `\n<script type="application/ld+json">${JSON.stringify(schema)}</script>` + (a.image ? `\n<meta property="og:image" content="${esc(a.image)}">` : ''),
    body,
  });
  const dir = path.join(BRAND.outDir, 'magazine', 'news', a.slug);
  ensureDir(dir);
  fs.writeFileSync(path.join(dir, 'index.html'), html, 'utf8');
}

function buildNews(shows) {
  const items = newsItems(shows);
  const used = new Set();
  items.forEach(a => {
    let s = a.slug || 'news';
    if (used.has(s)) s += '-' + (used.size);
    used.add(s);
    a.slug = s;
    a.url = `/magazine/news/${s}/`;
  });
  items.forEach(newsArticlePage);

  const cardsHtml = items.map(a => `
    <article class="news-card">
      <a class="news-card-media" href="${esc(a.url)}">${a.image ? `<img loading="lazy" src="${esc(a.image)}" alt="${esc(a.title)}">` : ''}</a>
      <div class="news-card-body">
        <span class="news-card-kicker">${escText(a.kicker || 'חדשות')}</span>
        <h3 class="news-card-title"><a href="${esc(a.url)}">${escText(a.title)}</a></h3>
        <span class="news-card-date">${formatDate(a.date)}</span>
      </div>
    </article>`).join('\n');
  const idxBody = `
<article class="hub news-hub">
  <div class="wrap">
    <nav class="breadcrumb"><a href="/">בית</a> <span>›</span> <a href="/magazine/">מגזין</a> <span>›</span> <span class="current">חדשות</span></nav>
    <h1 class="hub-title">חדשות ועדכונים</h1>
    <p class="hub-intro">כל החדשות החמות מעולם ההופעות, ההצגות והתרבות בישראל: הכרזות על מופעים חדשים, פתיחת מכירות כרטיסים ועדכוני לוח. מתעדכן באופן שוטף.</p>
    <div class="news-grid">${cardsHtml || '<p>אין כרגע עדכונים חדשים. חזרו בקרוב.</p>'}</div>
  </div>
</article>`;
  const idxHtml = page({
    title: 'חדשות ועדכונים | איידיר כרטיסים',
    description: 'חדשות ועדכונים שוטפים מעולם ההופעות והתרבות בישראל: הכרזות מופעים, פתיחת מכירות כרטיסים ועדכוני לוח.',
    canonical: BRAND.domain + '/magazine/news/',
    head: breadcrumbSchema([{ name: 'בית', url: BRAND.domain + '/' }, { name: 'מגזין', url: BRAND.domain + '/magazine/' }, { name: 'חדשות', url: BRAND.domain + '/magazine/news/' }]),
    body: idxBody,
  });
  const nd = path.join(BRAND.outDir, 'magazine', 'news');
  ensureDir(nd);
  fs.writeFileSync(path.join(nd, 'index.html'), idxHtml, 'utf8');

  NEWS_ARTICLES = items;
  return items.length;
}

/* ------------------------------ דף הבית -------------------------------- */
function buildIndex(shows) {
  const sections = [...new Set(shows.map(s => s.section).filter(Boolean))];
  const cities = [...new Set(shows.flatMap(s => (s.Seances || []).map(z => z.city)).filter(Boolean))];

  const cards = shows.map(showCard).join('\n');

  const sectionChips = sections.map(s =>
    `<button class="chip" data-filter="section" data-value="${esc(s)}">${escText(s)}</button>`).join('');

  // ערים: כפתורים רק לערים המובילות (שקיימות בנתונים) + תפריט נפתח לכל השאר
  const TOP_CITIES = ['תל אביב-יפו', 'ירושלים', 'חיפה', 'באר שבע', 'ראשון לציון', 'הרצליה', 'אשדוד'];
  const citySet = new Set(cities);
  const topCities = TOP_CITIES.filter(c => citySet.has(c));
  const citiesSorted = [...cities].sort((a, b) => a.localeCompare(b, 'he'));
  const topCityChips = topCities.map(c =>
    `<button class="chip" data-filter="city" data-value="${esc(c)}">${escText(c)}</button>`).join('');
  const cityOptions = citiesSorted.map(c =>
    `<option value="${esc(c)}">${escText(c)}</option>`).join('');

  // אולמות: 8 האולמות הנפוצים ביותר (נגזר דינמית מהנתונים), עם תווית מקוצרת
  const hallCount = {};
  shows.forEach(s => [...new Set((s.Seances || []).map(z => z.hall).filter(Boolean))]
    .forEach(h => { hallCount[h] = (hallCount[h] || 0) + 1; }));
  const topVenues = Object.entries(hallCount).sort((a, b) => b[1] - a[1]).slice(0, 8).map(e => e[0]);
  const venueLabel = h => h.split(/\s[-–—]\s|,/)[0].trim();
  const venueChips = topVenues.map(h =>
    `<button class="chip" data-filter="venue" data-value="${esc(h)}" title="${esc(h)}">${escText(venueLabel(h))}</button>`).join('');
  // רשימת כל האולמות (ייחודית, ממוינת) לתפריט נפתח
  const allVenues = Object.keys(hallCount).sort((a, b) => a.localeCompare(b, 'he'));
  const venueOptions = allVenues.map(h =>
    `<option value="${esc(h)}">${escText(h)}</option>`).join('');

  const body = `
<section class="hero">
  <div class="wrap hero-inner">
    <p class="hero-eyebrow">${esc(BRAND.tagline)}</p>
    <h1 class="hero-title">כרטיסים להופעות והצגות היום, השבוע ולפי תאריך 2026</h1>
    <p class="hero-sub">מרכזים עבורכם את כל המופעים, ההצגות והקונצרטים המובילים בישראל. בחרו לפי תאריך, עיר או קטגוריה ורכשו כרטיסים מאובטחת בקלות ובמהירות.</p>
    <div class="search-box">
      <input id="q" type="search" placeholder="חיפוש מופע, אמן או קטגוריה…" autocomplete="off" aria-label="חיפוש מופע">
    </div>
  </div>
</section>

<main class="wrap main">
  <div class="filters">
    <div class="filter-row">
      <span class="filter-label">קטגוריות</span>
      <div class="chips">
        <button class="chip is-active" data-filter="section" data-value="">הכל</button>
        ${sectionChips}
      </div>
    </div>
    <div class="filter-row">
      <span class="filter-label">ערים</span>
      <div class="chips city-chips">
        <button class="chip is-active" data-filter="city" data-value="">הכל</button>
        ${topCityChips}
        <select id="city-select" class="city-select" aria-label="בחירת עיר מתוך כל הערים">
          <option value="">כל שאר הערים…</option>
          ${cityOptions}
        </select>
      </div>
    </div>
    <div class="filter-row">
      <span class="filter-label">מתי?</span>
      <div class="chips" id="date-chips">
        <button class="chip is-active" data-filter="date" data-value="all">הכל</button>
        <button class="chip" data-filter="date" data-value="today">היום</button>
        <button class="chip" data-filter="date" data-value="weekend">סוף השבוע הקרוב (חמישי עד שבת)</button>
        <button class="chip" data-filter="date" data-value="next-7">7 הימים הקרובים</button>
        <button class="chip" data-filter="date" data-value="this-month">החודש הקרוב</button>
      </div>
    </div>
    <div class="filter-row">
      <span class="filter-label">אולמות ותיאטרונים</span>
      <div class="chips venue-chips">
        <button class="chip is-active" data-filter="venue" data-value="">הכל</button>
        ${venueChips}
        <select id="venue-select" class="city-select venue-select" aria-label="בחירת אולם מתוך כל האולמות">
          <option value="">כל שאר האולמות…</option>
          ${venueOptions}
        </select>
      </div>
    </div>
  </div>

  <div class="results-head">
    <h2 class="section-title">מופעים קרובים</h2>
    <span id="count" class="results-count">${shows.length} מופעים</span>
  </div>

  <div id="grid" class="grid">
    ${cards}
  </div>
  <p id="empty" class="empty" hidden>לא נמצאו מופעים שתואמים לחיפוש.</p>
  <div id="load-more-wrap" class="load-more-wrap">
    <button id="load-more" class="btn btn-primary load-more-btn" type="button">טען מופעים נוספים</button>
  </div>
</main>

<script src="/assets/app.js" defer></script>`;

  const siteSchema = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebSite',
        '@id': BRAND.domain + '/#website',
        url: BRAND.domain + '/',
        name: BRAND.nameHe,
        description: 'פורטל המופעים, ההצגות והקונצרטים המובילים בישראל',
        inLanguage: 'he',
        potentialAction: {
          '@type': 'SearchAction',
          target: {
            '@type': 'EntryPoint',
            urlTemplate: BRAND.domain + '/?q={search_term_string}',
          },
          'query-input': 'required name=search_term_string',
        },
      },
      {
        '@type': 'Organization',
        '@id': BRAND.domain + '/#organization',
        name: BRAND.nameHe,
        url: BRAND.domain + '/',
        logo: BRAND.domain + '/assets/logo.svg',
      },
    ],
  };

  const html = page({
    title: `${BRAND.nameHe} | כרטיסים למופעים, הצגות וקונצרטים`,
    description: 'איידיר כרטיסים מרכזת עבורכם את המופעים, ההצגות והקונצרטים המובילים בישראל. חיפוש מהיר, מועדים מעודכנים ורכישת כרטיסים מאובטחת.',
    canonical: BRAND.domain + '/',
    head: `<script type="application/ld+json">${JSON.stringify(siteSchema)}</script>`,
    body,
  });

  fs.writeFileSync(path.join(BRAND.outDir, 'index.html'), html, 'utf8');
}

/* ----------------------------- דף מופע בודד ---------------------------- */
function seanceRow(show, s) {
  return `<tr>
    <td data-th="תאריך">${formatDate(s.date)}</td>
    <td data-th="שעה">${formatTime(s.time)}</td>
    <td data-th="עיר">${escText(s.city)}</td>
    <td data-th="אולם">${venueUrlByHall[s.hall] ? `<a href="${esc(venueUrlByHall[s.hall])}">${escText(s.hall)}</a>` : escText(s.hall)}</td>
    <td data-th="מחיר">${priceLabel(s.priceMin, s.priceMax)}</td>
    <td data-th="הזמנה">${seanceSoldOut(s) ? `<span class="soldout">אזלו הכרטיסים</span>` : `<a class="btn btn-primary btn-sm" href="${esc(affiliateUrl(s.link))}" target="_blank" rel="noopener sponsored">להזמנת כרטיסים</a>`}</td>
  </tr>`;
}

// תת־טיפוס Schema.org מדויק לפי קטגוריה
const EVENT_TYPES = {
  'הופעות': 'MusicEvent',
  'הופעות ג\'אז ובלוז': 'MusicEvent',
  'הופעות מוזיקה קלאסית': 'MusicEvent',
  'הופעות רוק': 'MusicEvent',
  'אופרה': 'MusicEvent',
  'קונצרטים לילדים': 'MusicEvent',
  'הצגות': 'TheaterEvent',
  'הצגות ילדים': 'TheaterEvent',
  'מחזמר': 'TheaterEvent',
  'סטנד אפ': 'ComedyEvent',
  'הופעות מחול ובלט': 'DanceEvent',
};
function eventType(section) { return EVENT_TYPES[section] || 'Event'; }

// אזור זמן ישראל לתאריך מסוים (חסין DST: חורף +02:00 / קיץ +03:00)
function israelOffset(dateStr) {
  try {
    const utc = new Date(`${dateStr}T12:00:00Z`);
    const s = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jerusalem', timeZoneName: 'longOffset' }).format(utc);
    const m = s.match(/GMT([+-]\d{1,2})(?::?(\d{2}))?/);
    if (!m) return '+02:00';
    const sign = m[1][0];
    const hh = String(Math.abs(parseInt(m[1], 10))).padStart(2, '0');
    const mm = m[2] || '00';
    return `${sign}${hh}:${mm}`;
  } catch (e) { return '+02:00'; }
}

// שעת סיום משוערת: 3 שעות אחרי ההתחלה, בפורמט ISO 8601 עם אזור זמן
function endDateTime(dateStr, timeStr) {
  const [y, mo, d] = String(dateStr).split('-').map(Number);
  const [hh, mm, ss] = String(timeStr || '20:00:00').split(':').map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d, hh, mm, ss || 0));
  dt.setUTCHours(dt.getUTCHours() + 3);
  const p = n => String(n).padStart(2, '0');
  const eyd = `${dt.getUTCFullYear()}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())}`;
  return `${eyd}T${p(dt.getUTCHours())}:${p(dt.getUTCMinutes())}:${p(dt.getUTCSeconds())}${israelOffset(eyd)}`;
}

function eventSchema(show) {
  const type = eventType(show.section);
  const events = (show.Seances || []).map(s => ({
    '@context': 'https://schema.org',
    '@type': type,
    name: show.name,
    url: `${BRAND.domain}${show._url}`,
    description: stripTags(show.description).slice(0, 300),
    image: show.image,
    startDate: `${s.date}T${(s.time || '20:00:00')}${israelOffset(s.date)}`,
    endDate: endDateTime(s.date, s.time),
    performer: { '@type': 'PerformingGroup', name: show.name },
    eventStatus: 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    location: {
      '@type': 'Place',
      name: s.hall,
      address: {
        '@type': 'PostalAddress',
        streetAddress: s.address || s.hall,
        addressLocality: s.city,
        addressCountry: 'IL',
      },
    },
    offers: {
      '@type': 'Offer',
      url: affiliateUrl(s.link),
      price: s.priceMin,
      priceCurrency: 'ILS',
      availability: seanceSoldOut(s) ? 'https://schema.org/SoldOut' : 'https://schema.org/InStock',
      validFrom: show.pubDate ? show.pubDate.replace(' ', 'T') : undefined,
    },
    organizer: { '@type': 'Organization', name: BRAND.nameHe, url: BRAND.domain },
  }));
  if (!events.length) return ''; // מופע ללא מועדים: אין Event תקין (חסר startDate)
  const payload = events.length === 1 ? events[0] : events;
  return `<script type="application/ld+json">${JSON.stringify(payload)}</script>`;
}

function buildShow(show) {
  const cities = [...new Set((show.Seances || []).map(s => s.city).filter(Boolean))];
  const rows = (show.Seances || []).map(s => seanceRow(show, s)).join('\n');
  const canonical = `${BRAND.domain}${show._url}`;
  const metaDesc = stripTags(show.description).slice(0, 155);
  const sold = showSoldOut(show);

  // פסקה פותחת עובדתית מותאמת AI Overviews (נשאבת דינמית מהפיד)
  const se0 = firstUpcomingSeance(show);
  const leadDate = (se0.date || show.dateFrom) ? formatDate(se0.date || show.dateFrom) : '';
  const leadTime = se0.time ? formatTime(se0.time) : '';
  const leadVenue = se0.hall ? escText(se0.hall) : '';
  const leadCity = se0.city ? escText(se0.city) : (cities[0] ? escText(cities[0]) : '');
  const leadPrice = Number(show.priceMin) ? `${Number(show.priceMin)} ₪` : '';
  const aiLede = sold
    ? `המופע ${escText(show.name)}${leadVenue ? ` מתקיים ב${leadVenue}` : ''}${leadCity ? `, ${leadCity}` : ''}. הכרטיסים למופע אזלו כרגע.`
    : `המופע ${escText(show.name)} יתקיים${leadDate ? ` בתאריך ${leadDate}` : ''}${leadTime ? ` בשעה ${leadTime}` : ''}${leadVenue ? ` ב${leadVenue}` : ''}${leadCity ? `, ${leadCity}` : ''}. כרטיסים זמינים להזמנה באתר${leadPrice ? ` החל ממחיר של ${leadPrice}` : ''}.`;

  const body = `
<nav class="breadcrumb wrap">
  <a href="/">בית</a> <span>›</span> <a href="/${categorySlug(show.section)}/">${escText(show.section)}</a> <span>›</span> <span class="current">${escText(show.name)}</span>
</nav>

<article class="show">
  <div class="show-hero">
    <div class="wrap show-hero-inner">
      <div class="show-cover">
        <img src="${esc(show.image)}" alt="${esc(show.name)}">
      </div>
      <div class="show-head">
        <span class="pill">${escText(show.section)}</span>
        <h1 class="show-title">${escText(show.name)}</h1>
        <p class="show-announce">${escText(show.announce || '')}</p>
        ${artistUrlByName[show.name] ? `<p class="show-artist-link"><a href="${esc(artistUrlByName[show.name])}">כל ההופעות של ${escText(show.name)} ›</a></p>` : ''}
        <div class="show-facts">
          <div class="fact"><span class="fact-k">מועדים</span><span class="fact-v">${formatDate(show.dateFrom)}</span></div>
          <div class="fact"><span class="fact-k">מיקום</span><span class="fact-v">${cities.length ? cities.map(c => cityUrlByCity[c] ? `<a href="${cityUrlByCity[c]}">${escText(c)}</a>` : escText(c)).join(' · ') : 'יפורסם'}</span></div>
          <div class="fact"><span class="fact-k">מחיר</span><span class="fact-v">${priceLabel(show.priceMin, show.priceMax)}</span></div>
        </div>
        ${sold ? `<span class="btn btn-soldout btn-lg">אזלו הכרטיסים</span>` : `<a class="btn btn-primary btn-lg" href="#seances">להזמנת כרטיסים</a>`}
      </div>
    </div>
  </div>

  <div class="wrap show-grid">
    <section class="show-desc">
      <p class="show-lead">${aiLede}</p>
      <h2>על המופע</h2>
      <div class="rte">${safeHtml(show.description)}</div>
    </section>

    <aside class="show-aside">
      <div class="aside-card">
        <span class="aside-price-k">מחיר כרטיס</span>
        <span class="aside-price-v${sold ? ' soldout' : ''}">${sold ? 'אזלו הכרטיסים' : priceLabel(show.priceMin, show.priceMax)}</span>
        ${sold ? `<span class="btn btn-soldout btn-block">אזלו הכרטיסים</span>` : `<a class="btn btn-primary btn-block" href="#seances">בחירת מועד</a>`}
        <p class="aside-note">${sold ? 'המופע אזל' : 'רכישת כרטיסים'}</p>
        <p class="faq-hint">שאלות על ביטולים או קבלת כרטיסים? <a href="/magazine/${encodeURI('שאלות-נפוצות-רכישת-כרטיסים')}/">מדריך השאלות הנפוצות ›</a></p>
      </div>
    </aside>
  </div>
${enrichmentSection(show)}
  <section id="seances" class="wrap seances">
    <h2>מועדים וכרטיסים</h2>
    <div class="table-wrap">
      <table class="seance-table">
        <thead>
          <tr><th>תאריך</th><th>שעה</th><th>עיר</th><th>אולם</th><th>מחיר</th><th></th></tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>
    <p class="faq-hint faq-hint-center">שאלות על ביטולים או קבלת כרטיסים? <a href="/magazine/${encodeURI('שאלות-נפוצות-רכישת-כרטיסים')}/">קראו במדריך השאלות הנפוצות ›</a></p>
  </section>
  ${sold ? '' : `<div class="mobile-cta"><a class="mobile-cta-btn" href="#seances">הזמן כרטיסים עכשיו ›</a></div>`}
</article>`;

  const html = page({
    title: `${show.name} | כרטיסים להופעות 2026`,
    description: metaDesc,
    canonical,
    head: eventSchema(show) +
      `\n<meta property="og:image" content="${esc(show.image)}">`,
    body,
  });

  const dir = path.join(BRAND.outDir, ...show._dir.split('/'));
  ensureDir(dir);
  fs.writeFileSync(path.join(dir, 'index.html'), html, 'utf8');
}

/* --------------------------- אינדקס חיפוש ------------------------------ */
function buildSearchIndex(shows) {
  const index = shows.map(s => {
    const cities = [...new Set((s.Seances || []).map(z => z.city).filter(Boolean))];
    return {
      id: s.id,
      name: s.name,
      section: s.section,
      image: s.image,
      priceMin: s.priceMin,
      priceMax: s.priceMax,
      dateFrom: s.dateFrom,
      dateTo: s.dateTo,
      dates: [...new Set((s.Seances || []).map(z => z.date).filter(Boolean))],
      cities,
      url: s._url,
      announce: stripTags(s.announce || s.description).slice(0, 120),
    };
  });
  ensureDir(path.join(BRAND.outDir, 'data'));
  fs.writeFileSync(path.join(BRAND.outDir, 'data', 'search-index.json'),
    JSON.stringify(index, null, 2), 'utf8');
}

/* --------------------------- מפת אתר ורובוטס --------------------------- */
function buildSitemap(shows) {
  const today = new Date().toISOString().slice(0, 10);
  const urls = [
    { loc: BRAND.domain + '/', pri: '1.0' },
    ...HUB_PAGES.map(p => ({ loc: `${BRAND.domain}/${p.slug}.html`, pri: '0.9' })),
    ...CITY_PAGES.map(p => ({ loc: `${BRAND.domain}/${p.slug}/`, pri: '0.9' })),
    ...GENRE_PAGES.map(p => ({ loc: `${BRAND.domain}${p.url}`, pri: '0.8' })),
    { loc: `${BRAND.domain}/רשימת-אמנים/`, pri: '0.7' },
    ...ARTIST_REGISTRY.map(a => ({ loc: `${BRAND.domain}${encodeURI(a.url)}`, pri: '0.7' })),
    ...VENUE_REGISTRY.map(v => ({ loc: `${BRAND.domain}${encodeURI(v.url)}`, pri: '0.7' })),
    { loc: `${BRAND.domain}/magazine/`, pri: '0.7' },
    ...MAGAZINE_ARTICLES.map(a => ({ loc: `${BRAND.domain}${encodeURI(a.url)}`, pri: '0.6' })),
    ...LANDING_PAGES.map(a => ({ loc: `${BRAND.domain}${encodeURI(a.url)}`, pri: '0.8' })),
    { loc: `${BRAND.domain}/magazine/news/`, pri: '0.7' },
    ...NEWS_ARTICLES.map(a => ({ loc: `${BRAND.domain}${encodeURI(a.url)}`, pri: '0.6' })),
    ...shows.map(s => ({ loc: `${BRAND.domain}${encodeURI(s._url)}`, pri: '0.8' })),
    ...STATIC_SLUGS.map(slug => ({ loc: `${BRAND.domain}/${slug}.html`, pri: '0.4' })),
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url>
    <loc>${u.loc}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>daily</changefreq>
    <priority>${u.pri}</priority>
  </url>`).join('\n')}
</urlset>`;
  fs.writeFileSync(path.join(BRAND.outDir, 'sitemap.xml'), xml, 'utf8');

  const robots = `User-agent: *
Allow: /

Sitemap: ${BRAND.domain}/sitemap.xml
`;
  fs.writeFileSync(path.join(BRAND.outDir, 'robots.txt'), robots, 'utf8');
}

/* ------------------------------ ads.txt (AdSense) --------------------- */
function buildAdsTxt() {
  fs.writeFileSync(path.join(BRAND.outDir, 'ads.txt'), BRAND.adsTxt + '\n', 'utf8');
}

/* --- הפניות 301 מהמבנה הישן למבנה ההיררכי החדש ---
   Cloudflare מסיר .html ב-308 לפני _redirects, לכן המקור הוא הצורה הנקייה /shows/[id]. --- */
function buildRedirects(shows) {
  const lines = [];
  for (const s of shows) {
    const dest = encodeURI(s._url);
    lines.push(`/shows/${s.id} ${dest} 301`);        // הצורה הנקייה
    lines.push(`/shows/${s.id}.html ${dest} 301`);   // הצורה עם .html
  }
  // הפניות 301 מכתבות מגזין שהסלאג שלהן שונה (מאנגלית לעברית)
  for (const m of MAGAZINE_REDIRECTS) {
    const dest = `/magazine/${encodeURI(m.to)}/`;
    lines.push(`/magazine/${m.from} ${dest} 301`);
    lines.push(`/magazine/${m.from}/ ${dest} 301`);
  }
  fs.writeFileSync(path.join(BRAND.outDir, '_redirects'), lines.join('\n') + '\n', 'utf8');
}

/* ------------------------------ נכסים (CSS/JS) ------------------------- */
function buildAssets() {
  const outAssets = path.join(BRAND.outDir, 'assets');
  ensureDir(outAssets);
  fs.writeFileSync(path.join(outAssets, 'styles.css'), STYLES, 'utf8');
  fs.writeFileSync(path.join(outAssets, 'app.js'), APP_JS, 'utf8');
  fs.writeFileSync(path.join(outAssets, 'accessibility.js'), A11Y_JS, 'utf8');
  // העתקת קבצים סטטיים מתיקיית המקור assets/ (לוגו וכו')
  const srcAssets = path.join(__dirname, 'assets');
  if (fs.existsSync(srcAssets)) {
    for (const f of fs.readdirSync(srcAssets)) {
      fs.copyFileSync(path.join(srcAssets, f), path.join(outAssets, f));
    }
  }
}

const STYLES = `:root{
  --bg:#f7f4f0; --card:#ffffff; --ink:#181320; --muted:#7a7385;
  --line:#ece7e1; --plum:#6d1f4b; --plum-d:#57173b; --gold:#bf9b48; --gold-d:#a07f2e;
  --accent:linear-gradient(135deg,#6d1f4b 0%,#a63a63 55%,#bf9b48 130%);
  --shadow:0 10px 30px rgba(24,19,32,.08); --shadow-sm:0 4px 14px rgba(24,19,32,.06);
  --radius:18px; --wrap:1160px;
}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--ink);
  font-family:'Heebo','Assistant',system-ui,'Segoe UI',Arial,sans-serif;
  font-size:16px;line-height:1.6;-webkit-font-smoothing:antialiased}
a{color:inherit;text-decoration:none}
img{max-width:100%;display:block}
.wrap{max-width:var(--wrap);margin-inline:auto;padding-inline:20px;width:100%}

/* header */
.site-header{position:sticky;top:0;z-index:50;background:rgba(247,244,240,.85);
  backdrop-filter:saturate(140%) blur(10px);border-bottom:1px solid var(--line)}
.header-inner{display:flex;align-items:center;justify-content:space-between;height:68px}
.brand{display:flex;align-items:center;gap:10px}
.site-logo{height:40px;width:auto;max-width:100%;display:block}
@media(max-width:560px){.site-logo{height:34px}}
.top-nav{display:flex;gap:20px;align-items:center}
.top-nav a{color:var(--muted);font-weight:600}
.top-nav a:hover{color:var(--plum)}

/* buttons */
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;
  border:0;cursor:pointer;font-family:inherit;font-weight:700;border-radius:12px;
  padding:12px 20px;font-size:15px;transition:transform .12s ease,box-shadow .2s ease;white-space:nowrap}
.btn-primary{background:var(--accent);color:#fff;box-shadow:0 8px 20px rgba(109,31,75,.28)}
.btn-primary:hover{transform:translateY(-2px);box-shadow:0 12px 26px rgba(109,31,75,.35)}
.btn-sm{padding:9px 14px;font-size:14px;border-radius:10px}
.btn-lg{padding:15px 30px;font-size:17px}
.btn-block{width:100%}

/* hero */
.hero{background:
  radial-gradient(1200px 400px at 90% -10%,rgba(191,155,72,.16),transparent 60%),
  radial-gradient(900px 380px at 0% 0%,rgba(109,31,75,.14),transparent 55%);
  border-bottom:1px solid var(--line)}
.hero-inner{padding:64px 20px 54px;text-align:center}
.hero-eyebrow{color:var(--gold-d);font-weight:700;letter-spacing:.5px;margin:0 0 10px;text-transform:uppercase;font-size:13px}
.hero-title{font-size:clamp(28px,5vw,46px);line-height:1.15;margin:0 0 14px;font-weight:800}
.hero-sub{color:var(--muted);max-width:620px;margin:0 auto 26px;font-size:18px}
.search-box{max-width:560px;margin-inline:auto}
.search-box input{width:100%;padding:16px 20px;border-radius:16px;border:1px solid var(--line);
  background:var(--card);font-family:inherit;font-size:17px;box-shadow:var(--shadow-sm);outline:none}
.search-box input:focus{border-color:var(--plum);box-shadow:0 0 0 4px rgba(109,31,75,.12)}

/* filters */
.main{padding-block:34px 60px}
.filters{display:flex;flex-direction:column;gap:14px;margin-bottom:26px}
.filter-row{display:flex;align-items:center;gap:14px;flex-wrap:wrap}
.filter-label{font-weight:700;color:var(--muted);min-width:70px;font-size:14px}
.chips{display:flex;gap:9px;flex-wrap:wrap}
.chip{border:1px solid var(--line);background:var(--card);color:var(--ink);
  padding:8px 15px;border-radius:999px;cursor:pointer;font-family:inherit;font-weight:600;
  font-size:14px;transition:all .15s ease}
.chip:hover{border-color:var(--plum);color:var(--plum)}
.chip.is-active{background:var(--plum);border-color:var(--plum);color:#fff}
.venue-chips .chip{max-width:210px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

.results-head{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:18px;gap:12px;flex-wrap:wrap}
.section-title{font-size:24px;margin:0;font-weight:800}
.results-count{color:var(--muted);font-weight:600}

/* grid + cards */
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:24px}
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);
  overflow:hidden;display:flex;flex-direction:column;box-shadow:var(--shadow-sm);
  transition:transform .15s ease,box-shadow .2s ease}
.card:hover{transform:translateY(-4px);box-shadow:var(--shadow)}
.card-media{position:relative;aspect-ratio:16/10;overflow:hidden;background:#efe9e2}
.card-media img{width:100%;height:100%;object-fit:cover;transition:transform .4s ease}
.card:hover .card-media img{transform:scale(1.05)}
.card-badge{position:absolute;top:12px;inset-inline-start:12px;background:rgba(24,19,32,.72);
  color:#fff;padding:5px 12px;border-radius:999px;font-size:12px;font-weight:600;backdrop-filter:blur(4px)}
.card-body{padding:16px 18px 18px;display:flex;flex-direction:column;gap:9px;flex:1}
.card-title{font-size:18px;margin:0;line-height:1.3;font-weight:700}
.card-title a:hover{color:var(--plum)}
.card-meta{display:flex;flex-wrap:wrap;gap:6px 14px;color:var(--muted);font-size:13.5px;margin:0}
.card-meta .ico-cal::before{content:"📅 "}
.card-meta .ico-pin::before{content:"📍 "}
.card-announce{color:var(--muted);font-size:14px;margin:0;
  display:-webkit-box;-webkit-line-clamp:2;line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.card-foot{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:auto;padding-top:4px}
.card-price{font-weight:800;color:var(--plum);font-size:16px}
.soldout{color:#c0392b;font-weight:800}
.btn-soldout{background:#ece5dd;color:#8a7f72;box-shadow:none}
.btn-soldout:hover{transform:none;box-shadow:none}
span.btn-soldout{cursor:default}
.aside-price-v.soldout{color:#c0392b}
.empty{text-align:center;color:var(--muted);padding:40px;font-size:18px}

/* city select + load more */
.city-select{border:1px solid var(--line);background:var(--card);color:var(--ink);
  padding:8px 15px;border-radius:999px;cursor:pointer;font-family:inherit;font-weight:600;
  font-size:14px;transition:all .15s ease;max-width:210px;
  appearance:none;-webkit-appearance:none;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236d1f4b' stroke-width='3'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");
  background-repeat:no-repeat;background-position:left 12px center;padding-inline-start:30px}
.city-select:hover{border-color:var(--plum);color:var(--plum)}
.city-select:focus-visible{outline:2px solid var(--plum);outline-offset:1px}
.load-more-wrap{display:flex;justify-content:center;margin-top:34px}
.load-more-wrap[hidden]{display:none}
.load-more-btn{padding:14px 40px;font-size:16px}

/* breadcrumb */
.breadcrumb{padding-block:18px 4px;color:var(--muted);font-size:14px;display:flex;gap:8px;flex-wrap:wrap}
.breadcrumb a:hover{color:var(--plum)}
.breadcrumb .current{color:var(--ink);font-weight:600}

/* show page */
.show-hero{padding-block:20px 28px}
.show-hero-inner{display:grid;grid-template-columns:minmax(0,420px) 1fr;gap:34px;align-items:start}
.show-cover{border-radius:var(--radius);overflow:hidden;box-shadow:var(--shadow);background:#efe9e2;aspect-ratio:16/10}
.show-cover img{width:100%;height:100%;object-fit:cover}
.pill{display:inline-block;background:rgba(109,31,75,.1);color:var(--plum);font-weight:700;
  padding:6px 14px;border-radius:999px;font-size:13px;margin-bottom:12px}
.show-title{font-size:clamp(24px,4vw,36px);margin:0 0 10px;line-height:1.2;font-weight:800}
.show-lead{font-size:17px;line-height:1.7;font-weight:600;color:var(--ink);background:var(--bg);border-radius:10px;padding:14px 16px;margin:0 0 18px;border-inline-start:3px solid var(--plum)}
/* Mobile sticky CTA — יחידה מבודדת, ניתנת להסרה בקלות (מחק את הבלוק ואת רכיב .mobile-cta בתבנית) */
.mobile-cta{display:none}
@media(max-width:767px){
  .mobile-cta{display:block;position:fixed;inset-inline:0;bottom:0;z-index:80;background:#fff;box-shadow:0 -2px 16px rgba(0,0,0,.14);padding:10px 14px calc(10px + env(safe-area-inset-bottom))}
  .mobile-cta-btn{display:block;text-align:center;background:#16a34a;color:#fff;font-weight:800;font-size:17px;padding:15px;border-radius:12px;text-decoration:none;box-shadow:0 2px 8px rgba(22,163,74,.35)}
  .mobile-cta-btn:active{background:#12833c}
  body:has(.mobile-cta){padding-bottom:84px}
}
.show-announce{color:var(--muted);font-size:18px;margin:0 0 12px}
.show-artist-link{margin:0 0 18px}
.show-artist-link a{color:var(--plum);font-weight:700;font-size:15px}
.show-artist-link a:hover{text-decoration:underline}
.show-facts{display:flex;gap:26px;flex-wrap:wrap;margin-bottom:22px}
.fact{display:flex;flex-direction:column;gap:2px}
.fact-k{color:var(--muted);font-size:13px;font-weight:600}
.fact-v{font-weight:700;font-size:15px}

.show-grid{display:grid;grid-template-columns:1fr 320px;gap:34px;padding-block:20px 10px;align-items:start}
.show-desc h2,.seances h2{font-size:22px;font-weight:800;margin:0 0 14px}
.show-enrichment{padding-block:8px 8px;max-width:820px}
.show-enrichment h2{font-size:22px;font-weight:800;margin:0 0 14px}
.show-enrichment-lead{font-size:17px;line-height:1.8;color:var(--ink);margin:0 0 18px}
.rte{color:#312a3a;font-size:16.5px;line-height:1.85}
.rte strong{color:var(--ink)}
.show-aside{position:sticky;top:88px}
.aside-card{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);
  padding:22px;box-shadow:var(--shadow-sm);display:flex;flex-direction:column;gap:10px;text-align:center}
.aside-price-k{color:var(--muted);font-size:13px;font-weight:600}
.aside-price-v{font-size:26px;font-weight:800;color:var(--plum)}
.aside-note{color:var(--muted);font-size:12.5px;margin:4px 0 0}

/* seance table */
.seances{padding-block:26px 60px}
.table-wrap{overflow-x:auto;border:1px solid var(--line);border-radius:var(--radius);background:var(--card);box-shadow:var(--shadow-sm)}
.seance-table{width:100%;border-collapse:collapse;min-width:640px}
.seance-table th,.seance-table td{padding:15px 16px;text-align:start;border-bottom:1px solid var(--line);font-size:15px}
.seance-table thead th{background:#faf7f3;font-weight:700;color:var(--muted);font-size:13.5px}
.seance-table tbody tr:last-child td{border-bottom:0}
.seance-table tbody tr:hover{background:#fbf8f4}

/* footer */
.site-footer{background:#211a2b;color:#cfc7d6;padding-block:50px 22px;margin-top:24px}
.footer-grid{display:grid;grid-template-columns:1.7fr 1fr 1fr 1fr;gap:36px}
.footer-col{min-width:0}
.foot-brand{font-weight:800;color:#fff;font-size:19px;margin-bottom:12px}
.foot-desc{max-width:360px;margin:0;font-size:14px;line-height:1.85;color:#a99fb4}
.footer-title{color:#fff;font-size:15px;font-weight:700;margin:0 0 15px;padding-bottom:9px;
  border-bottom:1px solid rgba(255,255,255,.12)}
.footer-links{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px}
.footer-links a,.footer-links span{color:#b4aabf;font-size:14px;transition:color .15s ease}
.footer-links a:hover{color:var(--gold)}
.footer-links span{cursor:default}
.footer-bottom{display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;
  margin-top:36px;padding-top:20px;border-top:1px solid rgba(255,255,255,.1)}
.foot-copy,.foot-disclaimer{font-size:13px;color:#8b8199}
.footer-legal-links{font-size:13px;color:#8b8199;display:flex;gap:6px;flex-wrap:wrap;align-items:center;justify-content:center}
.footer-legal-links a{color:#cfc7d6;font-weight:600}
.footer-legal-links a:hover{color:var(--gold)}

/* footer timing links row */
.footer-timing{display:flex;flex-wrap:wrap;align-items:center;gap:8px 16px;
  margin-top:30px;padding-top:20px;border-top:1px solid rgba(255,255,255,.1)}
.footer-timing-label{color:#8b8199;font-weight:700;font-size:13px}
.footer-timing a{color:#cfc7d6;font-size:14px;font-weight:600}
.footer-timing a:hover{color:var(--gold)}

/* hub (timing) landing pages */
.hub{padding-block:6px 50px}
.hub .breadcrumb{padding-block:18px 2px}
.hub-title{font-size:clamp(26px,4vw,38px);font-weight:800;margin:8px 0 10px;line-height:1.2}
.hub-intro{color:var(--muted);font-size:17px;max-width:760px;margin:0 0 22px;line-height:1.7}
.hub .results-head{margin-bottom:18px}
.hub-empty{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);
  padding:28px;box-shadow:var(--shadow-sm);text-align:center;color:var(--muted)}
.hub-empty p{margin:0 0 16px;font-size:17px}
.hub-empty-links{list-style:none;margin:0;padding:0;display:flex;gap:10px 18px;flex-wrap:wrap;justify-content:center}
.hub-empty-links a{color:var(--plum);font-weight:700;text-decoration:underline}
.artist-list-section{margin-top:40px;border-top:1px solid var(--line);padding-top:26px}
.artist-list-section h2{font-size:20px;font-weight:800;margin:0 0 16px}
.artist-list{list-style:none;margin:0;padding:0;columns:3;column-gap:28px}
.artist-list li{margin:0 0 9px;break-inside:avoid}
.artist-list a{color:var(--ink);font-size:14.5px}
.artist-list a:hover{color:var(--plum);text-decoration:underline}
@media(max-width:780px){.artist-list{columns:2}}
@media(max-width:480px){.artist-list{columns:1}}

/* static / legal pages */
.static{padding-block:6px 46px}
.static-inner{max-width:820px}
.static .breadcrumb{padding-block:18px 2px}
.static-title{font-size:clamp(26px,4vw,38px);font-weight:800;margin:8px 0 16px;line-height:1.2}
.static-updated{color:var(--muted);font-size:14px;margin:0 0 22px}
.static-body h2{font-size:20px;font-weight:800;margin:26px 0 10px}
.static-body p{margin:0 0 14px}
.static-body a{color:var(--plum);text-decoration:underline}

/* ===== magazine (editorial layout) ===== */
.mag-index{padding-block:6px 50px}
.mag-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:26px;margin-top:8px}
.mag-card{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);overflow:hidden;
  display:flex;flex-direction:column;box-shadow:var(--shadow-sm);transition:transform .15s ease,box-shadow .2s ease}
.mag-card:hover{transform:translateY(-4px);box-shadow:var(--shadow)}
.mag-card-media{display:block;aspect-ratio:16/9;overflow:hidden;background:#efe9e2}
.mag-card-media img{width:100%;height:100%;object-fit:cover}
.mag-card-body{padding:16px 18px 18px;display:flex;flex-direction:column;gap:8px;flex:1}
.mag-card-date{color:var(--gold-d);font-size:12.5px;font-weight:700;text-transform:uppercase;letter-spacing:.4px}
.mag-card-title{font-size:19px;margin:0;line-height:1.3;font-weight:800}
.mag-card-title a:hover{color:var(--plum)}
.mag-card-desc{color:var(--muted);font-size:14px;margin:0;flex:1;
  display:-webkit-box;-webkit-line-clamp:3;line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.mag-card-link{color:var(--plum);font-weight:700;font-size:14px;margin-top:2px}
.mag-subnav{margin:-6px 0 22px}
.mag-subnav-link{display:inline-block;background:var(--plum);color:#fff;font-weight:700;font-size:15px;padding:9px 18px;border-radius:999px;text-decoration:none;box-shadow:var(--shadow-sm)}
.mag-subnav-link:hover{background:var(--plum-d)}
.mag-section-title{font-size:22px;font-weight:800;margin:26px 0 16px}
.mag-index .mag-section-title:first-of-type{margin-top:8px}
.landing-page{padding-block:6px 50px}
.landing-count{color:var(--muted);font-size:15px;margin:4px 0 18px}
.landing-empty{background:var(--bg);border-right:3px solid var(--gold);border-radius:6px;padding:10px 14px;color:var(--muted);font-style:italic;font-size:14px;margin:0 0 18px}
.landing-related{margin-top:26px;padding-top:16px;border-top:1px solid var(--line);color:var(--muted);font-size:14px}

/* News Layout — מדור חדשות */
.news-hub{padding-block:6px 50px}
.news-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:22px;margin-top:10px}
.news-card{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);overflow:hidden;display:flex;flex-direction:column;box-shadow:var(--shadow-sm);transition:transform .15s ease,box-shadow .2s ease}
.news-card:hover{transform:translateY(-4px);box-shadow:var(--shadow)}
.news-card-media{display:block;aspect-ratio:16/9;overflow:hidden;background:#efe9e2}
.news-card-media img{width:100%;height:100%;object-fit:cover}
.news-card-body{padding:14px 16px 16px;display:flex;flex-direction:column;gap:7px;flex:1}
.news-card-kicker{color:var(--gold-d);font-size:11.5px;font-weight:800;letter-spacing:.5px}
.news-card-title{font-size:17px;line-height:1.35;margin:0;flex:1}
.news-card-title a{color:var(--ink);text-decoration:none}
.news-card-title a:hover{color:var(--plum)}
.news-card-date{color:var(--muted);font-size:12.5px;font-weight:600}
.news-article{padding-block:6px 56px}
.news-wrap{max-width:720px}
.news-article .breadcrumb{padding-block:18px 2px}
.news-kicker{display:inline-block;background:var(--gold);color:#fff;font-size:12.5px;font-weight:800;letter-spacing:.5px;padding:4px 12px;border-radius:999px;margin-bottom:8px}
.news-headline{font-size:clamp(26px,4.5vw,38px);font-weight:800;line-height:1.22;margin:6px 0 8px}
.news-dateline{color:var(--muted);font-size:14px;font-weight:600;margin:0 0 18px}
.news-hero{margin:0 0 22px;border-radius:var(--radius);overflow:hidden}
.news-hero img{width:100%;height:auto;display:block}
.news-lede{font-size:19px;line-height:1.6;font-weight:600;color:var(--ink)}
.news-body.rte p{margin:0 0 14px;line-height:1.75}
.news-cta{display:inline-block;background:var(--plum);color:#fff;font-weight:800;padding:11px 22px;border-radius:999px;text-decoration:none;box-shadow:var(--shadow-sm)}
.news-cta:hover{background:var(--plum-d)}
.news-related{font-size:14px;color:var(--muted);border-top:1px solid var(--line);padding-top:14px;margin-top:20px}
.news-back{margin-top:22px}
.news-back a{color:var(--plum);font-weight:700;text-decoration:none}

.mag-article{padding-block:6px 56px}
.mag-wrap{max-width:760px}
.mag-article .breadcrumb{padding-block:18px 2px}
.mag-title{font-size:clamp(28px,5vw,42px);font-weight:800;line-height:1.2;margin:8px 0 10px}
.mag-byline{color:var(--muted);font-size:14.5px;margin:0 0 22px}
.mag-hero{margin:0 0 26px;border-radius:var(--radius);overflow:hidden;box-shadow:var(--shadow)}
.mag-hero img{width:100%;height:auto;display:block}
.mag-body{font-size:18px;line-height:1.9;color:#2c2536}
.mag-body h2{font-size:24px;font-weight:800;margin:32px 0 12px;color:var(--ink);line-height:1.25}
.mag-body h3{font-size:20px;font-weight:700;margin:24px 0 10px}
.mag-body p{margin:0 0 18px}
.mag-body a{color:var(--plum);text-decoration:underline}
.mag-body ul{margin:0 0 18px;padding-inline-start:22px;display:flex;flex-direction:column;gap:10px}
.mag-body blockquote{margin:0 0 18px;padding:12px 18px;border-inline-start:4px solid var(--gold);
  background:#faf7f3;border-radius:0 10px 10px 0;color:#4a4356}
.mag-body figure{margin:0 0 22px}
.mag-body figure img{width:100%;border-radius:var(--radius)}
.mag-picks li{line-height:1.7;margin-bottom:4px}
.mag-sect{color:var(--gold-d);font-weight:700;font-size:13px}
.mag-buy{white-space:nowrap;font-weight:700}
.faq-item{border:1px solid var(--line);border-radius:12px;background:var(--card);margin:0 0 12px;overflow:hidden;box-shadow:var(--shadow-sm)}
.faq-item summary{cursor:pointer;list-style:none;padding:16px 20px;font-weight:700;font-size:17px;color:var(--ink);position:relative;padding-inline-start:46px}
.faq-item summary::-webkit-details-marker{display:none}
.faq-item summary::before{content:"+";position:absolute;inset-inline-start:18px;top:50%;transform:translateY(-50%);width:22px;height:22px;line-height:22px;text-align:center;background:var(--plum);color:#fff;border-radius:50%;font-weight:800;font-size:16px}
.faq-item[open] summary::before{content:"–"}
.faq-item[open] summary{color:var(--plum)}
.faq-answer{padding:0 20px 18px 20px;line-height:1.75;color:var(--ink)}
.faq-answer a{color:var(--plum);font-weight:700}
.faq-foot{margin-top:22px;padding-top:16px;border-top:1px solid var(--line);color:var(--muted);font-size:15px}
.faq-hint{font-size:13px;color:var(--muted);margin:10px 0 0;line-height:1.5;opacity:.85}
.faq-hint a{color:var(--muted);text-decoration:underline;font-weight:600}
.faq-hint a:hover{color:var(--plum);opacity:1}
.faq-hint-center{text-align:center;margin-top:18px}
.mag-note{display:block;margin-top:10px;padding:10px 14px;background:var(--bg);border-right:3px solid var(--gold);border-radius:6px;color:var(--muted);font-style:italic;font-size:14px}
.mag-back{margin-top:30px;padding-top:20px;border-top:1px solid var(--line)}
.mag-back a{color:var(--plum);font-weight:700}
@media(max-width:860px){
  .footer-grid{grid-template-columns:1fr 1fr;gap:30px}
  .foot-desc{max-width:none}
}
@media(max-width:560px){
  .footer-grid{grid-template-columns:1fr;gap:26px}
  .footer-bottom{flex-direction:column;align-items:flex-start;gap:8px}
}

/* responsive */
@media(max-width:860px){
  .show-hero-inner{grid-template-columns:1fr}
  .show-grid{grid-template-columns:1fr}
  .show-aside{position:static}
  .seance-table{min-width:0}
  .seance-table thead{display:none}
  .seance-table,.seance-table tbody,.seance-table tr,.seance-table td{display:block;width:100%}
  .seance-table tr{border-bottom:1px solid var(--line);padding:8px 0}
  .seance-table td{border:0;padding:7px 16px;display:flex;justify-content:space-between;gap:12px;align-items:center}
  .seance-table td::before{content:attr(data-th);color:var(--muted);font-weight:700;font-size:13px}
  .seance-table td:last-child{justify-content:flex-start}
  .seance-table td:last-child .btn{width:100%}
}
@media(max-width:560px){
  .hero-inner{padding:44px 20px 38px}
  .grid{grid-template-columns:1fr;gap:18px}
  .header-inner{height:60px}
}

/* ===== accessibility widget ===== */
.a11y-widget{position:fixed;bottom:20px;left:20px;z-index:1000;font-family:'Heebo','Assistant',Arial,sans-serif}
.a11y-btn{width:54px;height:54px;border-radius:50%;border:0;cursor:pointer;background:var(--plum);color:#fff;
  display:flex;align-items:center;justify-content:center;box-shadow:0 6px 20px rgba(0,0,0,.28);transition:transform .15s ease}
.a11y-btn:hover{transform:scale(1.07)}
.a11y-btn:focus-visible{outline:3px solid var(--gold);outline-offset:2px}
.a11y-menu{position:absolute;bottom:66px;left:0;width:280px;max-width:calc(100vw - 40px);background:#fff;color:#181320;
  border-radius:16px;box-shadow:0 18px 44px rgba(0,0,0,.3);border:1px solid #e5e0da;overflow:hidden}
.a11y-menu[hidden]{display:none}
.a11y-header{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;background:var(--plum);color:#fff}
.a11y-header h3{margin:0;font-size:16px;font-weight:700}
.a11y-close-btn{background:transparent;border:0;color:#fff;font-size:26px;line-height:1;cursor:pointer;padding:0 4px}
.a11y-close-btn:focus-visible{outline:2px solid var(--gold);outline-offset:2px;border-radius:4px}
.a11y-tools{padding:12px;display:flex;flex-direction:column;gap:8px}
.a11y-tool{text-align:start;padding:11px 14px;border:1px solid #e5e0da;background:#faf7f3;border-radius:10px;
  font-family:inherit;font-size:14.5px;font-weight:600;color:#181320;cursor:pointer;transition:all .12s ease}
.a11y-tool:hover{border-color:var(--plum);background:#fff}
.a11y-tool:focus-visible{outline:2px solid var(--plum);outline-offset:1px}
.a11y-tool[aria-pressed="true"]{background:var(--plum);border-color:var(--plum);color:#fff}
.a11y-reset{background:#fff;border-color:#d9b3c2;color:var(--plum)}
.a11y-reset:hover{background:#fbf1f5;border-color:var(--plum)}
.a11y-footer{padding:10px 16px 14px;border-top:1px solid #eee;color:#7a7385;text-align:center;font-size:12px}

/* ===== accessibility states (applied on <html>) ===== */
html.a11y-underline a{text-decoration:underline !important}
html.a11y-readable, html.a11y-readable body, html.a11y-readable :not(.a11y-btn):not(.a11y-btn *){
  font-family:'Assistant',Arial,sans-serif !important}
html.a11y-readable p,html.a11y-readable li,html.a11y-readable .rte{line-height:1.95 !important;letter-spacing:.02em}
html.a11y-invert{filter:invert(1) hue-rotate(180deg)}
html.a11y-invert img{filter:invert(1) hue-rotate(180deg)}
html.a11y-contrast-high,html.a11y-contrast-high body{background:#000 !important}
html.a11y-contrast-high .card,html.a11y-contrast-high .aside-card,html.a11y-contrast-high .table-wrap,
html.a11y-contrast-high .search-box input,html.a11y-contrast-high .chip,html.a11y-contrast-high .seance-table thead th{
  background:#000 !important;border-color:#fff !important}
html.a11y-contrast-high h1,html.a11y-contrast-high h2,html.a11y-contrast-high h3,html.a11y-contrast-high p,
html.a11y-contrast-high span,html.a11y-contrast-high li,html.a11y-contrast-high td,html.a11y-contrast-high th,
html.a11y-contrast-high .card-title,html.a11y-contrast-high .hero-title,html.a11y-contrast-high label{color:#fff !important}
html.a11y-contrast-high a,html.a11y-contrast-high .card-price,html.a11y-contrast-high .aside-price-v{color:#ffe14d !important}
html.a11y-contrast-high .btn,html.a11y-contrast-high .btn-primary{background:#ffe14d !important;color:#000 !important;box-shadow:none !important}
html.a11y-contrast-high .card-badge,html.a11y-contrast-high .pill{background:#ffe14d !important;color:#000 !important}
@media(max-width:560px){
  .a11y-widget{bottom:14px;left:14px}
}`;

const APP_JS = `(function(){
  var grid=document.getElementById('grid');
  if(!grid) return;
  var cards=[].slice.call(grid.querySelectorAll('.card'));
  var q=document.getElementById('q');
  var countEl=document.getElementById('count');
  var emptyEl=document.getElementById('empty');
  var citySelect=document.getElementById('city-select');
  var venueSelect=document.getElementById('venue-select');
  var loadMoreWrap=document.getElementById('load-more-wrap');
  var loadMoreBtn=document.getElementById('load-more');
  var state={text:'',section:'',city:'',venue:'',date:'all'};
  var PAGE=24, shownLimit=PAGE;

  function pad(n){return (n<10?'0':'')+n;}
  function ymd(d){return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());}
  function addDays(base,n){var d=new Date(base);d.setDate(d.getDate()+n);return d;}

  // התאמת מופע לפי טווח תאריכים ביחס להיום
  function matchDate(datesStr,mode){
    if(!mode||mode==='all') return true;
    var dates=(datesStr||'').split(',').filter(Boolean);
    if(!dates.length) return false;
    var now=new Date(); now.setHours(0,0,0,0);
    var today=ymd(now);
    if(mode==='today') return dates.indexOf(today)>-1;
    if(mode==='next-7'||mode==='this-month'){
      var end=ymd(addDays(now, mode==='next-7'?6:29));
      return dates.some(function(d){return d>=today && d<=end;});
    }
    if(mode==='weekend'){
      var day=now.getDay(); // 0=ראשון .. 6=שבת
      var toThu=(day>=4)? -(day-4) : (4-day); // חמישי הקרוב (או הנוכחי)
      var thu=addDays(now,toThu);
      var wk=[ymd(thu),ymd(addDays(thu,1)),ymd(addDays(thu,2))];
      return dates.some(function(d){return wk.indexOf(d)>-1;});
    }
    return true;
  }

  // ציור התוצאות עם טעינה מדורגת (מציג עד shownLimit מבין התואמים)
  function render(){
    var t=state.text.trim().toLowerCase();
    var matched=0, rendered=0;
    cards.forEach(function(card){
      var name=(card.getAttribute('data-name')||'').toLowerCase();
      var section=card.getAttribute('data-section')||'';
      var cities=(card.getAttribute('data-city')||'').split('|');
      var okText=!t || name.indexOf(t)>-1 || section.toLowerCase().indexOf(t)>-1 || cities.join(' ').toLowerCase().indexOf(t)>-1;
      var okSection=!state.section || section===state.section;
      var okCity=!state.city || cities.indexOf(state.city)>-1;
      var venues=(card.getAttribute('data-venue')||'').split('|');
      var okVenue=!state.venue || venues.indexOf(state.venue)>-1;
      var okDate=matchDate(card.getAttribute('data-dates'), state.date);
      if(okText&&okSection&&okCity&&okVenue&&okDate){
        matched++;
        if(rendered<shownLimit){ card.style.display=''; rendered++; }
        else { card.style.display='none'; }
      } else {
        card.style.display='none';
      }
    });
    if(countEl) countEl.textContent=matched+' מופעים';
    if(emptyEl) emptyEl.hidden=matched>0;
    if(loadMoreWrap){
      var more=matched-rendered;
      loadMoreWrap.hidden=!(more>0);
      if(loadMoreBtn && more>0) loadMoreBtn.textContent='טען מופעים נוספים ('+more+' נותרו)';
    }
  }

  // כל שינוי בפילטר מאפס לעמוד הראשון
  function apply(){ shownLimit=PAGE; render(); }
  function loadMore(){ shownLimit+=PAGE; render(); }

  // סנכרון בין כפתורי הערים המובילות לתפריט הנפתח
  function syncCityUI(v){
    var chipMatch=false;
    [].forEach.call(document.querySelectorAll('.chip[data-filter="city"]'),function(c){
      var on=c.getAttribute('data-value')===v;
      if(on && v) chipMatch=true;
      c.classList.toggle('is-active', on);
    });
    // עיר שמיוצגת בכפתור מוביל (או "הכל") -> התפריט חוזר ל-placeholder; אחרת מציג את העיר שנבחרה
    if(citySelect) citySelect.value = chipMatch ? '' : (v || '');
  }

  // סנכרון בין כפתורי האולמות המובילים לתפריט הנפתח
  function syncVenueUI(v){
    var chipMatch=false;
    [].forEach.call(document.querySelectorAll('.chip[data-filter="venue"]'),function(c){
      var on=c.getAttribute('data-value')===v;
      if(on && v) chipMatch=true;
      c.classList.toggle('is-active', on);
    });
    if(venueSelect) venueSelect.value = chipMatch ? '' : (v || '');
  }

  if(q) q.addEventListener('input',function(){state.text=q.value;apply();});

  // כיבוד פרמטר ?q= מתוך SearchAction / קישור חיצוני
  try{
    var initial=new URLSearchParams(location.search).get('q');
    if(initial && q){q.value=initial;state.text=initial;}
  }catch(e){}

  [].slice.call(document.querySelectorAll('.chip')).forEach(function(chip){
    chip.addEventListener('click',function(){
      var f=chip.getAttribute('data-filter');
      var v=chip.getAttribute('data-value');
      state[f]=v;
      if(f==='city'){
        syncCityUI(v);
      } else if(f==='venue'){
        syncVenueUI(v);
      } else {
        [].slice.call(document.querySelectorAll('.chip[data-filter="'+f+'"]')).forEach(function(c){
          c.classList.toggle('is-active', c===chip);
        });
      }
      apply();
    });
  });

  // תפריט "כל שאר הערים"
  if(citySelect) citySelect.addEventListener('change',function(){
    state.city=citySelect.value;
    syncCityUI(citySelect.value);
    apply();
  });

  // תפריט "כל שאר האולמות"
  if(venueSelect) venueSelect.addEventListener('change',function(){
    state.venue=venueSelect.value;
    syncVenueUI(venueSelect.value);
    apply();
  });

  // כפתור טעינה מדורגת
  if(loadMoreBtn) loadMoreBtn.addEventListener('click', loadMore);

  // כיבוד קישורי פוטר בסגנון /#section=... או /#city=...
  function applyHash(){
    var h=(location.hash||'').replace(/^#/,'');
    if(!h) return;
    var m=/^(section|city)=(.*)$/.exec(decodeURIComponent(h));
    if(!m) return;
    var f=m[1], v=m[2];
    state[f]=v;
    if(f==='city'){
      syncCityUI(v);
    } else {
      [].forEach.call(document.querySelectorAll('.chip[data-filter="'+f+'"]'),function(c){
        c.classList.toggle('is-active', c.getAttribute('data-value')===v);
      });
    }
    apply();
  }
  window.addEventListener('hashchange',applyHash);
  applyHash();

  apply();
})();`;

const A11Y_JS = `(function(){
  var KEY='idir-a11y';
  var root=document.documentElement;
  var widget=document.getElementById('a11y-widget');
  if(!widget) return;
  var trigger=document.getElementById('a11y-trigger');
  var modal=document.getElementById('a11y-modal');
  var closeBtn=document.getElementById('a11y-close');
  var tools=[].slice.call(widget.querySelectorAll('.a11y-tool'));

  function load(){ try{ return JSON.parse(localStorage.getItem(KEY))||{}; }catch(e){ return {}; } }
  function save(){ try{ localStorage.setItem(KEY, JSON.stringify(state)); }catch(e){} }
  function clampFont(v){ return Math.max(-2, Math.min(6, v||0)); }

  var state=load();

  function apply(){
    var step=clampFont(state.font);
    root.style.zoom = step ? (1 + step*0.1).toFixed(2) : '';
    root.classList.toggle('a11y-contrast-high', state.contrast==='high');
    root.classList.toggle('a11y-invert', state.contrast==='inverted');
    root.classList.toggle('a11y-underline', !!state.underline);
    root.classList.toggle('a11y-readable', !!state.readable);
    tools.forEach(function(b){
      var a=b.getAttribute('data-action'), on=false;
      if(a==='contrast-high') on=state.contrast==='high';
      else if(a==='contrast-inverted') on=state.contrast==='inverted';
      else if(a==='underline-links') on=!!state.underline;
      else if(a==='readable-font') on=!!state.readable;
      else return;
      b.setAttribute('aria-pressed', on?'true':'false');
    });
  }

  function doAction(a){
    switch(a){
      case 'font-plus': state.font=clampFont((state.font||0)+1); break;
      case 'font-minus': state.font=clampFont((state.font||0)-1); break;
      case 'contrast-high': state.contrast=(state.contrast==='high')?null:'high'; break;
      case 'contrast-inverted': state.contrast=(state.contrast==='inverted')?null:'inverted'; break;
      case 'underline-links': state.underline=!state.underline; break;
      case 'readable-font': state.readable=!state.readable; break;
      case 'reset': state={}; break;
    }
    save(); apply();
  }

  function openMenu(){ modal.hidden=false; trigger.setAttribute('aria-expanded','true'); }
  function closeMenu(){ modal.hidden=true; trigger.setAttribute('aria-expanded','false'); }

  trigger.addEventListener('click', function(){ modal.hidden?openMenu():closeMenu(); });
  closeBtn.addEventListener('click', function(){ closeMenu(); trigger.focus(); });
  tools.forEach(function(b){ b.addEventListener('click', function(){ doAction(b.getAttribute('data-action')); }); });
  document.addEventListener('keydown', function(e){ if(e.key==='Escape' && !modal.hidden){ closeMenu(); trigger.focus(); } });
  document.addEventListener('click', function(e){ if(!modal.hidden && !widget.contains(e.target)) closeMenu(); });

  apply();
})();`;

/* -------------------------------- הרצה --------------------------------- */
function run() {
  const t0 = Date.now();
  console.log('· טוען shows.json…');
  const shows = loadShows();
  const scope = BRAND.limit > 0 ? `${shows.length} מופעים (מגבלת פיילוט)` : `${shows.length} מופעים (מלא)`;
  console.log(`· לעיבוד: ${scope}`);
  assignShowUrls(shows);
  assignHubs(shows);
  loadEnrichments();

  if (fs.existsSync(BRAND.outDir)) {
    fs.rmSync(BRAND.outDir, { recursive: true, force: true });
  }
  ensureDir(BRAND.outDir);

  buildAssets();
  buildSearchIndex(shows);
  shows.forEach(buildShow);
  buildIndex(shows);
  buildStaticPages();
  const hubCounts = buildHubPages(shows);
  const cityCounts = buildCityPages(shows);
  const genreCount = buildGenrePages(shows);
  const artistCount = buildArtistsIndex(shows);
  const artistPageCount = buildArtistPages();
  const venuePageCount = buildVenuePages();
  const landingCount = buildLandingPages(shows);
  const magazineCount = buildMagazine(shows);
  const newsCount = buildNews(shows);
  buildSitemap(shows);
  buildAdsTxt();
  buildRedirects(shows);

  const totalSeances = shows.reduce((n, s) => n + ((s.Seances || []).length), 0);
  const secs = ((Date.now() - t0) / 1000).toFixed(2);

  console.log('· נוצרו הקבצים:');
  console.log('  - dist/index.html  (דף בית)');
  console.log(`  - dist/[category]/[show-slug]-כרטיסים-ולוח-הופעות/index.html  (${shows.length} דפי מופע)`);
  console.log('  - dist/_redirects  (301 מהמבנה הישן)');
  console.log(`  - dist/data/search-index.json  (${shows.length} רשומות)`);
  console.log('  - dist/privacy.html, terms.html, contact.html  (עמודי תשתית)');
  console.log(`  - dist/[עמודי עיתוי SEO]  (${HUB_PAGES.length}):`);
  HUB_PAGES.forEach(p => console.log(`      ${p.slug}  (${hubCounts[p.slug]} מופעים)`));
  console.log(`  - dist/[עמודי ערים SEO]  (${CITY_PAGES.length}):`);
  CITY_PAGES.forEach(p => console.log(`      ${p.slug}/  (${cityCounts[p.slug]} מופעים)`));
  console.log(`  - dist/רשימת-אמנים/index.html  (${artistCount} אמנים)`);
  console.log(`  - dist/artist/[slug]/  (${artistPageCount} עמודי אמנים קבועים)`);
  console.log(`  - dist/venues/[slug]/  (${venuePageCount} עמודי אולמות קבועים)`);
  console.log(`  - dist/sitemap.xml  (${shows.length + 2 + STATIC_SLUGS.length + HUB_PAGES.length + CITY_PAGES.length + artistPageCount + venuePageCount} כתובות)`);
  console.log('  - dist/robots.txt, dist/ads.txt');
  console.log('  - dist/assets/styles.css, app.js, accessibility.js');
  console.log('────────────────────────────────────────');
  console.log(`  מופעים:   ${shows.length}`);
  console.log(`  מועדים:   ${totalSeances}`);
  console.log(`  סה"כ דפי HTML: ${shows.length + 2 + STATIC_SLUGS.length + HUB_PAGES.length + CITY_PAGES.length + artistPageCount + venuePageCount}`);
  console.log(`  זמן ריצה: ${secs} שניות`);
  console.log('✓ הבנייה המלאה הושלמה.');
}

run();
