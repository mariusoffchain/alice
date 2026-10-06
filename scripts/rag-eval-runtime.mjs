import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { homedir, tmpdir } from 'node:os';
import { relative, resolve } from 'node:path';

// Default to offline lexical retrieval. A caller may explicitly supply a
// matcher for controlled E5 evaluation; this helper never downloads a model.
export async function loadRagEvaluationRuntime(entry, { revision, evaluationPreferences } = {}) {
  const root = process.cwd();
  const result = await build({
    stdin: { contents: `${entry}\nexport { setEvaluationSemanticMatcher } from './packages/alice-ai/src/semantic-runtime';`, resolveDir: root, sourcefile: 'rag-eval-entry.ts', loader: 'ts' },
    bundle: true, write: false, platform: 'node', format: 'esm',
    external: evaluationPreferences ? [] : ['react-native'],
    alias: {
      // The app-side Learn provider only needs this bridge; avoid importing
      // React/chat and unrelated application backends into a Node evaluator.
      '@alice-wallet/alice-ai': resolve(root, 'packages/alice-ai/src/learn-context.ts'),
      '@alice-wallet/alice-content': resolve(root, 'packages/alice-content'),
    },
    plugins: [{ name: 'offline-semantic-evaluation', setup(builder) {
      // Generation evaluation uses the real desktop backend while keeping
      // preferences/storage in memory. No user profile or wallet is opened.
      if (evaluationPreferences) {
        builder.onResolve({ filter: /^@react-native-async-storage\/async-storage$/ }, () => ({ path: 'storage', namespace: 'generation-stub' }));
        builder.onResolve({ filter: /^react-native$/ }, () => ({ path: 'platform', namespace: 'generation-stub' }));
        builder.onResolve({ filter: /(?:^|\/)tauri-runtime(?:\.ts)?$/ }, () => ({ path: 'tauri', namespace: 'generation-stub' }));
        builder.onResolve({ filter: /^expo-secure-store$/ }, () => ({ path: 'secure-store', namespace: 'generation-stub' }));
        builder.onResolve({ filter: /^expo-file-system(?:\/legacy)?$/ }, () => ({ path: 'file-system', namespace: 'generation-stub' }));
        builder.onLoad({ filter: /.*/, namespace: 'generation-stub' }, args => ({ contents: args.path === 'platform'
          ? "export const Platform = { OS: 'web', select: values => values.web ?? values.default };"
          : args.path === 'tauri' ? "export const isTauriDesktop = () => false; export function tauriInvoke(){ throw Error('Tauri bridge is forbidden in generation evaluation'); }"
          : args.path === 'file-system' ? "export const documentDirectory = 'forbidden://'; export function getInfoAsync(){ throw Error('Native filesystem is forbidden in generation evaluation'); } export const deleteAsync = getInfoAsync, makeDirectoryAsync = getInfoAsync, moveAsync = getInfoAsync, createDownloadResumable = getInfoAsync;"
          : args.path === 'secure-store' ? "export const WHEN_UNLOCKED_THIS_DEVICE_ONLY = 'unavailable'; export async function getItemAsync(){ throw Error('SecureStore is forbidden in generation evaluation'); } export const setItemAsync = getItemAsync, deleteItemAsync = getItemAsync;"
          : `const values = new Map(Object.entries(${JSON.stringify(evaluationPreferences)}));
             export default { getItem: async key => values.get(key) ?? null,
               setItem: async (key,value) => {values.set(key,value)},
               removeItem: async key => {values.delete(key)},
               getAllKeys: async () => [...values.keys()],
               multiGet: async keys => keys.map(key => [key, values.get(key) ?? null]) };`, loader: 'js' }));
      }
      builder.onResolve({ filter: /semantic-runtime$/ }, () => ({ path: 'semantic-runtime', namespace: 'offline-eval' }));
      builder.onLoad({ filter: /.*/, namespace: 'offline-eval' }, () => ({ contents: `
        let matcher = null;
        export function setEvaluationSemanticMatcher(next) { matcher = next; }
        export async function getSemanticMatches(query, topK) { return matcher ? matcher(query, topK) : null; }
      `, loader: 'js' }));
      if (revision) builder.onLoad({ filter: /\.[cm]?[jt]sx?$/, namespace: 'file' }, args => {
        const path = relative(root, args.path);
        if (path.startsWith('..') || path.includes('node_modules/')) return;
        // Read the COMPLETE historical implementation, not just its planner.
        // The caller passes a known Git revision; no shell interpolation.
        const contents = execFileSync('git', ['show', `${revision}:${path}`], { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
        return { contents, loader: path.endsWith('.tsx') ? 'tsx' : path.endsWith('.ts') ? 'ts' : 'js' };
      });
    } }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`);
}

/**
 * Replaces the machine-specific prefixes of absolute paths in an evaluation
 * report (home directory, temporary directory, repository checkout) by
 * placeholders, so a committed report names no account or disk layout. Hashes,
 * ids and every other value are untouched. Applied right before a report is
 * written; it never changes what a run did.
 */
export function redactLocalPaths(value, roots = {}) {
  const home = roots.home ?? homedir();
  const tmp = roots.tmp ?? tmpdir();
  const repo = roots.repo ?? process.cwd();
  const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rules = [
    [new RegExp(escape(repo) + '(?=/|"|$)', 'g'), '<repo>'],
    [new RegExp(escape(home) + '/Documents/alice-eval-models/', 'g'), '<eval-models>/'],
    [new RegExp(escape(home) + '/Library/Application Support/com\\.alicebitcoin\\.desktop/models/', 'g'), '<desktop-models>/'],
    [new RegExp('(?:/private)?' + escape(tmp.replace(/^\/private/, '')) + '/', 'g'), '<tmp>/'],
    [/\/private\/tmp\//g, '<tmp>/'],
    [new RegExp(escape(home) + '(?=/|"|$)', 'g'), '<home>'],
    [/\/Users\/[^/\s"]+(?=\/|"|$)/g, '<home>'],
    [/\/home\/[^/\s"]+(?=\/|"|$)/g, '<home>'],
  ];
  const redactText = text => rules.reduce((current, [pattern, replacement]) => current.replace(pattern, replacement), text);
  const walk = node => {
    if (typeof node === 'string') return redactText(node);
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === 'object') return Object.fromEntries(Object.entries(node).map(([key, item]) => [key, walk(item)]));
    return node;
  };
  return walk(value);
}
