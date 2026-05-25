import { describe, expect, it } from "vitest";
import {
  addDailyForestProgress,
  buildHeatmapWeeks,
  heatmapLevel,
  moveDailyForestProjectProgress,
  normalizeForestStats,
  summarizeProjectRange,
  summarizeRange,
  todayKey
} from "./stats";

describe("forest stats helpers", () => {
  it("normalizes missing and invalid persisted stats", () => {
    const stats = normalizeForestStats({
      days: {
        "2026-05-19": { focusSeconds: 1500.8, treesCompleted: 1.2 },
        nope: { focusSeconds: -5, treesCompleted: 3 }
      }
    });

    expect(stats.days["2026-05-19"]).toEqual({ focusSeconds: 1500, treesCompleted: 1, projects: {} });
    expect(stats.days.nope).toBeUndefined();
  });

  it("normalizes persisted per-project stats without inventing totals", () => {
    const stats = normalizeForestStats({
      days: {
        "2026-05-19": {
          focusSeconds: 1500,
          treesCompleted: 1,
          projects: {
            writing: { focusSeconds: 900.9, treesCompleted: 1.2 },
            "bad id": { focusSeconds: 999, treesCompleted: 9 }
          }
        }
      }
    });

    expect(stats.days["2026-05-19"].projects.writing).toEqual({ focusSeconds: 900, treesCompleted: 1 });
    expect(stats.days["2026-05-19"].projects["bad id"]).toBeUndefined();
    expect(stats.days["2026-05-19"].focusSeconds).toBe(1500);
  });

  it("adds focus seconds and completed trees to the local day", () => {
    const date = new Date(2026, 4, 19, 12);
    const stats = addDailyForestProgress({ days: {} }, 60, 1, date);
    const updated = addDailyForestProgress(stats, 30, 0, date);

    expect(updated.days[todayKey(date)]).toEqual({
      focusSeconds: 90,
      treesCompleted: 1,
      projects: {
        unclassified: { focusSeconds: 90, treesCompleted: 1 }
      }
    });
  });

  it("keeps all-project totals and selected project stats in sync", () => {
    const date = new Date(2026, 4, 19, 12);
    const stats = addDailyForestProgress({ days: {} }, 60, 1, date, "writing");
    const updated = addDailyForestProgress(stats, 30, 0, date, "lab");

    expect(updated.days[todayKey(date)].focusSeconds).toBe(90);
    expect(updated.days[todayKey(date)].treesCompleted).toBe(1);
    expect(updated.days[todayKey(date)].projects.writing).toEqual({ focusSeconds: 60, treesCompleted: 1 });
    expect(updated.days[todayKey(date)].projects.lab).toEqual({ focusSeconds: 30, treesCompleted: 0 });
  });

  it("moves a completed unclassified session to a selected project without duplicating totals", () => {
    const date = new Date(2026, 4, 19, 12);
    const stats = addDailyForestProgress({ days: {} }, 1500, 1, date);
    const moved = moveDailyForestProjectProgress(stats, 1500, 1, todayKey(date), "unclassified", "writing");
    const day = moved.days[todayKey(date)];

    expect(day.focusSeconds).toBe(1500);
    expect(day.treesCompleted).toBe(1);
    expect(day.projects.unclassified).toEqual({ focusSeconds: 0, treesCompleted: 0 });
    expect(day.projects.writing).toEqual({ focusSeconds: 1500, treesCompleted: 1 });
  });

  it("builds a 12 week heatmap ending in the current week", () => {
    const today = new Date(2026, 4, 19);
    const weeks = buildHeatmapWeeks({ days: {} }, "trees", today);

    expect(weeks).toHaveLength(12);
    expect(weeks[0]).toHaveLength(7);
    expect(weeks[11][2].date).toBe("2026-05-19");
    expect(weeks[11][6].isFuture).toBe(true);
  });

  it("summarizes day, week, and month ranges", () => {
    const stats = normalizeForestStats({
      days: {
        "2026-05-01": { focusSeconds: 1200, treesCompleted: 1 },
        "2026-05-18": { focusSeconds: 1800, treesCompleted: 2 },
        "2026-05-19": { focusSeconds: 600, treesCompleted: 1 }
      }
    });
    const today = new Date(2026, 4, 19);

    expect(summarizeRange(stats, "day", today)).toEqual({ focusSeconds: 600, treesCompleted: 1 });
    expect(summarizeRange(stats, "week", today)).toEqual({ focusSeconds: 2400, treesCompleted: 3 });
    expect(summarizeRange(stats, "month", today)).toEqual({ focusSeconds: 3600, treesCompleted: 4 });
  });

  it("summarizes and maps heatmap values for a selected project only", () => {
    const today = new Date(2026, 4, 19);
    const stats = normalizeForestStats({
      days: {
        "2026-05-18": {
          focusSeconds: 1800,
          treesCompleted: 2,
          projects: {
            writing: { focusSeconds: 1200, treesCompleted: 1 },
            lab: { focusSeconds: 600, treesCompleted: 1 }
          }
        },
        "2026-05-19": {
          focusSeconds: 600,
          treesCompleted: 1,
          projects: {
            writing: { focusSeconds: 600, treesCompleted: 1 }
          }
        }
      }
    });
    const weeks = buildHeatmapWeeks(stats, "focus", today, 12, "writing");

    expect(summarizeProjectRange(stats, "week", today, "writing")).toEqual({ focusSeconds: 1800, treesCompleted: 2 });
    expect(weeks[11][1].stats).toMatchObject({ focusSeconds: 1200, treesCompleted: 1 });
    expect(weeks[11][2].stats).toMatchObject({ focusSeconds: 600, treesCompleted: 1 });
  });

  it("calculates heatmap intensity from trees and focus time", () => {
    expect(heatmapLevel({ focusSeconds: 0, treesCompleted: 0 }, "trees")).toBe(0);
    expect(heatmapLevel({ focusSeconds: 25 * 60, treesCompleted: 0 }, "focus")).toBe(2);
    expect(heatmapLevel({ focusSeconds: 0, treesCompleted: 5 }, "trees")).toBe(4);
  });
});
