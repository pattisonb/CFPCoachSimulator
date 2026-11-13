import { DeviceMobileSlash } from "@phosphor-icons/react";
import BallLogo from "../../components/BallLogo/index.tsx";
import { messages as m } from "./messages.ts";
import "./index.css";

/** Shown instead of every page on phones (windows narrower than MIN_WIDTH, src/viewport.ts). */
export default function MobileNotSupported() {
  return (
    <main className="mobile">
      <div className="mobile__brand">
        <span className="mobile__mark">
          <BallLogo />
        </span>
        <span>{m.brand}</span>
      </div>
      <div className="mobile__card">
        <DeviceMobileSlash size={48} weight="bold" aria-hidden="true" />
        <h1 className="mobile__title">{m.title}</h1>
        <p>{m.body}</p>
        <p className="mobile__needs">{m.needs}</p>
      </div>
    </main>
  );
}
