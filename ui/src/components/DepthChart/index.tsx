import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import Face from "../Face/index.tsx";
import FolderTabs from "../FolderTabs/index.tsx";
import PlayerView from "../PlayerView/index.tsx";
import { api } from "../../api.ts";
import { playerFace, titleCase } from "../../faces.ts";
import { formatClass } from "../../format.ts";
import type { DepthCard, DepthChart as Chart, DepthRow, PlayerProfile } from "../../types.ts";
import { messages as m } from "./messages.ts";
import "./index.css";

type UnitKey = "offense" | "defense" | "special";
/** The chart's units come in this order (sim/season.py DEPTH_ROWS). */
const UNITS: UnitKey[] = ["offense", "defense", "special"];

interface Props {
  seasonId: string;
  /** the team's slug (yours) */
  team: string;
  weekLabels: Record<string, string>;
}

type Load = { kind: "loading" } | { kind: "error"; msg: string } | { kind: "ready"; chart: Chart };
type Profile = { kind: "ready"; profile: PlayerProfile } | { kind: "error"; msg: string };

/** A pick: the role and the player (a returner can sit on two rows). */
const keyOf = (role: string, slug: string) => `${role}|${slug}`;

/**
 * The Depth Chart section: Offense, Defense and Special Teams as tabs; each lists its roles in formation order, the
 * players in depth order with the starters marked, and the picked player's whole card beside the list.
 */
export default function DepthChart({ seasonId, team, weekLabels }: Props) {
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [unit, setUnit] = useState<UnitKey>("offense");
  const [pick, setPick] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<Map<string, Profile>>(() => new Map());
  const asked = useRef(new Set<string>());
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    setLoad({ kind: "loading" });
    api<Chart>(`/api/season/${seasonId}/depth/${team}`)
      .then((chart) => live && setLoad({ kind: "ready", chart }))
      .catch((e: Error) => live && setLoad({ kind: "error", msg: e.message }));
    return () => {
      live = false;
    };
  }, [seasonId, team]);

  const rows: DepthRow[] = useMemo(
    () => (load.kind === "ready" ? (load.chart.units[UNITS.indexOf(unit)]?.rows ?? []) : []),
    [load, unit],
  );

  // the picked player, else the unit's first starter
  const picked = useMemo(() => {
    for (const r of rows) for (const p of r.players) if (keyOf(r.role, p.slug) === pick) return { row: r, p };
    const r = rows[0];
    return r?.players[0] ? { row: r, p: r.players[0] } : null;
  }, [rows, pick]);

  // his profile, once per player
  const slug = picked?.p.slug;
  useEffect(() => {
    if (!slug || asked.current.has(slug)) return;
    asked.current.add(slug);
    const store = (v: Profile) => setProfiles((prev) => new Map(prev).set(slug, v));
    api<PlayerProfile>(
      `/api/season/${seasonId}/player?team=${encodeURIComponent(team)}&slug=${encodeURIComponent(slug)}`,
    )
      .then((profile) => store({ kind: "ready", profile }))
      .catch((e: Error) => {
        asked.current.delete(slug); // the next pick tries again
        store({ kind: "error", msg: e.message });
      });
  }, [slug, seasonId, team]);

  // ↑ ↓ walk the list
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const all = [...(list.current?.querySelectorAll<HTMLButtonElement>(".depth__player") ?? [])];
    const i = all.indexOf(document.activeElement as HTMLButtonElement);
    const next = all[i + (e.key === "ArrowDown" ? 1 : -1)];
    if (!next) return;
    e.preventDefault();
    next.focus();
    next.click();
  };

  if (load.kind !== "ready") {
    return (
      <div className="depth__state" role="status">
        {load.kind === "loading" ? m.loading : m.loadError(load.msg)}
      </div>
    );
  }

  const profile = slug ? profiles.get(slug) : undefined;
  return (
    <FolderTabs
      label={m.units}
      tabs={UNITS.map((key) => ({ key, label: m[key] }))}
      value={unit}
      onChange={(k) => {
        setUnit(k);
        setPick(null);
      }}
      panelClassName="depth"
    >
      <div className="depth__list" ref={list} onKeyDown={onKey}>
        {rows.map((r) => (
          <section key={r.role} className="depth__role" aria-labelledby={`depth-${r.role}`}>
            <h3 className="depth__role-head" id={`depth-${r.role}`}>
              <b>{r.role}</b>
              <span>{titleCase(r.label)}</span>
              <span className="depth__role-count">{m.starters(r.starters)}</span>
            </h3>
            <ol className="depth__players">
              {r.players.map((p, i) => (
                <li key={p.slug}>
                  <PlayerRow
                    p={p}
                    spot={i + 1}
                    starter={i < r.starters}
                    lastStarter={i === r.starters - 1 && i < r.players.length - 1}
                    on={picked?.row.role === r.role && picked.p.slug === p.slug}
                    onPick={() => setPick(keyOf(r.role, p.slug))}
                  />
                </li>
              ))}
            </ol>
          </section>
        ))}
      </div>
      <div className="depth__view" aria-live="polite">
        {picked ? (
          <PlayerView
            key={picked.p.slug}
            card={picked.p}
            profile={profile?.kind === "ready" ? profile.profile : null}
            error={profile?.kind === "error" ? profile.msg : null}
            weekLabels={weekLabels}
          />
        ) : (
          <p className="depth__state">{m.pickHint}</p>
        )}
      </div>
    </FolderTabs>
  );
}

interface RowProps {
  p: DepthCard;
  spot: number;
  starter: boolean;
  /** a rule under the last starter, between them and the backups */
  lastStarter: boolean;
  on: boolean;
  onPick: () => void;
}

/** One player on a role: spot, face, name, position and class, flags, overall. */
function PlayerRow({ p, spot, starter, lastStarter, on, onPick }: RowProps) {
  return (
    <button
      type="button"
      className={["depth__player", starter && "is-starter", lastStarter && "is-last-starter"].filter(Boolean).join(" ")}
      aria-pressed={on}
      aria-label={m.rowLabel(spot, p.name, p.overall)}
      onClick={onPick}
    >
      <span className="depth__spot">{spot}</span>
      <span className="depth__face">
        <Face face={playerFace(p.slug, p.position)} scale={1} label="" />
      </span>
      <span className="depth__who">
        <span className="depth__name">{p.name}</span>
        <span className="depth__meta">
          {[p.jersey && `#${p.jersey}`, p.position, formatClass(p.class)].filter(Boolean).join(" · ")}
        </span>
      </span>
      {p.injury && <span className="depth__flag depth__flag--out">{m.out}</span>}
      {p.redshirt?.on && <span className="depth__flag">{m.rs}</span>}
      <span className="depth__ovr" title={m.overall(p.overall)}>
        {p.overall}
      </span>
    </button>
  );
}
