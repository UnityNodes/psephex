import { m, useReducedMotion } from "motion/react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "./theme-provider.js";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const next = theme === "dark" ? "light" : "dark";
  const Icon = theme === "dark" ? Sun : Moon;
  const still = useReducedMotion() === true;
  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      aria-label={`Switch to the ${next} theme`}
      className="flex size-11 items-center justify-center rounded-full text-muted transition-colors duration-150 hover:bg-raised hover:text-ink"
    >
      <m.span
        key={theme}
        className="flex"
        initial={still ? false : { opacity: 0, rotate: -90, scale: 0.6 }}
        animate={{ opacity: 1, rotate: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 420, damping: 24 }}
      >
        <Icon className="size-[18px]" strokeWidth={1.75} aria-hidden="true" />
      </m.span>
    </button>
  );
}
