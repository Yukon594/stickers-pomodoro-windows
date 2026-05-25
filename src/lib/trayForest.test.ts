import { describe, expect, it } from "vitest";
import { defaultSettings } from "./storage";
import {
  TREE_STYLE_OPTIONS,
  buildTrayForestState,
  countdownStages,
  countupStages,
  drawTrayIconSvg,
  drawTreePreviewSvg,
  progressStage
} from "./trayForest";
import type { TimerState, TreeStyle } from "./types";

describe("tray forest helpers", () => {
  it("maps progress to five growth stages", () => {
    expect(progressStage(0)).toBe(0);
    expect(progressStage(0.25)).toBe(1);
    expect(progressStage(0.5)).toBe(2);
    expect(progressStage(0.75)).toBe(3);
    expect(progressStage(1)).toBe(4);
  });

  it("lists countdown growth stages from left to right", () => {
    expect(countdownStages(0)).toEqual([0]);
    expect(countdownStages(0.5)).toEqual([0, 1, 2]);
    expect(countdownStages(1)).toEqual([0, 1, 2, 3, 4]);
  });

  it("caps countup trees at five visible trees", () => {
    expect(countupStages(2, 0.5)).toEqual([4, 4, 2]);
    expect(countupStages(7, 0.1)).toEqual([4, 4, 4, 4, 4]);
  });

  it("uses completion state for the countdown tray forest", () => {
    const timer: TimerState = {
      phase: "countdown",
      countdownRole: "focus",
      secondsLeft: 0,
      isRunning: false,
      completedFocusSessions: 1,
      isComplete: true
    };

    const state = buildTrayForestState(timer, {
      ...defaultSettings,
      forestStats: {
        days: {
          "2026-05-19": { focusSeconds: 1500, treesCompleted: 1, projects: {} }
        }
      }
    });

    expect(state.title).toContain("完成");
    expect(state.stage).toBe(4);
    expect(state.iconVariant).toBe("tree");
  });

  it("switches rest countdown to the charging capsule icon", () => {
    const timer: TimerState = {
      phase: "countdown",
      countdownRole: "rest",
      secondsLeft: 90,
      isRunning: true,
      completedFocusSessions: 1,
      isComplete: false
    };

    const state = buildTrayForestState(timer, defaultSettings);

    expect(state.iconVariant).toBe("rest-charge");
  });

  it("keeps an idle focus tree visible instead of the stage-zero sprout", () => {
    const timer: TimerState = {
      phase: "countdown",
      countdownRole: "focus",
      secondsLeft: defaultSettings.timer.focusMinutes * 60,
      isRunning: false,
      completedFocusSessions: 0,
      isComplete: false
    };

    const state = buildTrayForestState(timer, defaultSettings);

    expect(state.iconVariant).toBe("tree");
    expect(state.stage).toBe(1);
  });

  it("uses a todo duration override for countdown tree growth", () => {
    const timer: TimerState = {
      phase: "countdown",
      countdownRole: "focus",
      secondsLeft: 150,
      isRunning: true,
      completedFocusSessions: 0,
      isComplete: false
    };

    const state = buildTrayForestState(timer, defaultSettings, 300);

    expect(state.iconVariant).toBe("tree");
    expect(state.stage).toBe(2);
  });

  it("starts idle pixel trees at a larger visible stage", () => {
    const timer: TimerState = {
      phase: "countdown",
      countdownRole: "focus",
      secondsLeft: defaultSettings.timer.focusMinutes * 60,
      isRunning: false,
      completedFocusSessions: 0,
      isComplete: false
    };

    const state = buildTrayForestState(timer, {
      ...defaultSettings,
      menuBar: { ...defaultSettings.menuBar, treeStyle: "pixel" }
    });

    expect(state.stage).toBe(2);
  });

  it("draws distinct growth stages for every tree style preview", () => {
    for (const option of TREE_STYLE_OPTIONS) {
      const svgs = Array.from({ length: 5 }, (_, stage) => drawTreePreviewSvg(stage, option.value as TreeStyle));
      expect(new Set(svgs).size, option.value).toBe(5);
      expect(svgs.join("")).not.toMatch(/NaN|undefined|Infinity/);
    }
  });

  it("draws distinct rest charge stages without malformed SVG values", () => {
    const svgs = Array.from({ length: 5 }, (_, stage) => drawTrayIconSvg(stage, "round", "rest-charge"));

    expect(new Set(svgs).size).toBe(5);
    expect(svgs.join("")).not.toMatch(/NaN|undefined|Infinity/);
    expect(svgs[4]).toContain('x="4.7"');
    expect(svgs[4]).toContain('width="8.6"');
  });

  it("keeps the pixel tree on a crisp integer grid", () => {
    const svg = drawTreePreviewSvg(4, "pixel");

    expect(svg).toContain('shape-rendering="crispEdges"');
    expect(svg).not.toContain("rx=");
    expect(svg).not.toMatch(/\d+\.\d/);
  });
});
