import CoachEdit from "./pages/CoachEdit/index.tsx";
import Game from "./pages/Game/index.tsx";
import Home from "./pages/Home/index.tsx";
import PlayerEdit from "./pages/PlayerEdit/index.tsx";
import ProgramEdit from "./pages/ProgramEdit/index.tsx";
import MobileNotSupported from "./pages/MobileNotSupported/index.tsx";
import { useRoute } from "./router.ts";
import { useTheme } from "./theme.ts";
import { useTooNarrow } from "./viewport.ts";

export default function App() {
  const [theme, toggleTheme] = useTheme();
  const { route, params } = useRoute();
  const tooNarrow = useTooNarrow();
  // phones get one page for every address until the game supports small screens
  if (tooNarrow) return <MobileNotSupported />;
  if (route === "game")
    return (
      <Game theme={theme} onToggleTheme={toggleTheme} seasonId={params.get("id")} sectionKey={params.get("section")} />
    );
  if (route === "coachEdit")
    return <CoachEdit theme={theme} onToggleTheme={toggleTheme} teamSlug={params.get("team")} />;
  if (route === "playerEdit")
    return (
      <PlayerEdit
        theme={theme}
        onToggleTheme={toggleTheme}
        seasonId={params.get("season")}
        team={params.get("team")}
        player={params.get("player")}
      />
    );
  if (route === "programEdit")
    return (
      <ProgramEdit
        theme={theme}
        onToggleTheme={toggleTheme}
        programId={params.get("id")}
        teamSlug={params.get("team")}
      />
    );
  return <Home theme={theme} onToggleTheme={toggleTheme} />;
}
