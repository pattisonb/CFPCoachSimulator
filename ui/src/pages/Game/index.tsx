import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, SidebarSimple } from "@phosphor-icons/react";
import Button from "../../components/Button/index.tsx";
import CoachBadge from "../../components/CoachBadge/index.tsx";
import DepthChart from "../../components/DepthChart/index.tsx";
import Office from "../../components/Office/index.tsx";
import Awards from "../../components/Awards/index.tsx";
import Bowls from "../../components/Bowls/index.tsx";
import Schedule from "../../components/Schedule/index.tsx";
import Standings from "../../components/Standings/index.tsx";
import Staff from "../../components/Staff/index.tsx";
import RecruitingHub, { type HubTab } from "../../components/RecruitingHub/index.tsx";
import GameNav, { type NavTeam } from "../../components/GameNav/index.tsx";
import SeasonStrip from "../../components/SeasonStrip/index.tsx";
import { api } from "../../api.ts";
import { faces, type Face as FaceSpec } from "../../faces.ts";
import { NAV_SHORTCUT, useNavMode } from "../../navMode.ts";
import { navigate, replaceParams } from "../../router.ts";
import { sectionOf } from "../../sections.ts";
import { useSim } from "../../sim.ts";
import { cachedTeams, loadTeams } from "../../teams.ts";
import type { Theme } from "../../theme.ts";
import type { RecruitingBoard, SavedCoach, SeasonCoach, SeasonSummary, TeamCard } from "../../types.ts";
import { messages as m } from "./messages.ts";
import "./index.css";

interface Props {
  theme: Theme;
  onToggleTheme: () => void;
  /** ?id=: the season (a Coach Career) being played */
  seasonId: string | null;
  /** ?section= */
  sectionKey: string | null;
}

type Load =
  | { kind: "none" }
  | { kind: "loading" }
  | { kind: "error"; msg: string }
  | { kind: "ready"; season: SeasonSummary };

const coachName = (c: SeasonCoach) => (c.existing ? c.name : `${c.first_name} ${c.last_name}`);

/** How each built section sits in the window: edge to edge with its own columns, or padded. */
const PANE: Record<string, string> = {
  office: "",
  recruiting: "",
  depth: "game__pane--padded",
  schedule: "",
  staff: "",
  awards: "",
  bowls: "",
  standings: "",
};

/**
 * /play: the game itself. Its own layout, no site header: the GameNav sidebar on the left; on the right, the
 * season's schedule and your coach (face, energy) across the top, then the open section's screen. Picking a section
 * rewrites the address (?section=) in place, so Back still leaves the game. The sidebar is open, minimized or
 * hidden (GameNav); hidden, an Open button leads the top row, and ⌘\\ / Ctrl+\\ hides and shows it.
 */
export default function Game({ theme, onToggleTheme, seasonId, sectionKey }: Props) {
  const [section, setSection] = useState(() => sectionOf(sectionKey));
  // Recruiting's tab: the Board, or Prospects (?tab=; an old ?section=prospects link opens it, sectionOf maps it)
  const [hubTab, setHubTab] = useState<HubTab>(() =>
    sectionKey === "prospects" || new URLSearchParams(location.search).get("tab") === "prospects"
      ? "prospects"
      : "board",
  );
  // every section opened stays mounted (hidden when not shown): going back is instant and keeps its filters,
  // page, picks and scroll
  const [visited, setVisited] = useState<string[]>(() => [sectionOf(sectionKey).key]);
  const [navMode, setNavMode] = useNavMode();
  const [lastShown, setLastShown] = useState<"open" | "rail">(navMode === "rail" ? "rail" : "open");
  const [load, setLoad] = useState<Load>(seasonId ? { kind: "loading" } : { kind: "none" });
  const [teams, setTeams] = useState<TeamCard[]>(() => cachedTeams() ?? []);
  const [recruiting, setRecruiting] = useState<RecruitingBoard | null>(null);
  const [savedFace, setSavedFace] = useState<FaceSpec | null>(null);

  useEffect(() => {
    loadTeams()
      .then(setTeams)
      .catch(() => setTeams([]));
  }, []);

  useEffect(() => {
    if (!seasonId) return;
    let live = true;
    setLoad({ kind: "loading" });
    api<SeasonSummary>(`/api/season/${seasonId}`)
      .then((season) => live && setLoad({ kind: "ready", season }))
      .catch((e: Error) => live && setLoad({ kind: "error", msg: e.message }));
    return () => {
      live = false;
    };
  }, [seasonId]);

  // the week's recruiting board (and with it Energy): on load, after every recruiting action and after a sim. Every
  // change to the board goes through here, so Recruiting never refetches just because it was opened
  const reloadRecruiting = useCallback(async () => {
    if (!seasonId) return;
    const r = await api<RecruitingBoard>(`/api/season/${seasonId}/recruiting`);
    setRecruiting(r);
  }, [seasonId]);
  useEffect(() => {
    reloadRecruiting().catch(() => setRecruiting(null));
  }, [reloadRecruiting]);

  // after a sim: the season and the week's recruiting again, in place (no loading screen)
  const refresh = useCallback(() => {
    if (!seasonId) return;
    api<SeasonSummary>(`/api/season/${seasonId}`)
      .then((season) => setLoad({ kind: "ready", season }))
      .catch(() => {});
    reloadRecruiting().catch(() => {});
  }, [seasonId, reloadRecruiting]);
  const sim = useSim(seasonId, refresh);
  const energy = recruiting && { left: recruiting.hours_left, total: recruiting.hours };

  const season = load.kind === "ready" ? load.season : null;
  const coach = season?.coach ?? null;
  const createdId = coach && !coach.existing ? coach.id : null;

  // your created coach's own face; the team's own coach gets one rolled from his name
  useEffect(() => {
    if (!createdId) return;
    api<SavedCoach>(`/api/coaches/${createdId}`)
      .then((c) => setSavedFace(c.face ? faces.repair(c.face).face : null))
      .catch(() => setSavedFace(null));
  }, [createdId]);
  const face = useMemo(
    () => savedFace ?? (coach ? faces.random(`coach-${coachName(coach)}`) : null),
    [savedFace, coach],
  );

  const bySlug = useMemo(() => new Map(teams.map((t) => [t.slug, t])), [teams]);
  const myTeam = season ? bySlug.get(season.team) : undefined;
  const navTeam: NavTeam | null = season && {
    name: season.team_name,
    primary: myTeam?.colors.primary ?? "var(--ink)",
    secondary: myTeam?.colors.secondary ?? "var(--paper)",
    record: `${season.record.wins}-${season.record.losses}`,
    week: season.current_week,
  };

  // ⌘\\ / Ctrl+\\: hide the sidebar, or show it again as it was before
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "\\" || !(e.metaKey || e.ctrlKey)) return;
      e.preventDefault();
      if (navMode === "hidden") setNavMode(lastShown);
      else {
        setLastShown(navMode);
        setNavMode("hidden");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navMode, lastShown, setNavMode]);

  // the address names the section and, in Recruiting, the Prospects tab; the rest of it (?id=) stays
  const writeAddress = (key: string, tab: HubTab) => {
    const params = new URLSearchParams(location.search);
    params.set("section", key);
    if (key === "recruiting" && tab === "prospects") params.set("tab", tab);
    else params.delete("tab");
    replaceParams("game", Object.fromEntries(params));
  };

  const openTab = (tab: HubTab) => {
    setHubTab(tab);
    writeAddress("recruiting", tab);
  };

  const open = (key: string) => {
    const next = sectionOf(key);
    if (next.key === section.key) return;
    setSection(next);
    setVisited((v) => (v.includes(next.key) ? v : [...v, next.key]));
    writeAddress(next.key, hubTab);
  };

  const toMenu = (
    <Button variant="outline" onClick={() => navigate("play")}>
      <ArrowLeft size={18} weight="bold" aria-hidden="true" />
      {m.mainMenu}
    </Button>
  );

  return (
    <div className="game">
      <GameNav
        team={navTeam}
        active={section.key}
        onSection={open}
        theme={theme}
        onToggleTheme={onToggleTheme}
        mode={navMode}
        onMode={(next) => {
          if (next === "hidden" && navMode !== "hidden") setLastShown(navMode);
          setNavMode(next);
        }}
      />
      <main className="game__main">
        {/* the season so far and to come, then you */}
        <div className="game__top">
          {navMode === "hidden" && (
            <button
              type="button"
              className="game__open"
              aria-label={m.openNav(NAV_SHORTCUT)}
              title={m.openNav(NAV_SHORTCUT)}
              onClick={() => setNavMode(lastShown)}
            >
              <SidebarSimple size={20} weight="bold" aria-hidden="true" />
            </button>
          )}
          {season && <SeasonStrip games={season.schedule} teams={bySlug} weekLabels={season.week_labels} />}
          {season && coach && face && (
            <CoachBadge name={coachName(coach)} team={season.team_name} face={face} energy={energy} />
          )}
        </div>

        {season ? (
          // one window for every section: it never changes; the sections stack in it and cross-fade (Game/index.css)
          <section className="game__body" aria-label={section.label}>
            {visited.map((key) => {
              const sec = sectionOf(key);
              return (
                <div
                  key={key}
                  className={["game__pane", PANE[key] ?? "game__pane--center", key === section.key && "is-shown"]
                    .filter(Boolean)
                    .join(" ")}
                  aria-hidden={key !== section.key}
                >
                  {key === "office" ? (
                    <Office season={season} recruiting={recruiting} teams={bySlug} sim={sim} onSection={open} />
                  ) : key === "recruiting" ? (
                    <RecruitingHub
                      seasonId={season.id}
                      team={season.team}
                      year={season.year}
                      weekLabels={season.week_labels}
                      board={recruiting}
                      reload={reloadRecruiting}
                      tab={hubTab}
                      onTab={openTab}
                      weekKey={season.current_week}
                      coach={coach && face ? { name: coachName(coach), face } : null}
                    />
                  ) : key === "standings" ? (
                    <Standings season={season} teams={bySlug} />
                  ) : key === "bowls" ? (
                    <Bowls season={season} teams={bySlug} />
                  ) : key === "awards" ? (
                    <Awards
                      key={season.current_week}
                      season={season}
                      teams={bySlug}
                      coach={coach && face ? { name: coachName(coach), face } : null}
                    />
                  ) : key === "staff" ? (
                    <Staff
                      key={season.current_week}
                      seasonId={season.id}
                      year={season.year}
                      onBoardChange={() => void reloadRecruiting()}
                    />
                  ) : key === "schedule" ? (
                    <Schedule season={season} teams={bySlug} />
                  ) : key === "depth" ? (
                    <DepthChart
                      key={season.current_week}
                      seasonId={season.id}
                      team={season.team}
                      weekLabels={season.week_labels}
                    />
                  ) : (
                    // the sidebar names the open section, so the section's screen takes the whole space
                    <div className="game__empty">
                      <sec.icon size={32} weight="bold" aria-hidden="true" />
                      <h1 className="game__empty-title">{m.notBuilt(sec.label)}</h1>
                      <p className="game__blurb">{sec.blurb}</p>
                      <p className="game__blurb">{m.notBuiltText}</p>
                    </div>
                  )}
                </div>
              );
            })}
          </section>
        ) : (
          <section className="game__body">
            <div className="game__pane game__pane--center is-shown">
              <div className="game__empty" role="status">
                {load.kind === "loading" && <p className="game__blurb">{m.loading}</p>}
                {load.kind === "error" && (
                  <>
                    <p className="game__empty-title">{m.loadError(load.msg)}</p>
                    {toMenu}
                  </>
                )}
                {load.kind === "none" && (
                  <>
                    <p className="game__empty-title">{m.noSeason}</p>
                    <p className="game__blurb">{m.noSeasonText}</p>
                    {toMenu}
                  </>
                )}
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
