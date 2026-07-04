// APP116_TWITCH_EVENTSUB_WEBHOOK_ROUTE
// Drop this in: api/twitch-eventsub.js
// Optional env: TWITCH_EVENTSUB_SECRET, DISCORD_WEBHOOK_URL
// This accepts Twitch EventSub webhook calls and mirrors stream online/offline/title events.

import crypto from 'crypto';

function getHeader(req, name) {
  const value = req.headers?.[name.toLowerCase()] || req.headers?.[name];
  return Array.isArray(value) ? value[0] : value;
}

async function readRawBody(req) {
  if (typeof req.body === 'string') return req.body;
  if (req.body && typeof req.body === 'object') return JSON.stringify(req.body);
  return await new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function verifySignature(req, rawBody) {
  const secret = process.env.TWITCH_EVENTSUB_SECRET;
  if (!secret) return { ok:true, skipped:true };
  const messageId = getHeader(req, 'twitch-eventsub-message-id') || '';
  const timestamp = getHeader(req, 'twitch-eventsub-message-timestamp') || '';
  const signature = getHeader(req, 'twitch-eventsub-message-signature') || '';
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(messageId + timestamp + rawBody).digest('hex');
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok:false };
  return { ok:true };
}

async function postDiscord(text, sub = '', icon = '📺') {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) return;
  await fetch(webhookUrl, {
    method:'POST',
    headers:{ 'Content-Type':'application/json' },
    body:JSON.stringify({ content:`${icon} **twitch** — ${text}${sub ? `\n${sub}` : ''}`.slice(0, 1900) }),
  }).catch(() => {});
}

export const config = { api: { bodyParser:false } };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok:false, error:'POST only' });
  const rawBody = await readRawBody(req);
  const verified = verifySignature(req, rawBody);
  if (!verified.ok) return res.status(403).json({ ok:false, error:'bad twitch signature' });

  let payload = {};
  try { payload = JSON.parse(rawBody || '{}'); } catch (_) {}
  const messageType = getHeader(req, 'twitch-eventsub-message-type');

  if (messageType === 'webhook_callback_verification') {
    return res.status(200).send(payload.challenge || '');
  }

  const type = payload?.subscription?.type || 'twitch.event';
  const ev = payload?.event || {};
  const channel = ev.broadcaster_user_name || ev.broadcaster_user_login || ev.user_name || ev.user_login || 'stream';

  if (type.includes('stream.online')) await postDiscord(`${channel} went live`, ev.title || '', '🟣');
  if (type.includes('stream.offline')) await postDiscord(`${channel} went offline`, '', '⚫');
  if (type.includes('channel.update')) await postDiscord(`${channel} updated stream`, ev.title || '', '✏️');

  return res.status(200).json({ ok:true, type, channel });
}
