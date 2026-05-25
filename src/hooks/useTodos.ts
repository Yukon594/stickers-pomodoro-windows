import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSyncedRef } from "./useSyncedRef";
import { todayKey } from "../lib/stats";
import { DEFAULT_PROJECT_ID } from "../lib/types";
import { activeTodoPlannedSeconds, completeTodo, recordTodoProgress, reorderTodos, treesForQuickStart, updateTodoPlan } from "../lib/todos";
import type { AppSettings, TodoItem } from "../lib/types";
import type { FocusOverride } from "./useTimer";
import type { AppSettingsPatch } from "./useSettings";

export function useTodos(
  settings: AppSettings,
  settingsRef: { current: AppSettings },
  patchSettings: (patch: AppSettingsPatch) => void,
  settingsLoaded: boolean,
  focusOverrideRef: { current: FocusOverride | null },
  setFocusOverride: (value: FocusOverride | null | ((prev: FocusOverride | null) => FocusOverride | null)) => void,
  timerRef: { current: { isRunning: boolean; phase: string; countdownRole: string; isComplete: boolean; secondsLeft: number } },
  setTimer: (value: any) => void
) {
  const [newTodoTitle, setNewTodoTitle] = useState("");
  const [newTodoMinutes, setNewTodoMinutes] = useState(25);
  const [newTodoProjectId, setNewTodoProjectId] = useState(DEFAULT_PROJECT_ID);
  const [draggingTodoId, setDraggingTodoId] = useState<string | null>(null);
  const [todoDragPreview, setTodoDragPreview] = useState<{
    id: string;
    title: string;
    meta: string;
    x: number;
    y: number;
    width: number;
    offsetX: number;
    offsetY: number;
    startX: number;
    startY: number;
  } | null>(null);

  const draggedTodoIdRef = useRef<string | null>(null);
  const pendingTodoDragRef = useRef<{
    id: string;
    title: string;
    meta: string;
    pointerId: number;
    width: number;
    offsetX: number;
    offsetY: number;
    startX: number;
    startY: number;
  } | null>(null);
  const suppressTodoClickRef = useRef(false);

  const activeProjects = useMemo(
    () => settings.projects.filter((p) => !p.archived),
    [settings.projects]
  );
  const activeProject = useMemo(
    () =>
      activeProjects.find((p) => p.id === settings.activeProjectId) ??
      activeProjects.find((p) => p.id === DEFAULT_PROJECT_ID) ??
      settings.projects[0],
    [activeProjects, settings.activeProjectId, settings.projects]
  );
  const activeTodo = useMemo(
    () => settings.todos.find((t) => t.id === settings.activeTodoId && !t.completed) ?? null,
    [settings.activeTodoId, settings.todos]
  );

  useEffect(() => {
    if (!activeProjects.some((p) => p.id === newTodoProjectId)) {
      setNewTodoProjectId(activeProject.id);
    } else if (!newTodoTitle.trim()) {
      setNewTodoProjectId(activeProject.id);
    }
  }, [activeProject.id, activeProjects, newTodoProjectId, newTodoTitle]);

  useEffect(() => {
    if (!settingsLoaded) {
      return;
    }

    const pruneCompletedTodos = () => {
      const today = todayKey();
      patchSettings({
        todos: settingsRef.current.todos.filter(
          (todo) => !todo.completed || todo.completedAt?.startsWith(today)
        )
      });
    };

    pruneCompletedTodos();
    const id = window.setInterval(pruneCompletedTodos, 60_000);
    return () => window.clearInterval(id);
  }, [settingsLoaded]);

  function createTodo(title: string) {
    const trimmed = title.trim().replace(/\s+/g, " ").slice(0, 40);
    if (!trimmed) {
      return;
    }

    const projectId = activeProjects.some((p) => p.id === newTodoProjectId) ? newTodoProjectId : activeProject.id;
    const projectTodos = settingsRef.current.todos.filter((t) => t.projectId === projectId && !t.completed);
    const todo: TodoItem = {
      id: `todo-${Date.now().toString(36)}`,
      title: trimmed,
      projectId,
      plannedMinutes: newTodoMinutes,
      order: projectTodos.length,
      completed: false,
      focusSeconds: 0,
      treesCompleted: 0,
      createdAt: new Date().toISOString()
    };

    patchSettings({ todos: [...settingsRef.current.todos, todo] });
    setNewTodoTitle("");
  }

  function selectTodo(todoId: string) {
    const todo = settingsRef.current.todos.find((item) => item.id === todoId);
    if (!todo) {
      return;
    }

    patchSettings({ activeTodoId: todoId, activeProjectId: todo.projectId });
    const seconds = todo.plannedMinutes * 60;
    setFocusOverride({ seconds, presetId: `todo-${todo.id}`, trackForest: true });
    setTimer((current: any) => ({
      ...current,
      phase: "countdown",
      countdownRole: "focus",
      secondsLeft: current.isRunning ? current.secondsLeft : seconds,
      isComplete: false
    }));
  }

  function clearActiveTodo() {
    patchSettings({ activeTodoId: null });
    setFocusOverride(null);
    setTimer((current: any) => {
      if (current.phase !== "countdown" || current.countdownRole !== "focus" || current.isRunning) {
        return current;
      }
      return { ...current, secondsLeft: current.currentTimerDuration?.(current) ?? current.secondsLeft, isComplete: false };
    });
  }

  function completeSelectedTodo(todoId: string | null = settings.activeTodoId) {
    if (!todoId) {
      return;
    }
    patchSettings({
      todos: completeTodo(settingsRef.current.todos, todoId),
      activeTodoId: settingsRef.current.activeTodoId === todoId ? null : settingsRef.current.activeTodoId
    });
  }

  function deleteTodo(todoId: string) {
    patchSettings({
      todos: settingsRef.current.todos.filter((todo) => todo.id !== todoId),
      activeTodoId: settingsRef.current.activeTodoId === todoId ? null : settingsRef.current.activeTodoId
    });
    if (settingsRef.current.activeTodoId === todoId) {
      setFocusOverride(null);
    }
  }

  function restoreTodo(todoId: string) {
    patchSettings({
      todos: settingsRef.current.todos.map((todo) => {
        if (todo.id !== todoId) return todo;
        const { completedAt: _, ...restoredTodo } = todo;
        return { ...restoredTodo, completed: false, order: settingsRef.current.todos.filter((t) => !t.completed).length };
      })
    });
  }

  function handleTodoPointerDown(todoId: string, event: React.PointerEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    if (target.closest(".todo-check, .todo-main, .todo-plan-controls, .todo-delete, select, input")) {
      return;
    }

    const todo = settingsRef.current.todos.find((item) => item.id === todoId);
    if (!todo || todo.completed) {
      return;
    }

    const project = settingsRef.current.projects.find((item) => item.id === todo.projectId);
    const rect = event.currentTarget.getBoundingClientRect();
    pendingTodoDragRef.current = {
      id: todo.id,
      title: todo.title,
      meta: `${project?.name ?? "未分类"} · ${todo.treesCompleted}棵`,
      pointerId: event.pointerId,
      width: rect.width,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      startX: event.clientX,
      startY: event.clientY
    };
    suppressTodoClickRef.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleTodoPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const pendingDrag = pendingTodoDragRef.current;
    if (!pendingDrag || pendingDrag.pointerId !== event.pointerId) {
      return;
    }

    const hasMovedEnough =
      Math.abs(event.clientX - pendingDrag.startX) > 6 || Math.abs(event.clientY - pendingDrag.startY) > 6;
    if (!draggedTodoIdRef.current && !hasMovedEnough) {
      return;
    }

    if (!draggedTodoIdRef.current) {
      draggedTodoIdRef.current = pendingDrag.id;
      suppressTodoClickRef.current = true;
      setDraggingTodoId(pendingDrag.id);
      setTodoDragPreview({
        id: pendingDrag.id,
        title: pendingDrag.title,
        meta: pendingDrag.meta,
        x: event.clientX - pendingDrag.offsetX,
        y: event.clientY - pendingDrag.offsetY,
        width: pendingDrag.width,
        offsetX: pendingDrag.offsetX,
        offsetY: pendingDrag.offsetY,
        startX: pendingDrag.startX,
        startY: pendingDrag.startY
      });
    }

    const draggedTodoId = draggedTodoIdRef.current;
    setTodoDragPreview((preview) =>
      preview ? { ...preview, x: event.clientX - preview.offsetX, y: event.clientY - preview.offsetY } : preview
    );

    const targetId = todoIdAtPointer(event.clientX, event.clientY, draggedTodoId);
    if (targetId) {
      patchSettings({
        todos: reorderTodos(settingsRef.current.todos, draggedTodoId, targetId, null)
      });
    }
  }

  function handleTodoPointerEnd(event?: React.PointerEvent<HTMLDivElement>) {
    if (
      event &&
      pendingTodoDragRef.current?.pointerId === event.pointerId &&
      event.currentTarget.hasPointerCapture(event.pointerId)
    ) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    pendingTodoDragRef.current = null;
    draggedTodoIdRef.current = null;
    setDraggingTodoId(null);
    setTodoDragPreview(null);
    window.setTimeout(() => {
      suppressTodoClickRef.current = false;
    }, 0);
  }

  function updateTodoMinutes(todoId: string, minutes: number) {
    const safeMinutes = Math.min(180, Math.max(1, Math.round(minutes)));
    patchSettings({
      todos: updateTodoPlan(settingsRef.current.todos, todoId, { plannedMinutes: safeMinutes })
    });
    if (settings.activeTodoId === todoId && !timerRef.current.isRunning) {
      const seconds = safeMinutes * 60;
      setFocusOverride({ seconds, presetId: `todo-${todoId}`, trackForest: true });
      setTimer((current: any) => ({ ...current, secondsLeft: seconds, isComplete: false }));
    }
  }

  function updateTodoProject(todoId: string, projectId: string) {
    if (!activeProjects.some((p) => p.id === projectId)) {
      return;
    }
    patchSettings({
      todos: updateTodoPlan(settingsRef.current.todos, todoId, { projectId }),
      activeProjectId: settingsRef.current.activeTodoId === todoId ? projectId : settingsRef.current.activeProjectId
    });
  }

  function updateTodoTitle(todoId: string, title: string) {
    patchSettings({
      todos: updateTodoPlan(settingsRef.current.todos, todoId, { title })
    });
  }

  return {
    newTodoTitle,
    setNewTodoTitle,
    newTodoMinutes,
    setNewTodoMinutes,
    newTodoProjectId,
    setNewTodoProjectId,
    draggingTodoId,
    todoDragPreview,
    activeTodo,
    suppressTodoClickRef,
    createTodo,
    selectTodo,
    clearActiveTodo,
    completeSelectedTodo,
    deleteTodo,
    restoreTodo,
    handleTodoPointerDown,
    handleTodoPointerMove,
    handleTodoPointerEnd,
    updateTodoMinutes,
    updateTodoProject,
    updateTodoTitle
  };
}

function todoIdAtPointer(clientX: number, clientY: number, draggedTodoId: string | null): string | null {
  const rows = Array.from(document.querySelectorAll<HTMLElement>("[data-todo-id]"));
  for (const row of rows) {
    const todoId = row.dataset.todoId;
    if (!todoId || todoId === draggedTodoId) {
      continue;
    }
    const rect = row.getBoundingClientRect();
    if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) {
      return todoId;
    }
  }
  return null;
}
