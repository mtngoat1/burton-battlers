// APP110_RLCS_STARTGG_PULL_DEBUG_FIX
// Drop this in: api/rlcs-lcq.js
// Fixes live refresh by using a safer start.gg query and returning visible debug errors instead of only falling back.

const DEFAULT_EVENT_SLUG = "tournament/rlcs-2026-north-america-last-chance-qualifier/event/3v3-bracket";
const CACHE_MS = 45 * 1000;

const CORE_WATCHLIST = [
  "M80",
  "FUT Esports",
  "Dignitas",
  "Gen.G Mobil1 Racing",
];

// Day 1 core pools: A1 FUT, A2 Gen.G, A3 Dignitas, A4 M80.
// If start.gg changes phase/pool IDs, set RLCS_CORE_POOL_IDS in Vercel.
const DEFAULT_CORE_POOL_IDS = [3325496, 3325497, 3325498, 3325499];
let memoryCache = null;

function cleanName(name = "") {
  return String(name || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function readListEnv(name) {
  return String(process.env[name] || "")
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function getWatchlist() {
  // Hard locked to only the four requested teams.
  return CORE_WATCHLIST;
}

function getCorePoolIds() {
  const ids = readListEnv("RLCS_CORE_POOL_IDS").map(Number).filter(Number.isFinite);
  return ids.length ? ids : DEFAULT_CORE_POOL_IDS;
}

async function gql(query, variables = {}) {
  const token = process.env.STARTGG_TOKEN;
  if (!token) throw new Error("missing STARTGG_TOKEN in this Vercel project");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8500);

  try {
    const res = await fetch("https://api.start.gg/gql/alpha", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
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
  }
}`;

// Important: do NOT request score.label here. start.gg's score object commonly exposes value only.
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
          entrant {
            id
            name
            participants { id gamerTag }
          }
        }
      }
    }
  }
}`;

async function getAllSetsForGroup(phaseGroupId) {
  const perPage = 100;
  let page = 1;
  const all = [];
  let info = null;

  while (true) {
    const data = await gql(PHASE_GROUP_SETS_QUERY, { phaseGroupId, page, perPage });
    const group = data?.phaseGroup;
    if (!group?.id) throw new Error(`could not read start.gg pool ${phaseGroupId}`);

    info = {
      id: Number(group.id),
      displayIdentifier: group.displayIdentifier || String(phaseGroupId),
      phaseName: "day 1 bracket",
    };

    const sets = group.sets || {};
    all.push(...(sets.nodes || []));
    if (!sets.pageInfo?.totalPages || page >= sets.pageInfo.totalPages) break;
    page += 1;
  }

  return { ...info, sets: all };
}

function setScore(slot) {
  const value = slot?.standing?.stats?.score?.value;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeSet(pool, set, watchlist) {
  const watchClean = new Map(watchlist.map((team) => [cleanName(team), team]));
  const rawSlot1 = set.slots?.[0] || null;
  const rawSlot2 = set.slots?.[1] || null;
  const slot1 = rawSlot1?.entrant || null;
  const slot2 = rawSlot2?.entrant || null;
  const team1 = slot1?.name || "TBD";
  const team2 = slot2?.name || "TBD";
  const watchTeams = [team1, team2].map((t) => watchClean.get(cleanName(t))).filter(Boolean);

  return {
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
    watchTeams,
    tier: watchTeams.length ? "high" : null,
    bettableNow: !!(slot1?.id && slot2?.id && watchTeams.length && !set.winnerId),
    source: "start.gg live",
  };
}

function buildPayload({ event, pools, poolErrors, startedAt }) {
  const watchlist = getWatchlist();
  const allSets = pools.flatMap((pool) => pool.sets || []);

  const matches = pools
    .flatMap((pool) => (pool.sets || []).map((set) => normalizeSet(pool, set, watchlist)))
    .filter((m) => m.watchTeams.length)
    .sort((a, b) => String(a.startAt || "").localeCompare(String(b.startAt || "")) || String(a.pool || "").localeCompare(String(b.pool || "")));

  const bracket = {
    pools: pools.map((pool) => ({
      phase: pool.phaseName,
      pool: pool.displayIdentifier,
      poolId: pool.id,
      sets: (pool.sets || []).map((set) => normalizeSet(pool, set, watchlist)),
    })),
  };

  return {
    ok: true,
    source: poolErrors.length ? "start.gg live partial" : "start.gg live",
    generatedAt: new Date().toISOString(),
    event: {
      id: event?.id || null,
      name: event?.name || "3v3 Bracket",
      slug: event?.slug || DEFAULT_EVENT_SLUG,
    },
    watchlist,
    highTierWatchlist: watchlist,
    lowTierWatchlist: [],
    poolIds: getCorePoolIds(),
    matches,
    bracket,
    poolErrors,
    stats: {
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

async function pullLive() {
  const startedAt = Date.now();
  const slug = process.env.STARTGG_EVENT_SLUG || DEFAULT_EVENT_SLUG;
  const eventData = await gql(EVENT_QUERY, { slug });
  const event = eventData?.event || { id: null, name: "3v3 Bracket", slug };

  const poolIds = getCorePoolIds();
  const results = await Promise.allSettled(poolIds.map((poolId) => getAllSetsForGroup(poolId)));
  const pools = results.filter((r) => r.status === "fulfilled").map((r) => r.value);
  const poolErrors = results
    .map((r, i) => r.status === "rejected" ? { poolId: poolIds[i], error: r.reason?.message || String(r.reason) } : null)
    .filter(Boolean);

  if (!pools.length) {
    throw new Error(poolErrors[0]?.error || "no start.gg pools returned");
  }

  return buildPayload({ event, pools, poolErrors, startedAt });
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();

  const force = String(req.query?.refresh || "") === "1" || String(req.query?.cron || "") === "1";
  const debug = String(req.query?.debug || "") === "1";
  const now = Date.now();

  try {
    if (!force && memoryCache?.expiresAt && memoryCache.expiresAt > now) {
      res.setHeader("Cache-Control", "s-maxage=15, stale-while-revalidate=60");
      return res.status(200).json({ ...memoryCache.payload, cached: true, debug: debug ? { cacheHit: true } : undefined });
    }

    const payload = await pullLive();
    memoryCache = { payload, expiresAt: now + CACHE_MS };
    res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=90");
    return res.status(200).json({ ...payload, cached: false });
  } catch (err) {
    const errorPayload = {
      ok: false,
      source: "start.gg error",
      cached: false,
      generatedAt: new Date().toISOString(),
      error: err?.message || "rlcs pull failed",
      watchlist: getWatchlist(),
      poolIds: getCorePoolIds(),
      hint: "Most common causes: STARTGG_TOKEN is missing from this exact Vercel project, api/rlcs-lcq.js was not redeployed, or the old backend query is still deployed.",
    };

    if (memoryCache?.payload) {
      return res.status(200).json({ ...memoryCache.payload, ok: true, cached: true, stale: true, warning: errorPayload.error, debug: debug ? errorPayload : undefined });
    }

    return res.status(500).json(errorPayload);
  }
}
