// APP114_RLCS_CLEAN_BETS_BRACKET_UI_FIX
// APP115_GEEKAY_EU_BET_TEAM_PATCH
// APP116_RLCS_CRON_CACHE_DISCORD_READY_PATCH
// Drop this in: api/rlcs-lcq.js
// Supports ?region=na and ?region=eu. Bets are filtered to known teams only; bracket can show all pulled pools.

const CACHE_MS = 45 * 1000;

const REGION_CONFIGS = {
  na: {
    id: "na",
    label: "North America",
    eventSlug: "tournament/rlcs-2026-north-america-last-chance-qualifier/event/3v3-bracket",
    watchlist: ["Dignitas", "Gen.G Mobil1 Racing", "M80", "FUT Esports"],
    day1CorePoolIds: [3325496, 3325497, 3325498, 3325499],
    fallbackDay2PhaseId: 2297299,
  },
  eu: {
    id: "eu",
    label: "Europe",
    eventSlug: "tournament/rlcs-2026-europe-last-chance-qualifier/event/3v3-bracket",
    // Small default EU known-team board. Override with RLCS_EU_BET_TEAMS if you want a different list.
    watchlist: ["Novo Esports", "Magnolia", "Kaydop Corp", "Geekay Esports"],
    // Day 1 EU pools appear to use this phase/pool range on start.gg. Day 2 is discovered from event phases when available.
    day1CorePoolIds: [3325158, 3325159, 3325160, 3325161, 3325162, 3325163, 3325164, 3325165],
    fallbackDay2PhaseId: 2297130,
  },
};

const memoryCache = new Map();

function cleanName(name = "") {
  return String(name || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function readListEnv(name) {
  return String(process.env[name] || "")
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function getRegion(req) {
  const raw = String(req?.query?.region || process.env.RLCS_DEFAULT_REGION || "na").toLowerCase();
  return REGION_CONFIGS[raw] ? raw : "na";
}

function getConfig(region) {
  const base = REGION_CONFIGS[region] || REGION_CONFIGS.na;
  const slugEnv = process.env[`RLCS_${region.toUpperCase()}_EVENT_SLUG`];
  const teamsEnv = readListEnv(`RLCS_${region.toUpperCase()}_BET_TEAMS`);
  const poolsEnv = readListEnv(`RLCS_${region.toUpperCase()}_DAY1_POOL_IDS`).map(Number).filter(Number.isFinite);
  const phaseEnv = Number(process.env[`RLCS_${region.toUpperCase()}_DAY2_PHASE_ID`] || "");
  return {
    ...base,
    eventSlug: slugEnv || base.eventSlug,
    watchlist: region === "na" ? base.watchlist : (teamsEnv.length ? teamsEnv : base.watchlist),
    day1CorePoolIds: poolsEnv.length ? poolsEnv : base.day1CorePoolIds,
    fallbackDay2PhaseId: Number.isFinite(phaseEnv) && phaseEnv > 0 ? phaseEnv : base.fallbackDay2PhaseId,
  };
}

async function gql(query, variables = {}) {
  const token = process.env.STARTGG_TOKEN;
  if (!token) throw new Error("missing STARTGG_TOKEN in this Vercel project");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9500);

  try {
    const res = await fetch("https://api.start.gg/gql/alpha", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ query, variables }),
      signal: controller.signal,
    });

    const text = await res.text();
    let json = {};
    try { json = text ? JSON.parse(text) : {}; } catch (_) {}

    if (!res.ok || json.errors) {
      const graphErr = Array.isArray(json.errors) ? json.errors.map((e) => e.message).join(" | ") : "";
      throw new Error(graphErr || `start.gg request failed with HTTP ${res.status}`);
    }
    return json.data;
  } finally {
    clearTimeout(timeout);
  }
}

const EVENT_QUERY = `
query GetEvent($slug: String!) {
  event(slug: $slug) {
    id
    name
    slug
    phases { id name }
  }
}`;

const PHASE_GROUPS_QUERY = `
query PhaseGroupsByPhase($phaseId: ID!, $page: Int!, $perPage: Int!) {
  phase(id: $phaseId) {
    id
    name
    phaseGroups(query: { page: $page, perPage: $perPage }) {
      pageInfo { total totalPages page perPage }
      nodes { id displayIdentifier }
    }
  }
}`;

const PHASE_GROUP_SETS_QUERY = `
query PhaseGroupSets($phaseGroupId: ID!, $page: Int!, $perPage: Int!) {
  phaseGroup(id: $phaseGroupId) {
    id
    displayIdentifier
    sets(page: $page, perPage: $perPage, sortType: STANDARD) {
      pageInfo { total totalPages page perPage }
      nodes {
        id
        identifier
        fullRoundText
        round
        state
        startAt
        winnerId
        slots {
          id
          standing { placement stats { score { value } } }
          entrant { id name participants { id gamerTag } }
        }
      }
    }
  }
}`;

async function getAllPhaseGroups(phaseId) {
  const perPage = 50;
  let page = 1;
  const all = [];
  let phaseName = `phase ${phaseId}`;

  while (true) {
    const data = await gql(PHASE_GROUPS_QUERY, { phaseId, page, perPage });
    const phase = data?.phase;
    if (!phase?.id) throw new Error(`could not read start.gg phase ${phaseId}`);
    phaseName = phase.name || phaseName;
    const groups = phase.phaseGroups || {};
    all.push(...(groups.nodes || []).map((g) => ({ id:Number(g.id), displayIdentifier:g.displayIdentifier, phaseId:Number(phase.id), phaseName })));
    if (!groups.pageInfo?.totalPages || page >= groups.pageInfo.totalPages) break;
    page += 1;
  }
  return all;
}

async function getAllSetsForGroup(phaseGroupId, phaseName = "bracket") {
  const perPage = 100;
  let page = 1;
  const all = [];
  let info = null;

  while (true) {
    const data = await gql(PHASE_GROUP_SETS_QUERY, { phaseGroupId, page, perPage });
    const group = data?.phaseGroup;
    if (!group?.id) throw new Error(`could not read start.gg pool ${phaseGroupId}`);
    info = { id:Number(group.id), displayIdentifier:group.displayIdentifier || String(phaseGroupId), phaseName };
    const sets = group.sets || {};
    all.push(...(sets.nodes || []));
    if (!sets.pageInfo?.totalPages || page >= sets.pageInfo.totalPages) break;
    page += 1;
  }
  return { ...info, sets:all };
}

function rawSetScore(slot) {
  const value = slot?.standing?.stats?.score?.value;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function setScore(slot) {
  const n = rawSetScore(slot);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function scoreUnavailable(slot1, slot2) {
  const a = rawSetScore(slot1);
  const b = rawSetScore(slot2);
  return (Number.isFinite(a) && a < 0) || (Number.isFinite(b) && b < 0);
}

function normalizeSet(pool, set, watchlist, region) {
  const watchClean = new Map(watchlist.map((team) => [cleanName(team), team]));
  const rawSlot1 = set.slots?.[0] || null;
  const rawSlot2 = set.slots?.[1] || null;
  const slot1 = rawSlot1?.entrant || null;
  const slot2 = rawSlot2?.entrant || null;
  const team1 = slot1?.name || "TBD";
  const team2 = slot2?.name || "TBD";
  const watchTeams = [team1, team2].map((t) => watchClean.get(cleanName(t))).filter(Boolean);

  return {
    region,
    phase: pool.phaseName,
    pool: pool.displayIdentifier,
    poolId: pool.id,
    setId: Number(set.id),
    identifier: set.identifier || null,
    round: set.fullRoundText || set.round || "match",
    state: set.state,
    startAt: set.startAt ? new Date(Number(set.startAt) * 1000).toISOString() : null,
    winnerId: set.winnerId || null,
    team1,
    team1Id: slot1?.id || null,
    team1Score: setScore(rawSlot1),
    team1Players: (slot1?.participants || []).map((p) => p.gamerTag).filter(Boolean).slice(0, 3),
    team2,
    team2Id: slot2?.id || null,
    team2Score: setScore(rawSlot2),
    team2Players: (slot2?.participants || []).map((p) => p.gamerTag).filter(Boolean).slice(0, 3),
    scoreUnavailable: scoreUnavailable(rawSlot1, rawSlot2),
    watchTeams,
    tier: watchTeams.length ? "high" : null,
    bettableNow: !!(slot1?.id && slot2?.id && watchTeams.length && !set.winnerId),
    source: "live",
  };
}

function getDay2PhaseId(event, cfg) {
  const phase = (event?.phases || []).find((p) => /day\s*2/i.test(String(p?.name || "")));
  const id = Number(phase?.id);
  return Number.isFinite(id) && id > 0 ? id : cfg.fallbackDay2PhaseId;
}

function shouldPullAllDay2Groups(groupCount) {
  const max = Number(process.env.RLCS_MAX_DAY2_GROUPS || 32);
  return groupCount <= max;
}

async function pullLive(region) {
  const cfg = getConfig(region);
  const startedAt = Date.now();
  const eventData = await gql(EVENT_QUERY, { slug: cfg.eventSlug });
  const event = eventData?.event || { id:null, name:"3v3 Bracket", slug:cfg.eventSlug, phases:[] };
  const day2PhaseId = getDay2PhaseId(event, cfg);

  let day2Groups = [];
  let day2PhaseError = null;
  try {
    day2Groups = await getAllPhaseGroups(day2PhaseId);
  } catch (err) {
    day2PhaseError = { phaseId:day2PhaseId, error:err?.message || String(err) };
  }

  const jobsById = new Map();
  cfg.day1CorePoolIds.forEach((poolId) => jobsById.set(Number(poolId), { id:Number(poolId), phaseName:"Day 1: Double Elimination Bracket" }));
  if (day2Groups.length && shouldPullAllDay2Groups(day2Groups.length)) {
    day2Groups.forEach((g) => jobsById.set(Number(g.id), { id:Number(g.id), phaseName:g.phaseName || "Day 2: Double Elimination Bracket" }));
  } else if (day2Groups.length) {
    // If start.gg returns too many Day 2 groups, pull the first chunk so Vercel does not time out.
    day2Groups.slice(0, Number(process.env.RLCS_MAX_DAY2_GROUPS || 32)).forEach((g) => jobsById.set(Number(g.id), { id:Number(g.id), phaseName:g.phaseName || "Day 2: Double Elimination Bracket" }));
  }

  const jobs = Array.from(jobsById.values()).filter((j) => Number.isFinite(j.id) && j.id > 0);
  const results = await Promise.allSettled(jobs.map((job) => getAllSetsForGroup(job.id, job.phaseName)));
  const pools = results.filter((r) => r.status === "fulfilled").map((r) => r.value);
  const poolErrors = results.map((r, i) => r.status === "rejected" ? { poolId:jobs[i]?.id, phaseName:jobs[i]?.phaseName, error:r.reason?.message || String(r.reason) } : null).filter(Boolean);
  if (day2PhaseError) poolErrors.push(day2PhaseError);

  if (!pools.length) throw new Error(poolErrors[0]?.error || "no start.gg pools returned");

  const allSets = pools.flatMap((pool) => pool.sets || []);
  const matches = pools
    .flatMap((pool) => (pool.sets || []).map((set) => normalizeSet(pool, set, cfg.watchlist, region)))
    .filter((m) => m.watchTeams.length)
    .sort((a, b) => String(a.startAt || "").localeCompare(String(b.startAt || "")) || String(a.pool || "").localeCompare(String(b.pool || "")));

  const bracket = {
    phases: Array.from(new Set(pools.map((p) => p.phaseName))).map((name) => ({ name, pools:pools.filter((p) => p.phaseName === name).length })),
    pools: pools.map((pool) => ({
      region,
      phase: pool.phaseName,
      pool: pool.displayIdentifier,
      poolId: pool.id,
      sets: (pool.sets || []).map((set) => normalizeSet(pool, set, cfg.watchlist, region)),
    })),
  };

  return {
    ok: true,
    source: poolErrors.length ? "live partial" : "live",
    cached: false,
    generatedAt: new Date().toISOString(),
    region,
    regionLabel: cfg.label,
    event: { id:event?.id || null, name:event?.name || "3v3 Bracket", slug:event?.slug || cfg.eventSlug },
    watchlist: cfg.watchlist,
    highTierWatchlist: cfg.watchlist,
    lowTierWatchlist: [],
    day1CorePoolIds: cfg.day1CorePoolIds,
    day2PhaseId,
    matches,
    bracket,
    poolErrors,
    stats: {
      phases: bracket.phases.length,
      pools: pools.length,
      totalSets: allSets.length,
      knownMatches: matches.length,
      bettable: matches.filter((m) => m.bettableNow && !m.winnerId).length,
      completed: matches.filter((m) => !!m.winnerId).length,
      futureOrTbd: matches.filter((m) => !m.bettableNow || !m.team1Id || !m.team2Id).length,
      durationMs: Date.now() - startedAt,
    },
  };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  const region = getRegion(req);
  const cfg = getConfig(region);
  const force = String(req.query?.refresh || "") === "1" || String(req.query?.cron || "") === "1";
  const debug = String(req.query?.debug || "") === "1";
  const now = Date.now();
  const cacheKey = region;

  try {
    const cache = memoryCache.get(cacheKey);
    if (!force && cache?.expiresAt && cache.expiresAt > now) {
      res.setHeader("Cache-Control", "s-maxage=15, stale-while-revalidate=60");
      return res.status(200).json({ ...cache.payload, cached:true, debug: debug ? { cacheHit:true, region } : undefined });
    }

    const payload = await pullLive(region);
    memoryCache.set(cacheKey, { payload, expiresAt: now + CACHE_MS });
    res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=90");
    return res.status(200).json(payload);
  } catch (err) {
    const errorPayload = {
      ok: false,
      source: "live error",
      cached: false,
      generatedAt: new Date().toISOString(),
      region,
      regionLabel: cfg.label,
      error: err?.message || "rlcs pull failed",
      watchlist: cfg.watchlist,
      hint: "Check STARTGG_TOKEN, this route deployment, and ?region=na or ?region=eu. Use ?refresh=1&debug=1 for details.",
    };
    const cache = memoryCache.get(cacheKey);
    if (cache?.payload) {
      return res.status(200).json({ ...cache.payload, ok:true, cached:true, stale:true, warning:errorPayload.error, debug:debug ? errorPayload : undefined });
    }
    return res.status(500).json(errorPayload);
  }
}
