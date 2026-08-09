import { createContext, useContext, useState, useEffect, useMemo, useCallback, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { type ThemeMode, type Colors, type PaletteId, type Pixel, getColors, getPixel, ALL_PALETTE_IDS } from '@alice-wallet/alice-content';

const THEME_KEY = 'alice_theme_mode';
const PALETTE_KEY = 'alice_palette';

type ThemeContextValue = {
  mode: ThemeMode;
  palette: PaletteId;
  colors: Colors;
  pixel: Pixel;
  toggle: () => void;
  setPalette: (id: PaletteId) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>('dark');
  const [palette, setPaletteState] = useState<PaletteId>('blue');

  useEffect(() => {
    Promise.all([
      AsyncStorage.getItem(THEME_KEY),
      AsyncStorage.getItem(PALETTE_KEY),
    ]).then(([m, p]) => {
      if (m === 'dark' || m === 'light') setMode(m);
      if (p && ALL_PALETTE_IDS.includes(p as PaletteId)) setPaletteState(p as PaletteId);
    });
  }, []);

  const toggle = useCallback(() => {
    setMode(prev => {
      const next = prev === 'light' ? 'dark' : 'light';
      AsyncStorage.setItem(THEME_KEY, next);
      return next;
    });
  }, []);

  const setPalette = useCallback((id: PaletteId) => {
    setPaletteState(id);
    AsyncStorage.setItem(PALETTE_KEY, id);
  }, []);

  const colors = useMemo(() => getColors(mode, palette), [mode, palette]);
  const pixel = useMemo(() => getPixel(mode, palette), [mode, palette]);

  const value = useMemo(
    () => ({ mode, palette, colors, pixel, toggle, setPalette }),
    [mode, palette, colors, pixel, toggle, setPalette],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}
