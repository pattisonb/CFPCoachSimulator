import "./index.css";

interface Props {
  /** your chance to win, 0 to 100; null while the read is still coming (an empty bar) */
  mine: number | null;
  /** your color, and your opponent's (each a team's primary); ink where one is not known */
  myColor?: string;
  theirColor?: string;
}

/**
 * A game's Win Chance as one bar shared by the two teams (the player's ask): your side from the left in your color,
 * theirs from the right in theirs, the page's color between them where they meet. The frame is ink, so a team whose
 * color is near the page's (white, black) still shows where its side ends. Decorative: the number beside it says it.
 */
export default function WinBar({ mine, myColor, theirColor }: Props) {
  return (
    <span className={`win-bar${mine === null ? " is-waiting" : ""}`} aria-hidden="true">
      {mine !== null && (
        <>
          <i className="win-bar__mine" style={{ width: `${mine}%`, background: myColor }} />
          <i className="win-bar__theirs" style={{ background: theirColor }} />
        </>
      )}
    </span>
  );
}
