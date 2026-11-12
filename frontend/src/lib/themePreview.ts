// Light-theme triplets for the Settings theme-preview tile. The tokens resolve
// per element (`rgb(var(--x))`), so a nested `.dark` scope renders the dark
// tile from the real tokens, but there is no `.light` scope to nest inside a
// dark page: the light tile re-declares these variables with the :root values.
// lib/tokenContrast.test.ts asserts each entry still equals index.css's :root
// value, so a token change cannot leave the preview behind.
export const LIGHT_PREVIEW_VARS: Record<string, string> = {
  "--background": "249 249 247",
  "--surface-container-lowest": "255 255 255",
  "--outline-variant": "208 208 204",
  "--primary": "31 117 51",
};
