import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NumberTicker } from "../src/components/ui/number-ticker.js";

const reduced = window.matchMedia;
window.matchMedia = ((query: string) => ({ ...reduced(query), matches: false })) as typeof window.matchMedia;

describe("NumberTicker with motion allowed", () => {
  it("counts up to the real number", async () => {
    render(<NumberTicker value={13} data-testid="n" />);
    await waitFor(() => expect(screen.getByTestId("n")).toHaveTextContent("13"), { timeout: 4000 });
  });
});
