/**
 * Loaded with `node --import` so it runs before any test module — and therefore before
 * `config/env.js` is evaluated and snapshots these values.
 *
 * Blanking them in `setup.js` was not enough: ESM hoists every import, so `env.js` had already
 * read the real SMTP settings by the time setup's top-level code ran. The suite then delivered
 * to a live mailbox — one send took twenty-four seconds against Gmail, order tests timed out
 * waiting on the transport, and the account collects hundreds of identical messages.
 *
 * The delivery ledger is still exercised end to end; only the network is removed.
 */
process.env.SMTP_HOST = ''
process.env.SMS_API_URL = ''
process.env.SMS_API_KEY = ''
