const ExpoCrypto = require('expo-crypto');

function getRandomValues(target) {
  if (!ArrayBuffer.isView(target)) {
    throw new TypeError('Expected a typed array.');
  }
  const bytes = ExpoCrypto.getRandomBytes(target.byteLength);
  new Uint8Array(target.buffer, target.byteOffset, target.byteLength).set(bytes);
  return target;
}

const webcrypto = { getRandomValues };

module.exports = {
  webcrypto,
  randomBytes: ExpoCrypto.getRandomBytes,
};
