import { PALETTES, ALL_PALETTE_IDS, type PaletteId } from '@alice-wallet/alice-content';

export function initThemeFromStorage() {
  if (typeof window === 'undefined') return;

  const storedMode = localStorage.getItem('alice_theme_mode') as 'light' | 'dark' | null;
  const storedPalette = localStorage.getItem('alice_palette') as PaletteId | null;

  const mode = storedMode ?? 'dark';
  const palette = storedPalette && ALL_PALETTE_IDS.includes(storedPalette) ? storedPalette : 'blue';

  const colors = PALETTES[palette][mode];
  const root = document.documentElement;

  root.style.setProperty('--alice-bg', colors.background);
  root.style.setProperty('--alice-bg-soft', colors.backgroundSoft);
  root.style.setProperty('--alice-primary', colors.primary);
  root.style.setProperty('--alice-primary-dark', colors.primaryDark);
  root.style.setProperty('--alice-text', colors.text);
  root.style.setProperty('--alice-border', colors.border);
  root.style.setProperty('--alice-muted', colors.muted);
  root.style.setProperty('--alice-card-bg', colors.cardBg);
  root.style.setProperty('--alice-on-primary', colors.onPrimary);
  root.style.setProperty('--alice-chat-bg', colors.primary);
  root.style.setProperty('--alice-chat-ink', colors.onPrimary);
  root.style.setProperty('--alice-danger', colors.danger);
  root.style.setProperty('--alice-danger-soft', colors.dangerSoft);
  root.style.setProperty('--alice-danger-ink', colors.dangerInk);
  root.style.setProperty('--alice-success', colors.success);
  root.style.setProperty('--alice-warning', colors.warning);
  root.style.setProperty('--alice-warning-soft', colors.warningSoft);
  root.style.setProperty('--alice-warning-ink', colors.warningInk);
  root.style.setProperty('--alice-info', colors.info);
  // PlanB Learn artwork is keyed to transparency at ingestion; this pair of
  // filters flips drawings to match the mode they were not drawn for
  // (dark-on-light art inverted in dark mode, light-on-dark art in light
  // mode), hues preserved.
  root.style.setProperty('--alice-media-invert', mode === 'dark' ? 'invert(1) hue-rotate(180deg)' : 'none');
  root.style.setProperty('--alice-media-invert-light', mode === 'dark' ? 'none' : 'invert(1) hue-rotate(180deg)');

  const [r, g, b] = [
    parseInt(colors.onPrimary.slice(1, 3), 16),
    parseInt(colors.onPrimary.slice(3, 5), 16),
    parseInt(colors.onPrimary.slice(5, 7), 16),
  ];
  root.style.setProperty('--alice-chat-ink-muted', `rgba(${r}, ${g}, ${b}, 0.7)`);
  root.style.setProperty('--alice-chat-field-border', `rgba(${r}, ${g}, ${b}, 0.3)`);
}
