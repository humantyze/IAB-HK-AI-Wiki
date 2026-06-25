---
name: html-to-image font embedding quirk
description: Why html-to-image logs a SecurityError when exporting nodes that use Google Fonts, and how the report's ShareCard handles it.
---

# html-to-image + cross-origin web fonts

When using `html-to-image`'s `toPng`/`toSvg` to export a DOM node that relies on a
web font loaded via a cross-origin `@import` (e.g. Google Fonts in
`artifacts/report/src/index.css`), the browser console logs a `SecurityError`
while the library tries to read `cssRules` of the cross-origin stylesheet.

**Why:** browsers block reading `cssRules` of cross-origin stylesheets (CSSOM
restriction, separate from fetch/CORS). html-to-image swallows the error and
continues, so the export still succeeds — the warning is non-blocking.

**How to apply:**
- Treat this console `SecurityError` as expected noise, not a bug, for the
  insight-card export feature (`ShareCard.tsx` / `ShareInsightDialog.tsx`).
- Always `await document.fonts.ready` before calling `toPng` so the live preview
  and capture use the loaded font.
- If exported PNGs ever render with a fallback font instead of Montserrat,
  the fix is to precompute `fontEmbedCSS` (fetch the font CSS yourself and pass
  it to `toPng`) rather than relying on the library reading the cross-origin sheet.
