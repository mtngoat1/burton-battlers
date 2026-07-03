// APP104_RLCS_CLEAN_BOARD_STREAM_FIX_PROPS_PATCH
// Vercel/Node serverless route: keeps STARTGG_TOKEN private and returns a trimmed LCQ betting board.
const DEFAULT_EVENT_SLUG = "tournament/rlcs-2026-north-america-last-chance-qualifier/event/3v3-bracket";
const CACHE_MS = 2 * 60 * 1000;

const HIGH_TIER_WATCHLIST = [
  "Dignitas",
  "Gen.G Mobil1 Racing",
  "M80",
  "FUT Esports"
];

const LOW_TIER_WATCHLIST = [
  "Lil Step Bros",
  "Next2Nu Esports",
  "Veloce Gaming"
];

const DEFAULT_WATCHLIST = Array.from(new Set([...HIGH_TIER_WATCHLIST, ...LOW_TIER_WATCHLIST]));
let memoryCache = null;

function cleanName(name = "") {
  return String(name || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function readListEnv(name) {
  return String(process.env[name] || "").split(/[,\n]/).map(s => s.trim()).filter(Boolean);
}

function getWatchlists() {
  const high = Array.from(new Set([...HIGH_TIER_WATCHLIST, ...readListEnv("RLCS_HIGH_TIER_WATCHLIST")]));
  const low = Array.from(new Set([...LOW_TIER_WATCHLIST, ...readListEnv("RLCS_LOW_TIER_WATCHLIST")]));
  const extra = readListEnv("RLCS_WATCHLIST");
  return {
    high,
    low,
    all: Array.from(new Set([...high, ...low, ...extra])),
  };
}

function getTierForTeam(team, lists) {
  const clean = cleanName(team);
  if ((lists.high || []).some(t => cleanName(t) === clean)) return "high";
  if ((lists.low || []).some(t => cleanName(t) === clean)) return "low";
  return null;
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
  event(slug: $slug) {
    id
    name
    phases { id name }
  }
}`;

const PHASE_GROUPS_QUERY = `
query PhaseGroupsByPhase($phaseId: ID!, $page: Int!, $perPage: Int!) {
  phase(id: $phaseId) {
    id
    name
    phaseGroups(query: { page: $page, perPage: $perPage }) {
      pageInfo { total totalPages }
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

async function getAllPhaseGroups(phaseId) {
  const perPage = 50;
  let page = 1;
  const all = [];
  while (true) {
    const data = await gql(PHASE_GROUPS_QUERY, { phaseId, page, perPage });
    const pg = data?.phase?.phaseGroups;
    all.push(...(pg?.nodes || []));
    if (!pg?.pageInfo?.totalPages || page >= pg.pageInfo.totalPages) break;
    page += 1;
  }
  return all;
}

async function getAllSetsForGroup(phaseGroupId) {
  const perPage = 100;
  let page = 1;
  const all = [];
  let groupInfo = null;
  while (true) {
    const data = await gql(PHASE_GROUP_SETS_QUERY, { phaseGroupId, page, perPage });
    const phaseGroup = data?.phaseGroup;
    groupInfo = { id: phaseGroup?.id, displayIdentifier: phaseGroup?.displayIdentifier };
    const sets = phaseGroup?.sets;
    all.push(...(sets?.nodes || []));
    if (!sets?.pageInfo?.totalPages || page >= sets.pageInfo.totalPages) break;
    page += 1;
  }
  return { ...groupInfo, sets: all };
}

function flattenKnownMatches(pools, lists) {
  const watchClean = new Map((lists.all || []).map(team => [cleanName(team), team]));
  const matches = [];
  let totalSets = 0;

  for (const pool of pools) {
    for (const set of pool.sets || []) {
      totalSets += 1;
      const slot1 = set.slots?.[0]?.entrant || null;
      const slot2 = set.slots?.[1]?.entrant || null;
      const team1 = slot1?.name || "TBD";
      const team2 = slot2?.name || "TBD";
      const watchTeams = [team1, team2]
        .map(t => watchClean.get(cleanName(t)))
        .filter(Boolean);
      if (!watchTeams.length) continue;

      const watchTiers = watchTeams.map(team => ({ team, tier: getTierForTeam(team, lists) || "low" }));
      const tier = watchTiers.some(t => t.tier === "high") ? "high" : "low";

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
        team1,
        team1Id: slot1?.id || null,
        team1Players: (slot1?.participants || []).map(p => p.gamerTag).filter(Boolean).slice(0, 3),
        team2,
        team2Id: slot2?.id || null,
        team2Players: (slot2?.participants || []).map(p => p.gamerTag).filter(Boolean).slice(0, 3),
        watchTeams,
        watchTiers,
        tier,
        bettableNow: !!(slot1?.id && slot2?.id && !set.winnerId),
        source: "start.gg live",
        propsAvailable: false,
      });
    }
  }

  matches.sort((a, b) => String(a.startAt || "").localeCompare(String(b.startAt || "")) || String(a.pool || "").localeCompare(String(b.pool || "")));
  return { matches, totalSets };
}

async function pullLive() {
  const slug = process.env.STARTGG_EVENT_SLUG || DEFAULT_EVENT_SLUG;
  const watchlists = getWatchlists();
  const eventData = await gql(EVENT_QUERY, { slug });
  const event = eventData?.event;
  if (!event?.id) throw new Error("Could not find start.gg event");

  const pools = [];
  for (const phase of event.phases || []) {
    const groups = await getAllPhaseGroups(phase.id);
    for (const group of groups) {
      const pool = await getAllSetsForGroup(group.id);
      pools.push({ phaseId: phase.id, phaseName: phase.name, ...pool });
    }
  }

  const { matches, totalSets } = flattenKnownMatches(pools, watchlists);
  const generatedAt = new Date().toISOString();
  return {
    ok: true,
    source: "start.gg live",
    generatedAt,
    event: { id: event.id, name: event.name, slug },
    watchlist: watchlists.all,
    highTierWatchlist: watchlists.high,
    lowTierWatchlist: watchlists.low,
    matches,
    stats: {
      phases: event.phases?.length || 0,
      pools: pools.length,
      totalSets,
      knownMatches: matches.length,
      highTierMatches: matches.filter(m => m.tier === "high").length,
      lowTierMatches: matches.filter(m => m.tier === "low").length,
      bettable: matches.filter(m => m.bettableNow && !m.winnerId).length,
      highTierBettable: matches.filter(m => m.tier === "high" && m.bettableNow && !m.winnerId).length,
      lowTierBettable: matches.filter(m => m.tier === "low" && m.bettableNow && !m.winnerId).length,
      completed: matches.filter(m => !!m.winnerId).length,
      futureOrTbd: matches.filter(m => !m.bettableNow || !m.team1Id || !m.team2Id).length,
      propsAvailable: false,
    },
  };
}

export default async function handler(req, res) {
  try {
    const force = String(req.query?.refresh || "") === "1";
    const now = Date.now();
    if (!force && memoryCache?.expiresAt && memoryCache.expiresAt > now) {
      res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=120");
      return res.status(200).json({ ...memoryCache.payload, cached: true });
    }

    const payload = await pullLive();
    memoryCache = { payload, expiresAt: now + CACHE_MS };
    res.setHeader("Cache-Control", "s-maxage=120, stale-while-revalidate=120");
    return res.status(200).json({ ...payload, cached: false });
  } catch (err) {
    const stale = memoryCache?.payload;
    if (stale) {
      return res.status(200).json({ ...stale, ok: true, cached: true, stale: true, warning: err?.message || "refresh failed" });
    }
    return res.status(500).json({ ok: false, error: err?.message || "RLCS pull failed" });
  }
}
