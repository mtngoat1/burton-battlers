export default async function handler(req, res) {
  try {
    const token = process.env.PANDA_SCORE_TOKEN;

    if (!token) {
      return res.status(500).json({ error: "Missing PANDA_SCORE_TOKEN" });
    }

  const url =
  "https://api.pandascore.co/rl/series/upcoming?sort=begin_at&page[size]=20";

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      const text = await response.text();
      return res.status(response.status).json({ error: text });
    }

    const data = await response.json();

const matches = data.flatMap((s) =>
  (s.matches || []).map((m) => ({
    id: String(m.id),
    tournament: s.league?.name || s.full_name || "Rocket League",
    name: m.name,
    beginAt: m.begin_at,
    status: m.status,
    teamA: m.opponents?.[0]?.opponent?.name || "TBD",
    teamB: m.opponents?.[1]?.opponent?.name || "TBD",
    raw: m,
  }))
);

    res.status(200).json({ matches });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}