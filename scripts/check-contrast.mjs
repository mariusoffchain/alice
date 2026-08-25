// Garde-fou d'accessibilité : vérifie les ratios WCAG 2.1 des 8 palettes dans
// les deux modes. Échoue (exit 1) si le texte courant passe sous 4.5:1 ou si
// l'accent (primary) passe sous 3:1 sur son fond.
//
//   node scripts/check-contrast.mjs
//
import { PALETTES } from '../packages/alice-content/src/theme.ts';

function channel(v) {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function luminance(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

// Les fonds en rgba()/hex 8 digits sont composés sur le background opaque.
function ratio(fg, bg) {
  const [l1, l2] = [luminance(fg.slice(0, 7)), luminance(bg.slice(0, 7))].sort((a, b) => b - a);
  return (l1 + 0.05) / (l2 + 0.05);
}

const MIN_TEXT = 4.5;
const MIN_ACCENT = 3.0;

let failed = false;
const rows = [];

for (const [id, palette] of Object.entries(PALETTES)) {
  for (const mode of ['light', 'dark']) {
    const c = palette[mode];
    // En clair, primary est une teinte de bordure/remplissage (l'identite
    // pastel), jamais une couleur de texte : les roles texte passent par
    // text/muted/onPrimary. Le seuil accent ne s'applique donc qu'en sombre,
    // ou primary porte titres, icones et texte utilisateur du chat.
    const checks = [
      ['text/bg', ratio(c.text, c.background), MIN_TEXT],
      ...(mode === 'dark' ? [['primary/bg', ratio(c.primary, c.background), MIN_TEXT]] : []),
      ['muted/bg', ratio(c.muted, c.background), MIN_ACCENT],
      ['onPrimary/primary', ratio(c.onPrimary, c.primary), MIN_TEXT],
      ['danger/bg', ratio(c.danger, c.background), MIN_ACCENT],
    ];
    for (const [name, value, min] of checks) {
      const ok = value >= min;
      if (!ok) failed = true;
      rows.push([id, mode, name, value.toFixed(2), ok ? 'ok' : `FAIL (min ${min})`]);
    }
  }
}

const width = [8, 6, 18, 7, 14];
for (const row of rows) {
  console.log(row.map((cell, i) => String(cell).padEnd(width[i])).join(' '));
}

if (failed) {
  console.error('\nContraste insuffisant, voir les lignes FAIL ci-dessus.');
  process.exit(1);
}
console.log('\nToutes les palettes passent.');
