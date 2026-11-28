import type { CSSProperties } from "react";
import { Football, ShieldChevron, Sneaker } from "@phosphor-icons/react";
import FitText from "../FitText/index.tsx";
import Panel from "../Panel/index.tsx";
import PlayerLink from "../PlayerLink/index.tsx";
import TeamPlate from "../TeamPlate/index.tsx";
import { inkOn } from "../../colors.ts";
import type { TeamCard } from "../../types.ts";
import { messages as m } from "./messages.ts";

type Kind = "offense" | "defense" | "special";
const KINDS: Kind[] = ["offense", "defense", "special"];
const ICON = { offense: Football, defense: ShieldChevron, special: Sneaker } as const;

/** One player's game, honored. */
interface Honor {
  team: string;
  team_name: string;
  team_rank: number | null;
  conference: string | null;
  name: string;
  position: string;
  line: string;
  opponent: string;
  opponent_abbr: string | null;
  opponent_name: string;
  won: boolean;
  points_for: number;
  points_against: number;
  mine: boolean;
}

/** GET /api/season/{id}/week_awards (sim_js/news.js week_awards): one finished week's Players of the Week. */
export interface WeekAwards {
  week: number | null;
  weeks: number[];
  latest: number | null;
  national: Record<Kind, { winner: Honor | null; also: Honor[] }> | null;
  conferences: ({ conference: string; mine: boolean } & Record<Kind, Honor | null | undefined>)[];
}

interface Props {
  view: WeekAwards;
  teams: Map<string, TeamCard>;
}

/**
 * The Players of the Week (the Awards page while the season is played: the player's design). The three national
 * honors as banners in the winners' colors, the two who ran them closest under each; then a card a conference with
 * its own three, yours first.
 */
export default function Week({ view, teams }: Props) {
  const abbr = (slug: string, fallback?: string | null) => teams.get(slug)?.abbreviation ?? fallback ?? "";
  const game = (h: Honor) =>
    m.week.game(h.won, h.points_for, h.points_against, abbr(h.opponent, h.opponent_abbr ?? h.opponent_name));
  if (!view.national) return <p className="aw__note">{m.week.none}</p>;
  const national = view.national;

  return (
    <div className="aw__scroll aw-week">
      <div className="aw-week__nation">
        {KINDS.map((k) => {
          const w = national[k].winner;
          const Icon = ICON[k];
          const t = w ? teams.get(w.team) : undefined;
          return (
            <article
              key={k}
              className={`aw-week__banner${w?.mine ? " is-mine" : ""}`}
              style={t ? ({ "--c": t.colors.primary, "--on": inkOn(t.colors.primary) } as CSSProperties) : undefined}
            >
              <span className="aw-week__mark" aria-hidden="true">
                {t?.abbreviation}
              </span>
              <span className="aw-week__kicker">
                <Icon size={16} weight="fill" aria-hidden="true" />
                {m.week.national[k]}
              </span>
              {w ? (
                <>
                  <h2>
                    <FitText>
                      <PlayerLink team={w.team} name={w.name} position={w.position} />
                    </FitText>
                  </h2>
                  <p className="aw-week__who">
                    {m.week.who(w.position, w.team_rank ? m.week.ranked(w.team_rank, w.team_name) : w.team_name)}
                  </p>
                  <p className="aw-week__line">{w.line}</p>
                  <p className="aw-week__game">{game(w)}</p>
                </>
              ) : (
                <p className="aw-week__who">{m.week.nobody}</p>
              )}
              {national[k].also.length > 0 && (
                <ul className="aw-week__also" aria-label={m.week.also}>
                  {national[k].also.map((p) => (
                    <li key={`${p.team}-${p.name}`}>
                      <b>
                        <PlayerLink team={p.team} name={p.name} position={p.position} />
                      </b>
                      <span>
                        {p.position} ·{" "}
                        <TeamPlate team={teams.get(p.team)} size="sm">
                          {abbr(p.team, p.team_name)}
                        </TeamPlate>
                      </span>
                      <span className="aw-week__also-line">{p.line}</span>
                    </li>
                  ))}
                </ul>
              )}
            </article>
          );
        })}
      </div>

      <h2 className="label aw__kicker">{m.week.conferences}</h2>
      <div className="aw-week__confs">
        {view.conferences.map((c) => (
          <Panel
            key={c.conference}
            title={m.week.confShort[c.conference] ?? c.conference}
            aside={c.mine ? m.week.yours : undefined}
            className={c.mine ? "aw-week__conf is-mine" : "aw-week__conf"}
          >
            <ul className="aw-week__rows">
              {KINDS.map((k) => {
                const p = c[k];
                const Icon = ICON[k];
                return (
                  <li key={k} className={p?.mine ? "is-mine" : undefined}>
                    <span className="aw-week__kind" title={m.week.kinds[k]}>
                      <Icon size={14} weight="fill" aria-hidden="true" />
                      <span className="label">{m.week.kindShort[k]}</span>
                    </span>
                    {p ? (
                      <span className="aw-week__pick">
                        <span className="aw-week__pick-who">
                          <b>
                            <PlayerLink team={p.team} name={p.name} position={p.position} />
                          </b>
                          <span className="aw-week__soft">
                            {p.position} ·{" "}
                            <TeamPlate team={teams.get(p.team)} size="sm">
                              {abbr(p.team, p.team_name)}
                            </TeamPlate>
                          </span>
                        </span>
                        <span className="aw-week__soft aw-week__pick-line">{p.line}</span>
                      </span>
                    ) : (
                      <span className="aw-week__soft">{m.week.nobody}</span>
                    )}
                    {p && <span className="aw-week__soft aw-week__result">{game(p)}</span>}
                  </li>
                );
              })}
            </ul>
          </Panel>
        ))}
      </div>
    </div>
  );
}
