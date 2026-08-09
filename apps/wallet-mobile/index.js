// Arkade requires Web Crypto randomness before any wallet module is evaluated.
// Keep this CommonJS entrypoint ordered: static ESM imports would be hoisted.
// Some Bitcoin dependencies also expect Node's process.version. Hermes exposes
// a partial process object, so complete it before the dependency graph loads.
if (global.process && typeof global.process.version === 'undefined') {
  global.process.version = '';
}

// Browsers already provide the complete Web Crypto API, including `subtle`.
// Never replace it with Expo's narrower native shim.
const browserCrypto = typeof window !== 'undefined' ? window.crypto : undefined;
if (browserCrypto?.subtle) {
  global.crypto = browserCrypto;
} else {
  // Load Expo's shim only on native. Evaluating it before reading
  // `window.crypto` can mask the browser's complete implementation.
  const Crypto = require('expo-crypto');
  if (!global.crypto) {
    global.crypto = {};
  }
  global.crypto.getRandomValues = Crypto.getRandomValues;
}

require('expo-router/entry');
