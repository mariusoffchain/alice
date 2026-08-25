// No-op stub for @ledgerhq/ledger-bitcoin. The descriptor library requires this
// eagerly but only uses it inside Ledger-signing functions Explorer never
// calls (it derives addresses, it does not sign). Exporting an empty object is
// enough for the eager `require` to succeed.
module.exports = {};
