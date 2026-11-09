import { NavLink } from "react-router";
import { usePageTitle } from "../hooks.js";

export function NotFound() {
  usePageTitle("Not found - Psephex");
  return (
    <div className="flex flex-col gap-3 py-10">
      <h1 className="m-0 font-display text-4xl font-extrabold">This page does not exist</h1>
      <p className="m-0 text-muted">
        <NavLink to="/app" className="underline underline-offset-2 hover:text-bronze-text">
          Open the disputes
        </NavLink>{" "}
        or go back to the{" "}
        <NavLink to="/" className="underline underline-offset-2 hover:text-bronze-text">
          start page
        </NavLink>
        .
      </p>
    </div>
  );
}
