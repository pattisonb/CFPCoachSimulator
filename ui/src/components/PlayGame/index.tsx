import { useEffect, useMemo, useState } from "react";
import { ArrowsLeftRight, Lightning, Play } from "@phosphor-icons/react";
import Button from "../Button/index.tsx";
import Modal from "../Modal/index.tsx";
import Swatch from "../Swatch/index.tsx";
import { PopupBlocked, playOnTheField } from "../../franchise.ts";
import type { TeamCard } from "../../types.ts";
import { messages as m } from "./messages.ts";
import "./index.css";

interface Props {
  open: boolean;
  onClose: () => void;
  seasonId: string;
  /** your team and this week's opponent: the sides it starts with */
  team: string;
  opponent: string | null;
  teams: Map<string, TeamCard>;
  /** the week's name and date, under the title */
  week: string;
  date: string;
  /** sim this week's game in the season instead (only in a week you play) */
  onSim?: () => void;
}

/** One side: a team's colors, and a picker of every FBS team. */
function Side({
  label,
  tip,
  value,
  onChange,
  options,
  teams,
}: {
  label: string;
  tip: string;
  value: string;
  onChange: (slug: string) => void;
  options: TeamCard[];
  teams: Map<string, TeamCard>;
}) {
  const t = teams.get(value);
  return (
    <label className="play-game__side">
      <span className="label play-game__label" title={tip}>
        {label}
      </span>
      <span className="play-game__team">
        <Swatch team={t} size={40} className="play-game__swatch" />
        <select className="play-game__select" value={value} onChange={(e) => onChange(e.target.value)}>
          {options.map((o) => (
            <option key={o.slug} value={o.slug}>
              {o.name}
            </option>
          ))}
        </select>
      </span>
    </label>
  );
}

/**
 * Play Game Day: pick the two sides (your team and this week's opponent to start; either can be any FBS team, and
 * Swap Sides flips them), then Play It on the Field opens Pocket Franchise's practice field in a new tab with both
 * rosters at their current skills. Sim Game Day plays this week's game in the season instead.
 */
export default function PlayGame({ open, onClose, seasonId, team, opponent, teams, week, date, onSim }: Props) {
  const [offense, setOffense] = useState(team);
  const [defense, setDefense] = useState(opponent ?? "");
  const [status, setStatus] = useState<{ kind: "idle" | "opening" } | { kind: "error"; msg: string }>({
    kind: "idle",
  });

  // each time it opens: your team against this week's opponent
  useEffect(() => {
    if (!open) return;
    setOffense(team);
    setDefense(opponent ?? "");
    setStatus({ kind: "idle" });
  }, [open, team, opponent]);

  const options = useMemo(() => [...teams.values()].sort((a, b) => a.name.localeCompare(b.name)), [teams]);
  const name = (slug: string) => teams.get(slug)?.name ?? slug;

  const field = () => {
    setStatus({ kind: "opening" });
    // straight from the click: the tab opens before anything is awaited
    playOnTheField(seasonId, offense, defense || null)
      .then(() => {
        setStatus({ kind: "idle" });
        onClose();
      })
      .catch((e) =>
        setStatus({ kind: "error", msg: e instanceof PopupBlocked ? m.blocked : m.failed((e as Error).message) }),
      );
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title={onSim ? m.title : m.field}
      lede={m.lede(week, date)}
      footer={
        <>
          {onSim && (
            <Button
              variant="outline"
              title={m.simNote}
              onClick={() => {
                onClose();
                onSim();
              }}
            >
              <Lightning size={18} weight="fill" aria-hidden="true" />
              {m.sim}
            </Button>
          )}
          <Button
            onClick={field}
            disabled={status.kind === "opening" || !offense}
            title={defense ? m.fieldNote(name(offense), name(defense)) : m.alone(name(offense))}
          >
            <Play size={18} weight="fill" aria-hidden="true" />
            {status.kind === "opening" ? m.opening : m.field}
          </Button>
        </>
      }
    >
      <div className="play-game">
        <div className="play-game__sides">
          <Side
            label={m.offense}
            tip={m.offenseTip}
            value={offense}
            onChange={setOffense}
            options={options}
            teams={teams}
          />
          <button
            type="button"
            className="play-game__swap"
            aria-label={m.swap}
            title={m.swap}
            disabled={!defense}
            onClick={() => {
              setOffense(defense);
              setDefense(offense);
            }}
          >
            <ArrowsLeftRight size={18} weight="bold" aria-hidden="true" />
          </button>
          <Side
            label={m.defense}
            tip={m.defenseTip}
            value={defense}
            onChange={setDefense}
            options={options}
            teams={teams}
          />
        </div>
        {status.kind === "error" && (
          <p className="play-game__error" role="alert">
            {status.msg}
          </p>
        )}
      </div>
    </Modal>
  );
}
