export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const token = process.env.BALLCHASING_TOKEN;
  if (!token) return res.status(500).json({ error: 'Missing BALLCHASING_TOKEN env var' });

  const q = req.query || {};
  const replayId = String(q.replayId || q.id || '').trim();
  const shouldDownload = String(q.download || q.file || '').toLowerCase() === '1' || String(q.download || q.file || '').toLowerCase() === 'true';
  const mode = String(q.mode || '').toLowerCase();
  const playlistFromQuery = String(q.playlist || '').trim();
  const playerName = String(q.playerName || q['player-name'] || '').trim();
  const after = String(q.after || q.startedAt || '').trim();
  const count = Math.max(1, Math.min(10, Number(q.count || 5) || 5));

  const playlistForMode = (m) => {
    if (playlistFromQuery) return playlistFromQuery;
    if (m.includes('tournament')) return 'tournament';
    if (m.includes('1v1') || m.includes('duel') || m.includes('1s')) return m.includes('casual') || m.includes('unranked') ? 'unranked-duels' : 'ranked-duels';
    if (m.includes('2v2') || m.includes('double') || m.includes('2s')) return m.includes('casual') || m.includes('unranked') ? 'unranked-doubles' : 'ranked-doubles';
    if (m.includes('3v3') || m.includes('standard') || m.includes('3s')) return m.includes('casual') || m.includes('unranked') ? 'unranked-standard' : 'ranked-standard';
    return '';
  };

  const ballFetchJson = async (url) => {
    const r = await fetch(url, { headers: { Authorization: token } });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = data?.error || `Ballchasing request failed (${r.status})`;
      const err = new Error(msg);
      err.status = r.status;
      throw err;
    }
    return data;
  };

  try {
    if (replayId && shouldDownload) {
      const r = await fetch(`https://ballchasing.com/api/replays/${encodeURIComponent(replayId)}/file`, {
        headers: { Authorization: token },
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        return res.status(r.status).json({ error: data?.error || `Ballchasing replay file failed (${r.status})` });
      }
      const ab = await r.arrayBuffer();
      res.setHeader('Content-Type', r.headers.get('content-type') || 'application/octet-stream');
      res.setHeader('Content-Disposition', r.headers.get('content-disposition') || `attachment; filename="${replayId}.replay"`);
      return res.status(200).send(Buffer.from(ab));
    }

    if (replayId) {
      const replay = await ballFetchJson(`https://ballchasing.com/api/replays/${encodeURIComponent(replayId)}`);
      return res.status(200).json({ replay });
    }

    if (!playerName) return res.status(400).json({ error: 'Provide replayId or playerName' });
    const search = new URLSearchParams();
    search.append('player-name', playerName);
    const playlist = playlistForMode(mode);
    if (playlist) search.append('playlist', playlist);
    if (after) search.append('replay-date-after', after);
    search.append('count', String(count));
    search.append('sort-by', 'replay-date');
    search.append('sort-dir', 'desc');

    const listData = await ballFetchJson(`https://ballchasing.com/api/replays?${search.toString()}`);
    const first = Array.isArray(listData?.list) ? listData.list[0] : null;
    if (!first?.id) return res.status(404).json({ error: 'No Ballchasing replay found', list: listData?.list || [] });
    const replay = await ballFetchJson(`https://ballchasing.com/api/replays/${encodeURIComponent(first.id)}`);
    return res.status(200).json({ replay, list: listData.list || [] });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || 'Ballchasing API error' });
  }
}
