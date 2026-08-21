export type ThemeMode = 'light' | 'dark';
export type PaletteId = 'blue' | 'green' | 'coral' | 'red' | 'flame' | 'indigo' | 'bitcoin' | 'mono';

export type Colors = {
  background: string;
  backgroundSoft: string;
  primary: string;
  primaryDark: string;
  text: string;
  border: string;
  muted: string;
  white: string;
  cardBg: string;
  dotted: string;
  onPrimary: string;
  qrColor: string;
  danger: string;
  dangerSoft: string;
  dangerInk: string;
  success: string;
  warning: string;
  warningSoft: string;
  warningInk: string;
  info: string;
};

// Couleurs d'etat, identiques pour les 8 palettes mais declinees par mode :
// la version sombre reprend les valeurs historiquement codees en dur pour ne
// pas changer le rendu, la version claire est assombrie pour rester >= 4.5:1.
const SEMANTIC_DARK = {
  danger: '#e06060',
  dangerSoft: '#e0606022',
  dangerInk: '#f0a0a0',
  success: '#3fb950',
  warning: '#d4a017',
  warningSoft: '#d4a01722',
  warningInk: '#e8c574',
  info: '#8bb8ff',
} as const;

const SEMANTIC_LIGHT = {
  danger: '#c23838',
  dangerSoft: '#fff1f1',
  dangerInk: '#8f3030',
  success: '#1e7d32',
  warning: '#8f6d0a',
  warningSoft: '#fdf3d7',
  warningInk: '#8f6d0a',
  info: '#3d69b8',
} as const;

type PaletteConfig = {
  label: string;
  primary: string;
  light: Colors;
  dark: Colors;
};

function hexToRgb(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map(v => Math.min(255, Math.max(0, Math.round(v))).toString(16).padStart(2, '0')).join('');
}

function darkBg(primary: string): string {
  const [r, g, b] = hexToRgb(primary);
  return rgbToHex(Math.round(r * 0.08), Math.round(g * 0.08), Math.round(b * 0.08));
}

function darkBgSoft(primary: string): string {
  const [r, g, b] = hexToRgb(primary);
  return rgbToHex(Math.round(r * 0.12), Math.round(g * 0.12), Math.round(b * 0.12));
}

function darkCardBg(primary: string): string {
  const [r, g, b] = hexToRgb(primary);
  return `rgba(${Math.round(r * 0.1)}, ${Math.round(g * 0.1)}, ${Math.round(b * 0.1)}, 0.8)`;
}

function qrDark(primary: string): string {
  const [r, g, b] = hexToRgb(primary);
  return rgbToHex(Math.round(r * 0.2), Math.round(g * 0.2), Math.round(b * 0.2));
}

// Encre de lecture du mode clair : le primaire rabattu vers le noir garde la
// teinte de la palette tout en restant >= 10:1 sur #fafafa quel que soit le
// primaire. Le pastel reste pour bordures et accents, jamais pour le corps.
function lightInk(primary: string): string {
  const [r, g, b] = hexToRgb(primary);
  return rgbToHex(Math.round(r * 0.2 + 15), Math.round(g * 0.2 + 15), Math.round(b * 0.2 + 15));
}

function lightMuted(primary: string): string {
  const [r, g, b] = hexToRgb(primary);
  return rgbToHex(Math.round(r * 0.3 + 55), Math.round(g * 0.3 + 55), Math.round(b * 0.3 + 55));
}

function luminance(hex: string): number {
  const ch = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}

function contrast(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

// Blanc casse du texte courant en sombre : un blanc chaud type papier,
// identique pour toutes les palettes (choisi sur echantillon par Marius).
const DARK_TEXT = '#f2efe6';

// Texte sur bouton rempli en clair : blanc sur les primaires satures (red,
// indigo), encre foncee sur les pastels (blue, coral, bitcoin) ou le blanc
// ne contraste pas. On prend celui des deux qui contraste le mieux.
function onPrimaryLight(primary: string): string {
  const candidates = ['#ffffff', lightInk(primary), '#111418'];
  return candidates.reduce((best, c) => (contrast(c, primary) > contrast(best, primary) ? c : best));
}

// darkAccent : accent pastel du mode sombre quand le primaire de marque est
// trop sombre pour rester lisible sur le fond nuit (recette de la palette
// Blue : fond derive de la marque, accent eclairci). Sans darkAccent, le
// primaire sert d'accent tel quel.
function buildPalette(primary: string, primaryDark: string, muted: string, dotted: string, onPrimaryDark: string, darkAccent?: string, darkAccentDark?: string): { light: Colors; dark: Colors } {
  const accent = darkAccent ?? primary;
  const accentDark = darkAccentDark ?? darkAccent ?? primaryDark;
  return {
    light: {
      background: '#fafafa',
      backgroundSoft: '#f6f8fb',
      primary,
      primaryDark,
      text: lightInk(primary),
      border: primary,
      muted: lightMuted(primary),
      white: '#ffffff',
      cardBg: 'rgba(255, 255, 255, 0.7)',
      dotted,
      onPrimary: onPrimaryLight(primary),
      qrColor: qrDark(primary),
      ...SEMANTIC_LIGHT,
    },
    dark: {
      background: darkBg(primary),
      backgroundSoft: darkBgSoft(primary),
      primary: accent,
      primaryDark: accentDark,
      text: DARK_TEXT,
      border: darken(primary),
      muted: desaturate(muted),
      white: '#e6edf3',
      cardBg: darkCardBg(primary),
      dotted: darken(primary),
      onPrimary: onPrimaryDark,
      qrColor: qrDark(primary),
      ...SEMANTIC_DARK,
    },
  };
}

function darken(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const f = (v: number) => Math.round(v * 0.3);
  return '#' + [f(r), f(g), f(b)].map(v => v.toString(16).padStart(2, '0')).join('');
}

function desaturate(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const avg = (r + g + b) / 3;
  const f = (v: number) => Math.round(v * 0.5 + avg * 0.5);
  return '#' + [f(r), f(g), f(b)].map(v => Math.min(255, v).toString(16).padStart(2, '0')).join('');
}

export const PALETTES: Record<PaletteId, PaletteConfig> = {
  blue: {
    label: 'Alice Blue',
    primary: '#8bb8ff',
    light: {
      background: '#fafafa', backgroundSoft: '#f6f8fb',
      primary: '#8bb8ff', primaryDark: '#6fa3f7', text: '#22304a',
      border: '#8bb8ff', muted: '#5d7599', white: '#ffffff',
      cardBg: 'rgba(255, 255, 255, 0.7)', dotted: '#d0dfff', onPrimary: '#1c2b45',
      qrColor: '#1c2533', ...SEMANTIC_LIGHT,
    },
    dark: {
      background: '#0d1117', backgroundSoft: '#161b22',
      primary: '#8bb8ff', primaryDark: '#a8ccff', text: '#f2efe6',
      border: '#2a3a52', muted: '#7f97bd', white: '#e6edf3',
      cardBg: 'rgba(22, 27, 34, 0.8)', dotted: '#2a3a52', onPrimary: '#16294a',
      qrColor: '#1c2533', ...SEMANTIC_DARK,
    },
  },
  green: {
    label: 'Green',
    primary: '#56dc4b',
    ...buildPalette('#56dc4b', '#56dc4b', '#90e888', '#b0f0a8', '#143012'),
  },
  coral: {
    label: 'Coral',
    primary: '#F08080',
    ...buildPalette('#F08080', '#d06060', '#f0b8b8', '#f0d0d0', '#3a1616'),
  },
  red: {
    label: 'Red',
    primary: '#c32b27',
    ...buildPalette('#c32b27', '#c32b27', '#e08080', '#e8a0a0', '#300a09', '#ea625c', '#f28b86'),
  },
  flame: {
    label: 'Flame',
    primary: '#f14317',
    ...buildPalette('#f14317', '#f14317', '#f89080', '#faa898', '#3a0e04', '#f76a3d', '#fa8c66'),
  },
  indigo: {
    label: 'Indigo',
    primary: '#391998',
    ...buildPalette('#391998', '#391998', '#8a78c0', '#a898d0', '#0e0830', '#a08cff', '#b8a8ff'),
  },
  bitcoin: {
    label: 'Bitcoin',
    primary: '#f7931a',
    ...buildPalette('#f7931a', '#f7931a', '#f8c080', '#f8d8a8', '#3a2205'),
  },
  mono: {
    label: 'Mono',
    primary: '#1a1a1a',
    light: {
      background: '#fafafa', backgroundSoft: '#f0f0f0',
      primary: '#1a1a1a', primaryDark: '#000000', text: '#1a1a1a',
      border: '#1a1a1a', muted: '#666666', white: '#ffffff',
      cardBg: 'rgba(255, 255, 255, 0.7)', dotted: '#cccccc', onPrimary: '#ffffff',
      qrColor: '#000000', ...SEMANTIC_LIGHT,
    },
    dark: {
      background: '#0a0a0a', backgroundSoft: '#141414',
      primary: '#ffffff', primaryDark: '#e0e0e0', text: '#f2efe6',
      border: '#333333', muted: '#888888', white: '#e6edf3',
      cardBg: 'rgba(20, 20, 20, 0.8)', dotted: '#333333', onPrimary: '#0a0a0a',
      qrColor: '#e0e0e0', ...SEMANTIC_DARK,
    },
  },
};

export const ALL_PALETTE_IDS: PaletteId[] = ['blue', 'green', 'coral', 'red', 'flame', 'indigo', 'bitcoin', 'mono'];

export function getColors(mode: ThemeMode, palette: PaletteId = 'blue'): Colors {
  return PALETTES[palette][mode];
}

export const colors = PALETTES.blue.light;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

export const typography = {
  pixel: 'PressStart2P' as const,
  numbers: 'TerminalGrotesque' as const,
  balanceSize: 32,
} as const;

export type Pixel = {
  borderWidth: number;
  borderColor: string;
  borderRadius: number;
};

export function getPixel(mode: ThemeMode, palette: PaletteId = 'blue'): Pixel {
  const c = getColors(mode, palette);
  return {
    borderWidth: 2,
    borderColor: c.border,
    borderRadius: 2,
  };
}

export const pixel = {
  borderWidth: 2,
  borderColor: '#8bb8ff',
  borderRadius: 2,
} as const;
