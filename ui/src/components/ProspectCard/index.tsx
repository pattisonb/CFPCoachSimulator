import { useEffect, useState } from "react";
import { Star, X } from "@phosphor-icons/react";
import Button from "../Button/index.tsx";
import Face from "../Face/index.tsx";
import { api } from "../../api.ts";
import { playerFace } from "../../faces.ts";
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

/** *tune* How many of a transfer's numbers his one-line season shows. */
const TRANSFER_STATS = 3;

/**
 * A transfer in one line, where a recruit has his stars: what he did last season ("1,204 Rush Yds · 9 TD") when he
 * played, else the games he got into, else the school he left.
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
  if (r.line?.games) return m.games(r.line.games);
  return r.from_name ? m.from(r.from_name) : "";
}

/** A prospect's stars as pixel stars (the font has none). */
export function Stars({ n, size = 12 }: { n: number; size?: number }) {
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

  return (
    <aside className="prospect-card" aria-label={name}>
      <button type="button" className="prospect-card__close" aria-label={m.close} title={m.close} onClick={onClose}>
        <X size={18} weight="bold" aria-hidden="true" />
      </button>

      <header className="prospect-card__head">
        <span className="prospect-card__face">
          <Face face={playerFace(pid, pos)} scale={3} label="" />
        </span>
        <div className="prospect-card__who">
          <h2 className="prospect-card__name">{name}</h2>
          {r && <Stars n={r.stars} />}
          <span className="prospect-card__soft">
            {[pos, r?.height_display, r?.weight_display].filter(Boolean).join(" · ")}
          </span>
        </div>
      </header>

      {p && (
        <p className="prospect-card__ranks">
          {m.ranks(p.national_rank, p.position_rank, p.state_rank, pos, p.hometown.state)}
        </p>
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

      {p && (
        <dl className="prospect-card__facts">
          <div>
            <dt className="label">{m.status}</dt>
            <dd>{r ? statusOf(r) : "–"}</dd>
          </div>
          <div>
            <dt className="label">{m.interest}</dt>
            <dd>{r?.interest_level ?? "–"}</dd>
          </div>
          <div>
            <dt className="label">{m.hometown}</dt>
            <dd>{`${p.hometown.city}, ${p.hometown.state}`}</dd>
          </div>
          <div>
            <dt className="label">{m.highSchool}</dt>
            <dd>{p.high_school}</dd>
          </div>
          <div>
            <dt className="label">{m.archetype}</dt>
            <dd>{p.archetype}</dd>
          </div>
          <div>
            <dt className="label">{m.need}</dt>
            <dd>{m.needWord(detail?.need ?? null)}</dd>
          </div>
        </dl>
      )}

      {p && (
        <section className="prospect-card__block">
          <h3 className="label prospect-card__kicker">{m.scouting}</h3>
          {looks > 0 ? (
            <p>
              <b>{m.looks(looks)}</b>
              {r?.our_potential && (
                <span className="prospect-card__soft">
                  {" · "}
                  {m.potential}{" "}
                  {r.our_potential[0] === r.our_potential[1] ? r.our_potential[0] : r.our_potential.join("–")}
                </span>
              )}
            </p>
          ) : (
            <p className="prospect-card__soft">{m.unscouted}</p>
          )}
        </section>
      )}

      {ev && (
        <section className="prospect-card__block">
          <h3 className="label prospect-card__kicker">{m.evaluation}</h3>
          <p className="prospect-card__outlook">{ev.outlook}</p>
          {ev.strengths.length > 0 && (
            <ul className="prospect-card__list">
              {ev.strengths.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          )}
          {ev.weaknesses.length > 0 && (
            <>
              <h4 className="label prospect-card__kicker">{m.weaknesses}</h4>
              <ul className="prospect-card__list">
                {ev.weaknesses.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      {p && (
        <section className="prospect-card__block">
          <h3 className="label prospect-card__kicker">{m.recruiting}</h3>
          {p.schools.length ? (
            <ol className="prospect-card__schools">
              {p.schools.map((s) => (
                <li key={s.school}>
                  <span>{s.name}</span>
                  {s.offered && <span className="prospect-card__tag">{m.offered}</span>}
                </li>
              ))}
            </ol>
          ) : (
            <p className="prospect-card__soft">{m.nobody}</p>
          )}
        </section>
      )}
    </aside>
  );
}
