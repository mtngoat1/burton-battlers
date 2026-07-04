// Optional Vercel route for Twitch live status. Safe if env vars are missing.
let tokenCache = null;

async function getAppToken() {
  const clientId = process.env.TWITCH_CLIENT_ID;
  const secret = process.env.TWITCH_CLIENT_SECRET;
  if (!clientId || !secret) return null;
  if (tokenCache?.token && tokenCache.expiresAt > Date.now()) return tokenCache.token;
  const body = new URLSearchParams({ client_id: clientId, client_secret: secret, grant_type: "client_credentials" });
  const res = await fetch("https://id.twitch.tv/oauth2/token", { method:"POST", body });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) throw new Error("twitch token request failed");
  tokenCache = { token: json.access_token, expiresAt: Date.now() + Math.max(60, Number(json.expires_in || 3600) - 60) * 1000 };
  return tokenCache.token;
}

export default async function handler(req, res) {
  try {
    res.setHeader("Access-Control-Allow-Origin", "*");
    const clientId = process.env.TWITCH_CLIENT_ID;
    const channels = String(req.query?.channels || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean).slice(0, 20);
    if (!channels.length) return res.status(200).json({ ok:true, connected:false, streams:[] });
    const token = await getAppToken();
    if (!token || !clientId) return res.status(200).json({ ok:true, connected:false, streams:[], error:"twitch env not connected" });
    const qs = channels.map(ch => `user_login=${encodeURIComponent(ch)}`).join("&");
    const twitchRes = await fetch(`https://api.twitch.tv/helix/streams?${qs}`, { headers:{ "Client-ID": clientId, Authorization:`Bearer ${token}` } });
    const json = await twitchRes.json().catch(() => ({}));
    if (!twitchRes.ok) throw new Error(json?.message || "twitch streams request failed");
    const live = (json.data || []).map(s => ({ ...s, live:true }));
    return res.status(200).json({ ok:true, connected:true, streams:live, checkedAt:new Date().toISOString() });
  } catch (err) {
    return res.status(200).json({ ok:true, connected:false, streams:[], error:err?.message || "twitch status unavailable" });
  }
}
