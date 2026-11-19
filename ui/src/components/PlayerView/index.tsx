import { useState, type ReactNode } from "react";
import { Medal, PencilSimple, Star } from "@phosphor-icons/react";
import Chip from "../Chip/index.tsx";
import Blocks from "../Blocks/index.tsx";
import Face from "../Face/index.tsx";
import Panel, { PanelRow, PanelRows, Panels } from "../Panel/index.tsx";
import ProfileHead, { HeadTag } from "../ProfileHead/index.tsx";
import Tooltip from "../Tooltip/index.tsx";
import { lookOf } from "../../faces.ts";
import { formatClass, ordinal } from "../../format.ts";
import type { DepthCard, PlayerProfile } from "../../types.ts";
import { messages as m } from "./messages.ts";
import "./index.css";

interface Props {
  /** what the depth chart knows about him (at once) */
  card: DepthCard;
  /** his whole profile: attributes, traits, stars (arrives a moment later) */
  profile: PlayerProfile | null;
  /** the profile failed to load */
  error?: string | null;
  /** the season's week names, for when an injured player is back */
  weekLabels?: Record<string, string>;
  /** open Edit Player Look for him */
  onEditLook?: () => void;
}

/** The profile's position groups (ratings_at): the three linebacker spots share one rating. */
const GROUP_OF: Record<string, string> = { LOLB: "MLB", ROLB: "MLB", OLB: "MLB" };
const GROUP_NAME: Record<string, string> = { MLB: "LB" };

const TABS = ["overview", "ratings", "development", "abilities", "history"] as const;
type Tab = (typeof TABS)[number];

/** 80 and up reads high, under 50 low (the old depth chart's tiers). */
const tier = (v: number) => (v >= 80 ? "hi" : v < 50 ? "lo" : "");

/** The game's tooltip around something, when there is something to say. */
function Tip({
  text,
  title,
  block,
  className,
  children,
}: {
  text?: string | null;
  title?: string;
  block?: boolean;
  className?: string;
  children: ReactNode;
}) {
  if (!text) return <>{children}</>;
  return (
    <Tooltip text={text} title={title} block={block} className={className}>
      {children}
    </Tooltip>
  );
}

/** A rating on one line: its name, a bar (the ceiling faint behind it, when there is one), its number. */
function Bar({
  label,
  value,
  ceiling,
  tip,
  mark,
  trail,
}: {
  label: string;
  value: number;
  ceiling?: number;
  tip?: string;
  /** a key rating for his position: its name in bold */
  mark?: boolean;
  /** in place of the number at the row's end */
  trail?: ReactNode;
}) {
  return (
    <Tip text={tip} title={label} block className="player-view__bar-row">
      <div className="player-view__bar">
        <span className={`player-view__bar-label${mark ? " is-key" : ""}`}>{label}</span>
        <span className="player-view__bar-track" aria-hidden="true">
          {ceiling != null && (
            <i className="player-view__bar-ceiling" style={{ width: `${Math.min(100, ceiling)}%` }} />
          )}
          <i className={`player-view__bar-fill ${tier(value)}`} style={{ width: `${Math.min(100, value)}%` }} />
        </span>
        {trail ?? <b className={`player-view__bar-value ${tier(value)}`}>{value}</b>}
      </div>
    </Tip>
  );
}

/** *tune* A goal of this many steps or fewer shows as blocks, one a step; a longer one as a bar. */
const BLOCKS_MAX = 12;

/** An ability's medal: its tier sets the metal (Bronze, Silver, Gold, Platinum). */
function Badge({ tier: t, name, big, small }: { tier: number; name: string; big?: boolean; small?: boolean }) {
  return (
    <Tooltip text={m.tierTip(name)}>
      <span
        className={`player-view__medal player-view__medal--t${t}${big ? " is-big" : ""}${small ? " is-small" : ""}`}
        aria-hidden="true"
      >
        <Medal size={big ? 30 : small ? 12 : 22} weight="fill" />
      </span>
    </Tooltip>
  );
}

/** How far along a goal is: a block a step when it is short, a bar when it is long. */
function Progress({ have, need }: { have: number; need: number }) {
  if (need > BLOCKS_MAX)
    return (
      <span className="player-view__bar-track player-view__progress-bar" aria-hidden="true">
        <i className="player-view__bar-fill" style={{ width: `${need ? Math.min(100, (100 * have) / need) : 0}%` }} />
      </span>
    );
  return <Blocks have={have} need={need} />;
}

/**
 * One player, everything the game knows about him: a head (his face, who he is, his overall, how he's doing), a strip
 * of facts, then four tabs. Overview: every attribute by group, and what else there is to know. Ratings: the broad
 * ratings and how he rates at every position. Development: his room to grow, how he develops and his abilities.
 * History: this season's ranks, games and honors, and his past seasons. The card's facts show at once; the profile's
 * parts fill in when it comes.
 */
export default function PlayerView({ card: p, profile: pr, error, weekLabels, onEditLook }: Props) {
  const [tab, setTab] = useState<Tab>("overview");
  const back = p.injury ? (weekLabels?.[String(p.injury.returns_week)] ?? m.week(p.injury.returns_week)) : null;
  // an injury names itself and when he is back (the whole line is the cell's tooltip when it is cut short)
  const status = p.injury ? m.injured(p.injury.type, back!) : p.redshirt?.on ? m.redshirting : m.healthy;
  const spot = p.role && p.depth ? m.spot(p.role, p.depth) : null;
  const season = p.headline || (p.games ? m.games(p.games) : m.noGames);

  const own = GROUP_OF[p.position] ?? p.position;
  const others = pr
    ? Object.entries(pr.ratings_at)
        .filter(([g]) => g !== own && g !== "KR")
        .sort((a, b) => b[1] - a[1])
    : [];
  const goal = pr?.ability_goal;
  const goalLine = goal ? m.goalLine(goal.name, goal.tier_name, goal.have, goal.need) : null;
  const groups = pr ? [...new Set(pr.attributes.map((a) => a.group))] : [];
  const coachability = pr?.coachability ?? p.coachability;
  const potential = pr?.potential_word ?? p.potential_word;

  return (
    <article className="player-view" aria-label={p.name}>
      <ProfileHead
        face={<Face face={lookOf(p.face, p.slug, p.position)} scale={6} label="" />}
        corner={
          onEditLook && (
            <Tooltip text={m.editLookTip} title={m.editLook}>
              <button type="button" aria-label={m.editLook} onClick={onEditLook}>
                <PencilSimple size={14} weight="bold" aria-hidden="true" />
              </button>
            </Tooltip>
          )
        }
        name={p.name}
        beside={[p.jersey && m.jersey(p.jersey), p.position].filter(Boolean).join(" ")}
        line={[formatClass(p.class), p.height, p.weight ? m.pounds(p.weight) : null].filter(Boolean).join(" · ")}
        tags={
          <>
            {/* his place on the depth chart, as a tag: WR2 (a starter's in ink) */}
            <HeadTag
              solid={p.starter}
              tip={{
                title: m.depthChart,
                text: p.role && p.depth ? m.spotTip(ordinal(p.depth), p.role, p.starter) : m.notOnChartTip,
              }}
            >
              {spot ?? m.notOnChart}
            </HeadTag>
            {p.archetype && <span>{p.archetype}</span>}
            {pr?.stars ? (
              <Tooltip text={m.starsTip} title={m.stars(pr.stars)}>
                <span className="player-view__stars" role="img" aria-label={m.stars(pr.stars)}>
                  {Array.from({ length: pr.stars }, (_, k) => (
                    <Star key={k} size={14} weight="fill" aria-hidden="true" />
                  ))}
                </span>
              </Tooltip>
            ) : null}
            {p.moved_from && <HeadTag tip={{ text: m.wasTitle(p.moved_from) }}>{m.was(p.moved_from)}</HeadTag>}
            {p.injury && <HeadTag solid>{m.out}</HeadTag>}
            {p.redshirt?.on && <HeadTag>{m.rs}</HeadTag>}
          </>
        }
        cells={[
          { label: m.status, value: status },
          { label: m.thisSeason, value: season },
          { label: m.form, value: pr?.morale?.enabled ? pr.morale.label : m.none },
        ]}
        tile={{ label: m.overall, value: p.overall, aria: m.overallLabel(p.overall), soft: tier(p.overall) === "lo" }}
      />

      <div className="player-view__tabs" role="tablist" aria-label={m.about}>
        {TABS.map((k) => (
          <Chip key={k} role="tab" on={tab === k} onClick={() => setTab(k)}>
            {m.tabs[k]}
          </Chip>
        ))}
      </div>

      {error && <p className="player-view__soft">{m.loadError(error)}</p>}
      {!pr && !error && <p className="player-view__soft player-view__loading">{m.loading}</p>}

      {pr && tab === "overview" && (
        <Panels label={m.tabs.overview}>
          {groups.map((g) => (
            <Panel key={g} title={g}>
              {pr.attributes
                .filter((a) => a.group === g)
                .map((a) => (
                  <Bar
                    key={a.key}
                    label={a.label}
                    value={a.value}
                    ceiling={a.potential}
                    tip={a.potential != null ? `${a.about} ${m.ceiling(a.potential)}.` : a.about}
                  />
                ))}
            </Panel>
          ))}
          <Panel title={m.other}>
            <PanelRows>
              {coachability && <PanelRow label={m.coachability} value={coachability} tip={m.coachTip} />}
              {potential && <PanelRow label={m.potential} value={potential} tip={m.potentialTip} />}
              {p.promise && <PanelRow label={m.promise} value={p.promise} tip={m.promiseTip} />}
              {goalLine && <PanelRow label={m.goal} value={goalLine} tip={goal?.text} />}
              {pr.traits.length > 0 && (
                <PanelRow label={m.traits} value={pr.traits.map((t) => `${t.name} (${t.tier_name})`).join(", ")} />
              )}
              <PanelRow label={m.team} value={pr.team.record ? `${pr.team.name} · ${pr.team.record}` : pr.team.name} />
            </PanelRows>
          </Panel>
        </Panels>
      )}

      {pr && tab === "ratings" && (
        <Panels label={m.tabs.ratings}>
          <Panel title={m.broad} aside={m.keyNote(p.position)}>
            {pr.ratings?.length ? (
              [...pr.ratings]
                .sort((a, b) => Number(isKey(pr, b.key)) - Number(isKey(pr, a.key)))
                .map((r) => <Bar key={r.key} label={r.label} value={r.value} mark={isKey(pr, r.key)} />)
            ) : (
              <p className="player-view__soft">{m.noRatings}</p>
            )}
          </Panel>
          <Panel title={m.everywhere}>
            <Bar label={GROUP_NAME[own] ?? own} value={p.overall} mark />
            {others.map(([g, v]) => (
              <Bar key={g} label={GROUP_NAME[g] ?? g} value={v} />
            ))}
            {pr.ratings_at.KR != null && <Bar label={m.returner} value={pr.ratings_at.KR} />}
          </Panel>
        </Panels>
      )}

      {pr && tab === "development" && (
        <Panels label={m.tabs.development}>
          <Panel title={m.room} aside={m.roomNote}>
            {pr.attributes.some((a) => a.potential != null) ? (
              [...pr.attributes]
                .filter((a) => a.potential != null)
                .sort((a, b) => b.potential - b.value - (a.potential - a.value))
                .map((a) => (
                  <Bar
                    key={a.key}
                    label={a.label}
                    value={a.value}
                    ceiling={a.potential}
                    tip={a.potential > a.value ? a.about : `${a.about} ${m.atCeilingTip}`}
                    trail={
                      <span className="player-view__grow">
                        <b>{a.value}</b>
                        <span className="player-view__soft">
                          {a.potential > a.value ? m.upTo(a.potential) : m.atCeiling}
                        </span>
                      </span>
                    }
                  />
                ))
            ) : (
              <p className="player-view__soft">{m.noCeilings}</p>
            )}
          </Panel>
          <Panel title={m.develops}>
            <PanelRows>
              <PanelRow label={m.classYear} value={pr.class_name ?? formatClass(p.class) ?? m.none} />
              {coachability && <PanelRow label={m.coachability} value={coachability} tip={m.coachTip} />}
              {potential && <PanelRow label={m.potential} value={potential} tip={m.potentialTip} />}
              {pr.redshirt && (
                <PanelRow
                  label={m.redshirt}
                  value={
                    pr.redshirt.on
                      ? m.redshirtOn(pr.redshirt.games, pr.redshirt.limit)
                      : pr.redshirt.can
                        ? m.redshirtCan
                        : m.redshirtNo(pr.redshirt.why)
                  }
                />
              )}
            </PanelRows>
          </Panel>
        </Panels>
      )}

      {pr && tab === "abilities" && (
        <Panels stack label={m.tabs.abilities}>
          <Panel title={m.goal}>
            {goal ? (
              <div className="player-view__goal">
                <Badge tier={goal.tier} name={goal.tier_name} big />
                <div className="player-view__goal-what">
                  <b className="player-view__goal-name">{goal.name}</b>
                  <span className="player-view__soft">{m.goalNext(goal.tier_name, goal.text)}</span>
                </div>
                <div className="player-view__goal-meter">
                  <Progress have={goal.have} need={goal.need} />
                  <b>{m.progress(goal.have, goal.need)}</b>
                </div>
              </div>
            ) : (
              <p className="player-view__soft">{m.noGoal}</p>
            )}
          </Panel>
          <Panel title={m.abilities} aside={pr.traits.length ? m.abilityCount(pr.traits.length) : undefined}>
            {pr.traits.length ? (
              <ul className="player-view__badges">
                {pr.traits.map((t) => (
                  <li key={t.key} className="player-view__badge-card">
                    <Badge tier={t.tier} name={t.tier_name} />
                    <div className="player-view__badge-what">
                      <b>{t.name}</b>
                      <span className="player-view__badge-tier">
                        {t.tier_name}
                        {t.earned && <span className="player-view__tag">{m.earned}</span>}
                        {goal?.trait === t.key && <span className="player-view__tag">{m.nextUp(goal.tier_name)}</span>}
                      </span>
                      <span className="player-view__soft">{t.about}</span>
                      {t.built_on.length > 0 && (
                        <span className="player-view__built">
                          {m.builtOn}{" "}
                          {t.built_on.map((x) => (
                            <span key={x.label} className="player-view__built-on">
                              {x.label} <b>{x.value}</b>
                            </span>
                          ))}
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="player-view__soft">{m.noAbilities}</p>
            )}
          </Panel>
          <p className="player-view__soft player-view__tiers">
            {m.tierKey}{" "}
            {[1, 2, 3, 4].map((k) => (
              <span key={k} className="player-view__tier-key">
                <Badge tier={k} name={m.tierNames[k - 1]} small />
                {m.tierNames[k - 1]}
              </span>
            ))}
          </p>
        </Panels>
      )}

      {pr && tab === "history" && (
        <Panels label={m.tabs.history}>
          <Panel title={m.thisSeason} aside={pr.team.record ? `${pr.team.name} · ${pr.team.record}` : pr.team.name}>
            <p className="player-view__lead">{season}</p>
            {pr.ranks?.length ? (
              <table className="player-view__table">
                <thead>
                  <tr>
                    <th scope="col">{m.stat}</th>
                    <th scope="col">{m.value}</th>
                    <th scope="col">{m.fbs}</th>
                    <th scope="col">{m.conf}</th>
                  </tr>
                </thead>
                <tbody>
                  {pr.ranks.map((x) => (
                    <tr key={x.key}>
                      <th scope="row">{x.label}</th>
                      <td>{x.value.toLocaleString("en-US")}</td>
                      <td>{m.rankOf(x.fbs_rank, x.fbs_n)}</td>
                      <td>{m.rankOf(x.conf_rank, x.conf_n)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="player-view__soft">{m.noRanks}</p>
            )}
          </Panel>
          <Panel title={m.gameLog}>
            {pr.game_log?.length ? (
              <table className="player-view__table">
                <thead>
                  <tr>
                    <th scope="col">{m.weekCol}</th>
                    <th scope="col">{m.opponent}</th>
                    <th scope="col">{m.result}</th>
                    <th scope="col">{m.role}</th>
                  </tr>
                </thead>
                <tbody>
                  {pr.game_log.map((g) => (
                    <tr key={g.week}>
                      <th scope="row">{weekLabels?.[String(g.week)] ?? m.week(g.week)}</th>
                      <td>{m.versus(g.venue === "away", g.opponent_name)}</td>
                      <td>{m.score(g.won, g.points_for, g.points_against)}</td>
                      <td>{g.started ? m.started : m.played}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="player-view__soft">{m.noGameLog}</p>
            )}
          </Panel>
          <Panel title={m.honors}>
            {pr.honors?.length ? (
              <ul className="player-view__list">
                {pr.honors.map((h, i) => (
                  <li key={i}>
                    <b>{h.award}</b>
                    <span className="player-view__soft">{[h.place, h.detail].filter(Boolean).join(" · ")}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="player-view__soft">{m.noHonors}</p>
            )}
          </Panel>
          <Panel title={m.career}>
            {pr.history?.length ? (
              <table className="player-view__table">
                <thead>
                  <tr>
                    <th scope="col">{m.year}</th>
                    <th scope="col">{m.team}</th>
                    <th scope="col">{m.classYear}</th>
                    <th scope="col">{m.gamesCol}</th>
                  </tr>
                </thead>
                <tbody>
                  {pr.history.map((h) => (
                    <tr key={h.year}>
                      <th scope="row">
                        <Tip text={h.honors.map((x) => x.name).join(", ")} title={m.honors}>
                          {h.year}
                        </Tip>
                      </th>
                      <td>{h.team_name}</td>
                      <td>{[h.position, formatClass(h.class)].filter(Boolean).join(" · ")}</td>
                      <td>{h.games}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="player-view__soft">{m.noCareer}</p>
            )}
          </Panel>
        </Panels>
      )}
    </article>
  );
}

/** One of the ratings his position leans on. */
const isKey = (pr: PlayerProfile, key: string) => !!pr.key_ratings?.includes(key);
