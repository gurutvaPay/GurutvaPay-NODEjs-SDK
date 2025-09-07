GuruTvapay Node.js SDK — gurutvapay-node-sdk.js

A single-file, drop-in Node.js SDK for the GuruTvapay payment gateway.
This README explains installation, configuration, and example usage (API-key and OAuth modes), idempotency, webhook verification, and publishing tips.

Requirements

Node.js 18+ recommended (has built-in fetch).

If using Node < 18, install node-fetch: npm install node-fetch.

crypto is used (built-in Node module).

What’s included

GuruTvapayClient class with methods:

loginWithPassword(username, password) — OAuth password grant

createPayment(payload, extraHeaders) — create payment (/initiate-payment)

transactionStatus(merchantOrderId) — check order status

transactionList(limit, page) — paginated list

request(method, pathOrUrl, options) — generic request (attach headers, params, body)

static verifyWebhook(payloadBytes, signatureHeader, secret) — HMAC-SHA256 verification

Built-in retry/backoff logic and basic timeout handling.

Installation

Save gurutvapay-node-sdk.js into your project.

(Optional, Node < 18) Install node-fetch:

npm install node-fetch

Quickstart — API-key mode (recommended)
// example.js
import GuruTvapayClient from './gurutvapay-node-sdk.js';

const client = new GuruTvapayClient({
  env: 'uat',                         // 'uat' or 'live'
  apiKey: process.env.GURUTVA_API_KEY // server-to-server API key (preferred)
});

async function run() {
  const payment = await client.createPayment({
    amount: 100,
    merchantOrderId: 'ORD' + Date.now(),
    channel: 'web',
    purpose: 'Online Payment',
    customer: { buyer_name: 'John Doe', email: 'john@example.com', phone: '9876543210' }
  });

  console.log('Payment created:', payment);
}

run();


Run:

node example.js

OAuth (password grant) example
import GuruTvapayClient from './gurutvapay-node-sdk.js';

const client = new GuruTvapayClient({
  env: 'uat',
  clientId: process.env.GURUTVA_CLIENT_ID,
  clientSecret: process.env.GURUTVA_CLIENT_SECRET
});

await client.loginWithPassword(process.env.GURUTVA_USERNAME, process.env.GURUTVA_PASSWORD);

const payment = await client.createPayment({ /* ... */ });
console.log(payment);

Idempotency (avoid duplicate payments)

Use unique Idempotency-Key header when creating payment:

const idempotencyKey = crypto.randomUUID(); // Node 14.17+ or use other UUID
const payment = await client.createPayment(payload, { 'Idempotency-Key': idempotencyKey });

Webhook verification (Express example)
import express from 'express';
import bodyParser from 'body-parser';
import GuruTvapayClient from './gurutvapay-node-sdk.js';

const WEBHOOK_SECRET = process.env.GURUTVA_WEBHOOK_SECRET || 'changeme';
const app = express();

// Use raw body to verify signature
app.use(bodyParser.raw({ type: '*/*' }));

app.post('/webhook', (req, res) => {
  const signature = req.get('X-Signature');
  const verified = GuruTvapayClient.verifyWebhook(req.body, signature, WEBHOOK_SECRET);
  if (!verified) return res.status(401).send('Invalid signature');
  const payload = JSON.parse(req.body.toString());
  // handle event...
  res.json({ ok: true });
});

app.listen(3000);

API surface & options

Constructor options:

env — 'uat' or 'live' (default 'uat')

apiKey — server API key (preferred)

clientId, clientSecret — for OAuth password grant

root — override base URL (default https://api.gurutvapay.com)

timeout, maxRetries, backoffFactor

Methods:

loginWithPassword(username, password) → { access_token, expires_at }

createPayment(payload, extraHeaders) → response JSON

transactionStatus(merchantOrderId) → response JSON

transactionList(limit, page) → response JSON

request(method, pathOrUrl, { headers, params, data, jsonBody }) → generic request result

static verifyWebhook(payloadBytes, signatureHeader, secret) → boolean

Error handling

The SDK throws errors for HTTP/auth failures and rate limits. Wrap calls in try/catch and map to your app’s error handling.

For 429 (rate-limited) responses the SDK attempts retries based on Retry-After header or exponential backoff.

Testing & local webhook simulation

Use the UAT environment for integration tests.

Simulate webhook signature with openssl:

payload='{"merchantOrderId":"ORD123","status":"success"}'
secret='your_webhook_secret'
sig=$(echo -n $payload | openssl dgst -sha256 -hmac "$secret" -hex | sed 's/^.* //')
curl -X POST http://localhost:3000/webhook -H "X-Signature: sha256=$sig" -d "$payload"

Publishing (optional)

Add package.json and publish to npm:

{
  "name": "gurutvapay-sdk",
  "version": "0.1.0",
  "main": "gurutvapay-node-sdk.js",
  "type": "module"
}


Run npm publish after testing. Use semantic versioning.

Security & best practices

Keep apiKey, clientSecret, and webhook secret in env vars / secret manager.

Verify webhooks server-side only.

Do not expose server API keys in front-end/browser code.

Use HTTPS in production.

Next steps I can help with

Convert this SDK to TypeScript (with typings).

Create npm package.json + publish workflow and GitHub Actions CI.

Add unit tests (Jest) and integration test examples.

Want a TypeScript version or the package.json + CI next?
