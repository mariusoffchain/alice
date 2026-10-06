import assert from 'node:assert/strict';
import test from 'node:test';
import { loadRagEvaluationRuntime } from '../../../scripts/rag-eval-runtime.mjs';

test('generation evaluation isolates preferences and fails closed on native storage', async () => {
  const runtime = await loadRagEvaluationRuntime(`
    export { getActiveModelId, getPreset, getAliceInstructions } from './packages/alice-ai/src/ai-preferences.ts';
    export { default as storage } from '@react-native-async-storage/async-storage';
    export * as secure from 'expo-secure-store';
    export * as files from 'expo-file-system/legacy';
    export * as tauri from './packages/alice-ai/src/tauri-runtime.ts';
  `, { evaluationPreferences: { alice_ai_local_model: 'qwen3-4b', alice_ai_preset_local: 'balanced' } });
  assert.equal(await runtime.getActiveModelId(), 'qwen3-4b');
  assert.equal(await runtime.getPreset('local'), 'balanced');
  assert.equal(await runtime.getAliceInstructions(), '');
  assert.equal(await runtime.storage.getItem('alice_chat_sessions'), null);
  await runtime.storage.setItem('synthetic-test-key', 'memory-only');
  assert.equal(await runtime.storage.getItem('synthetic-test-key'), 'memory-only');
  await assert.rejects(runtime.secure.getItemAsync('synthetic-key'), /forbidden/);
  await assert.rejects(runtime.secure.setItemAsync('synthetic-key', 'value'), /forbidden/);
  assert.throws(() => runtime.files.getInfoAsync('synthetic-path'), /forbidden/);
  assert.throws(() => runtime.files.deleteAsync('synthetic-path'), /forbidden/);
  assert.throws(() => runtime.tauri.tauriInvoke('local_ai_start'), /forbidden/);
});
