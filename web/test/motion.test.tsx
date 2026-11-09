import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NumberTicker } from "../src/components/ui/number-ticker.js";

describe("NumberTicker with reduced motion", () => {
  it("shows the final number at once", () => {
    render(<NumberTicker value={13} data-testid="n" />);
    expect(screen.getByTestId("n")).toHaveTextContent("13");
  });
});
