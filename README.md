# איידיר כרטיסים | IDIR Tickets

אתר סטטי (SSG) לכרטיסים למופעים, הצגות וקונצרטים בישראל. אתר אפילייט מול חברת בראוו.

- **דומיין:** https://idir.co.il
- **בסיס רכישה (שותף):** https://idir.kartisim.co.il

## מבנה

| קובץ | תיאור |
|------|-------|
| `shows.json` | מקור הנתונים (626 מופעים, מבנה `{ Shows: [...] }`) |
| `build.js` | סקריפט הבנייה (Node, ללא תלויות) שמייצר את `dist/` |
| `serve.js` | שרת פיתוח מקומי (פורט 4321) לבדיקה |
| `dist/` | פלט הבנייה (נוצר אוטומטית, לא נשמר ב־Git) |

## בנייה

```bash
node build.js
```

מייצר לתוך `dist/`:

- `index.html` — דף בית עם חיפוש חי, פילטרים (קטגוריה / עיר / תאריך) וטעינה מדורגת
- `shows/[id].html` — דף לכל מופע עם לוח מועדים, קישורי שותף ו־Schema.org Event
- `data/search-index.json`, `sitemap.xml`, `robots.txt`
- `assets/styles.css`, `assets/app.js`, `assets/accessibility.js`

היקף הבנייה נשלט ע"י `BRAND.limit` ב־`build.js` (0 = כל המופעים, מספר חיובי = מגבלה).

## תכונות

חיפוש חי, פילטר קטגוריות/ערים/תאריכים, טעינה מדורגת (24 בכל פעם), סרגל נגישות מובנה (תקן ת"י 5568 AA),
עיצוב Light Clean רספונסיבי, RTL מלא, ו־SEO מלא (Schema.org, sitemap, canonical, Open Graph).

## בדיקה מקומית

```bash
node serve.js
```

ואז פתיחת http://localhost:4321
