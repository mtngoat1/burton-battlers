// APP116_RLCS_DISCORD_WEBHOOK_ROUTE
// Drop this in: api/discord-webhook.js
// Optional env: DISCORD_WEBHOOK_URL. Keeps the webhook secret off the frontend.

function cleanText(value = '', limit = 1800) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok:false, error:'POST only' });

  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) return res.status(200).json({ ok:true, skipped:true, reason:'missing DISCORD_WEBHOOK_URL' });

  try {
    const body = typeof req.body === 'object' && req.body ? req.body : {};
    const source = cleanText(body.source || 'app', 40);
    const text = cleanText(body.text || body.content || 'new update', 700);
    const sub = cleanText(body.sub || '', 700);
    const icon = cleanText(body.icon || '🔔', 8);
    const content = `${icon} **${source}** — ${text}${sub ? `\n${sub}` : ''}`;

    const discordRes = await fetch(webhookUrl, {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body:JSON.stringify({ content }),
    });

    if (!discordRes.ok) {
      const errText = await discordRes.text().catch(() => '');
      return res.status(502).json({ ok:false, error:`discord webhook failed ${discordRes.status}`, detail:errText.slice(0, 300) });
    }

    return res.status(200).json({ ok:true });
  } catch (err) {
    return res.status(500).json({ ok:false, error:err?.message || 'discord webhook failed' });
  }
}
