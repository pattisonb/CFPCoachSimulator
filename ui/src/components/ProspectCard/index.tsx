import { GradeRange } from "../Grade/index.tsx";
import { useEffect, useState } from "react";
import { EnvelopeSimple, Star, X } from "@phosphor-icons/react";
import Button from "../Button/index.tsx";
import Chip from "../Chip/index.tsx";
import Face from "../Face/index.tsx";
import Meter from "../Meter/index.tsx";
import Swatch from "../Swatch/index.tsx";
import { api } from "../../api.ts";
import { playerFace } from "../../faces.ts";
import { cachedTeams } from "../../teams.ts";
import type { ProspectDetail, ProspectRow } from "../../types.ts";
import { messages as m } from "./messages.ts";
import "./index.css";

interface Props {
  seasonId: string;
  pid: string;
  /** what the list already knows (status words, board, scouting), shown at once */
  row: ProspectRow | undefined;
  onClose: () => void;
  /** add or remove him; his file reloads after */
  onBoard: (row: ProspectRow, on: boolean) => Promise<void>;
}

/** "Open", "Committed: Texas", "Signed: SMU", "Leaning FCS", "Going Pro" */
export function statusOf(r: ProspectRow): string {
  if (r.pro) return m.goingPro;
  if (r.signed && r.school_name) return m.signedWith(r.school_name);
  if (r.committed && r.school_name) return r.hard ? m.hardCommit(r.school_name) : m.committedTo(r.school_name);
  if (r.leaning_fcs) return m.leaningFcs;
  // uncommitted: where you stand with him, when you stand anywhere
  return m.openAt[r.stage ?? ""] ?? m.open;
}

/** *tune* How many of the schools after him the card names (the rest are counted). */
const SCHOOLS = 5;

/** *tune* How many of a transfer's numbers his one-line season shows. */
const TRANSFER_STATS = 3;

/**
 * A transfer in one line, where a recruit has his stars: what he did last season ("1,204 Rush Yds · 9 TD") when he
 * played, else the school he left.
 */
export function transferLine(r: {
  from_name?: string;
  line?: { games: number; stats: Record<string, number> } | null;
}): string {
  const stats = Object.entries(r.line?.stats ?? {}).filter(([k, v]) => v && m.stat[k]);
  if (stats.length)
    return stats
      .slice(0, TRANSFER_STATS)
      .map(([k, v]) => `${v.toLocaleString("en-US")} ${m.stat[k]}`)
      .join(" · ");
  // no numbers worth a line (he barely played): the school he left says more than "1 Game"
  if (r.from_name) return m.from(r.from_name);
  return r.line?.games ? m.games(r.line.games) : "";
}

/** A prospect's stars as pixel stars (the font has none); nothing for a player with none (a transfer). */
export function Stars({ n, size = 12 }: { n: number; size?: number }) {
  if (!n) return null; // a transfer has no stars: five empty ones say nothing
  return (
    <span className="prospect-stars" aria-label={`${n}-star`}>
      {Array.from({ length: 5 }, (_, k) => (
        <Star
          key={k}
          size={size}
          weight={k < n ? "fill" : "regular"}
          className={k < n ? undefined : "prospect-stars__empty"}
          aria-hidden="true"
        />
      ))}
    </span>
  );
}

/**
 * One prospect's file, beside the list: his face (pocket-faces from his id, the face he keeps when he signs), who he
 * is and where he ranks, who's recruiting him, your scouting so far and the scouting service's read, and the board
 * toggle. Shared by Prospects now; Scouting and Recruiting add their own tabs later.
 */
export default function ProspectCard({ seasonId, pid, row, onClose, onBoard }: Props) {
  const [detail, setDetail] = useState<ProspectDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  /** which of the scouting service's lists is up */
  const [side, setSide] = useState<"strengths" | "weaknesses">("strengths");
  const [point, setPoint] = useState(0);

  useEffect(() => {
    let live = true;
    setError(null);
    api<ProspectDetail>(`/api/season/${seasonId}/prospect/${encodeURIComponent(pid)}`)
      .then((d) => live && setDetail(d))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [seasonId, pid, version]);

  // Escape closes him
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  const p = detail?.public;
  const r = row ?? detail?.row;
  const name = p?.name ?? r?.name ?? "";
  const pos = p?.display_pos ?? r?.display_pos ?? "";
  const looks = r?.looks ?? detail?.looks ?? 0;
  const ev = detail?.evaluation;
  const points = (side === "strengths" ? ev?.strengths : ev?.weaknesses) ?? [];
  const at = Math.min(point, Math.max(0, points.length - 1));

  const schoolOf = (slug: string) => cachedTeams()?.find((t) => t.slug === slug);

  return (
    <aside className="prospect-card" aria-label={name}>
      <button type="button" className="prospect-card__close" aria-label={m.close} title={m.close} onClick={onClose}>
        <X size={18} weight="bold" aria-hidden="true" />
      </button>

      {/* who he is: his picture, his name and stars, his position and size */}
      <header className="prospect-card__head">
        <span className="prospect-card__face">
          <Face face={playerFace(pid, pos)} scale={2} label="" />
        </span>
        <div className="prospect-card__who">
          <h2 className="prospect-card__name">{name}</h2>
          {r && <Stars n={r.stars} />}
          <span className="prospect-card__soft">
            {[pos, r?.height_display, r?.weight_display].filter(Boolean).join(" · ")}
          </span>
          {p?.archetype && <b className="prospect-card__type">{p.archetype}</b>}
        </div>
      </header>

      {/* where he ranks: in the country, at his position, in his state */}
      {p && (
        <dl className="prospect-card__tiles prospect-card__tiles--3 prospect-card__tiles--line">
          <div>
            <dt className="label">{m.rankNat}</dt>
            <dd>#{p.national_rank}</dd>
          </div>
          <div>
            <dt className="label">{pos}</dt>
            <dd>#{p.position_rank}</dd>
          </div>
          <div>
            <dt className="label">{p.hometown.state}</dt>
            <dd>#{p.state_rank}</dd>
          </div>
        </dl>
      )}

      {r && (
        <Button
          variant={r.on_board ? "outline" : "solid"}
          className="prospect-card__board"
          onClick={() => onBoard(r, !r.on_board).then(() => setVersion((v) => v + 1))}
        >
          <Star size={18} weight={r.on_board ? "fill" : "bold"} aria-hidden="true" />
          {r.on_board ? m.removeBoard : m.addBoard}
        </Button>
      )}

      {error && <p className="prospect-card__soft">{m.loadError(error)}</p>}
      {!detail && !error && <p className="prospect-card__soft">{m.loading}</p>}

      {/* the facts, a tile each: his status, your pull and your need on one row, where he is from on the next, then
          your scouting */}
      {p && (
        <dl className="prospect-card__tiles prospect-card__tiles--3">
          <div>
            <dt className="label">{m.status}</dt>
            <dd>{r ? statusOf(r) : "–"}</dd>
          </div>
          <div title={m.interest}>
            <dt className="label">{m.interestShort}</dt>
            <dd>{r?.interest_level ?? "–"}</dd>
          </div>
          <div title={m.need}>
            <dt className="label">{m.needShort}</dt>
            <dd>{m.needWord(detail?.need ?? null)}</dd>
          </div>
          <div className="prospect-card__wide">
            <dt className="label">{m.from_}</dt>
            <dd>{[`${p.hometown.city}, ${p.hometown.state}`, p.high_school].filter(Boolean).join(" · ")}</dd>
          </div>
          <div className="prospect-card__half" title={looks ? undefined : m.unscoutedTip}>
            <dt className="label">{m.scouted}</dt>
            <dd>{looks ? m.looksShort(looks) : m.unscouted}</dd>
            <Meter value={looks / 3} label={m.scouted} />
          </div>
          <div className="prospect-card__half">
            <dt className="label">{m.potential}</dt>
            <dd>
              {r?.our_potential && looks > 0 ? (
                <GradeRange read={r.our_potential} size="sm" />
              ) : (
                <span className="prospect-card__soft">{m.unknown}</span>
              )}
            </dd>
          </div>
        </dl>
      )}

      {/* the scouting service: its read, then what he does well beside what he must work on */}
      {ev && (
        <section className="prospect-card__block">
          <h3 className="label prospect-card__kicker">{m.evaluation}</h3>
          <p className="prospect-card__outlook">{ev.outlook}</p>
          {/* one list at a time, the card's full width, so each point reads as a sentence: a switch picks which */}
          {(ev.strengths.length > 0 || ev.weaknesses.length > 0) && (
            <>
              <div className="prospect-card__switch" role="tablist">
                {(
                  [
                    ["strengths", m.strengths, ev.strengths.length],
                    ["weaknesses", m.weaknesses, ev.weaknesses.length],
                  ] as const
                ).map(([key, title, n]) => (
                  <Chip
                    key={key}
                    on={side === key}
                    count={n}
                    onClick={() => {
                      setSide(key);
                      setPoint(0);
                    }}
                  >
                    {title}
                  </Chip>
                ))}
              </div>
              {/* its points one at a time (the player's ask), in one box: the point, and in the box's foot its
                  numbered tabs, on their own line so they never sit on the words */}
              <div className="prospect-card__point">
                {/* every point of both lists shares the one cell, only the one up showing: the box is as tall as the
                    longest, so it never changes height between them */}
                {[...(ev.strengths ?? []), ...(ev.weaknesses ?? [])].map((t) => (
                  <p key={t} className={t === points[at] ? undefined : "is-off"} aria-hidden={t !== points[at]}>
                    {t}
                  </p>
                ))}
                {points.length > 1 && (
                  <div className="prospect-card__pips" role="tablist" aria-label={m[side]}>
                    {points.map((t, i) => (
                      <button
                        key={t}
                        type="button"
                        role="tab"
                        aria-selected={i === at}
                        className={`prospect-card__pip${i === at ? " is-on" : ""}`}
                        onClick={() => setPoint(i)}
                      >
                        {i + 1}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </section>
      )}

      {/* who is after him: each school in its colors, in order */}
      {p && (
        <section className="prospect-card__block">
          <h3 className="label prospect-card__kicker">{m.recruiting}</h3>
          {p.schools.length ? (
            <ol className="prospect-card__schools">
              {p.schools.slice(0, SCHOOLS).map((s, i) => (
                <li key={s.school}>
                  <span className="prospect-card__place">{i + 1}</span>
                  <Swatch team={schoolOf(s.school)} size={16} />
                  <b title={s.name}>{schoolOf(s.school)?.abbreviation ?? s.name}</b>
                  {s.offered && (
                    <span className="prospect-card__offered" role="img" aria-label={m.offered} title={m.offered}>
                      <EnvelopeSimple size={14} weight="fill" aria-hidden="true" />
                    </span>
                  )}
                </li>
              ))}
              {/* the rest, counted: their names are the tile's tip */}
              {p.schools.length > SCHOOLS && (
                <li
                  className="prospect-card__more"
                  title={p.schools
                    .slice(SCHOOLS)
                    .map((x) => x.name)
                    .join(", ")}
                >
                  {m.more(p.schools.length - SCHOOLS)}
                </li>
              )}
            </ol>
          ) : (
            <p className="prospect-card__soft">{m.nobody}</p>
          )}
        </section>
      )}
    </aside>
  );
}
