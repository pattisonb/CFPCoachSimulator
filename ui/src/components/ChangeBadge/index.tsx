import { BellRinging } from "@phosphor-icons/react";
import Tooltip from "../Tooltip/index.tsx";
import { standingOf } from "../../standing.ts";
import type { BoardRow } from "../../types.ts";
import { messages as m } from "./messages.ts";
import "./index.css";

/** What the badge watches on a recruit: kept from the last time you opened his card, compared with how he is now. */
export interface Seen {
  /** your chance as the head reads it ("Close Race", "A Flip Is a Long Shot") */
  chance: string;
  /** your place on his list, or null off it */
  place: number | null;
  /** the school he is committed to or signed with (its slug and its name), or null */
  school: string | null;
  schoolName: string | null;
  /** how firmly he is held there: a verbal commit, a hard commit, signed */
  hold?: "verbal" | "hard" | "signed" | null;
  /** the other schools that have offered him, by name */
  offers: string[];
  /** the schools answering your recruiting of him, by name */
  rivals: string[];
}

/** A recruit as the badge sees him now. */
export function seenOf(r: BoardRow, team: string): Seen {
  const sd = standingOf(r, team);
  const race = r.list.filter((x) => x.bar != null);
  const mine = race.find((x) => x.you || x.school === team);
  const school = r.signed || r.committed || null;
  return {
    chance: sd.odds ?? sd.word,
    place: mine && !r.signed ? (mine.rank ?? race.indexOf(mine) + 1) : null,
    school,
    schoolName: school ? (school === team ? null : (r.school_name ?? null)) : null,
    hold: !school ? null : r.signed ? "signed" : r.hard ? "hard" : "verbal",
    offers: r.list
      .filter((x) => x.offered && !x.you && x.school !== team)
      .map((x) => x.name)
      .sort(),
    rivals: (r.rival_push ?? []).map((x) => x.name).sort(),
  };
}

/** What changed between the last look and now, each a sentence; none when nothing did. */
export function changesOf(was: Seen | undefined, now: Seen, team: string): string[] {
  if (!was) return [];
  const out: string[] = [];
  const name = (x: Seen) => (x.school === team ? m.you : (x.schoolName ?? ""));
  const moved = was.school !== now.school;
  if (moved && was.school) out.push(m.decommitted(name(was)));
  // where he stands with a school now: said when he went there, or when a commitment hardened or was signed
  if (now.school && (moved || (was.hold ?? null) !== (now.hold ?? null)))
    out.push((now.hold === "signed" ? m.signed : now.hold === "hard" ? m.hard : m.committed)(name(now)));
  // (Lost and Yours are that commitment over again: it has been said)
  if (was.chance !== now.chance && now.chance !== "Lost" && now.chance !== "Yours")
    out.push(m.chance(now.chance, was.chance));
  // (a signed recruit has no list any more: nothing to say about it)
  if (was.place !== now.place && now.hold !== "signed")
    out.push(now.place == null ? m.offList : was.place == null ? m.onList(now.place) : m.place(now.place, was.place));
  for (const s of now.offers) if (!was.offers.includes(s)) out.push(m.offered(s));
  for (const s of was.offers) if (!now.offers.includes(s) && s !== now.schoolName) out.push(m.pulled(s));
  for (const s of now.rivals) if (!was.rivals.includes(s)) out.push(m.pushing(s));
  return out;
}

/**
 * A small bell on a recruit's row when something about him changed since you last opened his card (his chance, your
 * place on his list, a commitment, another school's offer, a rival pushing back); the changes are its tooltip.
 * Nothing when nothing changed.
 */
export default function ChangeBadge({ changes }: { changes: string[] }) {
  if (!changes.length) return null;
  return (
    <Tooltip title={m.title} text={changes.join(" ")}>
      <span className="change-badge" role="img" aria-label={m.label(changes.length)}>
        <BellRinging size={11} weight="fill" aria-hidden="true" />
      </span>
    </Tooltip>
  );
}
