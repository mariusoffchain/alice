import { PALETTES, type PaletteId, type ThemeMode } from '../../../../packages/alice-content/src/theme.ts';

import { mixColor, opaqueColor, readableColor, onColor } from './color-contrast.ts';

/** Preserve the application's full palettes across surfaces, reading ink and accents. */
export function webThemeTokens(mode: ThemeMode, palette: PaletteId) {
  const colors = PALETTES[palette][mode];
  const dark = mode === 'dark';
  const text = palette === 'mono' ? (dark ? '#f0f0f0' : '#1a1a1a') : colors.text;
  // The shared content palettes use a blue-tinted light surface for every hue.
  // Web chrome must derive its own surfaces from the selected palette instead.
  const surface = dark ? colors.backgroundSoft : mixColor(PALETTES[palette].primary, '#ffffff', .045);
  const card = dark ? opaqueColor(colors.cardBg, colors.background) : mixColor(PALETTES[palette].primary, '#ffffff', .02);
  const hover = mixColor(colors.primary, surface, .08);
  const surfaces = [colors.background, surface, card, hover];
  // Use one secondary ink, not opacity layered over an already-muted color.
  const muted = readableColor(mixColor(text, surface, .65), surfaces, dark);
  const accent = readableColor(colors.primary, surfaces, dark);
  const onAccent = onColor(accent);
  const controlBorder = readableColor(mixColor(text, surface, .4), surfaces, dark, 3.1);
  const danger = readableColor(colors.danger, surfaces, dark);
  const warning = readableColor(colors.warning, surfaces, dark);
  const dangerSoft = opaqueColor(colors.dangerSoft, colors.background);
  const warningSoft = opaqueColor(colors.warningSoft, colors.background);
  return {
    '--alice-bg': colors.background,
    '--alice-bg-soft': surface,
    '--alice-sidebar-bg': surface,
    '--alice-primary': accent,
    '--alice-primary-dark': accent,
    '--alice-text': text,
    '--alice-border': mixColor(accent, surface, .22),
    '--alice-control-border': controlBorder,
    '--alice-muted': muted,
    '--alice-card-bg': card,
    '--alice-hover': hover,
    '--alice-selected': text,
    '--alice-on-primary': onAccent,
    '--alice-danger': danger,
    '--alice-on-danger': onColor(danger),
    '--alice-danger-soft': dangerSoft,
    '--alice-danger-ink': readableColor(colors.dangerInk, [dangerSoft], dark),
    '--alice-success': readableColor(colors.success, surfaces, dark),
    '--alice-warning': warning,
    '--alice-warning-soft': warningSoft,
    '--alice-warning-ink': readableColor(colors.warningInk, [warningSoft], dark),
    '--alice-info': accent,
    '--alice-chart-secondary': mixColor(accent, text, .75),
    '--alice-illustration-bg': dark ? mixColor(PALETTES[palette].primary, '#ffffff', .02) : card,
    '--alice-chat-bg': accent,
    '--alice-chat-field-bg': mixColor(onAccent === '#ffffff' ? '#000000' : '#ffffff', accent, .08),
    '--alice-chat-bubble-user': mixColor(onAccent === '#ffffff' ? '#000000' : '#ffffff', accent, .12),
    '--alice-chat-ink': onAccent,
    '--alice-chat-ink-muted': readableColor(mixColor(onAccent, accent, .75), [accent], onAccent === '#ffffff'),
    '--alice-chat-field-border': readableColor(mixColor(onAccent, accent, .5), [accent], onAccent === '#ffffff', 3.1),
    '--alice-media-invert': dark ? 'invert(1) hue-rotate(180deg)' : 'none',
    '--alice-media-invert-light': dark ? 'none' : 'invert(1) hue-rotate(180deg)',
  };
}
