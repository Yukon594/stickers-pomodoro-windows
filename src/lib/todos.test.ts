import { describe, expect, it } from "vitest";
import { DEFAULT_PROJECT_ID, type QuickStartPreset, type TodoItem } from "./types";
import { activeTodoPlannedSeconds, TIME_PRESET_MINUTES, completeTodo, recordTodoProgress, reorderTodos, treesForQuickStart, updateTodoPlan } from "./todos";

const baseTodo: TodoItem = {
  id: "todo-1",
  title: "读一章",
  projectId: DEFAULT_PROJECT_ID,
  plannedMinutes: 25,
  order: 0,
  completed: false,
  focusSeconds: 0,
  treesCompleted: 0,
  createdAt: "2026-05-21T10:00:00.000Z"
};

describe("todo helpers", () => {
  it("offers a shared minute list for quick starts and todo planning", () => {
    expect(TIME_PRESET_MINUTES).toEqual([5, 10, 15, 20, 25, 30, 40, 45, 50, 60, 90, 120]);
  });

  it("records focus progress on the active todo without changing other todos", () => {
    const updated = recordTodoProgress([baseTodo, { ...baseTodo, id: "todo-2", title: "写摘要", order: 1 }], "todo-1", 1500, 1);

    expect(updated[0]).toMatchObject({ focusSeconds: 1500, treesCompleted: 1, completed: false });
    expect(updated[1]).toMatchObject({ focusSeconds: 0, treesCompleted: 0, completed: false });
  });

  it("marks a todo as completed with a stable completion timestamp", () => {
    const updated = completeTodo([baseTodo], "todo-1", "2026-05-21T12:00:00.000Z");

    expect(updated[0]).toMatchObject({
      completed: true,
      completedAt: "2026-05-21T12:00:00.000Z"
    });
  });

  it("reorders only incomplete todos inside the selected project", () => {
    const updated = reorderTodos(
      [
        { ...baseTodo, id: "todo-1", title: "A", projectId: "writing", order: 0 },
        { ...baseTodo, id: "todo-2", title: "B", projectId: "writing", order: 1 },
        { ...baseTodo, id: "todo-3", title: "C", projectId: "lab", order: 2 }
      ],
      "todo-2",
      "todo-1",
      "writing"
    );

    expect(updated.find((todo) => todo.id === "todo-2")?.order).toBe(0);
    expect(updated.find((todo) => todo.id === "todo-1")?.order).toBe(1);
    expect(updated.find((todo) => todo.id === "todo-3")?.order).toBe(2);
  });

  it("reorders the visible open todo list across projects", () => {
    const updated = reorderTodos(
      [
        { ...baseTodo, id: "todo-1", title: "A", projectId: "writing", order: 0 },
        { ...baseTodo, id: "todo-2", title: "B", projectId: "lab", order: 1 },
        { ...baseTodo, id: "todo-3", title: "C", projectId: "lab", order: 2 },
        { ...baseTodo, id: "todo-4", title: "D", projectId: "lab", order: 3, completed: true }
      ],
      "todo-1",
      "todo-2",
      null
    );

    expect(updated.find((todo) => todo.id === "todo-2")?.order).toBe(0);
    expect(updated.find((todo) => todo.id === "todo-1")?.order).toBe(1);
    expect(updated.find((todo) => todo.id === "todo-3")?.order).toBe(2);
    expect(updated.find((todo) => todo.id === "todo-4")?.order).toBe(3);
  });

  it("can suppress forest trees for quick starts that should not count toward forest stats", () => {
    const preset: QuickStartPreset = {
      id: "fitness",
      label: "健身",
      minutes: 15,
      projectId: DEFAULT_PROJECT_ID,
      trackForest: false
    };

    expect(treesForQuickStart(preset, 1)).toBe(0);
  });

  it("updates a todo planned time and project without losing progress", () => {
    const updated = updateTodoPlan([{ ...baseTodo, focusSeconds: 900, treesCompleted: 1 }], "todo-1", {
      plannedMinutes: 40,
      projectId: "writing"
    });

    expect(updated[0]).toMatchObject({
      projectId: "writing",
      plannedMinutes: 40,
      focusSeconds: 900,
      treesCompleted: 1
    });
  });

  it("uses the active todo planned minutes for the next focus session", () => {
    expect(activeTodoPlannedSeconds([{ ...baseTodo, plannedMinutes: 5 }], "todo-1")).toBe(300);
    expect(activeTodoPlannedSeconds([{ ...baseTodo, plannedMinutes: 5, completed: true }], "todo-1")).toBeNull();
    expect(activeTodoPlannedSeconds([{ ...baseTodo, plannedMinutes: 5 }], null)).toBeNull();
  });
});
