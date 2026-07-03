const TOKEN = process.env.STARTGG_TOKEN;

const EVENT_SLUG =
  "tournament/rlcs-2026-north-america-last-chance-qualifier/event/3v3-bracket";

if (!TOKEN) {
  console.error("Missing token. Run: export STARTGG_TOKEN='your_token_here'");
  process.exit(1);
}

async function gql(query, variables = {}) {
  const res = await fetch("https://api.start.gg/gql/alpha", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${TOKEN}`,
    },
    body: JSON.stringify({ query, variables }),
  });

  const json = await res.json();

  if (json.errors) {
    console.error(JSON.stringify(json.errors, null, 2));
    process.exit(1);
  }

  return json.data;
}

const EVENT_QUERY = `
query GetEvent($slug: String!) {
  event(slug: $slug) {
    id
    name
    phases {
      id
      name
    }
  }
}
`;

const PHASE_GROUPS_QUERY = `
query PhaseGroupsByPhase($phaseId: ID!, $page: Int!, $perPage: Int!) {
  phase(id: $phaseId) {
    id
    name
    phaseGroups(query: { page: $page, perPage: $perPage }) {
      pageInfo {
        total
        totalPages
      }
      nodes {
        id
        displayIdentifier
      }
    }
  }
}
`;

const PHASE_GROUP_SETS_QUERY = `
query PhaseGroupSets($phaseGroupId: ID!, $page: Int!, $perPage: Int!) {
  phaseGroup(id: $phaseGroupId) {
    id
    displayIdentifier
    sets(page: $page, perPage: $perPage, sortType: STANDARD) {
      pageInfo {
        total
        totalPages
      }
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
            participants {
              id
              gamerTag
            }
          }
        }
      }
    }
  }
}
`;

async function getAllPhaseGroups(phaseId) {
  const perPage = 50;
  let page = 1;
  let all = [];

  while (true) {
    const data = await gql(PHASE_GROUPS_QUERY, { phaseId, page, perPage });
    const groupData = data.phase.phaseGroups;
    all.push(...groupData.nodes);

    if (page >= groupData.pageInfo.totalPages) break;
    page++;
  }

  return all;
}

async function getAllSetsForGroup(phaseGroupId) {
  const perPage = 100;
  let page = 1;
  let all = [];
  let groupInfo = null;

  while (true) {
    const data = await gql(PHASE_GROUP_SETS_QUERY, {
      phaseGroupId,
      page,
      perPage,
    });

    groupInfo = {
      id: data.phaseGroup.id,
      displayIdentifier: data.phaseGroup.displayIdentifier,
    };

    const sets = data.phaseGroup.sets;
    all.push(...sets.nodes);

    if (page >= sets.pageInfo.totalPages) break;
    page++;
  }

  return { ...groupInfo, sets: all };
}

function unique(arr) {
  return [...new Set(arr.filter(Boolean))].sort((a, b) =>
    a.localeCompare(b)
  );
}

async function main() {
  const eventData = await gql(EVENT_QUERY, { slug: EVENT_SLUG });
  const event = eventData.event;

  if (!event) {
    console.error("Could not find event. Check the EVENT_SLUG.");
    process.exit(1);
  }

  console.log(`Found event: ${event.name} (${event.id})`);
  console.log("Phases:");
  event.phases.forEach((p) => console.log(`- ${p.id}: ${p.name}`));

  const allPools = [];

  for (const phase of event.phases) {
    console.log(`\nPulling phase: ${phase.name}`);
    const groups = await getAllPhaseGroups(phase.id);
    console.log(`Found ${groups.length} pools/groups`);

    for (const group of groups) {
      console.log(`  Pulling pool ${group.displayIdentifier} (${group.id})`);
      const pool = await getAllSetsForGroup(group.id);
      allPools.push({
        phaseId: phase.id,
        phaseName: phase.name,
        ...pool,
      });
    }
  }

  const allTeams = unique(
    allPools.flatMap((pool) =>
      pool.sets.flatMap((set) =>
        set.slots.map((slot) => slot.entrant?.name)
      )
    )
  );

  const compactMatches = allPools.map((pool) => ({
    phase: pool.phaseName,
    pool: pool.displayIdentifier,
    poolId: pool.id,
    matches: pool.sets.map((set) => ({
      setId: set.id,
      identifier: set.identifier,
      round: set.fullRoundText || set.round,
      state: set.state,
      startAt: set.startAt
        ? new Date(set.startAt * 1000).toISOString()
        : null,
      winnerId: set.winnerId,
      team1: set.slots[0]?.entrant?.name || "TBD",
      team1Id: set.slots[0]?.entrant?.id || null,
      team1Players:
        set.slots[0]?.entrant?.participants?.map((p) => p.gamerTag) || [],
      team2: set.slots[1]?.entrant?.name || "TBD",
      team2Id: set.slots[1]?.entrant?.id || null,
      team2Players:
        set.slots[1]?.entrant?.participants?.map((p) => p.gamerTag) || [],
    })),
  }));

  const fs = await import("fs");

  fs.writeFileSync(
    "rlcs-pools-full.json",
    JSON.stringify(allPools, null, 2)
  );

  fs.writeFileSync(
    "rlcs-matches-compact.json",
    JSON.stringify(compactMatches, null, 2)
  );

  fs.writeFileSync("rlcs-all-teams.txt", allTeams.join("\n"));

  console.log("\nDone.");
  console.log(`Teams found: ${allTeams.length}`);
  console.log("Created:");
  console.log("- rlcs-pools-full.json");
  console.log("- rlcs-matches-compact.json");
  console.log("- rlcs-all-teams.txt");
}

main();
