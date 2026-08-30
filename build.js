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
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}\s-]/gu, '') // מסיר מרכאות, סלאשים, פיסוק ותווים מיוחדים
    .trim()
    .replace(/[\s-]+/g, '-')           // רווחים ומקפים כפולים -> מקף אחד
    .replace(/^-+|-+$/g, '');
}

// מקצה לכל מופע נתיב תיקייה (_dir) וכתובת URL (_url) ייחודיים
function assignShowUrls(shows) {
  const used = new Set();
  const SUFFIX = 'כרטיסים-ולוח-הופעות';
  for (const s of shows) {
    const cat = categorySlug(s.section);
    const nameSlug = slugify(s.name) || String(s.id);
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
  return `<article class="card"
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
        <span class="card-price">${priceLabel(show.priceMin, show.priceMax)}</span>
        <a class="btn btn-primary" href="${esc(show._url)}">לפרטים וכרטיסים</a>
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
    const dir = path.join(BRAND.outDir, cfg.slug);
    ensureDir(dir);
    fs.writeFileSync(path.join(dir, 'index.html'), html, 'utf8');
    results[cfg.slug] = matched.length;
  });
  return results;
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
    `<li><a href="${esc(s._url)}">${escText(s.name)} הופעות</a></li>`).join('');

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
    <td data-th="אולם">${escText(s.hall)}</td>
    <td data-th="מחיר">${priceLabel(s.priceMin, s.priceMax)}</td>
    <td data-th="הזמנה"><a class="btn btn-primary btn-sm" href="${esc(affiliateUrl(s.link))}" target="_blank" rel="noopener sponsored">להזמנת כרטיסים</a></td>
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
      availability: 'https://schema.org/InStock',
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

  const body = `
<nav class="breadcrumb wrap">
  <a href="/">בית</a> <span>›</span> <span>${escText(show.section)}</span> <span>›</span> <span class="current">${escText(show.name)}</span>
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
        <div class="show-facts">
          <div class="fact"><span class="fact-k">מועדים</span><span class="fact-v">${formatDate(show.dateFrom)}</span></div>
          <div class="fact"><span class="fact-k">מיקום</span><span class="fact-v">${escText(cities.join(' · ') || 'יפורסם')}</span></div>
          <div class="fact"><span class="fact-k">מחיר</span><span class="fact-v">${priceLabel(show.priceMin, show.priceMax)}</span></div>
        </div>
        <a class="btn btn-primary btn-lg" href="#seances">להזמנת כרטיסים</a>
      </div>
    </div>
  </div>

  <div class="wrap show-grid">
    <section class="show-desc">
      <h2>על המופע</h2>
      <div class="rte">${safeHtml(show.description)}</div>
    </section>

    <aside class="show-aside">
      <div class="aside-card">
        <span class="aside-price-k">מחיר כרטיס</span>
        <span class="aside-price-v">${priceLabel(show.priceMin, show.priceMax)}</span>
        <a class="btn btn-primary btn-block" href="#seances">בחירת מועד</a>
        <p class="aside-note">רכישת כרטיסים</p>
      </div>
    </aside>
  </div>

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
  </section>
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
    { loc: `${BRAND.domain}/רשימת-אמנים/`, pri: '0.7' },
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
.show-announce{color:var(--muted);font-size:18px;margin:0 0 20px}
.show-facts{display:flex;gap:26px;flex-wrap:wrap;margin-bottom:22px}
.fact{display:flex;flex-direction:column;gap:2px}
.fact-k{color:var(--muted);font-size:13px;font-weight:600}
.fact-v{font-weight:700;font-size:15px}

.show-grid{display:grid;grid-template-columns:1fr 320px;gap:34px;padding-block:20px 10px;align-items:start}
.show-desc h2,.seances h2{font-size:22px;font-weight:800;margin:0 0 14px}
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
  const artistCount = buildArtistsIndex(shows);
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
  console.log(`  - dist/sitemap.xml  (${shows.length + 2 + STATIC_SLUGS.length + HUB_PAGES.length + CITY_PAGES.length} כתובות)`);
  console.log('  - dist/robots.txt, dist/ads.txt');
  console.log('  - dist/assets/styles.css, app.js, accessibility.js');
  console.log('────────────────────────────────────────');
  console.log(`  מופעים:   ${shows.length}`);
  console.log(`  מועדים:   ${totalSeances}`);
  console.log(`  סה"כ דפי HTML: ${shows.length + 2 + STATIC_SLUGS.length + HUB_PAGES.length + CITY_PAGES.length}`);
  console.log(`  זמן ריצה: ${secs} שניות`);
  console.log('✓ הבנייה המלאה הושלמה.');
}

run();
