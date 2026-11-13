import { useEffect, useMemo, useState, type ReactNode } from "react";
import { CheckCircle, DownloadSimple, Plus, Trash, X } from "@phosphor-icons/react";
import Button from "../../components/Button/index.tsx";
import Field from "../../components/Field/index.tsx";
import EditorPage from "../../components/EditorPage/index.tsx";
import FolderTabs from "../../components/FolderTabs/index.tsx";
import ProgramPicker from "../../components/ProgramPicker/index.tsx";
import UniformPlayer from "../../components/UniformPlayer/index.tsx";
import { api } from "../../api.ts";
import { formatClass } from "../../format.ts";
import {
  CLASSES,
  MAX_RIVALS,
  NEW_CONF,
  POSITIONS,
  STATES,
  STRENGTHS,
  createProgram,
  leagueDoc,
  loadPrograms,
  parseRoster,
  problems,
  savePrograms,
  slugOf,
  type CheckResponse,
  type Program,
  type ProgramFields,
  type ProblemKey,
  type ProgramsResponse,
  type RealProgram,
  type RivalryOften,
} from "../../programs.ts";
import { replaceParams } from "../../router.ts";
import type { Theme } from "../../theme.ts";
import { messages as m } from "./messages.ts";
import "./index.css";

interface Props {
  theme: Theme;
  onToggleTheme: () => void;
  /** the program to open (?id=); none starts a new one */
  programId: string | null;
  /** the team picked on Play (?team=), so Back lands on it */
  teamSlug: string | null;
}

type Tab = keyof typeof m.tabs;
const TABS = Object.keys(m.tabs) as Tab[];
/** Which tab each problem's field is on, so the tab can be marked. */
const TAB_OF: Record<ProblemKey, Tab> = {
  name: "identity",
  abbreviation: "identity",
  conference: "program",
  new_conf_name: "program",
  prestige: "program",
  rivals: "rivals",
  roster: "roster",
};

type Check = { kind: "idle" } | { kind: "checking" } | { kind: "ok" } | { kind: "bad"; errors: string[] };

// the game's programs, kept between visits to the page
let catalog: ProgramsResponse | null = null;
const details: Record<string, RealProgram> = {};

async function detailsOf(slug: string): Promise<RealProgram> {
  if (details[slug]?.colors) return details[slug];
  details[slug] = await api<RealProgram>(`/api/league/programs/${encodeURIComponent(slug)}`);
  return details[slug];
}

/** Save a file to the viewer's computer. */
function downloadJson(data: unknown, name: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: "application/json" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

/** /program/edit: make a program of your own, or change a real one, saved in this browser as you type. */
export default function ProgramEdit({ theme, onToggleTheme, programId, teamSlug }: Props) {
  const [list, setList] = useState<Program[]>(loadPrograms);
  // a new program joins the list on its first change, so opening the page leaves no empty programs behind
  const [draft, setDraft] = useState<Program | null>(() =>
    programId && loadPrograms().some((p) => p.id === programId) ? null : createProgram(),
  );
  const [openId, setOpenId] = useState<string | null>(() => (draft ? null : programId));
  const [games, setGames] = useState<ProgramsResponse | null>(catalog);
  const [error, setError] = useState<string | null>(null);
  // ?tab= opens a tab directly
  const [tab, setTab] = useState<Tab>(() => {
    const t = new URLSearchParams(location.search).get("tab");
    return TABS.find((x) => x === t) ?? "identity";
  });
  const [check, setCheck] = useState<Check>({ kind: "idle" });
  const [kept, setKept] = useState(true);
  const [detailsVersion, setDetailsVersion] = useState(0); // bumped when a real team's details arrive

  const program = draft ?? list.find((p) => p.id === openId) ?? null;
  const f: ProgramFields = program?.f ?? {};

  useEffect(() => {
    if (catalog) return;
    api<ProgramsResponse>("/api/league/programs")
      .then((d) => {
        catalog = d;
        setGames(d);
      })
      .catch((e: Error) => setError(m.loadError(e.message)));
  }, []);

  // an edit compares against its real team: fetch that team's details
  useEffect(() => {
    if (program?.kind !== "edit" || !program.base || details[program.base]?.colors) return;
    detailsOf(program.base)
      .then(() => setDetailsVersion((n) => n + 1))
      .catch(() => {});
  }, [program?.kind, program?.base]);

  // the address names the open program
  useEffect(() => {
    if (draft) replaceParams("programEdit", teamSlug ? { team: teamSlug } : undefined);
    else if (openId) replaceParams("programEdit", { id: openId, ...(teamSlug ? { team: teamSlug } : {}) });
  }, [draft, openId, teamSlug]);

  const real = useMemo(() => {
    const out: Record<string, RealProgram> = {};
    for (const t of games?.teams ?? []) out[t.slug] = { ...t, ...details[t.slug] };
    return out;
  }, [games, detailsVersion]);

  const fbs = useMemo(() => (games?.teams ?? []).filter((t) => (t.level || "FBS") === "FBS"), [games]);
  const conferences = useMemo(() => (games?.conferences ?? []).filter((c) => (c.level || "FBS") === "FBS"), [games]);
  const confName = (id?: string) =>
    id === NEW_CONF ? f.new_conf_name || m.newConference : (conferences.find((c) => c.id === id)?.name ?? "");

  const title = (p: Program) => p.f.name || (p.kind === "edit" && p.base ? real[p.base]?.short_name : "") || m.untitled;

  const commit = (next: Program[]) => {
    setList(next);
    setKept(savePrograms(next));
  };

  /** Change the open program's fields. */
  const update = (patch: Partial<ProgramFields>) => {
    if (!program) return;
    const next: Program = { ...program, f: { ...program.f, ...patch }, updated: Date.now() };
    setCheck({ kind: "idle" });
    if (draft) {
      setDraft(null);
      setOpenId(next.id);
      commit([next, ...list]);
    } else commit(list.map((p) => (p.id === next.id ? next : p)));
  };
  const text = (key: keyof ProgramFields) => ({
    value: (f[key] as string | number | undefined) ?? "",
    onChange: (e: { target: { value: string } }) => update({ [key]: e.target.value }),
  });

  const open = (id: string) => {
    setDraft(null);
    setOpenId(id);
    setCheck({ kind: "idle" });
  };
  const startNew = () => {
    setDraft(createProgram());
    setOpenId(null);
    setTab("identity");
    setCheck({ kind: "idle" });
  };
  const startEdit = async (slug: string) => {
    const already = list.find((p) => p.kind === "edit" && p.base === slug);
    if (already) return open(already.id);
    try {
      const p = createProgram(await detailsOf(slug));
      setDetailsVersion((n) => n + 1);
      commit([p, ...list]);
      open(p.id);
      setTab("identity");
    } catch (e) {
      setError(m.loadError((e as Error).message));
    }
  };
  const remove = () => {
    if (!program) return;
    if (draft) return startNew();
    if (!confirm(m.confirmDelete(title(program)))) return;
    const next = list.filter((p) => p.id !== program.id);
    commit(next);
    if (next[0]) open(next[0].id);
    else startNew();
  };

  // a blank new program shows no problems until something is typed
  const probs = program && !draft ? problems(program) : [];
  const bad = (key: ProblemKey) => probs.some((p) => p.key === key);
  const tabBad = (t: Tab) => probs.some((p) => TAB_OF[p.key] === t);

  const runCheck = async () => {
    if (!program || draft || probs.length) return;
    setCheck({ kind: "checking" });
    try {
      const r = await api<CheckResponse>("/api/league/check", {
        method: "POST",
        body: leagueDoc([program], real, title(program)),
      });
      setCheck(r.ok ? { kind: "ok" } : { kind: "bad", errors: r.errors ?? [] });
    } catch (e) {
      setCheck({ kind: "bad", errors: [m.checkFailed((e as Error).message)] });
    }
  };
  const download = () => {
    if (!program) return;
    downloadJson(leagueDoc([program], real, title(program)), `${slugOf(title(program), new Set())}.json`);
  };

  const backParams = teamSlug ? { team: teamSlug } : undefined;
  const name = program ? title(program) : m.untitled;
  const subline = [f.mascot, confName(f.conference)].filter(Boolean).join(" · ");
  // the switcher's rows: the unsaved new program first, then the saved ones, then the real teams
  const describe = (p: Program, unsaved = false) => {
    const kind = unsaved
      ? m.unsaved
      : p.kind === "edit" && p.base
        ? m.edits(real[p.base]?.short_name ?? p.f.short_name ?? title(p))
        : m.newKind;
    const conf =
      p.f.conference === NEW_CONF ? p.f.new_conf_name : conferences.find((c) => c.id === p.f.conference)?.name;
    return {
      id: p.id,
      name: title(p),
      meta: [kind, conf].filter(Boolean).join(" · "),
      primary: p.f.primary || "#5a6275",
      secondary: p.f.secondary || "#ffffff",
    };
  };
  const pickerPrograms = [...(draft ? [describe(draft, true)] : []), ...list.map((p) => describe(p))];
  const edited = new Set(list.filter((p) => p.kind === "edit").map((p) => p.base));
  const pickerTeams = fbs.map((t) => ({
    slug: t.slug,
    name: t.short_name,
    abbreviation: t.abbreviation,
    edited: edited.has(t.slug),
  }));

  let panel: ReactNode = null;
  if (tab === "identity")
    panel = (
      <div className="program__grid">
        <Field label={m.name} invalid={bad("name")}>
          <input {...text("name")} maxLength={60} placeholder={m.namePlaceholder} autoComplete="off" />
        </Field>
        <Field label={m.shortName}>
          <input {...text("short_name")} maxLength={30} autoComplete="off" />
        </Field>
        <Field label={m.abbreviation} invalid={bad("abbreviation")}>
          <input {...text("abbreviation")} maxLength={4} autoComplete="off" />
        </Field>
        <Field label={m.mascot}>
          <input {...text("mascot")} maxLength={30} autoComplete="off" />
        </Field>
      </div>
    );
  else if (tab === "home")
    panel = (
      <div className="program__grid">
        <Field label={m.city} hint={m.homeHint}>
          <input {...text("city")} maxLength={40} autoComplete="off" />
        </Field>
        <Field label={m.state}>
          <select
            value={f.state ?? ""}
            onChange={(e) => update({ state: e.target.value, lat: undefined, lon: undefined })}
          >
            <option value="">{m.pickState}</option>
            {STATES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </Field>
      </div>
    );
  else if (tab === "program")
    panel = (
      <div className="program__grid">
        <Field label={m.conference} invalid={bad("conference")}>
          <select {...text("conference")}>
            <option value="">{m.pickConference}</option>
            {conferences.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
            <option value={NEW_CONF}>{m.newConference}</option>
          </select>
        </Field>
        <Field label={m.strength}>
          <select {...text("strength")}>
            <option value="">{m.conferenceAverage}</option>
            {STRENGTHS.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </Field>
        {f.conference === NEW_CONF && (
          <>
            <Field label={m.conferenceName} invalid={bad("new_conf_name")}>
              <input {...text("new_conf_name")} maxLength={60} autoComplete="off" />
            </Field>
            <Field label={m.conferenceGames}>
              <select value={f.new_conf_games ?? "8"} onChange={(e) => update({ new_conf_games: e.target.value })}>
                <option>8</option>
                <option>9</option>
              </select>
            </Field>
          </>
        )}
        <Field label={m.prestige} hint={m.prestigeHint} invalid={bad("prestige")}>
          <input {...text("prestige")} type="number" min={0} max={100} />
        </Field>
      </div>
    );
  else if (tab === "coaches")
    panel = (
      <div className="program__grid">
        <Field label={m.headCoach}>
          <input {...text("coach")} maxLength={40} placeholder={m.generated} autoComplete="off" />
        </Field>
        <Field label={m.oc}>
          <input {...text("oc")} maxLength={40} placeholder={m.generated} autoComplete="off" />
        </Field>
        <Field label={m.dc}>
          <input {...text("dc")} maxLength={40} placeholder={m.generated} autoComplete="off" />
        </Field>
        <span />
        <Field label={m.offense}>
          <select {...text("offense")}>
            <option value="">{m.usual}</option>
            {games?.playbooks.offense.map((x) => <option key={x}>{x}</option>)}
          </select>
        </Field>
        <Field label={m.defense}>
          <select {...text("defense")}>
            <option value="">{m.usual}</option>
            {games?.playbooks.defense.map((x) => <option key={x}>{x}</option>)}
          </select>
        </Field>
      </div>
    );
  else if (tab === "rivals")
    panel = (
      <Rivals
        fields={f}
        own={program?.kind === "edit" ? program.base : null}
        teams={fbs}
        invalid={bad("rivals")}
        onChange={update}
      />
    );
  else panel = <Roster text={f.roster ?? ""} invalid={bad("roster")} onChange={(roster) => update({ roster })} />;

  const lede =
    program?.kind === "edit" && program.base
      ? m.editing(real[program.base]?.short_name ?? program.f.short_name ?? title(program))
      : m.intro;

  return (
    <EditorPage
      theme={theme}
      onToggleTheme={onToggleTheme}
      back={{ route: "play", params: backParams, label: m.back }}
      title={m.title}
      lede={lede}
      aside={
        <ProgramPicker
          label={m.switcher}
          programs={pickerPrograms}
          teams={pickerTeams}
          value={draft ? draft.id : openId}
          onPick={(id) => (draft && id === draft.id ? undefined : open(id))}
          onNew={startNew}
          onEditReal={(slug) => void startEdit(slug)}
        />
      }
      side={
        <>
          {/* the program as it looks: the quarterback in its uniform, its name and its colors */}
          <div className="program__stage">
            <UniformPlayer
              primary={f.primary || "#5a6275"}
              secondary={f.secondary || "#ffffff"}
              team={name}
              className="program__player"
            />
          </div>
          <div className="program__who">
            <p className="program__name">{name}</p>
            <p className="program__sub">{subline || (program?.kind === "edit" ? m.edits(name) : m.newKind)}</p>
          </div>

          <div className="program__colors">
            {(["primary", "secondary", "accent"] as const).map((k) => (
              <Field key={k} label={m[k]}>
                <input type="color" value={f[k] || "#777777"} onChange={(e) => update({ [k]: e.target.value })} />
              </Field>
            ))}
          </div>

          <div className="program__status" role="status" aria-live="polite">
            {error && <p className="program__bad">{error}</p>}
            {probs.length > 0 && <p className="program__bad">{probs[0].msg}</p>}
            {check.kind === "ok" && (
              <p className="program__good">
                <CheckCircle size={18} weight="fill" aria-hidden="true" /> {m.ready}
              </p>
            )}
            {check.kind === "bad" &&
              check.errors.slice(0, 3).map((e) => (
                <p key={e} className="program__bad">
                  {e}
                </p>
              ))}
            {!error && probs.length === 0 && check.kind === "idle" && (
              <p className="program__soft">{kept ? m.autosave : m.notKept}</p>
            )}
          </div>

          <div className="program__actions">
            <Button
              className="program__check"
              onClick={runCheck}
              disabled={!program || !!draft || probs.length > 0 || check.kind === "checking"}
              title={probs.length ? m.fixFirst : undefined}
            >
              <CheckCircle size={18} weight="bold" aria-hidden="true" />
              {check.kind === "checking" ? m.checking : m.check}
            </Button>
            <Button variant="outline" onClick={download} disabled={!program}>
              <DownloadSimple size={18} weight="bold" aria-hidden="true" />
              {m.download}
            </Button>
            <Button variant="outline" onClick={remove} disabled={!program}>
              <Trash size={18} weight="bold" aria-hidden="true" />
              {m.remove}
            </Button>
          </div>
        </>
      }
    >
      {/* the form: one tab per part of the program */}
      <FolderTabs
        label={m.tabsLabel}
        tabs={TABS.map((t) => ({ key: t, label: m.tabs[t], flagged: tabBad(t) }))}
        value={tab}
        onChange={setTab}
      >
        {panel}
      </FolderTabs>
    </EditorPage>
  );
}

/** Rivals: search a team to add it, then name the rivalry and say how often it's played. */
function Rivals({
  fields: f,
  own,
  teams,
  invalid,
  onChange,
}: {
  fields: ProgramFields;
  own: string | null;
  teams: RealProgram[];
  invalid: boolean;
  onChange: (patch: Partial<ProgramFields>) => void;
}) {
  const [query, setQuery] = useState("");
  const rivals = f.rivals ?? [];
  const names = f.rivalry_names ?? {};
  const often = f.rivalry_often ?? {};
  const full = rivals.length >= MAX_RIVALS;
  const bySlug = useMemo(() => Object.fromEntries(teams.map((t) => [t.slug, t])), [teams]);
  const q = query.trim().toLowerCase();
  const hits = q
    ? teams
        .filter((t) => t.slug !== own && !rivals.includes(t.slug))
        .filter((t) => `${t.short_name} ${t.name} ${t.abbreviation}`.toLowerCase().includes(q))
        .slice(0, 6)
    : [];

  const add = (slug: string) => {
    onChange({ rivals: [...rivals, slug].slice(0, MAX_RIVALS) });
    setQuery("");
  };
  const drop = (slug: string) => {
    const { [slug]: _n, ...restNames } = names;
    const { [slug]: _o, ...restOften } = often;
    onChange({ rivals: rivals.filter((x) => x !== slug), rivalry_names: restNames, rivalry_often: restOften });
  };

  return (
    <div className="rivals">
      <Field label={m.rivals} hint={m.rivalCount(rivals.length)} invalid={invalid} group>
        <input
          type="search"
          value={query}
          disabled={full}
          placeholder={full ? m.rivalsFull : m.rivalSearch}
          aria-label={m.rivalSearch}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && hits[0]) add(hits[0].slug);
          }}
        />
      </Field>
      {hits.length > 0 && (
        <div className="rivals__hits">
          {hits.map((t) => (
            <button key={t.slug} type="button" className="rivals__hit" onClick={() => add(t.slug)}>
              <Plus size={14} weight="bold" aria-hidden="true" />
              {t.short_name}
            </button>
          ))}
        </div>
      )}
      {rivals.length === 0 ? (
        <p className="program__soft">{m.noRivals}</p>
      ) : (
        <ul className="rivals__list">
          {rivals.map((slug) => {
            const team = bySlug[slug]?.short_name ?? slug;
            const weekTaken = rivals.some((x) => x !== slug && often[x] === "week");
            return (
              <li key={slug} className="rivals__row">
                <b className="rivals__team">{team}</b>
                <Field label={m.rivalName}>
                  <input
                    value={names[slug] ?? ""}
                    maxLength={60}
                    placeholder={m.rivalNamePlaceholder}
                    onChange={(e) => onChange({ rivalry_names: { ...names, [slug]: e.target.value } })}
                  />
                </Field>
                <Field label={m.rivalOften}>
                  <select
                    value={often[slug] ?? "year"}
                    onChange={(e) => onChange({ rivalry_often: { ...often, [slug]: e.target.value as RivalryOften } })}
                  >
                    <option value="year">{m.often.year}</option>
                    <option value="week" disabled={weekTaken}>
                      {m.often.week}
                    </option>
                    <option value="some">{m.often.some}</option>
                  </select>
                </Field>
                <button
                  type="button"
                  className="program__x"
                  aria-label={m.removeRival(team)}
                  onClick={() => drop(slug)}
                >
                  <X size={16} weight="bold" aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <p className="field__hint">{m.rivalsHint}</p>
    </div>
  );
}

/** The roster: add players one at a time, or paste a list. Both edit the same lines. */
function Roster({ text, invalid, onChange }: { text: string; invalid: boolean; onChange: (text: string) => void }) {
  const [name, setName] = useState("");
  const [pos, setPos] = useState(POSITIONS[0]);
  const [cls, setCls] = useState(CLASSES[0]);
  const [ovr, setOvr] = useState("");
  const rows = parseRoster(text);
  const lines = text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);

  const add = () => {
    const n = name.trim().replace(/,/g, " ");
    if (!n) return;
    const line = [n, pos, cls, ovr ? String(Math.round(Number(ovr))) : null].filter(Boolean).join(", ");
    onChange([...lines, line].join("\n"));
    setName("");
    setOvr("");
  };

  return (
    <div className="roster-edit">
      <div className="roster-edit__add">
        <Field label={m.playerName}>
          <input
            value={name}
            maxLength={40}
            autoComplete="off"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") add();
            }}
          />
        </Field>
        <Field label={m.position}>
          <select value={pos} onChange={(e) => setPos(e.target.value)}>
            {POSITIONS.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </Field>
        <Field label={m.cls}>
          <select value={cls} onChange={(e) => setCls(e.target.value)}>
            {CLASSES.map((c) => (
              <option key={c} value={c}>
                {formatClass(c)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={m.overall}>
          <input
            type="number"
            min={40}
            max={99}
            value={ovr}
            placeholder={m.optional}
            onChange={(e) => setOvr(e.target.value)}
          />
        </Field>
        <Button variant="outline" onClick={add} disabled={!name.trim()}>
          <Plus size={16} weight="bold" aria-hidden="true" />
          {m.addPlayer}
        </Button>
      </div>

      <div className="roster-edit__body">
        <div className="roster-edit__list" aria-live="polite">
          <span className="label">{m.playerCount(rows.length)}</span>
          {rows.length === 0 ? (
            <p className="program__soft">{m.noPlayers}</p>
          ) : (
            <ul>
              {rows.map((r, i) => {
                const ok = r.name && POSITIONS.includes(r.pos) && CLASSES.includes(r.class);
                return (
                  <li key={`${i}-${r.name}`} className={ok ? "roster-edit__row" : "roster-edit__row is-bad"}>
                    <span className="roster-edit__pos">{r.pos || "?"}</span>
                    <b className="roster-edit__name">{r.name || m.noName}</b>
                    <span className="roster-edit__meta">
                      {[
                        CLASSES.includes(r.class) ? formatClass(r.class) : r.class,
                        r.overall != null && m.ovr(r.overall),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                    <button
                      type="button"
                      className="program__x"
                      aria-label={m.removePlayer(r.name || m.noName)}
                      onClick={() => onChange(lines.filter((_, j) => j !== i).join("\n"))}
                    >
                      <X size={14} weight="bold" aria-hidden="true" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <Field label={m.paste} hint={m.pasteHint} invalid={invalid} className="roster-edit__paste">
          <textarea value={text} rows={6} placeholder={m.pastePlaceholder} onChange={(e) => onChange(e.target.value)} />
        </Field>
      </div>
    </div>
  );
}
