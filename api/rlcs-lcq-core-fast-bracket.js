// APP108_RLCS_CORE_ONLY_FAST_STARTGG_PULL_PATCH
// APP109_RLCS_LIVE_BRACKET_VIEW_PATCH
// Vercel/Node serverless route: keeps STARTGG_TOKEN private and returns only M80, FUT, Dignitas, Gen.G.
// This is faster than pulling all 24 pools, which can time out on Vercel.
const DEFAULT_EVENT_SLUG = "tournament/rlcs-2026-north-america-last-chance-qualifier/event/3v3-bracket";
const CACHE_MS = 75 * 1000;

const CORE_WATCHLIST = [
  "Dignitas",
  "Gen.G Mobil1 Racing",
  "M80",
  "FUT Esports",
];

// Day 1 core-team pool ids from start.gg. Override later with RLCS_CORE_POOL_IDS="3325496,3325497" if needed.
const DEFAULT_CORE_POOL_IDS = [3325496, 3325497, 3325498, 3325499];
let memoryCache = null;

function cleanName(name = "") {
  return String(name || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function readListEnv(name) {
  return String(process.env[name] || "").split(/[,\n]/).map(s => s.trim()).filter(Boolean);
}

function getWatchlist() {
  // Hard locked to the four teams you said. Do not add extra teams here unless you intentionally set RLCS_EXTRA_CORE_WATCHLIST.
  return Array.from(new Set([...CORE_WATCHLIST, ...readListEnv("RLCS_EXTRA_CORE_WATCHLIST")])).filter(t => CORE_WATCHLIST.map(cleanName).includes(cleanName(t)) || process.env.RLCS_ALLOW_EXTRA_CORE === "1");
}

function getCorePoolIds() {
  const raw = readListEnv("RLCS_CORE_POOL_IDS");
  const ids = raw.map(Number).filter(Number.isFinite);
  return ids.length ? ids : DEFAULT_CORE_POOL_IDS;
}

async function gql(query, variables = {}) {
  const token = process.env.STARTGG_TOKEN;
  if (!token) throw new Error("Missing STARTGG_TOKEN environment variable");

  const res = await fetch("https://api.start.gg/gql/alpha", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query, variables }),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.errors) {
    const message = json?.errors?.[0]?.message || `start.gg request failed (${res.status})`;
    throw new Error(message);
  }
  return json.data;
}

const EVENT_QUERY = `
query GetEvent($slug: String!) {
  event(slug: $slug) { id name slug }
}`;

const PHASE_GROUP_SETS_QUERY = `
query PhaseGroupSets($phaseGroupId: ID!, $page: Int!, $perPage: Int!) {
  phaseGroup(id: $phaseGroupId) {
    id
    displayIdentifier
    phase { id name }
    sets(page: $page, perPage: $perPage, sortType: STANDARD) {
      pageInfo { total totalPages }
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
          standing { id placement stats { score { label value } } }
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
    if (!group?.id) throw new Error(`Could not read start.gg pool ${phaseGroupId}`);
    info = { id: group.id, displayIdentifier: group.displayIdentifier, phaseId: group.phase?.id, phaseName: group.phase?.name || "day 1 bracket" };
    const sets = group.sets;
    all.push(...(sets?.nodes || []));
    if (!sets?.pageInfo?.totalPages || page >= sets.pageInfo.totalPages) break;
    page += 1;
  }
  return { ...info, sets: all };
}

function flattenCoreMatches(pools, watchlist) {
  const watchClean = new Map((watchlist || []).map(team => [cleanName(team), team]));
  const matches = [];
  let totalSets = 0;

  for (const pool of pools) {
    for (const set of pool.sets || []) {
      totalSets += 1;
      const rawSlot1 = set.slots?.[0] || null;
      const rawSlot2 = set.slots?.[1] || null;
      const slot1 = rawSlot1?.entrant || null;
      const slot2 = rawSlot2?.entrant || null;
      const team1 = slot1?.name || "TBD";
      const team2 = slot2?.name || "TBD";
      const watchTeams = [team1, team2].map(t => watchClean.get(cleanName(t))).filter(Boolean);
      if (!watchTeams.length) continue;
      const team1Score = rawSlot1?.standing?.stats?.score?.value ?? null;
      const team2Score = rawSlot2?.standing?.stats?.score?.value ?? null;

      matches.push({
        phase: pool.phaseName,
        pool: pool.displayIdentifier,
        poolId: pool.id,
        setId: set.id,
        identifier: set.identifier,
        round: set.fullRoundText || set.round,
        state: set.state,
        startAt: set.startAt ? new Date(set.startAt * 1000).toISOString() : null,
        winnerId: set.winnerId || null,
        team1Score,
        team2Score,
        team1,
        team1Id: slot1?.id || null,
        team1Players: (slot1?.participants || []).map(p => p.gamerTag).filter(Boolean).slice(0, 3),
        team2,
        team2Id: slot2?.id || null,
        team2Players: (slot2?.participants || []).map(p => p.gamerTag).filter(Boolean).slice(0, 3),
        watchTeams,
        tier: "high",
        bettableNow: !!(slot1?.id && slot2?.id && !set.winnerId),
        source: "start.gg live",
      });
    }
  }

  matches.sort((a, b) => String(a.startAt || "").localeCompare(String(b.startAt || "")) || String(a.pool || "").localeCompare(String(b.pool || "")) || String(a.round || "").localeCompare(String(b.round || "")));
  return { matches, totalSets };
}

function buildBracketPools(pools, watchlist) {
  const watchClean = new Map((watchlist || []).map(team => [cleanName(team), team]));
  return (pools || []).map(pool => ({
    phase: pool.phaseName,
    pool: pool.displayIdentifier,
    poolId: pool.id,
    sets: (pool.sets || []).map(set => {
      const rawSlot1 = set.slots?.[0] || null;
      const rawSlot2 = set.slots?.[1] || null;
      const slot1 = rawSlot1?.entrant || null;
      const slot2 = rawSlot2?.entrant || null;
      const team1 = slot1?.name || "TBD";
      const team2 = slot2?.name || "TBD";
      const watchTeams = [team1, team2].map(t => watchClean.get(cleanName(t))).filter(Boolean);
      return {
        phase: pool.phaseName,
        pool: pool.displayIdentifier,
        poolId: pool.id,
        setId: set.id,
        identifier: set.identifier,
        round: set.fullRoundText || set.round,
        state: set.state,
        startAt: set.startAt ? new Date(set.startAt * 1000).toISOString() : null,
        winnerId: set.winnerId || null,
        team1,
        team1Id: slot1?.id || null,
        team1Score: rawSlot1?.standing?.stats?.score?.value ?? null,
        team1Players: (slot1?.participants || []).map(p => p.gamerTag).filter(Boolean).slice(0, 3),
        team2,
        team2Id: slot2?.id || null,
        team2Score: rawSlot2?.standing?.stats?.score?.value ?? null,
        team2Players: (slot2?.participants || []).map(p => p.gamerTag).filter(Boolean).slice(0, 3),
        watchTeams,
        tier: watchTeams.length ? "high" : null,
        bettableNow: !!(slot1?.id && slot2?.id && watchTeams.length && !set.winnerId),
        source: "start.gg live",
      };
    }),
  }));
}

async function pullLive() {
  const startedAt = Date.now();
  const slug = process.env.STARTGG_EVENT_SLUG || DEFAULT_EVENT_SLUG;
  const watchlist = getWatchlist();
  const poolIds = getCorePoolIds();
  const eventData = await gql(EVENT_QUERY, { slug });
  const event = eventData?.event || { id: null, name: "3v3 Bracket", slug };

  const pools = [];
  for (const poolId of poolIds) {
    const pool = await getAllSetsForGroup(poolId);
    pools.push(pool);
  }

  const { matches, totalSets } = flattenCoreMatches(pools, watchlist);
  const bracket = { pools: buildBracketPools(pools, watchlist) };
  const generatedAt = new Date().toISOString();
  return {
    ok: true,
    source: "start.gg live",
    generatedAt,
    event: { id: event.id, name: event.name, slug: event.slug || slug },
    watchlist,
    highTierWatchlist: watchlist,
    lowTierWatchlist: [],
    poolIds,
    matches,
    bracket,
    stats: {
      pools: pools.length,
      totalSets,
      knownMatches: matches.length,
      bettable: matches.filter(m => m.bettableNow && !m.winnerId).length,
      completed: matches.filter(m => !!m.winnerId).length,
      futureOrTbd: matches.filter(m => !m.bettableNow || !m.team1Id || !m.team2Id).length,
      durationMs: Date.now() - startedAt,
    },
  };
}

export default async function handler(req, res) {
  try {
    res.setHeader("Access-Control-Allow-Origin", "*");
    const force = String(req.query?.refresh || "") === "1" || String(req.query?.cron || "") === "1";
    const now = Date.now();
    if (!force && memoryCache?.expiresAt && memoryCache.expiresAt > now) {
      res.setHeader("Cache-Control", "s-maxage=45, stale-while-revalidate=180");
      return res.status(200).json({ ...memoryCache.payload, cached: true });
    }
    const payload = await pullLive();
    memoryCache = { payload, expiresAt: now + CACHE_MS };
    res.setHeader("Cache-Control", "s-maxage=75, stale-while-revalidate=180");
    return res.status(200).json({ ...payload, cached: false });
  } catch (err) {
    const stale = memoryCache?.payload;
    if (stale) {
      return res.status(200).json({ ...stale, ok: true, cached: true, stale: true, warning: err?.message || "refresh failed" });
    }
    return res.status(500).json({
      ok: false,
      source: "start.gg error",
      error: err?.message || "RLCS pull failed",
      hint: "Check STARTGG_TOKEN in the same Vercel project, make sure api/rlcs-lcq.js is in the root api folder, then redeploy. This route only pulls the four core pools to avoid timeouts.",
    });
  }
}
