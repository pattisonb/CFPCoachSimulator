import { createContext, useContext, useEffect, useMemo, useState, type CSSProperties } from "react";
import { ArrowRight } from "@phosphor-icons/react";
import Chip from "../Chip/index.tsx";
import Face from "../Face/index.tsx";
import SectionTabs, { SampleNote, SectionPane, SectionStatus } from "../SectionTabs/index.tsx";
import PlayerLink from "../PlayerLink/index.tsx";
import Swatch from "../Swatch/index.tsx";
import Wordmark from "../Wordmark/index.tsx";
import { AllAmericaTeams, Coaches, Conferences, NationalTable } from "./More.tsx";
import { SAMPLE } from "./sample.ts";
import { api } from "../../api.ts";
import { inkOn } from "../../colors.ts";
import { lookOf, staffFace, type Face as FaceSpec } from "../../faces.ts";
import { formatClass, ordinal } from "../../format.ts";
import type {
  AwardCoach,
  AwardPlayer,
  AwardsView,
  CoachAward,
  ConferenceAwards,
  TeamPick,
  HeismanVote,
  NationalAwards,
  PlayerAward,
  SeasonSummary,
  TeamCard,
} from "../../types.ts";
import { messages as m } from "./messages.ts";
import "./index.css";

type Tab = "overview" | "heisman" | "national" | "coaches" | "allAmerica" | "conferences" | "team";
type Group = "all" | "poy" | "offense" | "defense" | "special";
const GROUPS: Group[] = ["all", "poy", "offense", "defense", "special"];

/** Each award's kind, by group (sim/awards.py NATIONAL_AWARDS kinds; anything else counts as Player of the Year). */
const OFFENSE = new Set([
  "qb",
  "qb_upper",
  "rb",
  "wr",
  "te",
  "interior",
  "c",
  "ol",
  "ol_unit",
  "blocker",
  "opoy",
  "off_freshman",
]);
const DEFENSE = new Set(["dpoy", "dpoy_alt", "lb", "db", "edge", "dl", "front", "def_freshman"]);
const SPECIAL = new Set(["k", "p", "rs", "stpoy", "versatile"]);
const groupOf = (kind: string): Group =>
  OFFENSE.has(kind) ? "offense" : DEFENSE.has(kind) ? "defense" : SPECIAL.has(kind) ? "special" : "poy";

interface Props {
  season: SeasonSummary;
  teams: Map<string, TeamCard>;
  /** your head coach: in a coach award he wears the face from your coach card */
  coach: { name: string; face: FaceSpec } | null;
}

/** Your coach's name and face, for any coach card that's him. */
const You = createContext<{ name: string; face: FaceSpec } | null>(null);

/** A team's colors as CSS variables for a panel drawn in them. */
const colorsOf = (t: TeamCard | undefined) =>
  ({
    "--c": t?.colors.primary ?? "var(--tile)",
    "--c2": t?.colors.secondary ?? "var(--line-soft)",
    "--on": t ? inkOn(t.colors.primary) : "var(--ink)",
  }) as CSSProperties;

const sentence = (t?: string) => (t ? `${t[0].toUpperCase()}${t.slice(1)}.` : "");
const whoLine = (p: AwardPlayer) => [p.position, formatClass(p.class), p.team_name].filter(Boolean).join(" · ");

/** One of your team's honors: the award, where you stand in it, and who. */
interface Honor {
  award: string;
  /** 1 leads or won it */
  rank: number;
  place: string;
  player?: AwardPlayer;
  coach?: AwardCoach;
}

/** Your team's honors from the races (or results): the Heisman's top ten, every national player and coach award, your
 * consensus All-Americans, then your conference's awards and its first all-conference team (the player's report: a
 * conference award you won was missing here). */
function honorsOf(
  nat: NationalAwards,
  extra: PlayerAward[],
  team: string,
  live: boolean,
  conferences: Record<string, ConferenceAwards> = {},
): Honor[] {
  const out: Honor[] = [];
  nat.heisman?.candidates.slice(0, 10).forEach((c, i) => {
    if (c.team === team)
      out.push({
        award: m.heisman,
        rank: i + 1,
        place: i === 0 ? (live ? m.leader : m.winner) : m.inVote(i + 1),
        player: c,
      });
  });
  const place = (i: number) => (i === 0 ? (live ? m.leader : m.winner) : live ? ordinal(i + 1) : m.finalist);
  for (const a of [...nat.awards, ...extra]) {
    if (a.kind === "ol_unit") continue; // a line's award has no one man to show
    if (a.kind === "coach") {
      (a as unknown as CoachAward).finalists.forEach((c, i) => {
        if (c.team === team) out.push({ award: a.name, rank: i + 1, place: place(i), coach: c });
      });
      continue;
    }
    (live ? (a.race ?? a.finalists) : a.finalists).forEach((p, i) => {
      if (p.team === team) out.push({ award: a.name, rank: i + 1, place: place(i), player: p });
    });
  }
  for (const a of nat.coach_awards)
    a.finalists.forEach((c, i) => {
      if (c.team === team) out.push({ award: a.name, rank: i + 1, place: place(i), coach: c });
    });
  for (const p of nat.all_america?.consensus ?? [])
    if (p.team === team)
      out.push({ award: p.unanimous ? m.unanimousAa : m.consensusAa, rank: 1, place: m.allAmerican, player: p });
  for (const [conf, entry] of Object.entries(conferences)) {
    for (const a of entry.awards) {
      if (a.kind === "coach")
        (a as unknown as CoachAward).finalists.forEach((c, i) => {
          if (c.team === team) out.push({ award: m.confAward(conf, a.name), rank: i + 1, place: place(i), coach: c });
        });
      else {
        const pa = a as PlayerAward;
        (live ? (pa.race ?? pa.finalists) : pa.finalists).forEach((p, i) => {
          if (p.team === team) out.push({ award: m.confAward(conf, a.name), rank: i + 1, place: place(i), player: p });
        });
      }
    }
    // the first all-conference team, a man once (whichever selector named him)
    const seen = new Set<string>();
    for (const list of Object.values(entry.teams?.selectors ?? {}) as TeamPick[][])
      for (const p of list)
        if (p.team === team && p.level === 1 && !seen.has(p.name)) {
          seen.add(p.name);
          out.push({ award: m.allConf(conf), rank: 1, place: m.firstTeam, player: p });
        }
  }
  return out.sort((a, b) => a.rank - b.rank);
}

/**
 * Awards: the season's honors. Overview leads with the Heisman as a banner in the leader's colors (his face, his
 * line, his points) beside the four chasing him; below, every national award as a trophy card (the leader's face and
 * line, then the next two) and the coach awards. Heisman is the whole vote; your team's tab, its honors. Until selection week
 * it's the live race ("Leader"); then the results ("Winner"). Before Week 4, with no race yet, it shows a sample.
 */
export default function Awards({ season, teams, coach }: Props) {
  const [tab, setTab] = useState<Tab>("overview");
  const [view, setView] = useState<AwardsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [group, setGroup] = useState<Group>("all");

  useEffect(() => {
    let live = true;
    api<AwardsView>(`/api/season/${season.id}/awards`)
      .then((v) => live && setView(v))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [season.id]);

  const live = !view?.national;
  const real = view ? (view.national ?? view.race ?? null) : null;
  // before the race has a shape the game sends its preseason favorites (the best-rated players at each award's
  // positions); the canned sample only stands in when a save has neither
  const preseason = !!view && live && !!(view.race as { preseason?: boolean } | undefined)?.preseason;
  const sample = !!view && live && !preseason && !real?.heisman && !real?.awards.length;
  const nat = sample ? SAMPLE : real;
  const extra = useMemo(() => (!live && view?.postseason ? view.postseason.awards : []), [live, view]);
  const national = useMemo(() => (nat ? [...nat.awards, ...extra] : []), [nat, extra]);

  // each conference's honors: the results once given, else the race in your own conference
  const conferences = useMemo(() => {
    const given = view?.conference ?? {};
    return Object.keys(given).length ? given : ((sample ? {} : view?.race?.conference) ?? {});
  }, [view, sample]);
  const honors = useMemo(
    () => (nat ? honorsOf(nat, extra, season.team, live, sample ? {} : conferences) : []),
    [nat, extra, season.team, live, sample, conferences],
  );
  const confLive = !Object.keys(view?.conference ?? {}).length;
  const shared = {
    teams,
    mine: season.team,
    live,
    face: (p: AwardPlayer) => <PlayerFace p={p} teams={teams} />,
  };

  const weekName = season.week_labels[season.current_week] ?? `Week ${season.current_week}`;
  const status = !view ? null : sample ? (
    <SectionStatus sample tip={m.sampleTip}>
      {m.sample}
    </SectionStatus>
  ) : preseason ? (
    <SectionStatus sample tip={m.preseasonTip}>
      {m.preseason}
    </SectionStatus>
  ) : (
    <SectionStatus tip={live ? m.liveNote : undefined}>{live ? m.live(weekName) : m.final}</SectionStatus>
  );

  return (
    <You.Provider value={coach}>
      <div className="section-tabs__wrap">
        <SectionTabs
          title={m.title}
          value={tab}
          onChange={setTab}
          aside={status}
          tabs={[
            { key: "overview", label: m.tabs.overview },
            { key: "heisman", label: m.tabs.heisman },
            { key: "national", label: m.tabs.national },
            { key: "coaches", label: m.tabs.coaches },
            { key: "allAmerica", label: m.tabs.allAmerica },
            { key: "conferences", label: m.tabs.conferences },
            { key: "team", label: season.team_name, count: honors.length || undefined },
          ]}
        />
        {!nat ? (
          <p className="aw__note" role="status">
            {error ? m.loadError(error) : m.loading}
          </p>
        ) : (
          <>
            <SectionPane shown={tab === "overview"}>
              <div className="aw__scroll">
                {sample && <SampleNote>{m.sampleTip}</SampleNote>}
                {preseason && <SampleNote>{m.preseasonTip}</SampleNote>}
                <Hero h={nat.heisman} live={live} teams={teams} mine={season.team} onVote={() => setTab("heisman")} />
                <div className="aw__main">
                  <div className="aw__col">
                    <div className="aw__group-head">
                      <h2 className="label aw__kicker">{m.national}</h2>
                      <div className="aw__chips" role="group" aria-label={m.groupsLabel}>
                        {GROUPS.map((g) => (
                          <Chip key={g} on={group === g} onClick={() => setGroup(g)}>
                            {m.groups[g]}
                          </Chip>
                        ))}
                      </div>
                    </div>
                    {national.length ? (
                      <div className="aw__cards">
                        {national
                          .filter((a) => group === "all" || groupOf(a.kind) === group)
                          .map((a) =>
                            // an award after the playoff may go to a coach or to a team's line, not to a player
                            a.kind === "coach" ? (
                              <CoachCard
                                key={a.name}
                                a={a as unknown as CoachAward}
                                live={live}
                                teams={teams}
                                mine={season.team}
                              />
                            ) : a.kind === "ol_unit" ? (
                              <UnitCard key={a.name} a={a} teams={teams} mine={season.team} />
                            ) : (
                              <AwardCard key={a.name} a={a} live={live} teams={teams} mine={season.team} />
                            ),
                          )}
                      </div>
                    ) : (
                      <p className="aw__empty">{m.noAwards}</p>
                    )}
                    <h2 className="label aw__kicker">{m.coaches}</h2>
                    {nat.coach_awards.length ? (
                      <div className="aw__cards">
                        {nat.coach_awards.map((a) => (
                          <CoachCard key={a.name} a={a} live={live} teams={teams} mine={season.team} />
                        ))}
                      </div>
                    ) : (
                      <p className="aw__empty">{m.noAwards}</p>
                    )}
                  </div>
                </div>
              </div>
            </SectionPane>
            <SectionPane shown={tab === "national"}>
              <div className="aw__scroll">
                <NationalTable awards={national} {...shared} />
              </div>
            </SectionPane>
            <SectionPane shown={tab === "coaches"}>
              <div className="aw__scroll">
                <Coaches
                  awards={nat.coach_awards}
                  teams={teams}
                  mine={season.team}
                  live={live}
                  card={(a) => <CoachCard a={a} live={live} teams={teams} mine={season.team} />}
                />
              </div>
            </SectionPane>
            <SectionPane shown={tab === "allAmerica"}>
              <div className="aw__scroll">
                <AllAmericaTeams aa={sample ? null : nat.all_america} {...shared} />
              </div>
            </SectionPane>
            <SectionPane shown={tab === "conferences"}>
              <div className="aw__scroll">
                <Conferences
                  all={conferences}
                  start={view?.my_conference ?? season.conference}
                  {...shared}
                  live={confLive}
                  award={(a) => <AwardCard a={a} live={confLive} teams={teams} mine={season.team} />}
                  coach={(a) => <CoachCard a={a} live={confLive} teams={teams} mine={season.team} />}
                />
              </div>
            </SectionPane>
            <SectionPane shown={tab === "team"}>
              <div className="aw__scroll">
                <YourTeam teams={teams} slug={season.team} name={season.team_name} honors={honors} live={live} />
              </div>
            </SectionPane>
            <SectionPane shown={tab === "heisman"}>
              <div className="aw__scroll">
                <Vote h={nat.heisman} live={live} teams={teams} mine={season.team} />
              </div>
            </SectionPane>
          </>
        )}
      </div>
    </You.Provider>
  );
}

/** A player's face in his team's color. */
function PlayerFace({ p, teams, big }: { p: AwardPlayer; teams: Map<string, TeamCard>; big?: 1 | 2 | 3 }) {
  const t = teams.get(p.team);
  const scale = big ?? 1;
  return (
    <span
      className={`face-tile aw-face aw-face--${scale}`}
      style={t ? { background: t.colors.primary } : undefined}
      aria-hidden="true"
    >
      <Face face={lookOf(p.face, p.slug ?? `${p.team}-${p.name}`, p.position)} scale={scale} label="" />
    </span>
  );
}

function CoachFace({ c, teams, big }: { c: AwardCoach; teams: Map<string, TeamCard>; big?: boolean }) {
  const t = teams.get(c.team);
  const you = useContext(You);
  const face = you && you.name === c.coach ? you.face : staffFace(c.coach);
  return (
    <span
      className={`face-tile aw-face aw-face--${big ? 2 : 1}`}
      style={t ? { background: t.colors.primary } : undefined}
      aria-hidden="true"
    >
      <Face face={face} scale={big ? 2 : 1} label="" />
    </span>
  );
}

/** The Heisman leader as a banner in his team's colors, beside the four chasing him. */
function Hero({
  h,
  live,
  teams,
  mine,
  onVote,
}: {
  h: HeismanVote | null;
  live: boolean;
  teams: Map<string, TeamCard>;
  mine: string;
  onVote: () => void;
}) {
  const w = h?.candidates[0];
  if (!h || !w)
    return (
      <section className="aw-hero aw-hero--empty" aria-label={m.heisman}>
        <b>{m.noHeisman}</b>
        <span>{m.noHeismanText}</span>
      </section>
    );
  const t = teams.get(w.team);
  const chase = h.candidates.slice(1, 5);
  return (
    <section className={`aw-hero${w.team === mine ? " is-mine" : ""}`} aria-label={live ? m.strawPoll : m.heisman}>
      <div className="aw-hero__art" style={colorsOf(t)}>
        <span className="aw-hero__mark" aria-hidden="true">
          {t?.abbreviation ?? w.team_name.slice(0, 3).toUpperCase()}
        </span>
        <PlayerFace p={w} teams={teams} big={3} />
        <div className="aw-hero__text">
          <span className="aw-hero__kicker">
            {live ? m.strawPoll : m.heisman}
            <span className="aw-hero__tag">{live ? m.leader : m.winner}</span>
          </span>
          <b className="aw-hero__name">
            <PlayerLink team={w.team} name={w.name} position={w.position} />
          </b>
          <span className="aw-hero__who">{[whoLine(w), w.record].filter(Boolean).join(" · ")}</span>
          <span className="aw-hero__line">{w.final_line ?? w.line}</span>
        </div>
        <div className="aw-hero__points">
          <b>{w.points.toLocaleString("en-US")}</b>
          <span className="label">{m.points}</span>
          <span className="aw-hero__share">
            {m.share(Math.round((100 * w.points) / Math.max(1, h.possible)), h.ballots)}
          </span>
        </div>
      </div>
      <div className="aw-hero__chase">
        <h3 className="label aw__kicker">{m.chasing}</h3>
        <ol>
          {chase.map((c, i) => (
            <li key={`${c.team}-${c.name}`} className={c.team === mine ? "is-mine" : undefined}>
              <span className="aw-hero__place">{i + 2}</span>
              <PlayerFace p={c} teams={teams} />
              <span className="aw-who">
                <b>
                  <PlayerLink team={c.team} name={c.name} position={c.position} />
                </b>
                <span className="aw-who__team">
                  <Swatch team={teams.get(c.team)} size={12} />
                  {c.position} · {c.team_name}
                </span>
              </span>
              <span className="aw-hero__pts">{m.pts(c.points)}</span>
            </li>
          ))}
        </ol>
        <button type="button" className="aw-link" onClick={onVote}>
          {m.openVote}
          <ArrowRight size={14} weight="bold" aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}

/** An award that goes to a team's unit (the best offensive line): the school in its letters and colors, its numbers,
 * then the next two. */
function UnitCard({ a, teams, mine }: { a: PlayerAward; teams: Map<string, TeamCard>; mine: string }) {
  const list = a.finalists as unknown as {
    team: string;
    team_name: string;
    rush_ypg?: number;
    ypc?: number;
    sack_rate?: number;
  }[];
  const w = list[0];
  const line = (u: (typeof list)[number]) => m.unitLine(u.rush_ypg ?? 0, u.ypc ?? 0, u.sack_rate ?? 0);
  const card = w ? teams.get(w.team) : undefined;
  return (
    <article className={`aw-card${w?.team === mine ? " is-mine" : ""}`} aria-label={a.name}>
      <header className="aw-card__head">
        <b className="aw-card__name">{a.name}</b>
        {a.honors && <span className="aw-card__honors">{sentence(a.honors)}</span>}
      </header>
      {!w ? (
        <p className="aw__empty">{m.noRace}</p>
      ) : (
        <>
          <div className="aw-card__lead">
            {card && <Wordmark team={card} />}
            <span className="aw-who">
              <span className="aw-card__tag">{m.winner}</span>
              <b className="aw-card__winner">{w.team_name}</b>
              <span className="aw-card__headline">{line(w)}</span>
            </span>
          </div>
          {list.length > 1 && (
            <ol className="aw-card__rest" start={2}>
              {list.slice(1, 3).map((u, i) => (
                <li key={u.team}>
                  <span className="aw-card__n">{i + 2}</span>
                  <Swatch team={teams.get(u.team)} size={12} />
                  <span className="aw-card__rest-name">{u.team_name}</span>
                  <span className="aw-card__rest-line">{m.unitShort(u.rush_ypg ?? 0)}</span>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </article>
  );
}

/** One national award: its leader (or winner) with his face and line, then the next two. */
function AwardCard({
  a,
  live,
  teams,
  mine,
}: {
  a: PlayerAward;
  live: boolean;
  teams: Map<string, TeamCard>;
  mine: string;
}) {
  const list = live ? (a.race ?? a.finalists) : a.finalists.length ? a.finalists : a.winner ? [a.winner] : [];
  const w = list[0];
  return (
    <article className={`aw-card${w?.team === mine ? " is-mine" : ""}`} aria-label={a.name}>
      <header className="aw-card__head">
        <b className="aw-card__name">{a.name}</b>
        {a.honors && <span className="aw-card__honors">{sentence(a.honors)}</span>}
      </header>
      {!w ? (
        <p className="aw__empty">{m.noRace}</p>
      ) : (
        <>
          <div className="aw-card__lead">
            <PlayerFace p={w} teams={teams} big={2} />
            <span className="aw-who">
              <span className="aw-card__tag">{live ? m.leader : m.winner}</span>
              <b className="aw-card__winner">
                <PlayerLink team={w.team} name={w.name} position={w.position} />
              </b>
              <span className="aw-who__team">
                <Swatch team={teams.get(w.team)} size={12} />
                {whoLine(w)}
              </span>
              <span className="aw-card__headline">{w.headline}</span>
            </span>
          </div>
          {list.length > 1 && (
            <ol className="aw-card__rest" start={2}>
              {list.slice(1, 3).map((p, i) => (
                <li
                  key={`${p.team}-${p.name}`}
                  className={p.team === mine ? "is-mine" : undefined}
                  title={`${p.name} · ${p.position} · ${p.team_name}`}
                >
                  <span className="aw-card__n">{i + 2}</span>
                  <Swatch team={teams.get(p.team)} size={12} />
                  <span className="aw-card__rest-name">
                    <b>
                      <PlayerLink team={p.team} name={p.name} position={p.position} />
                    </b>
                  </span>
                  <span className="aw-card__rest-line">{p.headline}</span>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </article>
  );
}

function CoachCard({
  a,
  live,
  teams,
  mine,
}: {
  a: CoachAward;
  live: boolean;
  teams: Map<string, TeamCard>;
  mine: string;
}) {
  const w = a.finalists[0] ?? a.winner;
  return (
    <article className={`aw-card aw-card--coach${w?.team === mine ? " is-mine" : ""}`} aria-label={a.name}>
      <header className="aw-card__head">
        <b className="aw-card__name">{a.name}</b>
      </header>
      {!w ? (
        <p className="aw__empty">{m.noRace}</p>
      ) : (
        <div className="aw-card__lead">
          <CoachFace c={w} teams={teams} big />
          <span className="aw-who">
            <span className="aw-card__tag">{live ? m.leader : m.winner}</span>
            <b className="aw-card__winner">{w.coach}</b>
            <span className="aw-who__team">
              <Swatch team={teams.get(w.team)} size={12} />
              {w.role ?? m.headCoach} · {w.team_name}
            </span>
            <span className="aw-card__headline">{m.coachLine(w.wins, w.losses, w.rank)}</span>
          </span>
        </div>
      )}
    </article>
  );
}

/** Your team's honors: a strip in your colors with the counts, then each honor as a card (best placings first). */
function YourTeam({
  teams,
  slug,
  name,
  honors,
  live,
}: {
  teams: Map<string, TeamCard>;
  slug: string;
  name: string;
  honors: Honor[];
  live: boolean;
}) {
  const team = teams.get(slug);
  const wins = honors.filter((h) => h.rank === 1).length;
  const people = new Set(honors.map((h) => h.player?.name ?? h.coach?.coach)).size;
  return (
    <section className="aw-mine" aria-label={m.yourHonors(name)}>
      <header className="aw-mine__head" style={colorsOf(team)}>
        <span className="aw-mine__mark" aria-hidden="true">
          {team?.abbreviation ?? ""}
        </span>
        <h2 className="aw-mine__title">{m.yourHonors(name)}</h2>
        <dl className="aw-mine__pod">
          <div>
            <dt className="label">{m.honors}</dt>
            <dd>{honors.length}</dd>
          </div>
          <div>
            <dt className="label">{live ? m.racesLed : m.awardsWon}</dt>
            <dd>{wins}</dd>
          </div>
          <div>
            <dt className="label">{m.people}</dt>
            <dd>{people}</dd>
          </div>
        </dl>
      </header>
      {honors.length ? (
        <ul className="aw-mine__list">
          {honors.map((h, i) => (
            <li key={i} className={`aw-mine__card${h.rank === 1 ? " is-top" : ""}`}>
              {h.player ? (
                <PlayerFace p={h.player} teams={teams} big={2} />
              ) : h.coach ? (
                <CoachFace c={h.coach} teams={teams} big />
              ) : null}
              <span className="aw-who">
                <span className={`aw-mine__place${h.rank === 1 ? " is-top" : ""}`}>{h.place}</span>
                <b className="aw-card__winner">{h.player?.name ?? h.coach?.coach}</b>
                <span className="aw-mine__award">{h.award}</span>
                <span className="aw-card__headline">
                  {h.player
                    ? h.player.headline
                    : h.coach
                      ? m.coachLine(h.coach.wins, h.coach.losses, h.coach.rank)
                      : ""}
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="aw-mine__none">{live ? m.noHonorsLive : m.noHonors}</p>
      )}
    </section>
  );
}

/** The whole Heisman vote: every candidate, his votes and his points as a bar against the leader's. */
function Vote({
  h,
  live,
  teams,
  mine,
}: {
  h: HeismanVote | null;
  live: boolean;
  teams: Map<string, TeamCard>;
  mine: string;
}) {
  if (!h || !h.candidates.length)
    return (
      <div className="aw-hero aw-hero--empty">
        <b>{m.noHeisman}</b>
        <span>{m.noHeismanText}</span>
      </div>
    );
  const top = Math.max(1, h.candidates[0].points);
  return (
    <section className="aw-vote" aria-label={live ? m.strawPoll : m.heisman}>
      <header className="aw-vote__head">
        <h2 className="aw-vote__title">{live ? m.strawPoll : m.heisman}</h2>
        <p className="aw-card__honors">{m.ballotsLine(h.ballots, h.possible)}</p>
      </header>
      <table className="aw-vote__table">
        <thead>
          <tr>
            <th scope="col">{m.cols.rank}</th>
            <th scope="col" className="aw-vote__left">
              {m.cols.player}
            </th>
            <th scope="col">{m.cols.record}</th>
            <th scope="col" title={m.colsTip.first}>
              {m.cols.first}
            </th>
            <th scope="col" title={m.colsTip.second}>
              {m.cols.second}
            </th>
            <th scope="col" title={m.colsTip.third}>
              {m.cols.third}
            </th>
            <th scope="col" className="aw-vote__left">
              {m.cols.points}
            </th>
          </tr>
        </thead>
        <tbody>
          {h.candidates.map((c, i) => (
            <tr
              key={`${c.team}-${c.name}`}
              className={[i === 0 && "is-top", c.team === mine && "is-mine"].filter(Boolean).join(" ")}
            >
              <td className="aw-vote__rank">{i + 1}</td>
              <td className="aw-vote__left">
                <span className="aw-vote__player">
                  <PlayerFace p={c} teams={teams} />
                  <span className="aw-who">
                    <b>
                      <PlayerLink team={c.team} name={c.name} position={c.position} />
                    </b>
                    <span className="aw-who__team">
                      <Swatch team={teams.get(c.team)} size={12} />
                      {whoLine(c)}
                    </span>
                    <span className="aw-vote__line">{c.final_line ?? c.line}</span>
                  </span>
                </span>
              </td>
              <td>
                {c.rank ? `#${c.rank} · ` : ""}
                {c.record}
              </td>
              <td>{c.first}</td>
              <td>{c.second}</td>
              <td>{c.third}</td>
              <td className="aw-vote__left">
                <span className="aw-vote__points">
                  <span className="aw-vote__bar" aria-hidden="true">
                    <i style={{ width: `${(100 * c.points) / top}%` }} />
                  </span>
                  <b>{c.points.toLocaleString("en-US")}</b>
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
