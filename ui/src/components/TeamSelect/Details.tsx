import { useEffect, useState } from "react";
import Button from "../Button/index.tsx";
import FolderTabs from "../FolderTabs/index.tsx";
import RosterTable from "../RosterTable/index.tsx";
import TeamOverview from "../TeamOverview/index.tsx";
import { api } from "../../api.ts";
import type { RosterPlayer, TeamCard, TeamDetail } from "../../types.ts";
import { messages as m } from "./messages.ts";

type View = "overview" | "roster";

// kept between visits to Play, so coming back draws at once
const rosters = new Map<string, RosterPlayer[]>();

/** The picked team's Overview and Roster tabs; its players are fetched once a team. */
export default function Details({ team }: { team: TeamCard }) {
  const [view, setView] = useState<View>("overview");
  const [players, setPlayers] = useState<RosterPlayer[] | null>(() => rosters.get(team.slug) ?? null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const cached = rosters.get(team.slug);
    setPlayers(cached ?? null);
    setError(null);
    if (cached) return;
    let current = true;
    api<TeamDetail>(`/api/teams/${encodeURIComponent(team.slug)}`)
      .then((d) => {
        rosters.set(team.slug, d.players);
        if (current) setPlayers(d.players);
      })
      .catch((e: Error) => current && setError(e.message));
    return () => {
      current = false;
    };
  }, [team.slug, attempt]);

  return (
    <FolderTabs
      label={m.teamTabs}
      tabs={(["overview", "roster"] as const).map((v) => ({ key: v, label: m[v] }))}
      value={view}
      onChange={setView}
      panelClassName="team-details"
    >
      {error ? (
        <p className="team-details__note" role="alert">
          {m.rosterError(error)}
          <Button variant="outline" onClick={() => setAttempt((n) => n + 1)}>
            {m.tryAgain}
          </Button>
        </p>
      ) : view === "overview" ? (
        <TeamOverview team={team} players={players} />
      ) : (
        <RosterTable players={players} />
      )}
    </FolderTabs>
  );
}
