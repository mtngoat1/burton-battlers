// APP116_TWITCH_EVENTSUB_SUBSCRIBE_ROUTE
// Drop this in: api/twitch-eventsub-subscribe.js
// Env needed: TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET, TWITCH_EVENTSUB_SECRET, TWITCH_EVENTSUB_CALLBACK_BASE
// Call /api/twitch-eventsub-subscribe?broadcasterId=TWITCH_USER_ID&type=online

const TYPE_MAP = {
  online:'stream.online',
  offline:'stream.offline',
  update:'channel.update',
};

async function getAppToken() {
  const id = process.env.TWITCH_CLIENT_ID;
  const secret = process.env.TWITCH_CLIENT_SECRET;
  if (!id || !secret) throw new Error('missing TWITCH_CLIENT_ID or TWITCH_CLIENT_SECRET');
  const params = new URLSearchParams({ client_id:id, client_secret:secret, grant_type:'client_credentials' });
  const res = await fetch(`https://id.twitch.tv/oauth2/token?${params.toString()}`, { method:'POST' });
  const json = await res.json();
  if (!res.ok) throw new Error(json.message || 'twitch token failed');
  return json.access_token;
}

export default async function handler(req, res) {
  const broadcasterId = String(req.query?.broadcasterId || '').trim();
  const type = TYPE_MAP[String(req.query?.type || 'online')] || 'stream.online';
  const callbackBase = process.env.TWITCH_EVENTSUB_CALLBACK_BASE;
  const secret = process.env.TWITCH_EVENTSUB_SECRET;
  const clientId = process.env.TWITCH_CLIENT_ID;
  if (!broadcasterId) return res.status(400).json({ ok:false, error:'missing broadcasterId' });
  if (!callbackBase || !secret || !clientId) return res.status(500).json({ ok:false, error:'missing Twitch EventSub env vars' });
  try {
    const token = await getAppToken();
    const callback = `${callbackBase.replace(/\/$/, '')}/api/twitch-eventsub`;
    const body = {
      type,
      version:'1',
      condition:{ broadcaster_user_id:broadcasterId },
      transport:{ method:'webhook', callback, secret },
    };
    const subRes = await fetch('https://api.twitch.tv/helix/eventsub/subscriptions', {
      method:'POST',
      headers:{ 'Content-Type':'application/json', 'Client-Id':clientId, Authorization:`Bearer ${token}` },
      body:JSON.stringify(body),
    });
    const json = await subRes.json().catch(() => ({}));
    return res.status(subRes.ok ? 200 : subRes.status).json({ ok:subRes.ok, type, callback, response:json });
  } catch (err) {
    return res.status(500).json({ ok:false, error:err?.message || 'eventsub subscribe failed' });
  }
}
