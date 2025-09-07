/*
 * gurutvapay-node-sdk.js
 *
 * Single-file Node.js SDK for GuruTvapay
 * - Supports API-key and OAuth (password grant) modes
 * - Methods: loginWithPassword, createPayment, transactionStatus, transactionList, request, verifyWebhook
 * - Built-in retry/backoff and idempotency support
 * - Uses global fetch when available (Node 18+). Falls back to node-fetch if not available.
 *
 * Requirements:
 * - Node.js 18+ (recommended) for built-in fetch, or install node-fetch (npm i node-fetch)
 *
 * Usage (CommonJS):
 *   const { GuruTvapayClient } = require('./gurutvapay-node-sdk');
 *   const client = new GuruTvapayClient({ env: 'uat', apiKey: process.env.GURUTVA_API_KEY });
 *
 * Usage (ESM):
 *   import { GuruTvapayClient } from './gurutvapay-node-sdk.js';
 */

import crypto from 'crypto';

// fetch shim for Node < 18
let fetchShim = globalThis.fetch;
let HeadersShim = globalThis.Headers;
let URLSearchParamsShim = globalThis.URLSearchParams;
try {
  if (!fetchShim) {
    // eslint-disable-next-line import/no-extraneous-dependencies
    const nodeFetch = await import('node-fetch');
    fetchShim = nodeFetch.default || nodeFetch;
    HeadersShim = nodeFetch.Headers;
    URLSearchParamsShim = nodeFetch.URLSearchParams;
  }
} catch (e) {
  // if node-fetch not installed and fetch missing, we'll throw at call time
}

const DEFAULT_ROOT = 'https://api.gurutvapay.com';
const ENV_PREFIXES = { uat: '/uat_mode', live: '/live' };

class GuruTvapayClient {
  constructor({ env = 'uat', apiKey = null, clientId = null, clientSecret = null, root = DEFAULT_ROOT, timeout = 30000, maxRetries = 3, backoffFactor = 0.5 } = {}) {
    if (!ENV_PREFIXES[env]) throw new Error("env must be 'uat' or 'live'");
    this.env = env;
    this.apiKey = apiKey;
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.root = root.replace(/\/$/, '');
    this.timeout = timeout;
    this.maxRetries = maxRetries;
    this.backoffFactor = backoffFactor;
    this.token = null; // { access_token, expires_at }
  }

  _getFetch() {
    if (fetchShim) return fetchShim;
    // last resort: try global fetch (Node 18+)
    if (globalThis.fetch) return globalThis.fetch;
    throw new Error('fetch is not available. Use Node 18+ or install node-fetch.');
  }

  _authHeader() {
    if (this.apiKey) return { Authorization: `Bearer ${this.apiKey}` };
    if (this.token && Date.now() / 1000 < (this.token.expires_at - 10)) return { Authorization: `Bearer ${this.token.access_token}` };
    return {};
  }

  async _fetchWithRetry(url, options = {}, attempt = 0) {
    const fetch = this._getFetch();
    attempt += 1;
    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), this.timeout);
      const res = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(id);

      if (res.ok) {
        const text = await res.text();
        try { return JSON.parse(text); } catch (e) { return { raw: text }; }
      }

      if (res.status === 401 || res.status === 403) {
        throw new Error(`AuthError: ${res.status} ${await res.text()}`);
      }
      if (res.status === 404) {
        throw new Error(`NotFound: ${url}`);
      }
      if (res.status === 429) {
        const retryAfter = res.headers.get('Retry-After');
        if (retryAfter && attempt <= this.maxRetries) {
          const wait = parseInt(retryAfter, 10) || (this.backoffFactor * Math.pow(2, attempt - 1) * 1000);
          await new Promise(r => setTimeout(r, wait));
          return this._fetchWithRetry(url, options, attempt);
        }
        throw new Error(`RateLimit: ${await res.text()}`);
      }
      if (res.status >= 500 && attempt <= this.maxRetries) {
        const wait = this.backoffFactor * Math.pow(2, attempt - 1) * 1000;
        await new Promise(r => setTimeout(r, wait));
        return this._fetchWithRetry(url, options, attempt);
      }

      // other errors
      throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    } catch (err) {
      // network / abort errors
      if (attempt <= this.maxRetries) {
        const wait = this.backoffFactor * Math.pow(2, attempt - 1) * 1000;
        await new Promise(r => setTimeout(r, wait));
        return this._fetchWithRetry(url, options, attempt);
      }
      throw err;
    }
  }

  async loginWithPassword(username, password, grant_type = 'password') {
    if (!this.clientId || !this.clientSecret) throw new Error('clientId and clientSecret required');
    const url = `${this.root}${ENV_PREFIXES[this.env]}/login`;
    const body = new URLSearchParamsShim({ grant_type, username, password, client_id: this.clientId, client_secret: this.clientSecret });
    const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
    const res = await this._fetchWithRetry(url, { method: 'POST', headers, body: body.toString() });
    if (!res || !res.access_token) throw new Error('Login failed');
    const expires_at = res.expires_at || (Math.floor(Date.now() / 1000) + (res.expires_in || 0));
    this.token = { access_token: res.access_token, expires_at };
    return this.token;
  }

  async createPayment({ amount, merchantOrderId, channel = 'web', purpose = 'Online Payment', customer = {}, expires_in = null, metadata = null } = {}, extraHeaders = {}) {
    const url = `${this.root}/initiate-payment`;
    const headers = { 'Content-Type': 'application/json', ...this._authHeader(), ...extraHeaders };
    const payload = { amount, merchantOrderId, channel, purpose, customer };
    if (expires_in !== null) payload.expires_in = expires_in;
    if (metadata !== null) payload.metadata = metadata;
    return this._fetchWithRetry(url, { method: 'POST', headers, body: JSON.stringify(payload) });
  }

  async transactionStatus(merchantOrderId) {
    const url = `${this.root}${ENV_PREFIXES[this.env]}/transaction-status`;
    const body = new URLSearchParamsShim({ merchantOrderId }).toString();
    const headers = { 'Content-Type': 'application/x-www-form-urlencoded', ...this._authHeader() };
    return this._fetchWithRetry(url, { method: 'POST', headers, body });
  }

  async transactionList(limit = 50, page = 0) {
    const url = `${this.root}${ENV_PREFIXES[this.env]}/transaction-list?limit=${limit}&page=${page}`;
    const headers = { ...this._authHeader() };
    return this._fetchWithRetry(url, { method: 'GET', headers });
  }

  async request(method, pathOrUrl, { headers = {}, params = null, data = null, jsonBody = null } = {}) {
    let url = pathOrUrl;
    if (!/^https?:\/\//.test(pathOrUrl)) {
      url = `${this.root}${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl}`;
    }
    if (params && typeof params === 'object') {
      const qs = new URLSearchParamsShim(params).toString();
      url += (url.includes('?') ? '&' : '?') + qs;
    }
    const allHeaders = { ...this._authHeader(), ...headers };
    let opts = { method, headers: allHeaders };
    if (jsonBody) {
      opts.body = JSON.stringify(jsonBody);
      opts.headers = { 'Content-Type': 'application/json', ...opts.headers };
    } else if (data) {
      opts.body = typeof data === 'string' ? data : new URLSearchParamsShim(data).toString();
      opts.headers = { 'Content-Type': 'application/x-www-form-urlencoded', ...opts.headers };
    }
    return this._fetchWithRetry(url, opts);
  }

  static verifyWebhook(payloadBytes, signatureHeader, secret) {
    if (!signatureHeader) return false;
    const sigHex = signatureHeader.startsWith('sha256=') ? signatureHeader.split('=')[1] : signatureHeader;
    const mac = crypto.createHmac('sha256', secret).update(payloadBytes).digest('hex');
    const sigBuf = Buffer.from(sigHex, 'hex');
    const macBuf = Buffer.from(mac, 'hex');
    if (sigBuf.length !== macBuf.length) return false;
    return crypto.timingSafeEqual(sigBuf, macBuf);
  }
}

export { GuruTvapayClient as GuruTvapayClient /* intentionally misspelled export to be fixed in usage */ };
export default GuruTvapayClient;
