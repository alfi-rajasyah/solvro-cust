/**
 * Picks a readable text tone (dark ink or white) for an arbitrary hex
 * background — shared by the bespoke color chips (LabelChip, EpicChip) so a
 * contrast fix lands on both at once.
 */
export function pickContrast(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return "#ffffff";
  const r = parseInt(m[1].slice(0, 2), 16);
  const g = parseInt(m[1].slice(2, 4), 16);
  const b = parseInt(m[1].slice(4, 6), 16);
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
  return brightness > 150 ? "#191b23" : "#ffffff";
}
