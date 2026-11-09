import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NumberTicker } from "../src/components/ui/number-ticker.js";

describe("NumberTicker with reduced motion", () => {
  it("shows the final number at once", () => {
    render(<NumberTicker value={13} data-testid="n" />);
    expect(screen.getByTestId("n")).toHaveTextContent("13");
  });
});

describe("useEnter with reduced motion", () => {
  it("does not animate at all", async () => {
    const { renderHook } = await import("@testing-library/react");
    const { useEnter } = await import("../src/lib/motion.js");
    const { result } = renderHook(() => useEnter({ opacity: 0, y: 8 }));
    expect(result.current).toEqual({});
  });
});
