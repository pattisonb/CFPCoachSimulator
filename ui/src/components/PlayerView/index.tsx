import { Star } from "@phosphor-icons/react";
import Face from "../Face/index.tsx";
import { playerFace } from "../../faces.ts";
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
}

/** *tune* How many other positions "At Other Positions" lists, best first. */
const ELSEWHERE = 3;
/** The profile's position groups (ratings_at): the three linebacker spots share one rating. */
const GROUP_OF: Record<string, string> = { LOLB: "MLB", ROLB: "MLB", OLB: "MLB" };
const GROUP_NAME: Record<string, string> = { MLB: "LB" };

/** 80 and up reads high, under 50 low (the old depth chart's tiers). */
const tier = (v: number) => (v >= 80 ? "hi" : v < 50 ? "lo" : "");

/**
 * One player, everything the game knows about him: his face (pocket-faces, from his id, so a recruit keeps it when he
 * signs), who he is, where he sits on the depth chart, how he's doing, his traits and every attribute against his
 * ceiling. The card's facts show at once; the profile's parts fill in when it comes.
 */
export default function PlayerView({ card: p, profile: pr, error, weekLabels }: Props) {
  const back = p.injury ? (weekLabels?.[String(p.injury.returns_week)] ?? m.week(p.injury.returns_week)) : null;
  const status = p.injury ? m.injured(p.injury.type, back!) : p.redshirt?.on ? m.redshirting : m.healthy;
  const spot = p.role && p.depth ? m.spot(p.role, ordinal(p.depth), p.starter) : m.notOnChart;

  const facts: [string, string, string?][] = [
    [m.depthChart, spot],
    [m.height, p.height ?? "–"],
    [m.weight, p.weight ? m.pounds(p.weight) : "–"],
    [m.status, status],
    [m.thisSeason, p.headline || (p.games ? m.games(p.games) : m.noGames)],
  ];
  if (pr?.morale?.enabled) facts.push([m.form, pr.morale.label]);
  if (p.coachability) facts.push([m.coachability, p.coachability, m.coachTip]);
  if (p.potential_word) facts.push([m.potential, p.potential_word, m.potentialTip]);
  if (p.promise) facts.push([m.promise, p.promise, m.promiseTip]);

  const own = GROUP_OF[p.position] ?? p.position;
  const elsewhere = pr
    ? Object.entries(pr.ratings_at)
        .filter(([g]) => g !== own && g !== "KR")
        .sort((a, b) => b[1] - a[1])
        .slice(0, ELSEWHERE)
    : [];
  const groups = pr ? [...new Set(pr.attributes.map((a) => a.group))] : [];

  return (
    <article className="player-view" aria-label={p.name}>
      <header className="player-view__head">
        <span className="player-view__face">
          <Face face={playerFace(p.slug, p.position)} scale={6} label="" />
        </span>
        <div className="player-view__who">
          <h2 className="player-view__name">{p.name}</h2>
          <p className="player-view__line">
            {[p.jersey && m.jersey(p.jersey), p.position, formatClass(p.class)].filter(Boolean).join(" · ")}
          </p>
          <div className="player-view__tags">
            {p.archetype && <span className="player-view__tag">{p.archetype}</span>}
            {pr?.dev_trait && pr.dev_trait !== "Normal" && (
              <span className="player-view__tag">{m.dev(pr.dev_trait)}</span>
            )}
            {pr?.stars ? (
              <span
                className="player-view__tag player-view__stars"
                title={m.stars(pr.stars)}
                aria-label={m.stars(pr.stars)}
              >
                {Array.from({ length: pr.stars }, (_, k) => (
                  <Star key={k} size={12} weight="fill" aria-hidden="true" />
                ))}
              </span>
            ) : null}
            {p.moved_from && (
              <span className="player-view__tag" title={m.wasTitle(p.moved_from)}>
                {m.was(p.moved_from)}
              </span>
            )}
            {p.injury && <span className="player-view__tag player-view__tag--out">{m.out}</span>}
            {p.redshirt?.on && <span className="player-view__tag">{m.rs}</span>}
          </div>
        </div>
        <div className="player-view__ovr" aria-label={m.overallLabel(p.overall)}>
          <span className="label" aria-hidden="true">
            {m.overall}
          </span>
          <b className={`player-view__ovr-value ${tier(p.overall)}`} aria-hidden="true">
            {p.overall}
          </b>
        </div>
      </header>

      <dl className="player-view__facts">
        {facts.map(([k, v, tip]) => (
          <div key={k} title={tip}>
            <dt className="label">{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>

      {error && <p className="player-view__soft">{m.loadError(error)}</p>}
      {!pr && !error && <p className="player-view__soft">{m.loading}</p>}

      {pr && (pr.traits.length > 0 || pr.ability_goal || elsewhere.length > 0) && (
        <div className="player-view__extras">
          {pr.traits.length > 0 && (
            <section className="player-view__block">
              <h3 className="label player-view__kicker">{m.traits}</h3>
              <ul className="player-view__traits">
                {pr.traits.map((t) => (
                  <li key={t.key} className={`player-view__trait player-view__trait--t${t.tier}`} title={t.about}>
                    <b>{t.name}</b>
                    <small>{t.tier_name}</small>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {pr.ability_goal && (
            <section className="player-view__block">
              <h3 className="label player-view__kicker">{m.goal}</h3>
              <p className="player-view__goal">
                <b>
                  {m.goalLine(
                    pr.ability_goal.name,
                    pr.ability_goal.tier_name,
                    pr.ability_goal.have,
                    pr.ability_goal.need,
                  )}
                </b>
                <span className="player-view__soft">{pr.ability_goal.text}</span>
              </p>
            </section>
          )}
          {elsewhere.length > 0 && (
            <section className="player-view__block">
              <h3 className="label player-view__kicker">{m.elsewhere}</h3>
              <ul className="player-view__elsewhere">
                {elsewhere.map(([g, v]) => (
                  <li key={g}>
                    <span>{GROUP_NAME[g] ?? g}</span>
                    <b className={tier(v)}>{v}</b>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      {groups.length > 0 && (
        <section className="player-view__attrs" aria-label={m.attributes}>
          {groups.map((g) => (
            <div key={g} className="player-view__group">
              <h3 className="label player-view__kicker">{g}</h3>
              {pr!.attributes
                .filter((a) => a.group === g)
                .map((a) => (
                  <div key={a.key} className="player-view__bar" title={`${a.about} ${m.ceiling(a.potential)}.`}>
                    <span className="player-view__bar-label">{a.label}</span>
                    <span className="player-view__bar-track" aria-hidden="true">
                      <i className="player-view__bar-ceiling" style={{ width: `${Math.min(100, a.potential)}%` }} />
                      <i
                        className={`player-view__bar-fill ${tier(a.value)}`}
                        style={{ width: `${Math.min(100, a.value)}%` }}
                      />
                    </span>
                    <b className={`player-view__bar-value ${tier(a.value)}`}>{a.value}</b>
                  </div>
                ))}
            </div>
          ))}
        </section>
      )}
    </article>
  );
}
