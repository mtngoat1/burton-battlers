export default async function handler(req, res) {
  try {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      return res.status(204).end();
    }

    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
      return res.status(500).json({
        error: "Missing VAPID env vars",
        hasPublic: !!process.env.VAPID_PUBLIC_KEY,
        hasPrivate: !!process.env.VAPID_PRIVATE_KEY,
      });
    }

    let webpush;
    try {
      const mod = await import("web-push");
      webpush = mod.default || mod;
    } catch (e) {
      return res.status(500).json({
        error: "web-push package is not installed on Vercel",
        detail: e.message,
      });
    }

    const body =
      typeof req.body === "string"
        ? JSON.parse(req.body || "{}")
        : req.body || {};

    const { subscription, title, message, data } = body;

    if (!subscription || !subscription.endpoint) {
      return res.status(400).json({ error: "Missing subscription" });
    }

    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT || "mailto:burtonbattlers@example.com",
      process.env.VAPID_PUBLIC_KEY,
      process.env.VAPID_PRIVATE_KEY
    );

    await webpush.sendNotification(
      subscription,
      JSON.stringify({
        title: title || "Burton Battlers",
        body: message || body.body || "You have a new notification.",
        icon: "/icon-192.png",
        badge: "/icon-192.png",
        data: data || { url: "/" },
      })
    );

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error("send-push crashed:", error);
    return res.status(500).json({
      error: "send-push crashed",
      detail: error.message,
    });
  }
}
