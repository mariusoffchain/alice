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
};

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

function buildPalette(primary: string, primaryDark: string, muted: string, dotted: string, onPrimaryDark: string): { light: Colors; dark: Colors } {
  return {
    light: {
      background: '#fafafa',
      backgroundSoft: '#f6f8fb',
      primary,
      primaryDark,
      text: primaryDark,
      border: primary,
      muted,
      white: '#ffffff',
      cardBg: 'rgba(255, 255, 255, 0.7)',
      dotted,
      onPrimary: '#ffffff',
      qrColor: qrDark(primary),
    },
    dark: {
      background: darkBg(primary),
      backgroundSoft: darkBgSoft(primary),
      primary,
      primaryDark,
      text: primary,
      border: darken(primary),
      muted: desaturate(muted),
      white: '#e6edf3',
      cardBg: darkCardBg(primary),
      dotted: darken(primary),
      onPrimary: onPrimaryDark,
      qrColor: qrDark(primary),
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
      primary: '#8bb8ff', primaryDark: '#6fa3f7', text: '#6f9ee8',
      border: '#8bb8ff', muted: '#b8d0ff', white: '#ffffff',
      cardBg: 'rgba(255, 255, 255, 0.7)', dotted: '#d0dfff', onPrimary: '#ffffff',
      qrColor: '#1c2533',
    },
    dark: {
      background: '#0d1117', backgroundSoft: '#161b22',
      primary: '#8bb8ff', primaryDark: '#a8ccff', text: '#8bb8ff',
      border: '#2a3a52', muted: '#4a6a9a', white: '#e6edf3',
      cardBg: 'rgba(22, 27, 34, 0.8)', dotted: '#2a3a52', onPrimary: '#16294a',
      qrColor: '#1c2533',
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
    ...buildPalette('#c32b27', '#c32b27', '#e08080', '#e8a0a0', '#300a09'),
  },
  flame: {
    label: 'Flame',
    primary: '#f14317',
    ...buildPalette('#f14317', '#f14317', '#f89080', '#faa898', '#3a0e04'),
  },
  indigo: {
    label: 'Indigo',
    primary: '#391998',
    ...buildPalette('#391998', '#391998', '#8a78c0', '#a898d0', '#0e0830'),
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
      qrColor: '#000000',
    },
    dark: {
      background: '#0a0a0a', backgroundSoft: '#141414',
      primary: '#ffffff', primaryDark: '#e0e0e0', text: '#ffffff',
      border: '#333333', muted: '#888888', white: '#e6edf3',
      cardBg: 'rgba(20, 20, 20, 0.8)', dotted: '#333333', onPrimary: '#0a0a0a',
      qrColor: '#e0e0e0',
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
