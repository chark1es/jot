const { getRandomValues } = require('expo-crypto');

module.exports = {
  ensureSecure() {},
  getRandomValues,
  subtle: globalThis.crypto?.subtle,
};
