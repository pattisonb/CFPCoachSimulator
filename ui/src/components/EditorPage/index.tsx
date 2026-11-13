import type { ReactNode } from "react";
import { ArrowLeft } from "@phosphor-icons/react";
import Header from "../Header/index.tsx";
import { hrefFor, navigate, type Route } from "../../router.ts";
import type { Theme } from "../../theme.ts";
import "./index.css";

interface Props {
  theme: Theme;
  onToggleTheme: () => void;
  /** where Back goes, and its label */
  back: { route: Route; params?: Record<string, string>; label: string };
  title: string;
  lede?: string;
  /** a control on the intro row's right (a picker) */
  aside?: ReactNode;
  /** the window's sidebar */
  side: ReactNode;
  /** the window's main area */
  children: ReactNode;
}

/**
 * The editors' page (Your Coach, Custom Program): the header, a row as wide as the window (Back on the left, the
 * title in the middle, an optional control on the right), then a framed window with a sidebar and a main area.
 * Fits one window from 768 px wide up, like Play.
 */
export default function EditorPage({ theme, onToggleTheme, back, title, lede, aside, side, children }: Props) {
  return (
    <div className="editor">
      <Header active="play" theme={theme} onToggleTheme={onToggleTheme} />

      <div className="editor__intro">
        <a
          className="editor__back"
          href={hrefFor(back.route, back.params)}
          onClick={(e) => {
            e.preventDefault();
            navigate(back.route, back.params);
          }}
        >
          <ArrowLeft size={18} weight="bold" aria-hidden="true" />
          {back.label}
        </a>
        <div className="editor__heading">
          <h1 className="editor__title">{title}</h1>
          {lede && <p className="editor__lede">{lede}</p>}
        </div>
        <div className="editor__aside">{aside}</div>
      </div>

      <section className="editor__window" aria-label={title}>
        <aside className="editor__side">{side}</aside>
        <div className="editor__main">{children}</div>
      </section>
    </div>
  );
}
