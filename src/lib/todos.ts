import type { QuickStartPreset, TodoItem } from "./types";

export const TIME_PRESET_MINUTES = [5, 10, 15, 20, 25, 30, 40, 45, 50, 60, 90, 120];

export function recordTodoProgress(todos: TodoItem[], todoId: string | null, focusSeconds: number, treesCompleted: number): TodoItem[] {
  if (!todoId) {
    return todos;
  }

  const safeFocusSeconds = Math.max(0, Math.floor(focusSeconds));
  const safeTreesCompleted = Math.max(0, Math.floor(treesCompleted));

  if (safeFocusSeconds <= 0 && safeTreesCompleted <= 0) {
    return todos;
  }

  return todos.map((todo) =>
    todo.id === todoId && !todo.completed
      ? {
          ...todo,
          focusSeconds: todo.focusSeconds + safeFocusSeconds,
          treesCompleted: todo.treesCompleted + safeTreesCompleted
        }
      : todo
  );
}

export function completeTodo(todos: TodoItem[], todoId: string | null, completedAt = new Date().toISOString()): TodoItem[] {
  if (!todoId) {
    return todos;
  }

  return todos.map((todo) =>
    todo.id === todoId
      ? {
          ...todo,
          completed: true,
          completedAt
        }
      : todo
  );
}

export function reorderTodos(todos: TodoItem[], draggedId: string, targetId: string, projectId: string | null): TodoItem[] {
  if (draggedId === targetId) {
    return todos;
  }

  const projectTodos = todos
    .filter((todo) => !todo.completed && (projectId === null || todo.projectId === projectId))
    .sort((a, b) => a.order - b.order);
  const draggedIndex = projectTodos.findIndex((todo) => todo.id === draggedId);
  const targetIndex = projectTodos.findIndex((todo) => todo.id === targetId);

  if (draggedIndex < 0 || targetIndex < 0) {
    return todos;
  }

  const reordered = [...projectTodos];
  const [dragged] = reordered.splice(draggedIndex, 1);
  reordered.splice(targetIndex, 0, dragged);
  const nextOrderById = new Map(reordered.map((todo, index) => [todo.id, index]));

  return todos.map((todo) => {
    const nextOrder = nextOrderById.get(todo.id);
    return nextOrder === undefined ? todo : { ...todo, order: nextOrder };
  });
}

export function treesForQuickStart(preset: Pick<QuickStartPreset, "trackForest"> | null, treesCompleted: number): number {
  return preset?.trackForest === false ? 0 : Math.max(0, Math.floor(treesCompleted));
}

export function activeTodoPlannedSeconds(todos: TodoItem[], activeTodoId: string | null): number | null {
  const activeTodo = todos.find((todo) => todo.id === activeTodoId && !todo.completed);
  return activeTodo ? Math.max(1, Math.round(activeTodo.plannedMinutes)) * 60 : null;
}

export function updateTodoPlan(
  todos: TodoItem[],
  todoId: string,
  patch: Partial<Pick<TodoItem, "plannedMinutes" | "projectId" | "title">>
): TodoItem[] {
  return todos.map((todo) =>
    todo.id === todoId
      ? {
          ...todo,
          ...("title" in patch && typeof patch.title === "string" ? { title: patch.title.trim().replace(/\s+/g, " ").slice(0, 40) } : {}),
          ...("projectId" in patch && typeof patch.projectId === "string" ? { projectId: patch.projectId } : {}),
          ...("plannedMinutes" in patch && typeof patch.plannedMinutes === "number"
            ? { plannedMinutes: Math.min(180, Math.max(1, Math.round(patch.plannedMinutes))) }
            : {})
        }
      : todo
  );
}
