import { describe, expect, it, vi } from "vitest";
import { durationForPhase, formatTime, nextPhase, resolveCorner } from "./timer";
import { defaultSettings } from "./storage";

describe("timer helpers", () => {
  it("formats remaining time with leading zeroes", () => {
    expect(formatTime(65)).toBe("01:05");
    expect(formatTime(0)).toBe("00:00");
  });

  it("keeps countdown durations at a one-minute minimum", () => {
    expect(durationForPhase("countdown", { ...defaultSettings.timer, focusMinutes: 0 }, "focus")).toBe(60);
    expect(durationForPhase("countdown", { ...defaultSettings.timer, restMinutes: 0 }, "rest")).toBe(60);
  });

  it("chooses long break on configured focus interval", () => {
    expect(nextPhase("countdown", 3, defaultSettings.timer)).toBe("countup");
    expect(nextPhase("countup", 1, defaultSettings.timer)).toBe("countdown");
  });

  it("keeps reminder corners on the top edge", () => {
    expect(resolveCorner("top-left", null, 0)).toBe("top-left");
    expect(resolveCorner("top-center", "top-right", 0)).toBe("top-center");
  });

  it("accepts the right top reminder corner", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    expect(resolveCorner("top-right", null, 0)).toBe("top-right");
    vi.restoreAllMocks();
  });
});
