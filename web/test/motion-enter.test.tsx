import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useEnter } from "../src/lib/motion.js";

const reduced = window.matchMedia;
window.matchMedia = ((query: string) => ({ ...reduced(query), matches: false })) as typeof window.matchMedia;

describe("useEnter", () => {
  it("animates every property back to its resting value", () => {
    const { result } = renderHook(() => useEnter({ opacity: 0, y: 8, scale: 0.6, scaleY: 0 }, 0.2));
    expect(result.current.initial).toEqual({ opacity: 0, y: 8, scale: 0.6, scaleY: 0 });
    expect(result.current.animate).toEqual({ opacity: 1, y: 0, scale: 1, scaleY: 1 });
    expect(result.current.transition).toMatchObject({ delay: 0.2 });
  });
});
