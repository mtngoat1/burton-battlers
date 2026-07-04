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
  const shouldTimeline = String(q.timeline || q.events || '').toLowerCase() === '1' || String(q.timeline || q.events || '').toLowerCase() === 'true';
  const mode = String(q.mode || '').toLowerCase();
  const playlistFromQuery = String(q.playlist || '').trim();
  const playerNameRaw = String(q.playerName || q['player-name'] || '').trim();
  const after = String(q.after || q.startedAt || '').trim();
  const afterBufferMinutes = Math.max(0, Math.min(180, Number(q.afterBufferMinutes || q.afterBuffer || 45) || 0));
  const count = Math.max(1, Math.min(20, Number(q.count || 10) || 10));

  const playlistForMode = (m) => {
    if (playlistFromQuery) return playlistFromQuery;
    if (m.includes('tournament')) return 'tournament';
    if (m.includes('1v1') || m.includes('duel') || m.includes('1s')) return m.includes('casual') || m.includes('unranked') ? 'unranked-duels' : 'ranked-duels';
    if (m.includes('2v2') || m.includes('double') || m.includes('2s')) return m.includes('casual') || m.includes('unranked') ? 'unranked-doubles' : 'ranked-doubles';
    if (m.includes('3v3') || m.includes('standard') || m.includes('3s')) return m.includes('casual') || m.includes('unranked') ? 'unranked-standard' : 'ranked-standard';
    return '';
  };

  const bufferedAfter = (value) => {
    if (!value) return '';
    const d = new Date(value);
    if (!Number.isFinite(d.getTime())) return value;
    return new Date(d.getTime() - afterBufferMinutes * 60000).toISOString();
  };

  const ballFetchJson = async (url) => {
    const r = await fetch(url, { headers: { Authorization: token, Accept: 'application/json' } });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = data?.error || `Ballchasing request failed (${r.status})`;
      const err = new Error(msg);
      err.status = r.status;
      throw err;
    }
    return data;
  };

  const ballFetchTimeline = async (id) => {
    const url = `https://ballchasing.com/dyn/replay/${encodeURIComponent(id)}/timeline`;
    let r = await fetch(url, { headers: { Authorization: token, Accept: 'application/json' } });
    if (r.status === 401 || r.status === 403) {
      r = await fetch(url, { headers: { Accept: 'application/json' } });
    }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = data?.error || `Ballchasing timeline failed (${r.status})`;
      const err = new Error(msg);
      err.status = r.status;
      throw err;
    }
    return data;
  };

  const searchList = async ({ name, playlist, afterValue, label }) => {
    const search = new URLSearchParams();
    search.append('player-name', name);
    if (playlist) search.append('playlist', playlist);
    if (afterValue) search.append('replay-date-after', afterValue);
    search.append('count', String(count));
    search.append('sort-by', 'replay-date');
    search.append('sort-dir', 'desc');
    const url = `https://ballchasing.com/api/replays?${search.toString()}`;
    const data = await ballFetchJson(url);
    return { label, url, list:Array.isArray(data?.list) ? data.list : [] };
  };

  try {
    if (replayId && shouldTimeline) {
      const timeline = await ballFetchTimeline(replayId);
      return res.status(200).json({ timeline });
    }

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

    if (!playerNameRaw) return res.status(400).json({ error: 'Provide replayId or playerName' });

    const names = Array.from(new Set(playerNameRaw.split(',').map(v => v.trim()).filter(Boolean)));
    const playlist = playlistForMode(mode);
    const afterBuffered = bufferedAfter(after);
    const strategies = [
      { label:'exact playlist + session time', playlist, afterValue:afterBuffered || after },
      { label:'exact playlist latest', playlist, afterValue:'' },
      { label:'any playlist + session time', playlist:'', afterValue:afterBuffered || after },
      { label:'any playlist latest', playlist:'', afterValue:'' },
    ];

    const attempts = [];
    for (const name of names) {
      for (const strategy of strategies) {
        const result = await searchList({ name, ...strategy });
        attempts.push({ name, label:result.label, count:result.list.length });
        const first = result.list[0];
        if (first?.id) {
          const replay = await ballFetchJson(`https://ballchasing.com/api/replays/${encodeURIComponent(first.id)}`);
          return res.status(200).json({
            replay,
            list:result.list,
            searchMeta:{
              matchedName:name,
              strategy:result.label,
              playlist:strategy.playlist || 'any',
              after:strategy.afterValue || '',
              attempts,
            },
          });
        }
      }
    }

    return res.status(404).json({
      error:'No Ballchasing replay found after broad search',
      attempts,
    });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || 'Ballchasing API error' });
  }
}
