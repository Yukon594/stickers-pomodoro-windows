import { describe, expect, it } from "vitest";
import { DEFAULT_PROJECT_ID } from "./types";
import { mergePersistedSettings, mergeSettings } from "./storage";

describe("settings storage helpers", () => {
  it("merges older settings without todo or quick start fields", () => {
    const settings = mergeSettings({
      timer: { focusMinutes: 30 }
    });

    expect(settings.timer.focusMinutes).toBe(30);
    expect(settings.todos).toEqual([]);
    expect(settings.activeTodoId).toBeNull();
    expect(settings.quickStartPresets.map((preset) => preset.label)).toEqual(["读书", "健身", "写作", "整理"]);
  });

  it("filters invalid todos while preserving valid local todo progress", () => {
    const settings = mergeSettings({
      todos: [
        {
          id: "todo-1",
          title: "  改 Introduction  ",
          projectId: "writing",
          plannedMinutes: 35.8,
          order: 2,
          completed: false,
          focusSeconds: 1500.8,
          treesCompleted: 1.2,
          createdAt: "2026-05-21T10:00:00.000Z"
        },
        {
          id: "bad todo id",
          title: "bad",
          projectId: DEFAULT_PROJECT_ID,
          plannedMinutes: 25,
          order: 1,
          completed: false,
          focusSeconds: 0,
          treesCompleted: 0,
          createdAt: "2026-05-21T10:00:00.000Z"
        }
      ],
      activeTodoId: "todo-1"
    });

    expect(settings.todos).toEqual([
      {
        id: "todo-1",
        title: "改 Introduction",
        projectId: "writing",
        plannedMinutes: 36,
        order: 2,
        completed: false,
        focusSeconds: 1500,
        treesCompleted: 1,
        createdAt: "2026-05-21T10:00:00.000Z"
      }
    ]);
    expect(settings.activeTodoId).toBe("todo-1");
  });

  it("recovers todo-era fields from a local fallback when native settings were truncated", () => {
    const merged = mergePersistedSettings(
      {
        projects: [{ id: DEFAULT_PROJECT_ID, name: "未分类", color: "#6aa4ce", archived: false }],
        activeProjectId: DEFAULT_PROJECT_ID,
        forestStats: { days: {} }
      },
      {
        projects: [
          { id: DEFAULT_PROJECT_ID, name: "未分类", color: "#6aa4ce", archived: false },
          { id: "writing", name: "写论文", color: "#f2c862", archived: false }
        ],
        activeProjectId: "writing",
        todos: [
          {
            id: "todo-1",
            title: "论文图表",
            projectId: "writing",
            plannedMinutes: 45,
            order: 0,
            completed: false,
            focusSeconds: 2700,
            treesCompleted: 1,
            createdAt: "2026-05-22T08:00:00.000Z"
          }
        ],
        activeTodoId: "todo-1",
        quickStartPresets: [{ id: "quick-writing", label: "写作", minutes: 45, projectId: "writing", trackForest: true }],
        forestStats: {
          days: {
            "2026-05-22": {
              focusSeconds: 2700,
              treesCompleted: 1,
              projects: {
                writing: { focusSeconds: 2700, treesCompleted: 1 }
              }
            }
          }
        }
      }
    );

    const settings = mergeSettings(merged);

    expect(settings.projects).toHaveLength(2);
    expect(settings.activeProjectId).toBe("writing");
    expect(settings.todos).toHaveLength(1);
    expect(settings.activeTodoId).toBe("todo-1");
    expect(settings.quickStartPresets[0].minutes).toBe(45);
    expect(settings.forestStats.days["2026-05-22"].focusSeconds).toBe(2700);
  });

  it("falls back to no active todo when the persisted active todo is missing or completed", () => {
    const settings = mergeSettings({
      todos: [
        {
          id: "todo-1",
          title: "完成的任务",
          projectId: DEFAULT_PROJECT_ID,
          plannedMinutes: 25,
          order: 1,
          completed: true,
          focusSeconds: 1500,
          treesCompleted: 1,
          createdAt: "2026-05-21T10:00:00.000Z"
        }
      ],
      activeTodoId: "todo-1"
    });

    expect(settings.activeTodoId).toBeNull();
  });

  it("normalizes editable quick starts and falls back on invalid todo time", () => {
    const settings = mergeSettings({
      todos: [
        {
          id: "todo-1",
          title: "短任务",
          projectId: DEFAULT_PROJECT_ID,
          plannedMinutes: 0,
          order: 0,
          completed: false,
          focusSeconds: 0,
          treesCompleted: 0,
          createdAt: "2026-05-21T10:00:00.000Z"
        }
      ],
      quickStartPresets: [{ id: "quick-reading", label: "  阅读  ", minutes: 45.2, projectId: "writing", trackForest: true }]
    });

    expect(settings.todos[0].plannedMinutes).toBe(25);
    expect(settings.quickStartPresets[0]).toMatchObject({
      id: "quick-reading",
      label: "阅读",
      minutes: 45,
      projectId: "writing"
    });
  });

  it("adds default reminder sound and copy for older settings", () => {
    const settings = mergeSettings({
      reminder: { soundEnabled: true }
    });

    expect(settings.reminder.soundName).toBe("Blow");
    expect(settings.reminder.copy.focusStart.title).toBe("专注开始啦 ♡");
    expect(settings.reminder.copy.focusStart.body).toBe("计时已经开始，慢慢来。");
    expect(settings.reminder.copy.focusComplete.title).toBe("宝宝辛苦啦~ ♡");
    expect(settings.reminder.copy.focusComplete.body).toBe("休息一下，喝口水。");
    expect(settings.reminder.copy.restStart.title).toBe("休息开始啦~ ♡");
    expect(settings.reminder.copy.restStart.body).toBe("给大脑充会儿电。");
    expect(settings.reminder.copy.restComplete.title).toBe("休息结束啦~ ♡");
    expect(settings.reminder.copy.restComplete.body).toBe("可以慢慢回到节奏里。");
  });

  it("normalizes reminder sound and empty custom copy", () => {
    const settings = mergeSettings({
      reminder: {
        soundName: "NotARealSound",
        copy: {
          focusStart: { title: "  我的开始  ", body: "" },
          focusComplete: { title: "", body: "  去休息一下  " },
          restStart: { title: "  休息一下  ", body: "  " },
          restComplete: { title: "  ", body: "  " }
        }
      }
    } as unknown as Parameters<typeof mergeSettings>[0]);

    expect(settings.reminder.soundName).toBe("Blow");
    expect(settings.reminder.copy.focusStart.title).toBe("我的开始");
    expect(settings.reminder.copy.focusStart.body).toBe("计时已经开始，慢慢来。");
    expect(settings.reminder.copy.focusComplete.title).toBe("宝宝辛苦啦~ ♡");
    expect(settings.reminder.copy.focusComplete.body).toBe("去休息一下");
    expect(settings.reminder.copy.restStart.title).toBe("休息一下");
    expect(settings.reminder.copy.restStart.body).toBe("给大脑充会儿电。");
    expect(settings.reminder.copy.restComplete.title).toBe("休息结束啦~ ♡");
    expect(settings.reminder.copy.restComplete.body).toBe("可以慢慢回到节奏里。");
  });
});
