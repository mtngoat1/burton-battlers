// APP101_RLCS_LIVE_STARTGG_BACKEND_PATCH
// Vercel/Node serverless route: keeps STARTGG_TOKEN private and returns only known-team LCQ matches.
const DEFAULT_EVENT_SLUG = "tournament/rlcs-2026-north-america-last-chance-qualifier/event/3v3-bracket";
const CACHE_MS = 2 * 60 * 1000;

const DEFAULT_WATCHLIST = [
  "Dignitas",
  "Gen.G Mobil1 Racing",
  "M80",
  "FUT Esports",
  "Veloce Gaming",
  "GSK",
  "AML",
  "Certified",
  "Unc & Nephews",
  "2026 New York Knicks",
  "KCG Wonderpets",
  "KCG Ukiyo",
  "VANTA",
  "Vello-1",
  "Vortex Esports",
  "VORTEX GAMING",
  "Velocity Esports",
  "Veylox Esports",
  "Valor Esports USA",
  "Undefined Esports",
  "Torrent Corp",
  "Torrent Crossfire",
  "Reign Esports",
  "RGN Black",
  "Next2Nu Esports",
  "Lotus Esports",
  "Kozmosis Esports",
  "F9 Esports",
  "G11 eSports",
  "CLRTY Esports",
  "Control Esports",
  "Cosmic Rift Esports",
  "DME",
  "DME GENESIX",
  "NTX",
  "NTX Academy",
  "NTX Esports",
  "SkyOne Gaming",
  "Team Factor",
  "The Fifth Element",
  "Virtue",
  "VitrixGG",
  "West Coast Warriors",
  "Fortior Eclipse",
  "InGenious eSports",
  "Inherent Skill Esports",
  "LatinSeven Eternals",
  "7VEN Club",
  "ATK",
  "925 Esports",
  "Aether storm",
  "Affinity",
  "AVID Academy",
  "Phantom Esports",
  "Paradox Gaming",
  "VON ESPORTS",
  "Vornux",
  "Meow Esports",
  "MZ Esports",
  "MED Gaming",
  "North Country Elite",
  "Lumina Esports",
  "Astronyx Esports"
];

let memoryCache = null;

function cleanName(name = "") {
  return String(name || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function getWatchlist() {
  const fromEnv = process.env.RLCS_WATCHLIST || "";
  const extra = fromEnv.split(/[,\n]/).map(s => s.trim()).filter(Boolean);
  return [...new Set([...DEFAULT_WATCHLIST, ...extra])];
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

function flattenKnownMatches(pools, watchlist) {
  const watchClean = new Map(watchlist.map(team => [cleanName(team), team]));
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
        team1Players: (slot1?.participants || []).map(p => p.gamerTag).filter(Boolean),
        team2,
        team2Id: slot2?.id || null,
        team2Players: (slot2?.participants || []).map(p => p.gamerTag).filter(Boolean),
        watchTeams,
        bettableNow: !!(slot1?.id && slot2?.id && !set.winnerId),
        source: "start.gg live",
      });
    }
  }

  matches.sort((a, b) => String(a.startAt || "").localeCompare(String(b.startAt || "")) || String(a.pool || "").localeCompare(String(b.pool || "")));
  return { matches, totalSets };
}

async function pullLive() {
  const slug = process.env.STARTGG_EVENT_SLUG || DEFAULT_EVENT_SLUG;
  const watchlist = getWatchlist();
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

  const { matches, totalSets } = flattenKnownMatches(pools, watchlist);
  const generatedAt = new Date().toISOString();
  return {
    ok: true,
    source: "start.gg live",
    generatedAt,
    event: { id: event.id, name: event.name, slug },
    watchlist,
    matches,
    stats: {
      phases: event.phases?.length || 0,
      pools: pools.length,
      totalSets,
      knownMatches: matches.length,
      bettable: matches.filter(m => m.bettableNow && !m.winnerId).length,
      completed: matches.filter(m => !!m.winnerId).length,
      futureOrTbd: matches.filter(m => !m.bettableNow || !m.team1Id || !m.team2Id).length,
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
