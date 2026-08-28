'use strict';

/* ==========================================================================
   fetch-shows.js  -  משיכת פיד המופעים העדכני מבראבו ושמירה ל-shows.json
   רץ אוטומטית ב-GitHub Actions (ראה .github/workflows/sync-shows.yml)
   הרצה ידנית:  node fetch-shows.js   (או: npm run sync)
   ========================================================================== */

const fs = require('node:fs');
const path = require('node:path');

// כתובת פיד ה-JSON של בראבו (פיד השותף של איידיר). ניתן לעקוף דרך משתנה
// הסביבה BRAVO_FEED_URL (למשל GitHub Secret) אם הכתובת תשתנה בעתיד.
const BRAVO_FEED_URL = process.env.BRAVO_FEED_URL || 'https://idir.kartisim.co.il/xml/partner/shows.json';
const OUTPUT_FILE = path.resolve('shows.json');

async function syncShows() {
  console.log('🔄 Fetching latest shows data from Bravo...');
  console.log(`   Source: ${BRAVO_FEED_URL}`);

  try {
    const res = await fetch(BRAVO_FEED_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
      },
    });

    if (!res.ok) {
      throw new Error(`Failed to fetch feed. HTTP Status: ${res.status}`);
    }

    const data = await res.json();

    // בדיקת תקינות בסיסית של המבנה (מערך ישיר או אובייקט עם Shows)
    if (!data || (!Array.isArray(data) && !Array.isArray(data.Shows))) {
      throw new Error('Invalid JSON schema received from provider');
    }

    const count = Array.isArray(data) ? data.length : data.Shows.length;
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(data, null, 2), 'utf-8');
    console.log(`✅ Successfully updated shows.json (${count} shows)`);
  } catch (err) {
    console.error('❌ Error updating shows:', err.message);
    process.exit(1);
  }
}

syncShows();
