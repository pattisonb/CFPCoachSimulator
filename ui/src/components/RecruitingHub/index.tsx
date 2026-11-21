import type { ReactNode } from "react";
import Classes from "../Classes/index.tsx";
import Prospects from "../Prospects/index.tsx";
import Recruiting from "../Recruiting/index.tsx";
import SectionTabs, { SectionPane } from "../SectionTabs/index.tsx";
import type { Face } from "../../faces.ts";
import type { RecruitingBoard, TeamCard } from "../../types.ts";
import { messages as m } from "./messages.ts";

export type HubTab = "board" | "prospects" | "classes";

interface Props {
  seasonId: string;
  team: string;
  year: number;
  weekLabels: Record<string, string>;
  board: RecruitingBoard | null;
  reload: (quiet?: boolean, stale?: () => boolean) => Promise<void>;
  /** change the board at once, ahead of the server (a quick action ticked) */
  patch?: (change: (b: RecruitingBoard) => RecruitingBoard) => void;
  tab: HubTab;
  onTab: (tab: HubTab) => void;
  /** the week's season key: a sim remounts both */
  weekKey: number | string;
  /** your coach: his face and name beside your lines on a call or visit */
  coach: { name: string; face: Face } | null;
  /** a recruit to open on the Board (asked for from another section) */
  pick?: string | null;
  /** the real teams by slug, for the class rankings' colors */
  teams: Map<string, TeamCard>;
  /** at the tab bar's far end (Auto-Recruit, while the coach card is off the screen) */
  aside?: ReactNode;
}

/**
 * Recruiting, in one place: the Board (the recruits you're working) and Prospects (the whole class, where you find
 * and star them) as two tabs. Both stay mounted, so switching keeps each one's filters, pick and scroll; a star on
 * Prospects is on the Board at once (reload). The tabs are one bar across the top that never changes, so switching
 * moves nothing but what's under it.
 */
export default function RecruitingHub({
  seasonId,
  team,
  year,
  weekLabels,
  board,
  reload,
  patch,
  tab,
  onTab,
  weekKey,
  coach,
  pick,
  teams,
  aside,
}: Props) {
  return (
    <div className="section-tabs__wrap">
      <SectionTabs
        title={m.label}
        value={tab}
        onChange={onTab}
        tabs={[
          { key: "board", label: m.board },
          { key: "prospects", label: m.prospects },
          { key: "classes", label: m.classes },
        ]}
        aside={aside}
      />
      <SectionPane shown={tab === "board"}>
        <Recruiting
          key={weekKey}
          seasonId={seasonId}
          team={team}
          weekLabels={weekLabels}
          board={board}
          reload={reload}
          patch={patch}
          coach={coach}
          pick={pick}
          onFindProspects={() => onTab("prospects")}
        />
      </SectionPane>
      <SectionPane shown={tab === "prospects"}>
        <Prospects
          key={weekKey}
          seasonId={seasonId}
          year={year}
          active={tab === "prospects"}
          boardSize={board?.board.length}
          school={teams.get(team)}
          onBoardChange={() => void reload()}
        />
      </SectionPane>
      <SectionPane shown={tab === "classes"}>
        <Classes key={weekKey} seasonId={seasonId} team={team} teams={teams} active={tab === "classes"} />
      </SectionPane>
    </div>
  );
}
