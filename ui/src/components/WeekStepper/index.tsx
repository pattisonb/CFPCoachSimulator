import { CaretLeft, CaretRight } from "@phosphor-icons/react";
import { SectionStatus } from "../SectionTabs/index.tsx";
import { messages as m } from "./messages.ts";
import "./index.css";

interface Props {
  /** the weeks there are to show, oldest first */
  weeks: number[];
  /** the one showing */
  week: number;
  /** a week's name ("Week 6", "Championship Week") */
  name: (week: number) => string;
  onPick: (week: number) => void;
}

/**
 * The week a page is showing, with a step to the one before and the one after: for the end of a section's tab bar
 * (the Weekly Recap, the Players of the Week).
 */
export default function WeekStepper({ weeks, week, name, onPick }: Props) {
  const at = weeks.indexOf(week);
  return (
    <span className="week-stepper">
      <button
        type="button"
        className="week-stepper__step"
        aria-label={m.earlier}
        title={m.earlier}
        disabled={at <= 0}
        onClick={() => onPick(weeks[at - 1])}
      >
        <CaretLeft size={14} weight="bold" aria-hidden="true" />
      </button>
      <SectionStatus>{name(week)}</SectionStatus>
      <button
        type="button"
        className="week-stepper__step"
        aria-label={m.later}
        title={m.later}
        disabled={at < 0 || at >= weeks.length - 1}
        onClick={() => onPick(weeks[at + 1])}
      >
        <CaretRight size={14} weight="bold" aria-hidden="true" />
      </button>
    </span>
  );
}
