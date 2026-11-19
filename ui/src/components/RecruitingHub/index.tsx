import Prospects from "../Prospects/index.tsx";
import Recruiting from "../Recruiting/index.tsx";
import SectionTabs, { SectionPane } from "../SectionTabs/index.tsx";
import type { Face } from "../../faces.ts";
import type { RecruitingBoard } from "../../types.ts";
import { messages as m } from "./messages.ts";

export type HubTab = "board" | "prospects";

interface Props {
  seasonId: string;
  team: string;
  year: number;
  weekLabels: Record<string, string>;
  board: RecruitingBoard | null;
  reload: () => Promise<void>;
  tab: HubTab;
  onTab: (tab: HubTab) => void;
  /** the week's season key: a sim remounts both */
  weekKey: number;
  /** your coach: his face and name beside your lines on a call or visit */
  coach: { name: string; face: Face } | null;
  /** a recruit to open on the Board (asked for from another section) */
  pick?: string | null;
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
  tab,
  onTab,
  weekKey,
  coach,
  pick,
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
        ]}
      />
      <SectionPane shown={tab === "board"}>
        <Recruiting
          key={weekKey}
          seasonId={seasonId}
          team={team}
          weekLabels={weekLabels}
          board={board}
          reload={reload}
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
          onBoardChange={() => void reload()}
        />
      </SectionPane>
    </div>
  );
}
