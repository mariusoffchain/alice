'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  PALETTES,
  ALL_PALETTE_IDS,
  type PaletteId,
} from '@alice-wallet/alice-content';
import { sectionStyle } from './ui';

/* ------------------------------------------------------------------ */
/*  Pixel Wheel                                                        */
/* ------------------------------------------------------------------ */

const GRID = 37;
const GAP = 1;
const INNER_RATIO = 0.4;
const PALETTE_COUNT = ALL_PALETTE_IDS.length; // 8

type WheelRegion =
  | { type: 'empty' }
  | { type: 'toggle'; half: 'light' | 'dark' }
  | { type: 'palette'; id: PaletteId };

function regionAt(
  px: number,
  py: number,
  outerR: number,
  innerR: number,
): WheelRegion {
  const dist = Math.hypot(px, py);
  if (dist > outerR) return { type: 'empty' };
  if (dist <= innerR) {
    const half = px < 0 ? 'light' : 'dark';
    return { type: 'toggle', half };
  }
  const angle = (Math.atan2(py, px) * (180 / Math.PI) + 90 + 360) % 360;
  const idx = Math.floor(angle / (360 / PALETTE_COUNT)) % PALETTE_COUNT;
  return { type: 'palette', id: ALL_PALETTE_IDS[idx] };
}

function wheelColor(region: WheelRegion, mode: 'light' | 'dark'): string | null {
  if (region.type === 'empty') return null;
  if (region.type === 'toggle') {
    return region.half === 'dark' ? '#1a1a1a' : '#ffffff';
  }
  // For mono, use dark/light-aware primary
  if (region.id === 'mono') return mode === 'dark' ? '#e0e0e0' : '#1a1a1a';
  return PALETTES[region.id].primary;
}

function PixelWheel({
  mode,
  onSelectPalette,
  onToggleMode,
}: {
  mode: 'light' | 'dark';
  onSelectPalette: (id: PaletteId) => void;
  onToggleMode: () => void;
}) {
  const cellSize = 8;
  const totalSize = GRID * (cellSize + GAP) - GAP;
  const half = GRID / 2;
  const outerR = half;
  const innerR = outerR * INNER_RATIO;

  const rects = useMemo(() => {
    const result: { x: number; y: number; color: string; region: WheelRegion }[] = [];
    for (let row = 0; row < GRID; row++) {
      for (let col = 0; col < GRID; col++) {
        const px = col - half + 0.5;
        const py = row - half + 0.5;
        const region = regionAt(px, py, outerR, innerR);
        const color = wheelColor(region, mode);
        if (color) {
          result.push({
            x: col * (cellSize + GAP),
            y: row * (cellSize + GAP),
            color,
            region,
          });
        }
      }
    }
    return result;
  }, [mode, half, outerR, innerR]);

  const handleClick = useCallback(
    (region: WheelRegion) => {
      if (region.type === 'toggle') {
        onToggleMode();
      } else if (region.type === 'palette') {
        onSelectPalette(region.id);
      }
    },
    [onSelectPalette, onToggleMode],
  );

  return (
    <svg
      viewBox={`0 0 ${totalSize} ${totalSize}`}
      width={totalSize}
      height={totalSize}
      style={{ maxWidth: '100%', cursor: 'pointer' }}
    >
      {rects.map((r, i) => (
        <rect
          key={i}
          x={r.x}
          y={r.y}
          width={cellSize}
          height={cellSize}
          fill={r.color}
          onClick={() => handleClick(r.region)}
          style={{ cursor: r.region.type !== 'empty' ? 'pointer' : 'default' }}
        />
      ))}
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/*  Tab                                                                */
/* ------------------------------------------------------------------ */

function getInitialAppearance(): { mode: 'light' | 'dark'; palette: PaletteId } {
  if (typeof window === 'undefined') return { mode: 'dark', palette: 'blue' };
  const storedMode = localStorage.getItem('alice_theme_mode') as 'light' | 'dark' | null;
  const storedPalette = localStorage.getItem('alice_palette') as PaletteId | null;
  return {
    mode: storedMode === 'light' || storedMode === 'dark' ? storedMode : 'dark',
    palette: storedPalette && ALL_PALETTE_IDS.includes(storedPalette) ? storedPalette : 'blue',
  };
}

export function AppearanceTab() {
  const [mode, setMode] = useState<'light' | 'dark'>(() => getInitialAppearance().mode);
  const [activePalette, setActivePalette] = useState<PaletteId>(() => getInitialAppearance().palette);

  const applyTheme = useCallback((newMode: 'light' | 'dark', newPalette: PaletteId) => {
    localStorage.setItem('alice_theme_mode', newMode);
    localStorage.setItem('alice_palette', newPalette);
    const colors = PALETTES[newPalette][newMode];
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
    root.style.setProperty('--alice-media-invert', newMode === 'dark' ? 'invert(1) hue-rotate(180deg)' : 'none');
    root.style.setProperty('--alice-media-invert-light', newMode === 'dark' ? 'none' : 'invert(1) hue-rotate(180deg)');
    const [r, g, b] = [
      parseInt(colors.onPrimary.slice(1, 3), 16),
      parseInt(colors.onPrimary.slice(3, 5), 16),
      parseInt(colors.onPrimary.slice(5, 7), 16),
    ];
    root.style.setProperty('--alice-chat-ink-muted', `rgba(${r}, ${g}, ${b}, 0.7)`);
    root.style.setProperty('--alice-chat-field-border', `rgba(${r}, ${g}, ${b}, 0.3)`);
  }, []);

  useEffect(() => {
    applyTheme(mode, activePalette);
  }, [mode, activePalette, applyTheme]);

  const handleSelectPalette = useCallback(
    (id: PaletteId) => {
      setActivePalette(id);
      applyTheme(mode, id);
    },
    [mode, applyTheme],
  );

  const handleToggleMode = useCallback(() => {
    const next = mode === 'dark' ? 'light' : 'dark';
    setMode(next);
    applyTheme(next, activePalette);
  }, [mode, activePalette, applyTheme]);

  return (
    <div style={sectionStyle}>
      <div className="flex justify-center">
        <PixelWheel
          mode={mode}
          onSelectPalette={handleSelectPalette}
          onToggleMode={handleToggleMode}
        />
      </div>

      <div className="flex justify-between items-center mt-4 px-2">
        <span className="font-pixel tracking-widest" style={{ fontSize: 10 }}>
          {mode === 'dark' ? '●' : '○'} {mode.toUpperCase()}
        </span>
        <span className="font-pixel tracking-widest" style={{ fontSize: 10 }}>
          {PALETTES[activePalette].label.toUpperCase()}
        </span>
      </div>

      <p className="font-numbers text-center m-0 mt-3" style={{ fontSize: 14, opacity: 0.5 }}>
        Tap center to toggle theme / Tap the ring to change color
      </p>
    </div>
  );
}
