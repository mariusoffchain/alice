import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
// L'ecran mobile delegue ses interrupteurs a PixelToggle (alice-ui), qui
// porte le accessibilityRole="switch"; on lit les deux sources ensemble.
const mobile = fs.readFileSync(path.join(root, 'apps/wallet-mobile/app/ai-settings.tsx'), 'utf8')
  + fs.readFileSync(path.join(root, 'packages/alice-ui/src/components/PixelToggle.tsx'), 'utf8');
// Depuis la refonte reglages en onglets (#42), les interrupteurs IA desktop
// vivent dans l'onglet IA; le role="switch" et le style des toggles vivent
// dans les primitives partagees (PixelSwitch, settings/ui.tsx).
const desktop = fs.readFileSync(path.join(root, 'apps/app-web/src/components/settings/AiTab.tsx'), 'utf8')
  + fs.readFileSync(path.join(root, 'apps/app-web/src/components/settings/ui.tsx'), 'utf8');

test('mobile settings expose switches for local, cloud, and custom AI', () => {
  assert.match(mobile, /accessibilityRole="switch"/);
  assert.match(mobile, /chat\.backendEnabled\.local/);
  assert.match(mobile, /chat\.backendEnabled\.cloud/);
  assert.match(mobile, /chat\.backendEnabled\.custom/);
  assert.doesNotMatch(mobile, /<Switch/);
  assert.match(mobile, />ALICE AI</);
  assert.match(mobile, /disabled=\{!chat\.localAvailable\}/);
  assert.match(mobile, /import \{ PixelToggle, useTheme \}/);
});

test('desktop settings expose switches for local, cloud, and custom AI', () => {
  assert.match(desktop, /role="switch"/);
  assert.match(desktop, /chat\.backendEnabled\.local/);
  assert.match(desktop, /chat\.backendEnabled\.cloud/);
  assert.match(desktop, /chat\.backendEnabled\.custom/);
  assert.doesNotMatch(desktop, />ALICE AI</);
  assert.match(desktop, /disabled=\{!chat\.localAvailable\}/);
  assert.match(desktop, /borderRadius: 0/);
});
