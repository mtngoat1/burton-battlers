const webpush = require('web-push');

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || 'BCovp-nX0K1k6PIV-0ZvyfB5ecoFfieuuB3ukvgaVw3vafmQeHNlGZCSX4QEID2yOxb4r6khDwuYR-K8hpJl_QE';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@burtonbattles.app';

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!VAPID_PRIVATE_KEY) return res.status(500).json({ error: 'Missing VAPID_PRIVATE_KEY env var' });

  try {
    const { subscription, title, body, data } = req.body || {};
    if (!subscription?.endpoint) return res.status(400).json({ error: 'Missing subscription' });

    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

    await webpush.sendNotification(
      subscription,
      JSON.stringify({
        title: title || 'Burton Battlers',
        body: body || 'You have a new update.',
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        url: '/',
        data: data || {},
      })
    );

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('send-push failed', error);
    const status = error.statusCode || 500;
    return res.status(status).json({ error: error.message || 'push failed' });
  }
};
