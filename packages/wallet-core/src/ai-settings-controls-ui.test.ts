import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const mobile = fs.readFileSync(path.join(root, 'apps/wallet-mobile/app/ai-settings.tsx'), 'utf8');
const desktop = fs.readFileSync(path.join(root, 'apps/app-web/src/app/settings/page.tsx'), 'utf8');

test('mobile settings expose switches for local, cloud, and custom AI', () => {
  assert.match(mobile, /accessibilityRole="switch"/);
  assert.match(mobile, /chat\.localAIEnabled/);
  assert.match(mobile, /chat\.cloudAIEnabled/);
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
