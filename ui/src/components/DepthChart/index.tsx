import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import Face from "../Face/index.tsx";
import { ArrowLeft } from "@phosphor-icons/react";
import Chip from "../Chip/index.tsx";
import Dropdown from "../Dropdown/index.tsx";
import Swatch from "../Swatch/index.tsx";
import FolderTabs from "../FolderTabs/index.tsx";
import Modal from "../Modal/index.tsx";
import PlayerView from "../PlayerView/index.tsx";
import { api } from "../../api.ts";
import { cachedTeams } from "../../teams.ts";
import { contrast, inkOn } from "../../colors.ts";
import { lookOf, titleCase } from "../../faces.ts";
import { navigate } from "../../router.ts";
import { formatClass } from "../../format.ts";
import type { DepthCard, DepthChart as Chart, DepthRow, PlayerProfile, TeamCard } from "../../types.ts";
import Actions from "./Actions.tsx";
import Formation, { PromiseMark } from "./Formation.tsx";
import type { Kick } from "./formation.ts";
import { messages as m } from "./messages.ts";
import "./index.css";

type UnitKey = "offense" | "defense" | "special";
/** The panel: the roles as lists beside the player's card, or the unit lined up on a field. */
type View = "formation" | "list";
const VIEWS: View[] = ["formation", "list"];
/** The chart's units come in this order (sim_js/season.js DEPTH_ROWS). */
const UNITS: UnitKey[] = ["offense", "defense", "special"];
/** The most players the chart sends for a role (sim_js/season.js depth_chart_view). */
const SHOWN = 6;

/** *tune* A team color this close to black (its contrast with black) counts as near-black for the cards. */
const DARK_CARD = 1.9;
/** *tune* How much white the light behind a card's face mixes into the team color: on a near-black color, and on any other. */
const SPOT_DARK = "46%";
const SPOT = "14%";

interface Props {
  seasonId: string;
  /** the team whose chart this is: yours, or another FBS team's to look at */
  team: string;
  /** your team: only its chart can be changed */
  mine: string;
  /** every team by slug, for the picker; with onTeam, the bar offers any FBS team's chart */
  teams?: Map<string, TeamCard>;
  /** pick a team's chart; null goes back to yours */
  onTeam?: (slug: string | null) => void;
  weekLabels: Record<string, string>;
  /** the team's colors, for the lineup's cards */
  colors?: { primary: string; secondary: string };
}

type Load = { kind: "loading" } | { kind: "error"; msg: string } | { kind: "ready"; chart: Chart };
type Profile = { kind: "ready"; profile: PlayerProfile } | { kind: "error"; msg: string };

/** A pick: the role and the player (a returner can sit on two rows). */
const keyOf = (role: string, slug: string) => `${role}|${slug}`;

/**
 * The Depth Chart section: Offense, Defense and Special Teams as tabs; each lists its roles in formation order, the
 * players in depth order with the starters marked, and the picked player's whole card beside the list. The Lineup
 * view (the first one) shows each starter as a card with his backups under him; the Formation view lines the starters
 * up on a field. Special Teams shows the field goal or the punt unit in both.
 */
export default function DepthChart({ seasonId, team, mine, teams, onTeam, weekLabels, colors }: Props) {
  const yours = team === mine;
  // the team itself, for a player's card (its colors and its name)
  const teamCard = teams?.get(team);
  // every FBS team, yours first, for the picker in the bar
  const teamOptions = useMemo(() => {
    const all = teams ? [...teams.values()].filter((t) => !t.fictional && t.subdivision === "FBS") : [];
    const me = all.find((t) => t.slug === mine);
    return [
      ...(me ? [{ value: me.slug, label: me.name, hint: m.yourTeam }] : []),
      ...all
        .filter((t) => t.slug !== mine)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((t) => ({ value: t.slug, label: t.name, hint: t.conference })),
    ];
  }, [teams, mine]);
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [unit, setUnit] = useState<UnitKey>("offense");
  const [view, setView] = useState<View>("formation");
  const [kick, setKick] = useState<Kick>("fg");
  /** the picked player's full card, over the formation */
  const [card, setCard] = useState(false);
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

  // every role on the chart (the kicking units draw on the offense and defense), and the unit each is in
  const allRows = useMemo(() => {
    const out = new Map<string, DepthRow & { unit: UnitKey }>();
    if (load.kind === "ready")
      load.chart.units.forEach((u, i) => u.rows.forEach((r) => out.set(r.role, { ...r, unit: UNITS[i] })));
    return out;
  }, [load]);

  // the picked player, else the unit's first starter
  const picked = useMemo(() => {
    for (const r of [...rows, ...allRows.values()])
      for (const p of r.players) if (keyOf(r.role, p.slug) === pick) return { row: r, p };
    // a move to another role lands him past the six a role shows: keep him picked by name
    const s = pick?.split("|")[1];
    if (s) for (const r of allRows.values()) for (const p of r.players) if (p.slug === s) return { row: r, p };
    const r = rows[0];
    return r?.players[0] ? { row: r, p: r.players[0] } : null;
  }, [rows, allRows, pick]);

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

  const choose = (role: string, s: string) => setPick(keyOf(role, s));

  // ---------- edits: each is saved to the game, and the chart it sends back is shown ----------
  const [busy, setBusy] = useState(false);
  const chartUrl = `/api/season/${seasonId}/depth/${team}`;
  /** one change: run it, then show the chart (the one it returned, or a fresh one); say why if the game refuses */
  const edit = (run: () => Promise<Chart | unknown>, fresh = false) => {
    setBusy(true);
    setSaveError(null);
    run()
      .then((v) => (fresh ? api<Chart>(chartUrl) : (v as Chart)))
      .then((chart) => setLoad({ kind: "ready", chart }))
      .catch((e: Error) => setSaveError(e.message))
      .finally(() => setBusy(false));
  };
  const post = (body: object) => api<Chart>(chartUrl, { method: "POST", body });
  const move = (role: string, player: string, to: "up" | "down" | "top") =>
    edit(() => post({ role, player, move: to }));
  /** play him at another role of his position: he goes to the end of it, and the pick follows him there */
  const toRole = (role: string, player: string) => {
    edit(() => post({ role, player, move: "down" }));
    setPick(keyOf(role, player));
  };
  const redshirt = (player: string, on: boolean) =>
    edit(() => api(`/api/season/${seasonId}/redshirt`, { method: "POST", body: { team, player, on } }), true);
  /** a new position: his card and his ratings change with it, so his profile is asked for again */
  const toPosition = (player: string, pos: string) => {
    edit(() => api(`/api/season/${seasonId}/position`, { method: "POST", body: { team, player, pos } }), true);
    asked.current.delete(player);
    setProfiles((prev) => {
      const next = new Map(prev);
      next.delete(player);
      return next;
    });
    setPick(null);
    setCard(false);
  };
  const reset = () => edit(() => post({ reset: true }));

  // two players at one role trade places: shown at once, saved to the game, put back if the game refuses
  const [saveError, setSaveError] = useState<string | null>(null);
  const swap = (role: string, a: string, b: string) => {
    if (load.kind !== "ready") return;
    const before = load.chart;
    const order = (allRows.get(role)?.players ?? []).map((p) => p.slug);
    const i = order.indexOf(a);
    const j = order.indexOf(b);
    if (i < 0 || j < 0) return;
    [order[i], order[j]] = [order[j], order[i]];
    setSaveError(null);
    setLoad({
      kind: "ready",
      chart: {
        ...before,
        units: before.units.map((u) => ({
          ...u,
          rows: u.rows.map((r) =>
            r.role === role ? { ...r, players: order.flatMap((s) => r.players.find((p) => p.slug === s) ?? []) } : r,
          ),
        })),
      },
    });
    // the chart shows a role's first six; the game wants the whole role, so anyone deeper keeps his place behind them
    const whole =
      order.length < SHOWN
        ? Promise.resolve(order)
        : api<{ players: { slug: string; role: string | null; depth: number | null }[] }>(
            `/api/season/${seasonId}/depth/${team}/roster`,
          ).then((v) => [
            ...order,
            ...v.players
              .filter((p) => p.role === role && !order.includes(p.slug))
              .sort((p, q) => (p.depth ?? 99) - (q.depth ?? 99))
              .map((p) => p.slug),
          ]);
    whole
      .then((all) =>
        api<Chart>(`/api/season/${seasonId}/depth/${team}`, { method: "POST", body: { role, order: all } }),
      )
      .then((chart) => setLoad({ kind: "ready", chart }))
      .catch((e: Error) => {
        setLoad({ kind: "ready", chart: before });
        setSaveError(e.message);
      });
  };

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
  // what the picked player can do: his moves, the other roles of his position, his redshirt and his position
  // another team's chart is to look at: no moves, no redshirts, no reset
  const actions = yours && picked && (
    <Actions
      seasonId={seasonId}
      team={team}
      row={picked.row}
      p={picked.p}
      roles={[...allRows.values()]
        .filter(
          (r) =>
            r.role !== picked.row.role &&
            !["KR", "PR"].includes(r.role) &&
            !["KR", "PR"].includes(picked.row.role) &&
            r.players[0]?.position === picked.p.position,
        )
        .map((r) => ({ role: r.role, label: titleCase(r.label) }))}
      busy={busy}
      onMove={(to) => move(picked.row.role, picked.p.slug, to)}
      onRole={(role) => toRole(role, picked.p.slug)}
      onRedshirt={(on) => redshirt(picked.p.slug, on)}
      onPosition={(pos) => toPosition(picked.p.slug, pos)}
    />
  );
  return (
    <FolderTabs
      label={m.units}
      tabs={UNITS.map((key) => ({ key, label: m[key] }))}
      value={unit}
      onChange={(k) => {
        setUnit(k);
        setPick(null);
      }}
      panelClassName={view === "list" ? "depth" : "depth depth--formation"}
      aside={
        <div className="depth__views" role="group" aria-label={m.viewLabel}>
          {onTeam && teamOptions.length > 1 && (
            <span className="depth__whose">
              {!yours && (
                <button type="button" className="depth__back" onClick={() => onTeam(null)}>
                  <ArrowLeft size={16} weight="bold" aria-hidden="true" />
                  {m.backToYours}
                </button>
              )}
              <Swatch team={teams?.get(team)} size={32} />
              <Dropdown
                label={m.teamLabel}
                hideLabel
                size="md"
                value={team}
                options={teamOptions}
                onChange={(slug) => onTeam(slug === mine ? null : slug)}
              />
            </span>
          )}
          {load.chart.ratings && (
            <dl className="depth__team" aria-label={m.teamRatings}>
              {(["overall", "offense", "defense"] as const).map((k) => (
                <div key={k} title={m.teamTips[k]}>
                  <dt className="label">{m.teamShort[k]}</dt>
                  <dd>{load.chart.ratings![k]}</dd>
                </div>
              ))}
            </dl>
          )}
          {yours && load.chart.overridden && (
            <button type="button" className="depth__reset" disabled={busy} title={m.resetTip} onClick={reset}>
              {m.reset}
            </button>
          )}
          <span className="depth__chips">
            {VIEWS.map((v) => (
              <Chip key={v} on={view === v} onClick={() => setView(v)}>
                {m.views[v]}
              </Chip>
            ))}
          </span>
        </div>
      }
    >
      {view !== "list" ? (
        <>
          <div
            className="formation"
            style={
              {
                "--c": colors?.primary ?? "var(--ink)",
                "--c2": colors?.secondary ?? "var(--ink-soft)",
                "--on": colors ? inkOn(colors.primary) : "var(--paper-hi)",
                // the light behind each face: strong on a near-black color (dark hair and skin were lost on it)
                "--spot": colors && contrast(colors.primary, "#000000") < DARK_CARD ? SPOT_DARK : SPOT,
              } as CSSProperties
            }
          >
            {unit === "special" && (
              <div className="formation__kicks" role="group" aria-label={m.kickLabel}>
                <Chip on={kick === "fg"} onClick={() => setKick("fg")}>
                  {m.fieldGoal}
                </Chip>
                <Chip on={kick === "punt"} onClick={() => setKick("punt")}>
                  {m.punt}
                </Chip>
              </div>
            )}
            {saveError && (
              <p className="formation__error" role="alert">
                {m.saveError(saveError)}
              </p>
            )}
            <Formation
              unit={unit}
              rows={allRows}
              kick={kick}
              school={cachedTeams()?.find((t) => t.slug === team)}
              onSwap={yours ? swap : undefined}
              onOpen={(role, slug) => {
                choose(role, slug);
                setCard(true);
              }}
            />
          </div>
          <Modal
            open={card && !!picked}
            onClose={() => setCard(false)}
            title={picked?.p.name ?? ""}
            head={<span />}
            footer={actions || undefined}
            tall
          >
            {picked && (
              <PlayerView
                key={picked.p.slug}
                card={picked.p}
                profile={profile?.kind === "ready" ? profile.profile : null}
                error={profile?.kind === "error" ? profile.msg : null}
                weekLabels={weekLabels}
                team={teamCard}
                onEditLook={() => navigate("playerEdit", { season: seasonId, team, player: picked.p.slug })}
              />
            )}
          </Modal>
        </>
      ) : (
        <>
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
            {saveError && (
              <p className="formation__error" role="alert">
                {m.saveError(saveError)}
              </p>
            )}
            {actions}
            {picked ? (
              <PlayerView
                key={picked.p.slug}
                card={picked.p}
                profile={profile?.kind === "ready" ? profile.profile : null}
                error={profile?.kind === "error" ? profile.msg : null}
                weekLabels={weekLabels}
                team={teamCard}
                onEditLook={() => navigate("playerEdit", { season: seasonId, team, player: picked.p.slug })}
              />
            ) : (
              <p className="depth__state">{m.pickHint}</p>
            )}
          </div>
        </>
      )}
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
        <Face face={lookOf(p.face, p.slug, p.position)} scale={1} label="" />
      </span>
      <span className="depth__who">
        <span className="depth__name">{p.name}</span>
        <span className="depth__meta">
          {[p.jersey && `#${p.jersey}`, p.position, formatClass(p.class)].filter(Boolean).join(" · ")}
        </span>
      </span>
      {p.promise && <PromiseMark status={p.promise} />}
      {p.injury && <span className="depth__flag depth__flag--out">{m.out}</span>}
      {p.redshirt?.on && <span className="depth__flag">{m.rs}</span>}
      <span className="depth__ovr" title={m.overall(p.overall)}>
        {p.overall}
      </span>
    </button>
  );
}
