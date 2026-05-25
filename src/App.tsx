import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode
} from "react";
import { confirm as confirmDialog } from "@tauri-apps/plugin-dialog";
import {
  BarChart3, Check, ChevronDown, Coffee,
  FlipHorizontal, FolderOpen, ImagePlus, Keyboard, ListTodo,
  Maximize2, MessageSquareText, Minus, Pencil, Play, Plus,
  RotateCcw, RotateCw, Settings2, SkipForward, Sprout, Sticker,
  Trash2, Volume2, VolumeX, X
} from "lucide-react";
import { PHASE_LABELS, durationForPhase, formatTime, resolveCorner } from "./lib/timer";
import { extractBackgroundPalette } from "./lib/palette";
import {
  PROJECT_COLORS, DEFAULT_REMINDER_COPY, REMINDER_SOUND_OPTIONS,
  defaultSettings, displayAvatarSrc, isTauriRuntime,
  minimizeMainWindow, playReminderSound, registerStartShortcut,
  saveSettings, showReminderWindow, startMainWindowDrag,
  tickFeedback, updateTrayState
} from "./lib/storage";
import {
  addDailyForestProgress, buildHeatmapWeeks, formatDuration,
  moveDailyForestProjectProgress, summarizeProjectRange, todayKey,
  type HeatmapMetric
} from "./lib/stats";
import {
  activeTodoPlannedSeconds, TIME_PRESET_MINUTES, completeTodo,
  recordTodoProgress, reorderTodos, treesForQuickStart, updateTodoPlan
} from "./lib/todos";
import {
  TREE_STYLE_OPTIONS, buildTrayForestState,
  drawTreePreviewSvg, renderTrayForestIconAsset
} from "./lib/trayForest";
import { playGearTick, disposeAudio } from "./lib/audio";
import { isMacOS, isWindows, shortcutModifierName } from "./lib/platform";
import {
  useSettings,
  type AppSettingsPatch
} from "./hooks/useSettings";
import {
  useTimer,
  type FocusOverride
} from "./hooks/useTimer";
import {
  useProjects
} from "./hooks/useProjects";
import {
  useTodos
} from "./hooks/useTodos";
import {
  useStickers
} from "./hooks/useStickers";
import type {
  AppSettings, AvatarSettings, BackgroundSettings,
  Corner, CornerMode, CountdownRole, Phase,
  ProjectItem, QuickStartPreset, ReminderCopyItem,
  ReminderCopySettings, ReminderSoundName, StickerItem,
  ThemeMode, TodoItem, TimerState, TrayIconDebugInfo, TreeStyle
} from "./lib/types";
import { DEFAULT_PROJECT_ID } from "./lib/types";

const TRAY_DIAGNOSTICS_STORAGE_KEY = "sticker-pomodoro-tray-diagnostics";

const themeOptions: Array<[ThemeMode, string]> = [
  ["cream", "奶油"], ["mint", "薄荷"], ["rose", "樱桃"], ["night", "夜晚"]
];

const reminderCopyFields: Array<{
  kind: keyof ReminderCopySettings;
  label: string;
  titlePlaceholder: string;
  bodyPlaceholder: string;
}> = [
  { kind: "focusStart", label: "专注开始", titlePlaceholder: DEFAULT_REMINDER_COPY.focusStart.title, bodyPlaceholder: DEFAULT_REMINDER_COPY.focusStart.body },
  { kind: "focusComplete", label: "专注结束", titlePlaceholder: DEFAULT_REMINDER_COPY.focusComplete.title, bodyPlaceholder: DEFAULT_REMINDER_COPY.focusComplete.body },
  { kind: "restStart", label: "休息开始", titlePlaceholder: DEFAULT_REMINDER_COPY.restStart.title, bodyPlaceholder: DEFAULT_REMINDER_COPY.restStart.body },
  { kind: "restComplete", label: "休息结束", titlePlaceholder: DEFAULT_REMINDER_COPY.restComplete.title, bodyPlaceholder: DEFAULT_REMINDER_COPY.restComplete.body }
];

function App() {
  const isReminderRoute = window.location.hash.startsWith("#/reminder");
  if (isReminderRoute) return <ReminderPopup />;
  return <PomodoroApp />;
}

function PomodoroApp() {
  // --- Hooks for state management ---
  const { settings, settingsRef, settingsLoaded, patchSettings, avatarSrc } = useSettings();

  const [activeCorner, setActiveCorner] = useState<Corner | null>(null);
  const [celebrating, setCelebrating] = useState(false);
  const [systemDark, setSystemDark] = useState(() => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false);
  const [shortcutStatus, setShortcutStatus] = useState("");
  const [capturingShortcut, setCapturingShortcut] = useState(false);
  const [reminderCopyOpen, setReminderCopyOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [todayOpen, setTodayOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [currentDateKey, setCurrentDateKey] = useState(() => todayKey());

  const lastFeedbackRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const stickerInputRef = useRef<HTMLInputElement>(null);
  const backgroundInputRef = useRef<HTMLInputElement>(null);
  const cardRef = useRef<HTMLElement>(null);
  const lastTimerTickAtRef = useRef<number | null>(null);
  const loadedOnce = useRef(false);

  // --- Core bridge: focus progress ---
  const addFocusProgress = (focusSeconds: number, treesCompleted = 0) => {
    const override = focusOverrideRef.current;
    const trackedTrees = treesForQuickStart(override, treesCompleted);
    const trackForest = override?.trackForest !== false;

    patchSettings({
      todos: recordTodoProgress(settingsRef.current.todos, settingsRef.current.activeTodoId, focusSeconds, trackedTrees),
      forestStats: trackForest
        ? addDailyForestProgress(settingsRef.current.forestStats, focusSeconds, trackedTrees, new Date(), settingsRef.current.activeProjectId)
        : undefined
    });
  };

  // --- Timer hook ---
  const {
    timer, timerRef, focusOverride, focusOverrideRef,
    currentTimerDuration, currentTimerDurationFromRefs,
    setFocusOverride, setTimer,
    toggleTimer: toggleTimerBase, resetTimer, skipPhase, changePhase,
    startRestCountdown, startFocusCountdown, startQuickStart
  } = useTimer({
    settingsRef,
    onTick: (focusSeconds, treesCompleted) => {
      addFocusProgress(focusSeconds, treesCompleted);
    },
    onComplete: (completedFocusSessions, countdownRole) => {
      announceCountdownComplete(completedFocusSessions, countdownRole);
    }
  });

  // --- Projects hook ---
  const {
    projectMenuOpen, setProjectMenuOpen,
    newProjectName, setNewProjectName,
    editingProjectId, editingProjectName, setEditingProjectName, setEditingProjectId,
    colorEditingProjectId, setColorEditingProjectId,
    pendingProjectTransfer, pendingProjectTransferRef,
    activeProjects, activeProject,
    closeProjectMenu, selectProject, createProject, deleteProject: deleteProjectFn,
    beginRenameProject, cancelRenameProject, commitRenameProject, updateProjectColor,
    setPendingProjectTransfer
  } = useProjects(settings, settingsRef, patchSettings);

  // --- Todos hook ---
  const {
    newTodoTitle, setNewTodoTitle,
    newTodoMinutes, setNewTodoMinutes,
    newTodoProjectId, setNewTodoProjectId,
    draggingTodoId, todoDragPreview,
    activeTodo,
    createTodo, selectTodo, clearActiveTodo, completeSelectedTodo,
    deleteTodo, restoreTodo,
    handleTodoPointerDown, handleTodoPointerMove, handleTodoPointerEnd,
    updateTodoMinutes, updateTodoProject, updateTodoTitle
  } = useTodos(
    settings, settingsRef, patchSettings, settingsLoaded,
    focusOverrideRef, setFocusOverride,
    timerRef, setTimer
  );

  // --- Stickers hook ---
  const {
    stickerMode, setStickerMode,
    selectedStickerId,
    addSticker, updateSticker, deleteSelectedSticker,
    rotateSelectedSticker, flipSelectedSticker,
    moveSticker, dragSticker
  } = useStickers(settings, settingsRef, patchSettings);

  // --- Side effects ---
  useEffect(() => {
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!media) return;
    const update = () => setSystemDark(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  // Detect day change so the tray icon resets tree count at midnight
  useEffect(() => {
    const check = () => {
      const key = todayKey();
      setCurrentDateKey((prev) => (prev !== key ? key : prev));
    };
    const id = setInterval(check, 30_000);
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("focus", check);
    };
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let cleanup: Array<() => void> = [];
    import("@tauri-apps/api/event")
      .then(async ({ listen }) => {
        const unlistenToggle = await listen("tray-toggle", () => toggleTimer());
        const unlistenReset = await listen("tray-reset", () => { resetTimer(); });
        const unlistenReminder = await listen<{ action: string }>("reminder-action", (event) => { handleReminderAction(event.payload.action); });
        const unlistenStats = await listen("tray-stats", () => { setStatsOpen(true); });
        const unlistenShortcut = await listen("pomodoro-shortcut-start", () => { startPomodoroShortcut(); });
        cleanup = [unlistenToggle, unlistenReset, unlistenReminder, unlistenStats, unlistenShortcut];
      })
      .catch((error) => console.warn("Tray events unavailable", error));
    return () => cleanup.forEach((unlisten) => unlisten());
  }, []);

  useEffect(() => {
    if (!settingsLoaded) return;
    saveSettings(settings).catch((error) => console.warn("Could not save settings", error));
  }, [settings, settingsLoaded]);

  useEffect(() => {
    if (!settingsLoaded || !isTauriRuntime()) return;
    let disposed = false;
    const shortcut = settings.timer.startShortcut.trim();
    registerStartShortcut(shortcut)
      .then((registeredShortcut) => {
        if (disposed) return;
        setShortcutStatus(registeredShortcut ? `已注册 ${registeredShortcut}` : "快捷键已关闭");
      })
      .catch((error) => {
        if (disposed) return;
        setShortcutStatus("注册失败，可能被系统或其他应用占用");
        console.warn("Could not register shortcut", error);
      });
    return () => { disposed = true; };
  }, [settings.timer.startShortcut, settingsLoaded]);

  useEffect(() => {
    if (!capturingShortcut) return;
    const handleKeyDown = (event: KeyboardEvent) => handleShortcutCapture(event);
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [capturingShortcut]);

  // Tray icon
  useEffect(() => {
    if (!isTauriRuntime()) return;
    let disposed = false;
    const retryTimers: number[] = [];
    const trayState = buildTrayForestState(timer, settings, timer.phase === "countdown" ? currentTimerDuration(timer) : null);
    if (!settings.menuBar.enabled) {
      updateTrayState("", "", [], false).catch((error) => console.warn("Could not hide tray forest", error));
      return;
    }
    renderTrayForestIconAsset(trayState.stage, settings.menuBar.treeStyle, trayState.iconVariant)
      .then(({ iconBytes, debugInfo }) => {
        logTrayDiagnostic("rendered tray forest icon", debugInfo);
        const sendTrayState = () => {
          if (!disposed) {
            updateTrayState(trayState.title, trayState.tooltip, iconBytes, true, debugInfo).catch((error) => console.warn("Could not update tray forest", error));
          }
        };
        sendTrayState();
        for (const delay of [1600, 3200]) retryTimers.push(window.setTimeout(sendTrayState, delay));
      })
      .catch((error) => {
        console.warn("Could not render tray forest icon", error);
        updateTrayState(trayState.title, trayState.tooltip, [], true).catch(() => undefined);
      });
    return () => { disposed = true; retryTimers.forEach((id) => window.clearTimeout(id)); };
  }, [settings.forestStats, settings.menuBar.enabled, settings.menuBar.treeStyle, settings.timer.focusMinutes, settings.timer.restMinutes, focusOverride, timer.phase, timer.countdownRole, timer.secondsLeft, timer.isComplete, currentDateKey]);

  useEffect(() => {
    const handleShortcut = () => startPomodoroShortcut();
    window.addEventListener("pomodoro-shortcut-start", handleShortcut);
    return () => window.removeEventListener("pomodoro-shortcut-start", handleShortcut);
  }, []);

  // --- Timer control functions (bridge between UI and hooks) ---
  function toggleTimer() {
    const { wasRunning, startRole } = toggleTimerBase();
    if (!wasRunning) {
      announceTimerStart("button", startRole);
      minimizeMainWindow().catch((error) => console.warn("Could not minimize main window", error));
    }
  }

  function startPomodoroShortcut() {
    const current = timerRef.current;
    if (current.phase === "countdown" && current.countdownRole === "focus" && current.isRunning && !current.isComplete) return;
    setFocusOverride(null);
    setTimer((ts: TimerState) => ({
      ...ts, phase: "countdown", countdownRole: "focus",
      secondsLeft: ts.phase === "countdown" && ts.countdownRole === "focus" && !ts.isComplete ? ts.secondsLeft : durationForPhase("countdown", settingsRef.current.timer, "focus"),
      isRunning: true, isComplete: false
    }));
    announceTimerStart("shortcut", "focus");
    minimizeMainWindow().catch((error) => console.warn("Could not minimize main window", error));
  }

  function handleReminderAction(action: string) {
    if (action === "start-rest") { startRestCountdown(); announceTimerStart("button", "rest"); }
    else if (action === "start-focus") { startFocusCountdown(); announceTimerStart("button", "focus"); }
    else if (action === "complete-todo") { completeSelectedTodo(settingsRef.current.activeTodoId); }
    else if (action === "add-project") { revealProjectPicker(); }
  }

  async function revealProjectPicker() {
    setProjectMenuOpen(true);
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const window = getCurrentWindow();
      await window.show(); await window.setFocus();
    } catch (error) { console.warn("Could not show project picker", error); }
  }

  async function announceTimerStart(source: "ring" | "button" | "shortcut", role: CountdownRole = "focus") {
    const currentSettings = settingsRef.current;
    const copy = role === "rest" ? currentSettings.reminder.copy.restStart : currentSettings.reminder.copy.focusStart;
    const fallbackCopy = role === "rest" ? DEFAULT_REMINDER_COPY.restStart : DEFAULT_REMINDER_COPY.focusStart;
    const message = resolveReminderText(copy.title, fallbackCopy.title);
    const body = resolveReminderText(copy.body, fallbackCopy.body);
    const corner = resolveCorner(currentSettings.reminder.cornerMode, activeCorner, timerRef.current.completedFocusSessions);
    setActiveCorner(corner);
    try { await showReminderWindow(corner, message, body, 5); }
    catch (error) { console.warn("Start reminder failed", error); }
  }

  async function announceCountdownComplete(completedFocusSessions: number, countdownRole: CountdownRole) {
    const currentSettings = settingsRef.current;
    const corner = resolveCorner(currentSettings.reminder.cornerMode, activeCorner, completedFocusSessions);
    const copy = countdownRole === "focus" ? currentSettings.reminder.copy.focusComplete : currentSettings.reminder.copy.restComplete;
    const fallbackCopy = countdownRole === "focus" ? DEFAULT_REMINDER_COPY.focusComplete : DEFAULT_REMINDER_COPY.restComplete;
    const message = resolveReminderText(copy.title, fallbackCopy.title);
    const body = resolveReminderText(copy.body, fallbackCopy.body);
    setActiveCorner(corner);
    setCelebrating(true);
    window.setTimeout(() => setCelebrating(false), 1100);
    try {
      if (currentSettings.reminder.soundEnabled) playReminderSound(currentSettings.reminder.soundName).catch(() => undefined);
      const isUnclassified = currentSettings.activeProjectId === DEFAULT_PROJECT_ID;
      if (countdownRole === "focus") {
        if (isUnclassified) {
          setPendingProjectTransfer({ date: todayKey(), focusSeconds: currentTimerDurationFromRefs(timerRef.current), treesCompleted: treesForQuickStart(focusOverrideRef.current, 1) });
        } else { setPendingProjectTransfer(null); }
        await showReminderWindow(corner, message, body, currentSettings.reminder.durationSeconds, "下一棵树", "start-focus", "休息一下", "start-rest", true);
      } else {
        await showReminderWindow(corner, message, body, currentSettings.reminder.durationSeconds, "下一棵树", "start-focus", "完成", "done", true);
      }
    } catch (error) { console.warn("Reminder window failed", error); }
  }

  // --- Settings helpers ---
  function changeReminderCorner(corner: CornerMode) { patchSettings({ reminder: { cornerMode: corner } }); previewReminderAtCorner(corner); }
  async function previewReminderAtCorner(corner: Corner) {
    setActiveCorner(corner); setCelebrating(true);
    window.setTimeout(() => setCelebrating(false), 900);
    try { await showReminderWindow(corner, "提醒会在这里出现", "之后的提醒会跟随这个角落。", 4); }
    catch (error) { console.warn("Reminder preview failed", error); }
  }
  function changeReminderSound(soundName: ReminderSoundName) {
    patchSettings({ reminder: { soundName } });
    if (settingsRef.current.reminder.soundEnabled) playReminderSound(soundName).catch(() => undefined);
  }
  function updateReminderCopy(kind: keyof ReminderCopySettings, patch: Partial<ReminderCopyItem>) {
    patchSettings({ reminder: { copy: { ...settings.reminder.copy, [kind]: { ...settings.reminder.copy[kind], ...patch } } } });
  }
  function resolveReminderText(value: string, fallback: string) { return value.trim() || fallback; }

  // --- File handlers ---
  function pickAvatar() { fileInputRef.current?.click(); }
  function pickSticker() { stickerInputRef.current?.click(); }
  function pickBackground() { backgroundInputRef.current?.click(); }
  function handleBrowserAvatar(file: File | undefined) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { patchSettings({ avatar: { src: String(reader.result), kind: "data-url" } }); };
    reader.readAsDataURL(file);
  }
  function handleBackgroundUpload(file: File | undefined) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const src = String(reader.result);
      patchSettings({ background: { src, kind: "data-url", palette: null } });
      extractBackgroundPalette(src).then((palette) => { patchSettings({ background: { palette } }); }).catch((error) => console.warn("Could not match background palette", error));
    };
    reader.readAsDataURL(file);
  }
  function clearBackground() { patchSettings({ background: { src: null, kind: "none", palette: null } }); }
  function handleStickerUpload(file: File | undefined) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { addSticker(String(reader.result)); };
    reader.readAsDataURL(file);
  }

  // --- Keyboard shortcut ---
  function handleShortcutCapture(event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey" | "preventDefault" | "stopPropagation">) {
    if (!capturingShortcut) return;
    event.preventDefault(); event.stopPropagation();
    if (event.key === "Escape") { setCapturingShortcut(false); return; }
    if (event.key === "Backspace" || event.key === "Delete") { patchSettings({ timer: { startShortcut: "" } }); setCapturingShortcut(false); return; }
    const shortcut = normalizeShortcut(event);
    if (!shortcut) return;
    patchSettings({ timer: { startShortcut: shortcut } });
    setCapturingShortcut(false);
  }
  function handleShortcutKey(event: React.KeyboardEvent<HTMLButtonElement>) { handleShortcutCapture(event); }
  function adjustmentFeedback() {
    const now = performance.now();
    if (now - lastFeedbackRef.current < 48) return;
    lastFeedbackRef.current = now;
    if (settings.reminder.soundEnabled) playGearTick();
    tickFeedback().catch(() => undefined);
  }

  // --- Window controls ---
  async function handleWindowControl(action: "close" | "minimize" | "zoom") {
    if (!isTauriRuntime()) return;
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const window = getCurrentWindow();
    if (action === "close") await window.hide();
    else if (action === "minimize") await window.minimize();
    else await window.toggleMaximize();
  }
  function dragWindow(event: MouseEvent<HTMLElement>) {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    const current = event.currentTarget as HTMLElement;
    if (current.classList.contains("timer-card") && target !== current) return;
    if (target.closest("button, input, label, a, select, textarea, .settings-panel, .project-popover, .project-backdrop, .stage-row, .controls, .sticker-layer, .sticker-dock, .window-controls")) return;
    startMainWindowDrag().catch(() => undefined);
  }
  function handleDialKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    toggleTimer();
  }

  // --- Quick start ---
  function handleQuickStart(preset: QuickStartPreset) {
    const seconds = Math.max(1, Math.round(preset.minutes)) * 60;
    patchSettings({
      projects: ensureQuickStartProject(preset, settingsRef.current),
      activeProjectId: preset.projectId,
      activeTodoId: settings.activeTodoId && settings.todos.some(t => t.id === settings.activeTodoId && t.projectId === preset.projectId && !t.completed) ? settings.activeTodoId : null
    });
    setFocusOverride({ seconds, presetId: preset.id, trackForest: preset.trackForest });
    setTimer((current: TimerState) => ({ ...current, phase: "countdown", countdownRole: "focus", secondsLeft: seconds, isRunning: true, isComplete: false }));
    setTodayOpen(false); setProjectMenuOpen(false);
    announceTimerStart("button", "focus");
    minimizeMainWindow().catch(() => undefined);
  }
  function updateQuickStartPreset(presetId: string, patch: Partial<Pick<QuickStartPreset, "label" | "minutes" | "projectId">>) {
    patchSettings({
      quickStartPresets: settings.quickStartPresets.map((preset) =>
        preset.id === presetId ? {
          ...preset,
          label: typeof patch.label === "string" ? patch.label.trim().replace(/\s+/g, " ").slice(0, 8) || preset.label : preset.label,
          minutes: typeof patch.minutes === "number" && Number.isFinite(patch.minutes) ? Math.min(180, Math.max(1, Math.round(patch.minutes))) : preset.minutes,
          projectId: typeof patch.projectId === "string" && settings.projects.some((p) => p.id === patch.projectId && !p.archived) ? patch.projectId : preset.projectId
        } : preset
      )
    });
  }

  // --- Computed values ---
  const resolvedTheme = settings.theme.followSystem && systemDark ? "night" : settings.theme.mode;
  const hasCustomBackground = settings.background.kind === "data-url" && Boolean(settings.background.src);
  const activeBackgroundPalette = hasCustomBackground && settings.background.autoMatch ? settings.background.palette : null;
  const shellStyle = useMemo(() => {
    if (!hasCustomBackground || !settings.background.src) return undefined;
    const style = { "--user-bg-image": `url("${settings.background.src}")`, "--user-bg-fit": settings.background.fit, "--background-image-opacity": `${settings.background.opacity / 100}` } as CSSProperties;
    if (activeBackgroundPalette) Object.assign(style, { "--accent": activeBackgroundPalette.accent, "--accent-soft": activeBackgroundPalette.accentSoft, "--ink": activeBackgroundPalette.ink, "--line": activeBackgroundPalette.line, "--card-bg": activeBackgroundPalette.cardBg, "--panel-bg": activeBackgroundPalette.panelBg, "--control-bg": activeBackgroundPalette.controlBg, "--background-overlay": activeBackgroundPalette.overlay, "--shadow": activeBackgroundPalette.shadow });
    return style;
  }, [activeBackgroundPalette, hasCustomBackground, settings.background.fit, settings.background.opacity, settings.background.src]);
  const totalSeconds = currentTimerDuration(timer);
  const countupCycleSeconds = Math.max(60, settings.timer.focusMinutes * 60);
  const progress = timer.phase === "countup" ? (timer.secondsLeft % countupCycleSeconds) / countupCycleSeconds : timer.isComplete ? 1 : totalSeconds > 0 ? 1 - timer.secondsLeft / totalSeconds : 0;
  const progressDegrees = Math.round(progress * 360);
  const timerModeLabel = timerDisplayLabel(timer);

  // --- Render ---
  return (
    <main className={`shell theme-${resolvedTheme} ${settings.theme.followSystem ? "theme-follow-system" : "theme-fixed"} ${hasCustomBackground ? "has-custom-background" : ""} ${activeBackgroundPalette ? "auto-matched-background" : ""} ${isWindows() ? "platform-win" : ""}`} style={shellStyle}>
      <div className="window-drag-region" onMouseDown={dragWindow} data-tauri-drag-region aria-hidden="true" />
      <section className={`timer-card ${stickerMode ? "sticker-mode" : ""}`} ref={cardRef} onMouseDown={dragWindow}>
        {/* Window controls */}
        <div className={isMacOS() ? "window-controls" : "window-controls win-controls"} aria-label="窗口控制">
          <button className="window-dot close-dot" type="button" onClick={() => handleWindowControl("close")} aria-label="关闭窗口"><X size={9} /></button>
          <button className="window-dot min-dot" type="button" onClick={() => handleWindowControl("minimize")} aria-label="最小化"><Minus size={9} /></button>
          <button className="window-dot zoom-dot" type="button" onClick={() => handleWindowControl("zoom")} aria-label="缩放窗口"><Maximize2 size={8} /></button>
        </div>

        {/* Sticker layer */}
        <div className="sticker-layer" aria-label="背景贴纸">
          {settings.stickers.map((sticker) => (
            <button key={sticker.id} className={sticker.id === selectedStickerId ? "board-sticker selected" : "board-sticker"} type="button" aria-label="移动贴纸"
              onPointerDown={(e) => moveSticker(e, sticker)} onPointerMove={(e) => dragSticker(e, sticker, cardRef)}
              onPointerUp={(e) => e.currentTarget.releasePointerCapture(e.pointerId)} onPointerCancel={(e) => e.currentTarget.releasePointerCapture(e.pointerId)}
              style={{ left: `${sticker.x}%`, top: `${sticker.y}%`, width: `${sticker.size}px`, "--sticker-rotate": `${sticker.rotation}deg`, "--sticker-flip": sticker.flipped ? -1 : 1 } as React.CSSProperties}>
              <img src={sticker.src} alt="" draggable={false} />
            </button>
          ))}
        </div>

        {/* Top bar */}
        <header className="topbar" onMouseDown={dragWindow}>
          <button className="toolbar-avatar" type="button" onClick={pickAvatar} aria-label="上传小人头像">
            {avatarSrc ? <img src={avatarSrc} alt="你的小人头像" /> : <DefaultAvatar />}
          </button>
          <div className="topbar-actions">
            <button className="icon-button today-button" type="button" aria-label="打开今日待办" onClick={() => { setProjectMenuOpen(false); setStatsOpen(false); setNewTodoProjectId(activeProject.id); setTodayOpen((open) => !open); }}><ListTodo size={19} /><span>今日</span></button>
            <button className="icon-button stats-button" type="button" aria-label="打开统计" onClick={() => { setProjectMenuOpen(false); setStatsOpen((open) => !open); }}><BarChart3 size={20} /><span>统计</span></button>
            <button className="icon-button" type="button" aria-label="打开设置" onClick={() => { setProjectMenuOpen(false); setSettingsOpen((open) => !open); }}><Settings2 size={20} /></button>
          </div>
        </header>

        {/* Stage row */}
        <div className="stage-row timer-mode-row" role="tablist" aria-label="计时模式">
          {(["countdown", "countup"] as Phase[]).map((phase) => (
            <button key={phase} className={phase === timer.phase ? `stage active ${phase}` : "stage"} type="button" onClick={() => changePhase(phase)}>{PHASE_LABELS[phase]}</button>
          ))}
        </div>

        {/* Hero / Dial */}
        <section className={`hero ${timer.phase} ${timer.countdownRole} ${celebrating ? "celebrate" : ""}`}>
          <div className={`dial-wrap timer-trigger ${timer.isRunning ? "running" : ""}`} role="button" tabIndex={0}
            aria-label={`${timer.isRunning ? "暂停" : "开始"}${timerModeLabel}`}
            onClick={() => toggleTimer()} onKeyDown={handleDialKeyDown}
            style={{ "--progress": `${progressDegrees}deg` } as React.CSSProperties}>
            <div className={`dial ${activeTodo ? "has-active-todo" : ""}`}>
              <div className="project-zone" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
                <button className="project-chip" type="button" aria-expanded={projectMenuOpen} aria-label={`当前项目：${activeProject.name}`}
                  onClick={() => (projectMenuOpen ? closeProjectMenu() : setProjectMenuOpen(true))}>
                  <span className="project-dot" style={{ "--project-color": activeProject.color } as React.CSSProperties} />
                  <FolderOpen size={15} /><span>{activeProject.name}</span><ChevronDown size={14} />
                </button>
                {activeTodo ? (
                  <span className="active-todo-wrap">
                    <span className="active-todo-pill">{activeTodo.title}</span>
                    <button className="active-todo-clear" type="button" aria-label={`取消当前任务：${activeTodo.title}`}
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); clearActiveTodo(); }}
                      onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()}
                      onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}><X size={10} /></button>
                  </span>
                ) : null}
              </div>
              <span className="timer-state-hint">{timerStateHint(timer)}</span>
              <strong>{formatTime(timer.secondsLeft)}</strong>
            </div>
          </div>

          {/* Project picker popover */}
          {projectMenuOpen ? (
            <div className="project-backdrop" role="presentation" onClick={closeProjectMenu}>
              <div className="project-popover" role="dialog" aria-label="选择项目" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
                <div className="project-popover-head">
                  <span>{pendingProjectTransfer ? "添加至项目" : "当前项目"}</span>
                  <button type="button" onClick={closeProjectMenu} aria-label="关闭项目选择"><X size={15} /></button>
                </div>
                <div className="project-list" role="listbox" aria-label="项目列表">
                  {activeProjects.map((project) => {
                    const isActive = project.id === activeProject.id;
                    const isEditing = editingProjectId === project.id;
                    if (isEditing) {
                      return (
                        <form key={project.id} className="project-option project-rename active" onSubmit={(e) => { e.preventDefault(); commitRenameProject(project.id); }}>
                          <span className="project-dot" style={{ "--project-color": project.color } as React.CSSProperties} />
                          <input value={editingProjectName} maxLength={12} autoFocus onChange={(e) => setEditingProjectName(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Escape") { cancelRenameProject(); } }} aria-label="项目新名称" />
                          <button type="submit" aria-label="保存项目名称"><Check size={14} /></button>
                          <button type="button" onClick={cancelRenameProject} aria-label="取消改名"><X size={14} /></button>
                        </form>
                      );
                    }
                    return (
                      <Fragment key={project.id}>
                        <div className={isActive ? "project-option active" : "project-option"} role="option" aria-selected={isActive}>
                          <button className="project-color-trigger" type="button"
                            onClick={() => setColorEditingProjectId((c) => c === project.id ? null : project.id)}
                            aria-label={`修改${project.name}颜色`} aria-expanded={colorEditingProjectId === project.id}>
                            <span className="project-dot" style={{ "--project-color": project.color } as React.CSSProperties} />
                          </button>
                          <button className="project-select-button" type="button" onClick={() => selectProject(project.id)}><span>{project.name}</span></button>
                          {isActive ? <Check size={15} /> : <span aria-hidden="true" />}
                          {project.id === DEFAULT_PROJECT_ID ? <span aria-hidden="true" /> : (
                            <button className="project-icon-button" type="button" onClick={() => beginRenameProject(project)} aria-label={`改名${project.name}`}><Pencil size={13} /></button>
                          )}
                        </div>
                        {colorEditingProjectId === project.id ? (
                          <div className="project-color-palette" role="group" aria-label={`${project.name}颜色`}>
                            {PROJECT_COLORS.map((color) => (
                              <button key={color} className={project.color.toLowerCase() === color.toLowerCase() ? "active" : ""} type="button"
                                onClick={() => updateProjectColor(project.id, color)} aria-label={`选择颜色${color}`}>
                                <span className="project-dot" style={{ "--project-color": color } as React.CSSProperties} />
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </div>
                <form className="project-create" onSubmit={(e) => { e.preventDefault(); createProject(newProjectName); setNewProjectName(""); }}>
                  <input value={newProjectName} maxLength={12} onChange={(e) => setNewProjectName(e.target.value)} placeholder="新项目" aria-label="新项目名称" />
                  <button type="submit" aria-label="添加项目"><Plus size={16} /></button>
                </form>
              </div>
            </div>
          ) : null}

          {/* Timer controls */}
          <div className="controls" aria-label="计时控制">
            <button className="round-button ghost" type="button" onClick={resetTimer} aria-label="重置"><RotateCcw size={24} /></button>
            <button className="round-button ghost" type="button" onClick={skipPhase} aria-label="跳过"><SkipForward size={24} /></button>
          </div>
        </section>

        {/* Sticker dock */}
        {stickerMode ? (
          <div className="sticker-dock" aria-label="贴纸布置工具">
            <button className="dock-button" type="button" onClick={pickSticker} aria-label="上传贴纸"><ImagePlus size={18} /></button>
            <button className="dock-button" type="button" onClick={rotateSelectedSticker} disabled={!selectedStickerId} aria-label="旋转贴纸"><RotateCw size={18} /></button>
            <button className="dock-button" type="button" onClick={flipSelectedSticker} disabled={!selectedStickerId} aria-label="水平翻转贴纸"><FlipHorizontal size={18} /></button>
            <button className="dock-button danger" type="button" onClick={deleteSelectedSticker} disabled={!selectedStickerId} aria-label="删除贴纸"><Trash2 size={18} /></button>
            <button className="dock-button done" type="button" onClick={() => setStickerMode(false)} aria-label="完成布置"><Check size={18} /></button>
          </div>
        ) : null}
      </section>

      {/* Panels */}
      {statsOpen ? <StatsPanel settings={settings} onClose={() => setStatsOpen(false)} /> : null}
      {todayOpen ? (
        <TodayDrawer settings={settings} activeTodo={activeTodo} draggingTodoId={draggingTodoId} todoDragPreview={todoDragPreview}
          newTodoTitle={newTodoTitle} newTodoMinutes={newTodoMinutes} newTodoProjectId={newTodoProjectId}
          onNewTodoTitleChange={setNewTodoTitle} onNewTodoMinutesChange={setNewTodoMinutes} onNewTodoProjectChange={setNewTodoProjectId}
          onCreateTodo={(e: FormEvent) => { e.preventDefault(); createTodo(newTodoTitle); }}
          onSelectTodo={selectTodo} onCompleteTodo={completeSelectedTodo} onDeleteTodo={deleteTodo} onRestoreTodo={restoreTodo}
          onUpdateTodoTitle={updateTodoTitle} onUpdateTodoMinutes={updateTodoMinutes} onUpdateTodoProject={updateTodoProject}
          onQuickStart={handleQuickStart} onUpdateQuickStart={updateQuickStartPreset}
          onTodoPointerDown={handleTodoPointerDown} onTodoPointerMove={handleTodoPointerMove} onTodoPointerEnd={handleTodoPointerEnd}
          onClose={() => setTodayOpen(false)} />
      ) : null}
      {settingsOpen ? (
        <div className="settings-backdrop" role="presentation" onMouseDown={() => setSettingsOpen(false)}>
          <aside className="settings-panel" aria-label="设置" onMouseDown={(e) => e.stopPropagation()}>
            <div className="panel-title">
              <div className="settings-brand" aria-label="贴纸番茄钟"><span className="settings-brand-icon" aria-hidden="true"><Sprout size={19} /></span><strong>贴纸番茄钟</strong></div>
              <button className="icon-button small" type="button" aria-label="关闭设置" onClick={() => setSettingsOpen(false)}><X size={18} /></button>
            </div>

            <SettingsSlider label="专注时间" value={settings.timer.focusMinutes} min={1} max={60} onChange={(fm) => { patchSettings({ timer: { focusMinutes: fm } }); adjustmentFeedback(); if (timer.phase === "countdown" && timer.countdownRole === "focus" && !timer.isRunning) { setTimer((c: TimerState) => ({ ...c, secondsLeft: durationForPhase("countdown", { ...settings.timer, focusMinutes: fm }, "focus"), isComplete: false })); } }} />
            <SettingsSlider label="休息时间" value={settings.timer.restMinutes} min={1} max={30} onChange={(rm) => { patchSettings({ timer: { restMinutes: rm } }); adjustmentFeedback(); if (timer.phase === "countdown" && timer.countdownRole === "rest" && !timer.isRunning) { setTimer((c: TimerState) => ({ ...c, secondsLeft: durationForPhase("countdown", { ...settings.timer, restMinutes: rm }, "rest"), isComplete: false })); } }} />

            {/* Project management */}
            <div className="settings-section core-settings-section">
              <span className="section-kicker">项目管理</span>
              <div className="project-manage-list" aria-label="项目管理列表">
                {activeProjects.map((project) => (
                  <div key={project.id} className="project-manage-row">
                    <span className="project-dot" style={{ "--project-color": project.color } as React.CSSProperties} />
                    {editingProjectId === project.id ? (
                      <input value={editingProjectName} maxLength={12} autoFocus onChange={(e) => setEditingProjectName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") commitRenameProject(project.id); else if (e.key === "Escape") setEditingProjectId(null); }} aria-label="项目新名称" />
                    ) : <span>{project.name}</span>}
                    {project.id === DEFAULT_PROJECT_ID ? <small>默认</small> : editingProjectId === project.id ? (
                      <><button type="button" onClick={() => commitRenameProject(project.id)} aria-label="保存项目名称"><Check size={14} /></button>
                        <button type="button" onClick={() => setEditingProjectId(null)} aria-label="取消改名"><X size={14} /></button></>
                    ) : (
                      <><button type="button" onClick={() => beginRenameProject(project)}>改名</button>
                        <button className="danger" type="button" onClick={async () => {
                          const name = project.name;
                          let confirmed = false;
                          if (isTauriRuntime()) {
                            try { confirmed = await confirmDialog(`确定删除"${name}"吗？`, { title: "删除项目", kind: "warning", okLabel: "删除", cancelLabel: "取消" }); } catch { return; }
                          } else { confirmed = window.confirm(`确定删除"${name}"吗？`); }
                          if (confirmed) deleteProjectFn(project.id);
                        }} aria-label={`删除${project.name}`}><Trash2 size={14} /></button></>
                    )}
                  </div>
                ))}
              </div>
              <p className="settings-note">项目会影响今日任务、{isMacOS() ? "菜单栏小树" : "系统托盘小树"}和森林统计；删除前会再次确认。</p>
            </div>

            {/* Theme */}
            <div className="settings-section"><span className="section-kicker">外观主题</span>
              <div className="segmented theme-grid" aria-label="外观主题">
                {themeOptions.map(([mode, label]) => <button key={mode} className={settings.theme.mode === mode ? "active" : ""} type="button" onClick={() => patchSettings({ theme: { mode } })}>{label}</button>)}
              </div>
            </div>
            <SettingsToggle label="跟随系统外观" checked={settings.theme.followSystem} onChange={(checked) => patchSettings({ theme: { followSystem: checked } })} />

            {/* Background */}
            <div className="settings-section"><span className="section-kicker">自定义背景</span>
              {hasCustomBackground && settings.background.src ? (
                <div className="background-preview-card"><span className="background-preview" aria-hidden="true" style={{ backgroundImage: `url("${settings.background.src}")` }} /><div><strong>{settings.background.autoMatch ? "已自动匹配界面" : "使用当前主题色"}</strong><small>{settings.background.fit === "cover" ? "铺满窗口" : "完整显示"}</small></div><button type="button" onClick={clearBackground} aria-label="清除自定义背景"><Trash2 size={15} /></button></div>
              ) : <button className="background-empty-card" type="button" onClick={pickBackground}><ImagePlus size={18} /><span>上传一张背景图</span></button>}
              <div className="background-actions">
                <button className="wide-action secondary compact" type="button" onClick={pickBackground}><ImagePlus size={17} />{hasCustomBackground ? "更换背景" : "选择背景"}</button>
                <div className="segmented background-fit" aria-label="背景显示方式">
                  {[["cover", "铺满"], ["contain", "完整"]].map(([fit, label]) => <button key={fit} className={settings.background.fit === fit ? "active" : ""} type="button" onClick={() => patchSettings({ background: { fit: fit as BackgroundSettings["fit"] } })}>{label}</button>)}
                </div>
              </div>
              {hasCustomBackground ? <SettingsSlider label="背景透出" value={settings.background.opacity} min={20} max={100} suffix="%" showTicks={false} onChange={(o) => patchSettings({ background: { opacity: o } })} /> : null}
              <SettingsToggle label="自动匹配背景色" checked={settings.background.autoMatch} onChange={(checked) => patchSettings({ background: { autoMatch: checked } })} />
              <p className="settings-note">图片只保存在本机设置里，匹配会优先保证计时、今日任务和按钮可读。</p>
            </div>

            {/* Menu bar */}
            <div className="settings-section"><span className="section-kicker">{isMacOS() ? "菜单栏" : "系统托盘"}</span>
              <SettingsToggle label={isMacOS() ? "显示在菜单栏" : "显示在系统托盘"} checked={settings.menuBar.enabled} onChange={(checked) => patchSettings({ menuBar: { enabled: checked } })} />
              <div className="tree-style-grid" aria-label="菜单栏树样式">
                {TREE_STYLE_OPTIONS.map((option) => (
                  <button key={option.value} className={settings.menuBar.treeStyle === option.value ? "tree-style active" : "tree-style"} type="button" onClick={() => patchSettings({ menuBar: { treeStyle: option.value } })}>
                    <span className="tree-style-preview" dangerouslySetInnerHTML={{ __html: drawTreePreviewSvg(4, option.value) }} /><span>{option.label}</span>
                  </button>
                ))}
              </div>
              <p className="settings-note">{isMacOS() ? "位置由 macOS 管理，可按住 Command 拖动图标。" : "图标位于任务栏通知区域，需展开托盘查看。"}</p>
            </div>

            {/* Reminder settings */}
            <div className="settings-section"><span className="section-kicker">提醒位置</span>
              <div className="segmented" aria-label="提醒模式">
                {[["top-left", "左上"], ["top-center", "上中"], ["top-right", "右上"]].map(([mode, label]) => <button key={mode} className={settings.reminder.cornerMode === mode ? "active" : ""} type="button" onClick={() => changeReminderCorner(mode as CornerMode)}>{label}</button>)}
              </div>
            </div>
            <div className="settings-section"><span className="section-kicker">快捷键</span>
              <button className={capturingShortcut ? "shortcut-capture active" : "shortcut-capture"} type="button" onClick={() => setCapturingShortcut(true)} onKeyDown={handleShortcutKey}>
                <Keyboard size={17} /><span>{capturingShortcut ? "按下新的组合键" : settings.timer.startShortcut || "未设置"}</span>
              </button>
              <p className="settings-note">默认 Control + {shortcutModifierName()} + P，可在后台直接开始或恢复番茄。{shortcutStatus ? ` ${shortcutStatus}` : ""}</p>
            </div>
            <SettingsToggle label={<>{settings.reminder.soundEnabled ? <Volume2 size={18} /> : <VolumeX size={18} />}声音提醒</>} checked={settings.reminder.soundEnabled} onChange={(checked) => patchSettings({ reminder: { soundEnabled: checked } })} />
            {settings.reminder.soundEnabled ? (
              <div className="settings-section sound-section"><span className="section-kicker">提醒声音</span>
                <select className="sound-select" value={settings.reminder.soundName} onChange={(e) => changeReminderSound(e.target.value as ReminderSoundName)} aria-label="提醒声音">
                  {REMINDER_SOUND_OPTIONS.map((sn) => <option key={sn} value={sn}>{sn}</option>)}
                </select>
              </div>
            ) : null}
            <button className="wide-action secondary" type="button" onClick={() => setReminderCopyOpen((open) => !open)} aria-expanded={reminderCopyOpen}><MessageSquareText size={18} />设置提醒文案</button>
            {reminderCopyOpen ? (
              <div className="settings-section reminder-copy-panel" aria-label="提醒文案设置">
                {reminderCopyFields.map((field) => {
                  const copy = settings.reminder.copy[field.kind];
                  return (
                    <div className="copy-field" key={field.kind}><span className="section-kicker">{field.label}</span>
                      <div className="copy-toast-preview">
                        <div className="copy-toast-avatar">{avatarSrc ? <img src={avatarSrc} alt="" /> : <DefaultAvatar />}</div>
                        <div className="copy-toast-fields">
                          <input className="copy-title-input" value={copy.title} maxLength={36} placeholder={field.titlePlaceholder} onChange={(e) => updateReminderCopy(field.kind, { title: e.target.value })} aria-label={`${field.label}标题`} />
                          <input className="copy-body-input" value={copy.body} maxLength={56} placeholder={field.bodyPlaceholder} onChange={(e) => updateReminderCopy(field.kind, { body: e.target.value })} aria-label={`${field.label}正文`} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}
            <button className="wide-action" type="button" onClick={pickAvatar}><ImagePlus size={18} />上传小人头像</button>
            <button className="wide-action secondary" type="button" onClick={() => { setSettingsOpen(false); setStickerMode(true); window.setTimeout(pickSticker, 120); }}><Sticker size={18} />布置背景贴纸</button>
          </aside>
        </div>
      ) : null}

      {/* Hidden file inputs */}
      <input ref={fileInputRef} className="hidden-input" type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(e) => handleBrowserAvatar(e.target.files?.[0])} />
      <input ref={stickerInputRef} className="hidden-input" type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(e) => { handleStickerUpload(e.target.files?.[0]); e.target.value = ""; }} />
      <input ref={backgroundInputRef} className="hidden-input" type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(e) => { handleBackgroundUpload(e.target.files?.[0]); e.target.value = ""; }} />
    </main>
  );
}

// --- Helper components (kept from original, with minor interface adjustments) ---

function timerStateHint(timer: TimerState) {
  if (timer.isComplete) return "完成";
  if (timer.phase === "countup") return "正计时";
  return timer.countdownRole === "rest" ? "休息中" : "专注中";
}

function timerDisplayLabel(timer: TimerState) {
  if (timer.isComplete) return "完成";
  if (timer.phase === "countup") return PHASE_LABELS.countup;
  return timer.countdownRole === "rest" ? "休息" : PHASE_LABELS.countdown;
}

function ensureQuickStartProject(preset: QuickStartPreset, current: AppSettings): AppSettings["projects"] {
  if (preset.projectId === DEFAULT_PROJECT_ID || current.projects.some((p) => p.id === preset.projectId && !p.archived)) return current.projects;
  if (current.projects.some((p) => p.id === preset.projectId && p.archived))
    return current.projects.map((p) => (p.id === preset.projectId ? { ...p, archived: false } : p));
  return [...current.projects, { id: preset.projectId, name: preset.label, color: PROJECT_COLORS[current.projects.length % PROJECT_COLORS.length], archived: false }];
}

// --- Sub-components ---

function SettingsToggle({ label, checked, onChange }: { label: ReactNode; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="toggle-row">
      <span className="toggle-label">{label}</span>
      <span className={checked ? "toggle-control checked" : "toggle-control"}>
        <input className="toggle-input" type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="toggle-indicator" aria-hidden="true">
          <svg className="toggle-mark-icon" viewBox="0 0 14 14" focusable="false" aria-hidden="true"><path d="M3.2 7.2 5.8 9.8 10.9 4.2" /></svg>
        </span>
      </span>
    </label>
  );
}

function TodayDrawer({ settings, activeTodo, draggingTodoId, todoDragPreview, newTodoTitle, newTodoMinutes, newTodoProjectId, onNewTodoTitleChange, onNewTodoMinutesChange, onNewTodoProjectChange, onCreateTodo, onSelectTodo, onCompleteTodo, onDeleteTodo, onRestoreTodo, onUpdateTodoTitle, onUpdateTodoMinutes, onUpdateTodoProject, onQuickStart, onUpdateQuickStart, onTodoPointerDown, onTodoPointerMove, onTodoPointerEnd, onClose }: {
  settings: AppSettings; activeTodo: TodoItem | null; draggingTodoId: string | null; todoDragPreview: any;
  newTodoTitle: string; newTodoMinutes: number; newTodoProjectId: string;
  onNewTodoTitleChange: (v: string) => void; onNewTodoMinutesChange: (v: number) => void; onNewTodoProjectChange: (v: string) => void;
  onCreateTodo: (e: FormEvent<HTMLFormElement>) => void; onSelectTodo: (id: string) => void; onCompleteTodo: (id: string) => void;
  onDeleteTodo: (id: string) => void; onRestoreTodo: (id: string) => void;
  onUpdateTodoTitle: (id: string, title: string) => void; onUpdateTodoMinutes: (id: string, m: number) => void; onUpdateTodoProject: (id: string, pid: string) => void;
  onQuickStart: (preset: QuickStartPreset) => void; onUpdateQuickStart: (id: string, patch: Partial<Pick<QuickStartPreset, "label" | "minutes" | "projectId">>) => void;
  onTodoPointerDown: (id: string, e: PointerEvent<HTMLDivElement>) => void; onTodoPointerMove: (e: PointerEvent<HTMLDivElement>) => void; onTodoPointerEnd: (e: PointerEvent<HTMLDivElement>) => void;
  onClose: () => void;
}) {
  const [editingPresetId, setEditingPresetId] = useState<string | null>(null);
  const [presetDraftLabel, setPresetDraftLabel] = useState("");
  const [presetDraftMinutes, setPresetDraftMinutes] = useState(25);
  const [presetDraftProjectId, setPresetDraftProjectId] = useState(DEFAULT_PROJECT_ID);
  const projects = settings.projects.filter((p) => !p.archived);
  const openTodos = settings.todos.filter((t) => !t.completed).sort((a, b) => a.order - b.order);
  const completedToday = settings.todos.filter((t) => t.completedAt?.startsWith(todayKey()));
  const todayFocusSeconds = settings.todos.reduce((total, t) => total + t.focusSeconds, 0);

  return (
    <div className="today-backdrop" role="presentation" onMouseDown={onClose}>
      <aside className="today-drawer" aria-label="今日待办" onMouseDown={(e) => e.stopPropagation()}>
        <div className="today-head">
          <div><span className="section-kicker">今日</span><strong>{completedToday.length} 件完成 · {formatDuration(todayFocusSeconds)}</strong></div>
          <button className="icon-button small" type="button" aria-label="关闭今日待办" onClick={onClose}><X size={18} /></button>
        </div>
        <section className="quick-start-row" aria-label="快速开始">
          {settings.quickStartPresets.map((preset) => editingPresetId === preset.id ? (
            <div key={preset.id} className="quick-start-card editing">
              <input value={presetDraftLabel} maxLength={8} onChange={(e) => setPresetDraftLabel(e.target.value)} aria-label="快速开始名称" />
              <MinuteSelect className="quick-minutes-select" value={presetDraftMinutes} onChange={setPresetDraftMinutes} aria-label="快速开始时间" />
              <select value={presetDraftProjectId} onChange={(e) => setPresetDraftProjectId(e.target.value)} aria-label="快速开始项目">
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <button type="button" onClick={() => { onUpdateQuickStart(editingPresetId!, { label: presetDraftLabel, minutes: presetDraftMinutes, projectId: presetDraftProjectId }); setEditingPresetId(null); }} aria-label="保存快速开始"><Check size={14} /></button>
            </div>
          ) : (
            <div key={preset.id} className="quick-start-card">
              <button className="quick-start-chip" type="button" onClick={() => onQuickStart(preset)}><Play size={13} /><span>{preset.label}</span><small>{preset.minutes}</small></button>
              <button className="quick-edit" type="button" onClick={() => { setEditingPresetId(preset.id); setPresetDraftLabel(preset.label); setPresetDraftMinutes(preset.minutes); setPresetDraftProjectId(projects.some((p) => p.id === preset.projectId) ? preset.projectId : DEFAULT_PROJECT_ID); }} aria-label={`编辑${preset.label}`}><Pencil size={12} /></button>
            </div>
          ))}
        </section>
        <section className="today-section" aria-label="Todolist">
          <div className="today-section-title"><ListTodo size={14} /><strong>Todolist</strong></div>
          <TodoList todos={openTodos} settings={settings} activeTodoId={activeTodo?.id ?? null} draggingTodoId={draggingTodoId}
            onSelectTodo={onSelectTodo} onCompleteTodo={onCompleteTodo} onDeleteTodo={onDeleteTodo}
            onUpdateTodoTitle={onUpdateTodoTitle} onUpdateTodoMinutes={onUpdateTodoMinutes} onUpdateTodoProject={onUpdateTodoProject}
            onTodoPointerDown={onTodoPointerDown} onTodoPointerMove={onTodoPointerMove} onTodoPointerEnd={onTodoPointerEnd}
            emptyLabel="给 Todolist 加一件小事" />
        </section>
        {todoDragPreview ? <TodoDragPreviewCard preview={todoDragPreview} /> : null}
        {completedToday.length > 0 ? (
          <section className="today-section done-section" aria-label="Done list">
            <div className="today-section-title"><Check size={14} /><strong>Done list</strong></div>
            <div className="done-list">
              {completedToday.slice().sort((a, b) => Date.parse(b.completedAt ?? "") - Date.parse(a.completedAt ?? "")).map((todo) => {
                const project = projects.find((p) => p.id === todo.projectId);
                return (
                  <div className="done-row" key={todo.id}><span aria-hidden="true"><Check size={13} /></span>
                    <div><strong>{todo.title}</strong><small>{project?.name ?? "未分类"} · {todo.treesCompleted}棵 · {formatDuration(todo.focusSeconds)}</small></div>
                    <button type="button" onClick={() => onRestoreTodo(todo.id)} aria-label={`撤回${todo.title}到 Todolist`}><RotateCcw size={13} /></button>
                  </div>
                );
              })}
            </div>
          </section>
        ) : null}
        <form className="todo-create" onSubmit={onCreateTodo}>
          <input value={newTodoTitle} maxLength={40} onChange={(e) => onNewTodoTitleChange(e.target.value)} placeholder="添加到 Todolist" aria-label="新增今日待办" />
          <MinuteSelect className="todo-minutes-input" value={newTodoMinutes} onChange={onNewTodoMinutesChange} aria-label="新待办预计时间" />
          <select className="todo-project-select" value={newTodoProjectId} onChange={(e) => onNewTodoProjectChange(e.target.value)} aria-label="新待办项目">
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <button type="submit" aria-label="添加待办"><Plus size={17} /></button>
        </form>
      </aside>
    </div>
  );
}

function TodoList({ todos, settings, activeTodoId, draggingTodoId, emptyLabel, onSelectTodo, onCompleteTodo, onDeleteTodo, onUpdateTodoTitle, onUpdateTodoMinutes, onUpdateTodoProject, onTodoPointerDown, onTodoPointerMove, onTodoPointerEnd }: {
  todos: TodoItem[]; settings: AppSettings; activeTodoId: string | null; draggingTodoId: string | null; emptyLabel: string;
  onSelectTodo: (id: string) => void; onCompleteTodo: (id: string) => void; onDeleteTodo: (id: string) => void;
  onUpdateTodoTitle: (id: string, t: string) => void; onUpdateTodoMinutes: (id: string, m: number) => void; onUpdateTodoProject: (id: string, pid: string) => void;
  onTodoPointerDown: (id: string, e: PointerEvent<HTMLDivElement>) => void; onTodoPointerMove: (e: PointerEvent<HTMLDivElement>) => void; onTodoPointerEnd: (e: PointerEvent<HTMLDivElement>) => void;
}) {
  const [editingTodoId, setEditingTodoId] = useState<string | null>(null);
  const [todoTitleDraft, setTodoTitleDraft] = useState("");
  const selectTodoTimerRef = useRef<number | null>(null);
  useEffect(() => () => { if (selectTodoTimerRef.current) window.clearTimeout(selectTodoTimerRef.current); }, []);
  if (todos.length === 0) return emptyLabel ? <p className="todo-empty">{emptyLabel}</p> : null;
  return (
    <div className="todo-list">
      {todos.map((todo) => {
        const project = settings.projects.find((p) => p.id === todo.projectId);
        const projects = settings.projects.filter((p) => !p.archived);
        const isActive = todo.id === activeTodoId;
        const isDragging = todo.id === draggingTodoId;
        const isEditingTitle = todo.id === editingTodoId;
        return (
          <div key={todo.id} data-todo-id={todo.id} className={`${isActive ? "todo-row active" : "todo-row"}${isDragging ? " dragging" : ""}`}
            onPointerDown={(e) => onTodoPointerDown(todo.id, e)} onPointerMove={onTodoPointerMove} onPointerUp={onTodoPointerEnd} onPointerCancel={onTodoPointerEnd} onClick={() => onSelectTodo(todo.id)}>
            <span className="todo-drag-border todo-drag-border-top" /><span className="todo-drag-border todo-drag-border-right" /><span className="todo-drag-border todo-drag-border-bottom" /><span className="todo-drag-border todo-drag-border-left" />
            <button className="todo-check" type="button" onClick={(e) => { e.stopPropagation(); onCompleteTodo(todo.id); }} aria-label={`完成${todo.title}`}><span aria-hidden="true" /></button>
            {isEditingTitle ? (
              <form className="todo-main todo-title-edit" onSubmit={(e) => { e.preventDefault(); e.stopPropagation(); onUpdateTodoTitle(todo.id, todoTitleDraft.trim().replace(/\s+/g, " ").slice(0, 40) || todo.title); setEditingTodoId(null); }} onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
                <input value={todoTitleDraft} maxLength={40} autoFocus onChange={(e) => setTodoTitleDraft(e.target.value)} onBlur={() => { onUpdateTodoTitle(todo.id, todoTitleDraft.trim().replace(/\s+/g, " ").slice(0, 40) || todo.title); setEditingTodoId(null); }} onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); setEditingTodoId(null); } else if (e.key === "Enter") { e.preventDefault(); onUpdateTodoTitle(todo.id, todoTitleDraft.trim().replace(/\s+/g, " ").slice(0, 40) || todo.title); setEditingTodoId(null); } }} aria-label={`编辑${todo.title}`} /><small>Enter 保存 · Esc 取消</small>
              </form>
            ) : (
              <div className="todo-main todo-title-shell" onPointerDown={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); }}>
                <div className="todo-title-line">
                  <button className="todo-title-name" type="button" onDoubleClick={(e) => { e.stopPropagation(); setEditingTodoId(todo.id); setTodoTitleDraft(todo.title); }} onClick={(e) => e.stopPropagation()}><span>{todo.title}</span></button>
                  <button className="todo-title-edit-button" type="button" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); setEditingTodoId(todo.id); setTodoTitleDraft(todo.title); }} aria-label={`编辑${todo.title}`}><Pencil size={11} /></button>
                </div>
                <small>{project?.name ?? "未分类"} · {todo.treesCompleted}棵 · {formatDuration(todo.focusSeconds)}</small>
              </div>
            )}
            <div className="todo-plan-controls" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
              <MinuteSelect value={todo.plannedMinutes} onChange={(m) => onUpdateTodoMinutes(todo.id, m)} aria-label={`${todo.title}预计时间`} />
              <select value={todo.projectId} onChange={(e) => onUpdateTodoProject(todo.id, e.target.value)} aria-label={`${todo.title}项目`}>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <button className="todo-delete" type="button" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onDeleteTodo(todo.id); }} aria-label={`删除${todo.title}`}><X size={13} /></button>
          </div>
        );
      })}
    </div>
  );
}

function TodoDragPreviewCard({ preview }: { preview: any }) {
  return <div className="todo-drag-preview" style={{ left: `${preview.x}px`, top: `${preview.y}px`, width: `${preview.width}px` } as CSSProperties} aria-hidden="true"><span className="todo-drag-preview-check" /><div><strong>{preview.title}</strong><small>{preview.meta}</small></div></div>;
}

function MinuteSelect({ value, onChange, className = "", "aria-label": ariaLabel }: { value: number; onChange: (v: number) => void; className?: string; "aria-label": string }) {
  return (
    <span className={`minute-select-wrap ${className ? `${className}-wrap` : ""}`}>
      <select className={className} value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label={ariaLabel}>
        {TIME_PRESET_MINUTES.map((m) => <option key={m} value={m}>{m}</option>)}
      </select>
      <small aria-hidden="true">mins</small>
    </span>
  );
}

function StatsPanel({ settings, onClose }: { settings: AppSettings; onClose: () => void }) {
  const [metric, setMetric] = useState<HeatmapMetric>("trees");
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const projects = useMemo(() => settings.projects.filter((p) => !p.archived), [settings.projects]);
  const selectedProject = useMemo(() => projects.find((p) => p.id === selectedProjectId) ?? null, [projects, selectedProjectId]);
  const weeks = useMemo(() => buildHeatmapWeeks(settings.forestStats, metric, new Date(), 12, selectedProject?.id ?? null), [settings.forestStats, metric, selectedProject]);
  const today = useMemo(() => summarizeProjectRange(settings.forestStats, "day", new Date(), selectedProject?.id ?? null), [settings.forestStats, selectedProject]);
  const week = useMemo(() => summarizeProjectRange(settings.forestStats, "week", new Date(), selectedProject?.id ?? null), [settings.forestStats, selectedProject]);
  const month = useMemo(() => summarizeProjectRange(settings.forestStats, "month", new Date(), selectedProject?.id ?? null), [settings.forestStats, selectedProject]);
  const heatmapStyle = useMemo(() => (selectedProject ? projectHeatmapStyle(selectedProject.color) : undefined), [selectedProject]);

  return (
    <div className="stats-backdrop" role="presentation" onMouseDown={onClose}>
      <aside className="stats-panel" aria-label="森林统计" onMouseDown={(e) => e.stopPropagation()}>
        <div className="stats-head"><div><span className="section-kicker">森林统计</span><strong>{selectedProject?.name ?? "全部"} · 最近 12 周</strong></div><button className="icon-button small" type="button" aria-label="关闭统计" onClick={onClose}><X size={18} /></button></div>
        <div className="project-filter" aria-label="项目筛选">
          <button className={selectedProjectId === null ? "project-filter-chip active" : "project-filter-chip"} type="button" onClick={() => setSelectedProjectId(null)}>全部</button>
          {projects.map((p) => <button key={p.id} className={selectedProjectId === p.id ? "project-filter-chip active" : "project-filter-chip"} type="button" onClick={() => setSelectedProjectId(p.id)}><span className="project-dot" style={{ "--project-color": p.color } as React.CSSProperties} /><span>{p.name}</span></button>)}
        </div>
        <div className="stats-summary">
          <StatsSummaryItem label="今日" summary={today} />
          <StatsSummaryItem label="本周" summary={week} />
          <StatsSummaryItem label="本月" summary={month} />
        </div>
        <div className="segmented stats-metric" aria-label="统计指标">
          {[["trees", "树"], ["focus", "时长"]].map(([v, label]) => <button key={v} className={metric === v ? "active" : ""} type="button" onClick={() => setMetric(v as HeatmapMetric)}>{label}</button>)}
        </div>
        <div className={selectedProject ? "heatmap-shell project-heatmap" : "heatmap-shell"} style={heatmapStyle}>
          <div className="heatmap-weekdays" aria-hidden="true"><span>日</span><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span></div>
          <div className="heatmap-grid" aria-label="最近 12 周专注热力图">
            {weeks.map((weekDays, wi) => <div className="heatmap-week" key={weekDays[0]?.date ?? wi}>{weekDays.map((day) => <span key={day.date} className={`heatmap-cell level-${day.level} ${day.isFuture ? "future" : ""}`} title={`${day.date} · ${selectedProject?.name ?? "全部"} · ${day.stats.treesCompleted}棵 · ${formatDuration(day.stats.focusSeconds)}`} />)}</div>)}
          </div>
        </div>
        <div className={selectedProject ? "heatmap-legend project-heatmap" : "heatmap-legend"} style={heatmapStyle} aria-hidden="true"><span>少</span>{[0, 1, 2, 3, 4].map((l) => <i key={l} className={`heatmap-cell level-${l}`} />)}<span>多</span></div>
      </aside>
    </div>
  );
}

function StatsSummaryItem({ label, summary }: { label: string; summary: { focusSeconds: number; treesCompleted: number } }) {
  return <div className="stats-summary-item"><span>{label}</span><strong>{summary.treesCompleted}棵</strong><small>{formatDuration(summary.focusSeconds)}</small></div>;
}

function ReminderPopup() {
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const params = new URLSearchParams(window.location.hash.split("?")[1] ?? "");
  const message = params.get("message") ?? DEFAULT_REMINDER_COPY.focusComplete.title;
  const body = params.get("body") ?? "休息一下，喝口水。";
  const placement = params.get("placement") ?? params.get("corner") ?? "top-right";
  const durationSeconds = clamp(Number(params.get("duration")) || settings.reminder.durationSeconds, 3, 60);
  const actionLabel = params.get("actionLabel"); const actionEvent = params.get("actionEvent");
  const secondaryActionLabel = params.get("secondaryActionLabel"); const secondaryActionEvent = params.get("secondaryActionEvent");
  const tertiaryActionLabel = params.get("tertiaryActionLabel"); const tertiaryActionEvent = params.get("tertiaryActionEvent");
  const hasTertiaryAction = Boolean(tertiaryActionLabel && tertiaryActionEvent);
  const hasActions = Boolean((actionLabel && actionEvent) || (secondaryActionLabel && secondaryActionEvent) || hasTertiaryAction);
  const persistent = params.get("persistent") === "true";
  const avatarSrc = displayAvatarSrc(settings.avatar);
  const leaveDelay = `${Math.max(1.8, durationSeconds - 0.6)}s`;

  useEffect(() => { document.documentElement.classList.add("reminder-document"); document.body.classList.add("reminder-document"); return () => { document.documentElement.classList.remove("reminder-document"); document.body.classList.remove("reminder-document"); }; }, []);
  useEffect(() => { loadSettings().then(setSettings); }, []);
  useEffect(() => {
    if (!isTauriRuntime() || persistent) return;
    const id = window.setTimeout(() => { closeReminder().catch(() => undefined); }, durationSeconds * 1000);
    return () => window.clearTimeout(id);
  }, [durationSeconds, persistent]);

  return (
    <main className={`reminder-pop ${placement}`}>
      <div className={`${hasActions ? "native-toast action-toast" : "native-toast"}${hasTertiaryAction ? " three-action-toast" : ""}${persistent ? " persistent-toast" : ""}`}
        aria-live="polite" style={{ "--leave-delay": leaveDelay } as React.CSSProperties}>
        <div className="toast-avatar">{avatarSrc ? <img src={avatarSrc} alt="小人头像" /> : <DefaultAvatar />}</div>
        <div className="toast-copy"><strong>{message}</strong><span>{body}</span></div>
        {hasActions ? (
          <div className="toast-actions">
            {actionLabel && actionEvent ? <button className="toast-action" type="button" onClick={() => handleReminderActionClick(actionEvent)}>{actionLabel}</button> : null}
            {secondaryActionLabel && secondaryActionEvent ? <button className="toast-action secondary" type="button" onClick={() => handleReminderActionClick(secondaryActionEvent)}>{secondaryActionLabel}</button> : null}
            {tertiaryActionLabel && tertiaryActionEvent ? <button className="toast-action tertiary" type="button" onClick={() => handleReminderActionClick(tertiaryActionEvent)}>{tertiaryActionLabel}</button> : null}
          </div>
        ) : null}
      </div>
    </main>
  );

  async function handleReminderActionClick(eventName: string | null) {
    if (!eventName) return;
    if (eventName === "done") { closeReminder().catch(() => undefined); return; }
    try { const { emit } = await import("@tauri-apps/api/event"); await emit("reminder-action", { action: eventName }); } catch (error) { console.warn("Reminder action failed", error); } finally { closeReminder().catch(() => undefined); }
  }
}

function loadSettings() { return import("./lib/storage").then((m) => m.loadSettings()); }

// --- Utility functions ---

function clamp(value: number, min: number, max: number) { return Math.min(max, Math.max(min, value)); }
function normalizeShortcut(event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">) {
  const key = normalizeShortcutKey(event.key);
  if (!key) return "";
  const parts = [event.metaKey ? (isMacOS() ? "Command" : "Win") : "", event.ctrlKey ? "Ctrl" : "", event.altKey ? shortcutModifierName() : "", event.shiftKey ? "Shift" : "", key].filter(Boolean);
  return parts.length > 1 ? parts.join("+") : "";
}
function normalizeShortcutKey(key: string) { if (["Meta", "Control", "Alt", "Shift"].includes(key)) return ""; if (key === " ") return "Space"; if (key.length === 1) return key.toUpperCase(); return key; }
async function closeReminder() { if (!isTauriRuntime()) return; const { getCurrentWindow } = await import("@tauri-apps/api/window"); await getCurrentWindow().close(); }

function SettingsSlider({ label, value, min, max, suffix = "分钟", showTicks = true, onChange }: { label: string; value: number; min: number; max: number; suffix?: string; showTicks?: boolean; onChange: (v: number) => void }) {
  const tickItems = buildMinuteTicks(min, max);
  const tickRange = Math.max(1, max - min);
  return (
    <label className="slider-row">
      <span>{label}<strong>{value}{suffix}</strong></span>
      <div className="slider-control">
        <input className="time-range" type="range" min={min} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))} />
        {showTicks ? <div className="time-ticks" aria-hidden="true">{tickItems.map((tick) => <i key={tick.value} className={`time-tick ${tick.kind}`} style={{ "--tick-position": `${Math.max(0, Math.min(100, ((tick.value - min) / tickRange) * 100))}%` } as CSSProperties} />)}</div> : null}
      </div>
    </label>
  );
}

function buildMinuteTicks(min: number, max: number): Array<{ value: number; kind: "major" | "minor" }> {
  const firstTick = Math.ceil(min / 5) * 5;
  const ticks: Array<{ value: number; kind: "major" | "minor" }> = [];
  for (let v = firstTick; v <= max; v += 5) ticks.push({ value: v, kind: v % 10 === 0 ? "major" : "minor" });
  return ticks;
}

function projectHeatmapStyle(color: string): CSSProperties {
  return { "--heat-level-1": mixHexColor(color, "#f7f5ef", 0.38), "--heat-level-2": mixHexColor(color, "#f7f5ef", 0.58), "--heat-level-3": mixHexColor(color, "#f7f5ef", 0.76), "--heat-level-4": mixHexColor(color, "#2b2724", 0.94) } as CSSProperties;
}

function mixHexColor(foreground: string, background: string, amount: number) {
  const fg = parseHexColor(foreground) ?? parseHexColor("#74c8a3")!;
  const bg = parseHexColor(background) ?? parseHexColor("#f7f5ef")!;
  const ratio = clamp(amount, 0, 1);
  const mixed = fg.map((ch, i) => Math.round(ch * ratio + bg[i] * (1 - ratio)));
  return `#${mixed.map((ch) => ch.toString(16).padStart(2, "0")).join("")}`;
}

function parseHexColor(color: string): [number, number, number] | null {
  const match = color.match(/^#([0-9a-fA-F]{6})$/);
  if (!match) return null;
  const v = match[1];
  return [Number.parseInt(v.slice(0, 2), 16), Number.parseInt(v.slice(2, 4), 16), Number.parseInt(v.slice(4, 6), 16)];
}

function isTrayDiagnosticsEnabled(): boolean { try { const v = window.localStorage.getItem(TRAY_DIAGNOSTICS_STORAGE_KEY); return v === "1" || v?.toLowerCase() === "true"; } catch { return false; } }
function logTrayDiagnostic(message: string, debugInfo: TrayIconDebugInfo): void { if (!isTrayDiagnosticsEnabled()) return; console.info("[tray-icon]", message, debugInfo); }

function DefaultAvatar() {
  return <div className="default-avatar" aria-hidden="true"><div className="hair" /><div className="face"><span /><span /></div><div className="collar"><Coffee size={18} /></div></div>;
}

export default App;
