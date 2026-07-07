// Burton Battlers native advanced replay analyzer
// Vercel serverless endpoint: POST /api/advanced-review-parser
// This does not need Rocket League, CARL2, or Ballchasing iframe access. It turns linked
// Ballchasing stats/timeline + optional uploaded JSON/CSV/Markdown into a stable coach report.

function safeObj(v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; }
function arr(v) { return Array.isArray(v) ? v : []; }
function num(v, fallback = 0) { const n = Number(v); return Number.isFinite(n) ? n : fallback; }
function pct(n) { return `${Math.max(0, Math.min(100, Math.round(num(n))))}%`; }
function clamp(n, min, max) { return Math.max(min, Math.min(max, num(n))); }
function takeText(v, max = 12000) { return String(v || '').slice(0, max); }
function wordsFromAssets(assets = []) {
  return arr(assets).map(a => `${a.name || ''}\n${a.type || ''}\n${a.text || ''}`).join('\n').slice(0, 60000);
}
function tryParseJsonAssets(assets = []) {
  const out = [];
  for (const a of arr(assets)) {
    const name = String(a?.name || '');
    const text = String(a?.text || '').trim();
    if (!text || !/json/i.test(`${name} ${a?.type || ''}`)) continue;
    try { out.push(JSON.parse(text)); } catch (_) {}
  }
  return out;
}
function pullMetricFromText(text, names = []) {
  const safe = String(text || '');
  for (const name of names) {
    const rx = new RegExp(`${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[:=,-]?\\s*(-?\\d+(?:\\.\\d+)?)`, 'i');
    const m = safe.match(rx);
    if (m) return Number(m[1]);
  }
  return null;
}
function fmtTime(value) {
  if (value === null || value === undefined || value === '') return 'full';
  if (typeof value === 'string' && value.includes(':')) return value;
  const sec = Math.max(0, Math.round(num(value, 0)));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}
function summarizeStats(linkedStats = [], nativeReview = {}) {
  const stats = arr(linkedStats);
  const rows = arr(nativeReview.rows);
  const allRows = rows.length ? rows : stats.map(g => ({
    name: g.playerName || g.playerId || 'player',
    appPlayerId:g.playerId || null,
    goals:g.goals,
    assists:g.assists,
    saves:g.saves,
    shots:g.shots,
    score:g.score,
    demos:g.demos,
    color:g.color || '#B8FF4D',
  }));
  const totals = {
    goals: stats.reduce((s,g)=>s+num(g.goals),0),
    assists: stats.reduce((s,g)=>s+num(g.assists),0),
    saves: stats.reduce((s,g)=>s+num(g.saves),0),
    shots: stats.reduce((s,g)=>s+num(g.shots),0),
    demos: stats.reduce((s,g)=>s+num(g.demos),0),
    score: stats.reduce((s,g)=>s+num(g.score),0),
  };
  const teamRows = allRows.map(r => ({
    player: r.appName || r.name || r.playerName || r.playerId || 'player',
    goals:num(r.goals), assists:num(r.assists), saves:num(r.saves), shots:num(r.shots), demos:num(r.demos || r.demosInflicted), score:num(r.score),
    avgBoost:num(r.avgBoost, null), zeroBoostTime:num(r.zeroBoostTime, null), boostCollected:num(r.boostCollected, null), boostStolen:num(r.boostStolen, null),
    defThird:num(r.defThird, null), offThird:num(r.offThird, null), percentDefThird:num(r.percentDefThird, null), percentOffThird:num(r.percentOffThird, null),
    goalsAgainstLastDefender:num(r.goalsAgainstLastDefender, null), avgDistMates:num(r.avgDistMates, null), color:r.color || '#B8FF4D',
  }));
  return { stats, rows:teamRows, totals };
}
function buildTimeline(nativeReview = {}, entry = {}) {
  const events = arr(nativeReview.events).length ? arr(nativeReview.events) : arr(entry.reviewNotes).map(n => ({
    id:n.id, time:n.time || null, player:n.player || '', kind:n.title || 'review', type:'review', body:n.body || '',
  }));
  return events.slice(0, 24).map((ev, idx) => ({
    id:String(ev.id || `backend_event_${idx}`),
    time:ev.time,
    timecode:fmtTime(ev.time),
    player:String(ev.player || ev.player_name || 'team'),
    kind:String(ev.kind || ev.type || ev.event || 'moment'),
    note:String(ev.body || ev.note || ev.title || '').slice(0, 160),
  }));
}
function makeReport({ entry = {}, linkedStats = [], nativeReview = {}, assets = [], players = [] }) {
  const { stats, rows, totals } = summarizeStats(linkedStats, nativeReview);
  const assetText = wordsFromAssets(assets);
  const jsonAssets = tryParseJsonAssets(assets);
  const hasRawReplay = arr(assets).some(a => /\.replay$/i.test(String(a?.name || '')));
  const hasDataFiles = arr(assets).some(a => /\.(json|csv|md|markdown|txt)$/i.test(String(a?.name || '')) || /json|csv|markdown|text/i.test(String(a?.type || '')));
  const goalsAgainst = Math.max(0, ...stats.map(g => num(g.theirScore, 0)));
  const shotQuality = totals.shots ? (totals.goals / totals.shots) * 100 : 0;
  const estimatedXg = Math.max(0, Math.min(9.99,
    (totals.shots * 0.16) + (totals.assists * 0.18) + (totals.goals * 0.22) + (pullMetricFromText(assetText, ['xG','expected goals']) || 0)
  ));
  const pressureScore = clamp((totals.shots * 8) + (totals.goals * 15) - (totals.saves * 4), 0, 100);
  const defensiveStress = clamp((totals.saves * 11) + (goalsAgainst * 10) - (totals.shots * 3), 0, 100);
  const boostControl = (() => {
    const boostRows = rows.filter(r => Number.isFinite(r.boostCollected) || Number.isFinite(r.boostStolen) || Number.isFinite(r.avgBoost));
    if (!boostRows.length) return null;
    const avgBoost = boostRows.reduce((s,r)=>s+num(r.avgBoost, 50),0)/boostRows.length;
    const stolen = boostRows.reduce((s,r)=>s+num(r.boostStolen),0);
    const collected = boostRows.reduce((s,r)=>s+num(r.boostCollected),0);
    return clamp((avgBoost * 0.75) + (collected ? (stolen / Math.max(collected,1))*35 : 0), 0, 100);
  })();
  const timelineEvents = buildTimeline(nativeReview, entry);
  const shotMap = rows.map((r, idx) => {
    const shots = num(r.shots);
    const goals = num(r.goals);
    const playerXg = shots ? Math.max(0.05, (shots * 0.16) + (goals * 0.22) + (num(r.assists) * 0.08)) : 0;
    return {
      player:r.player,
      label:`${r.player} shot quality`,
      value:shots ? `${goals}/${shots} · xG ${playerXg.toFixed(2)}` : 'no shots',
      score:shots ? Math.round((goals / Math.max(shots,1))*100) : 0,
      zone:idx % 3 === 0 ? 'left lane' : idx % 3 === 1 ? 'center lane' : 'right lane',
      color:r.color,
    };
  });
  const boostMap = rows.map(r => ({
    player:r.player,
    label:`${r.player} boost control`,
    value:Number.isFinite(r.avgBoost) ? `avg ${Math.round(r.avgBoost)} · stolen ${Math.round(num(r.boostStolen))}` : Number.isFinite(r.boostCollected) ? `collected ${Math.round(r.boostCollected)}` : 'needs boost data',
    score:Number.isFinite(r.avgBoost) ? Math.round(r.avgBoost) : null,
    color:r.color,
  }));
  const passMap = rows.map(r => ({
    player:r.player,
    label:`${r.player} passing impact`,
    value:num(r.assists) ? `${num(r.assists)} assist${num(r.assists) === 1 ? '' : 's'}` : `${num(r.shots)} shots created`,
    score:num(r.assists) * 30 + num(r.shots) * 5,
    color:r.color,
  }));
  const fiftyMap = rows.map(r => ({
    player:r.player,
    label:`${r.player} challenge pressure`,
    value:num(r.demos) ? `${num(r.demos)} demos` : num(r.saves) ? `${num(r.saves)} saves under pressure` : 'review challenges',
    score:num(r.demos) * 20 + num(r.saves) * 8,
    color:r.color,
  }));
  const sections = [];
  sections.push({ title:'Coach Report', status:'backend ready', body:`Backend analyzed ${stats.length || rows.length} linked player rows${hasDataFiles ? ' plus uploaded report files' : ''}. Use this as the CARL2 replacement layer for tonight.` });
  sections.push({ title:'Timeline', status:timelineEvents.length ? 'ready' : 'limited', body:timelineEvents.length ? `${timelineEvents.length} key moments available for review.` : 'No event timeline came through; use score/pressure notes until Ballchasing timeline appears.' });
  sections.push({ title:'Shot Map / xG', status:'estimated', body:`Estimated team xG ${estimatedXg.toFixed(2)} from ${totals.shots} shots and ${totals.goals} goals. This is a coach estimate until raw-coordinate parsing is added.` });
  sections.push({ title:'Boost Map', status:boostControl === null ? 'limited' : 'ready', body:boostControl === null ? 'No full boost-route coordinates yet. Backend still shows boost stat rows when Ballchasing provides them.' : `Estimated boost control ${pct(boostControl)} from average boost, collected boost, and stolen boost.` });
  sections.push({ title:'Pass Map', status:'estimated', body:totals.assists ? `${totals.assists} assisted scoring plays found. Backend uses assists/shots as pass-pressure proxy until ball-touch chain parsing is added.` : 'No assists found. Treat this as a sign to build more controlled passes or second touches.' });
  sections.push({ title:'50/50 Map', status:'estimated', body:`Challenge pressure estimate uses demos/saves/goals-against until raw collision/challenge extraction is wired.` });
  if (hasRawReplay) sections.push({ title:'Raw Replay Parser', status:'queued', body:'A .replay file is attached. This backend can store and analyze linked stats now; binary .replay decoding can be added to this endpoint later.' });
  const focus = [];
  if (defensiveStress > 55) focus.push('third-man patience after failed clears');
  if (totals.shots <= Math.max(3, rows.length)) focus.push('controlled offense instead of booming clears');
  if (boostControl !== null && boostControl < 45) focus.push('small-pad routes and boost conservation');
  if (!totals.assists) focus.push('simple infield/outlet passing plays');
  if (totals.demos || rows.some(r => num(r.demos))) focus.push('demo awareness and recovery spacing');
  if (!focus.length) focus.push('review one goal against and repeat the best scoring pattern');
  const cards = [
    { label:'est. xG', value:estimatedXg.toFixed(2), color:'#A78BFA' },
    { label:'shot quality', value:totals.shots ? pct(shotQuality) : 'pending', color:'#4D9EFF' },
    { label:'pressure', value:pct(pressureScore), color:'#B8FF4D' },
    { label:'def stress', value:pct(defensiveStress), color:'#FFD166' },
  ];
  if (boostControl !== null) cards.push({ label:'boost control', value:pct(boostControl), color:'#FF8C42' });
  return {
    status: hasRawReplay ? 'backend_ready_raw_queued' : 'backend_ready',
    statusLabel: hasRawReplay ? 'backend ready · raw queued' : 'backend ready',
    parserMessage: hasRawReplay
      ? 'Backend coach report generated from Ballchasing/timeline/uploaded data. Raw .replay binary decoding is queued for a future parser upgrade.'
      : 'Backend coach report generated from Ballchasing/timeline/uploaded data.',
    confidence: hasDataFiles || rows.length ? 78 : 58,
    generatedAt:new Date().toISOString(),
    cards,
    sections,
    timelineEvents,
    maps:{ shotMap, boostMap, passMap, fiftyMap },
    trainingFocus:focus,
    extracted:{ hasRawReplay, hasDataFiles, jsonAssetCount:jsonAssets.length, assetCount:arr(assets).length, statRows:stats.length, playerRows:rows.length },
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok:false, error:'Use POST' });
  }
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : safeObj(req.body);
    const report = makeReport({
      entry:safeObj(body.entry),
      linkedStats:arr(body.linkedStats),
      nativeReview:safeObj(body.nativeReview),
      assets:arr(body.assets),
      players:arr(body.players),
    });
    return res.status(200).json({ ok:true, report });
  } catch (err) {
    return res.status(500).json({ ok:false, error:err?.message || 'advanced review parser failed' });
  }
}
