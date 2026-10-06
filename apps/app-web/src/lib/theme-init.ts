import { ALL_PALETTE_IDS, type PaletteId, type ThemeMode } from '@alice-wallet/alice-content';
import { webThemeTokens } from './theme-tokens';

export function readAppearance(): { mode: ThemeMode; palette: PaletteId } {
  let mode = '', palette = '';
  try {
    mode = localStorage.getItem('alice_theme_mode') ?? '';
    palette = localStorage.getItem('alice_palette') ?? '';
  } catch { /* Storage is optional; the theme still works for this session. */ }
  return {
    mode: mode === 'light' ? 'light' : 'dark',
    palette: ALL_PALETTE_IDS.includes(palette as PaletteId) ? palette as PaletteId : 'blue',
  };
}

export function applyWebTheme(mode: ThemeMode, palette: PaletteId, persist = true) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const tokens = webThemeTokens(mode, palette);
  for (const [name, value] of Object.entries(tokens)) root.style.setProperty(name, value);
  root.dataset.theme = mode;
  root.dataset.palette = palette;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', tokens['--alice-bg']);
  root.style.colorScheme = mode;
  root.classList.toggle('dark', mode === 'dark');
  if (persist) {
    try {
      localStorage.setItem('alice_theme_mode', mode);
      localStorage.setItem('alice_palette', palette);
    } catch { /* Apply without persistence if storage is unavailable. */ }
  }
}

export function initThemeFromStorage() {
  if (typeof window === 'undefined') return;
  const { mode, palette } = readAppearance();
  applyWebTheme(mode, palette, false);
}
