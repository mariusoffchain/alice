import assert from 'node:assert/strict';
import test from 'node:test';
import { ALL_PALETTE_IDS, PALETTES } from '../../../../packages/alice-content/src/theme.ts';
import { webThemeTokens } from './theme-tokens.ts';

function luminance(hex: string) {
  const rgb = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4);
  return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
}
function contrast(a: string, b: string) { const x = luminance(a), y = luminance(b); return (Math.max(x,y)+.05)/(Math.min(x,y)+.05); }
for (const mode of ['dark', 'light'] as const) {
  for (const palette of ALL_PALETTE_IDS) test(`${mode}/${palette}: readable shared surfaces, links and selection`, () => {
    const tokens = webThemeTokens(mode, palette);
    for (const background of ['--alice-bg', '--alice-sidebar-bg', '--alice-bg-soft', '--alice-card-bg', '--alice-hover'] as const) {
      for (const foreground of ['--alice-text', '--alice-muted', '--alice-selected'] as const) {
        assert.ok(contrast(tokens[background], tokens[foreground]) >= 4.5, `${foreground} on ${background}`);
      }
      for (const fg of ['--alice-primary', '--alice-danger', '--alice-warning', '--alice-success', '--alice-info'] as const) assert.ok(contrast(tokens[background], tokens[fg]) >= 4.5, `${fg} on ${background}`);
      assert.ok(contrast(tokens[background], tokens['--alice-control-border']) >= 3, `control on ${background}`);
    }
    assert.equal(tokens['--alice-bg'], PALETTES[palette][mode].background);
    if (mode === 'dark') assert.equal(tokens['--alice-sidebar-bg'], PALETTES[palette][mode].backgroundSoft);
    assert.ok(contrast(tokens['--alice-on-primary'], tokens['--alice-primary']) >= 4.5);
    for (const bg of ['--alice-chat-field-bg', '--alice-chat-bubble-user'] as const) assert.ok(contrast(tokens['--alice-chat-ink'], tokens[bg]) >= 4.5);
    assert.ok(contrast(tokens['--alice-on-danger'], tokens['--alice-danger']) >= 4.5);
    assert.ok(contrast(tokens['--alice-danger-ink'], tokens['--alice-danger-soft']) >= 4.5);
    assert.ok(contrast(tokens['--alice-warning-ink'], tokens['--alice-warning-soft']) >= 4.5);
    assert.ok(contrast(tokens['--alice-chat-ink-muted'], tokens['--alice-chat-bg']) >= 4.5);
    assert.ok(contrast(tokens['--alice-chat-field-border'], tokens['--alice-chat-bg']) >= 3);
    assert.equal(tokens['--alice-selected'], tokens['--alice-text']);
  });
}
test('monochrome changes the mascot accent in both themes', () => {
  assert.notEqual(webThemeTokens('dark','mono')['--alice-primary'], webThemeTokens('dark','blue')['--alice-primary']);
  assert.ok(contrast(webThemeTokens('dark','mono')['--alice-primary'], webThemeTokens('light','mono')['--alice-primary']) > 7);
});

test('switching palette updates surfaces as well as the rabbit', () => {
  for (const mode of ['dark', 'light'] as const) {
    const blue = webThemeTokens(mode, 'blue'), green = webThemeTokens(mode, 'green');
    assert.notEqual(blue['--alice-sidebar-bg'], green['--alice-sidebar-bg']);
    assert.notEqual(blue['--alice-border'], green['--alice-border']);
    assert.notEqual(blue['--alice-primary'], green['--alice-primary']);
  }
});

// Regression: acceptable contrast must not allow an unrelated blue cast.
test('all light palettes have distinct secondary surfaces', () => {
  const surfaces = ALL_PALETTE_IDS.map(p => webThemeTokens('light', p)['--alice-sidebar-bg']);
  assert.equal(new Set(surfaces).size, ALL_PALETTE_IDS.length);
});
test('red light chrome never inherits the old blue surface', () => {
  const red = webThemeTokens('light', 'red');
  for (const key of ['--alice-sidebar-bg','--alice-bg-soft','--alice-card-bg','--alice-hover','--alice-border','--alice-illustration-bg'] as const) {
    const hex = red[key];
    const [r,g,b] = [1,3,5].map(i => parseInt(hex.slice(i,i+2),16));
    assert.ok(r >= g && r >= b, `${key} has a foreign cool cast: ${hex}`);
    assert.notEqual(hex, '#f6f8fb');
  }
});
test('monochrome surfaces remain neutral in both modes', () => {
  for (const mode of ['dark','light'] as const) for (const key of ['--alice-sidebar-bg','--alice-card-bg','--alice-hover','--alice-illustration-bg'] as const) {
    const hex = webThemeTokens(mode,'mono')[key];
    assert.equal(hex.slice(1,3),hex.slice(3,5));assert.equal(hex.slice(3,5),hex.slice(5,7));
  }
});
