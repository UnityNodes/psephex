import { Moon, Sun } from "lucide-react";
import { useTheme } from "./theme-provider.js";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const next = theme === "dark" ? "light" : "dark";
  const Icon = theme === "dark" ? Sun : Moon;
  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      aria-label={`Switch to the ${next} theme`}
      className="flex size-11 items-center justify-center rounded-full text-muted transition-colors duration-150 hover:bg-raised hover:text-ink"
    >
      <Icon className="size-[18px]" strokeWidth={1.75} aria-hidden="true" />
    </button>
  );
}
