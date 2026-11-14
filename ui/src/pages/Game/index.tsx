import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, SidebarSimple } from "@phosphor-icons/react";
import Button from "../../components/Button/index.tsx";
import CoachBadge from "../../components/CoachBadge/index.tsx";
import DepthChart from "../../components/DepthChart/index.tsx";
import Office from "../../components/Office/index.tsx";
import Prospects from "../../components/Prospects/index.tsx";
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
import type { RecruitingWeek, SavedCoach, SeasonCoach, SeasonSummary, TeamCard } from "../../types.ts";
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

/**
 * /play: the game itself. Its own layout, no site header: the GameNav sidebar on the left; on the right, the
 * season's schedule and your coach (face, energy) across the top, then the open section's screen. Picking a section
 * rewrites the address (?section=) in place, so Back still leaves the game. The sidebar is open, minimized or
 * hidden (GameNav); hidden, an Open button leads the top row, and ⌘\\ / Ctrl+\\ hides and shows it.
 */
export default function Game({ theme, onToggleTheme, seasonId, sectionKey }: Props) {
  const [section, setSection] = useState(() => sectionOf(sectionKey));
  const [navMode, setNavMode] = useNavMode();
  const [lastShown, setLastShown] = useState<"open" | "rail">(navMode === "rail" ? "rail" : "open");
  const [load, setLoad] = useState<Load>(seasonId ? { kind: "loading" } : { kind: "none" });
  const [teams, setTeams] = useState<TeamCard[]>(() => cachedTeams() ?? []);
  const [recruiting, setRecruiting] = useState<RecruitingWeek | null>(null);
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
    api<RecruitingWeek>(`/api/season/${seasonId}/recruiting`)
      .then((r) => live && setRecruiting(r))
      .catch(() => live && setRecruiting(null));
    return () => {
      live = false;
    };
  }, [seasonId]);

  // after a sim: the season and the week's recruiting again, in place (no loading screen)
  const refresh = useCallback(() => {
    if (!seasonId) return;
    api<SeasonSummary>(`/api/season/${seasonId}`)
      .then((season) => setLoad({ kind: "ready", season }))
      .catch(() => {});
    api<RecruitingWeek>(`/api/season/${seasonId}/recruiting`)
      .then(setRecruiting)
      .catch(() => {});
  }, [seasonId]);
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

  const open = (key: string) => {
    const next = sectionOf(key);
    setSection(next);
    // keeps the rest of the address (?id=)
    const params = new URLSearchParams(location.search);
    params.set("section", next.key);
    replaceParams("game", Object.fromEntries(params));
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

        {season && section.key === "office" ? (
          <section
            key={section.key}
            className="game__body game__body--fill game__body--flush game__section"
            aria-label={section.label}
          >
            <Office season={season} recruiting={recruiting} teams={bySlug} sim={sim} onSection={open} />
          </section>
        ) : season && section.key === "prospects" ? (
          <section
            key={section.key}
            className="game__body game__body--fill game__body--flush game__section"
            aria-label={section.label}
          >
            <Prospects key={season.current_week} seasonId={season.id} year={season.year} />
          </section>
        ) : season && section.key === "depth" ? (
          <section key={section.key} className="game__body game__body--fill game__section" aria-label={section.label}>
            <DepthChart
              key={season.current_week}
              seasonId={season.id}
              team={season.team}
              weekLabels={season.week_labels}
            />
          </section>
        ) : season ? (
          // keyed on the section, so each one fades in as it opens
          // the sidebar names the open section, so the section's screen takes the whole space
          <section key={section.key} className="game__body game__section" aria-label={section.label}>
            <div className="game__empty">
              <section.icon size={32} weight="bold" aria-hidden="true" />
              <h1 className="game__empty-title">{m.notBuilt(section.label)}</h1>
              <p className="game__blurb">{section.blurb}</p>
              <p className="game__blurb">{m.notBuiltText}</p>
            </div>
          </section>
        ) : (
          <section className="game__body">
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
          </section>
        )}
      </main>
    </div>
  );
}
