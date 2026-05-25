import { invoke } from "@tauri-apps/api/core";
import { normalizeForestStats } from "./stats";
import {
  DEFAULT_PROJECT_ID,
  type AppSettings,
  type AvatarSettings,
  type BackgroundSettings,
  type CornerMode,
  type ProjectItem,
  type QuickStartPreset,
  type ReminderCopyItem,
  type ReminderCopySettings,
  type ReminderSoundName,
  type StickerItem,
  type ThemeMode,
  type ToastPlacement,
  type TodoItem,
  type TrayIconDebugInfo,
  type TreeStyle
} from "./types";

const STORAGE_KEY = "sticker-pomodoro-settings";
export const REMINDER_SOUND_OPTIONS: ReminderSoundName[] = [
  "Basso",
  "Blow",
  "Bottle",
  "Frog",
  "Funk",
  "Glass",
  "Hero",
  "Morse",
  "Ping",
  "Pop",
  "Purr",
  "Sosumi",
  "Submarine",
  "Tink"
];
export const DEFAULT_REMINDER_COPY: ReminderCopySettings = {
  focusStart: {
    title: "专注开始啦 ♡",
    body: "计时已经开始，慢慢来。"
  },
  focusComplete: {
    title: "宝宝辛苦啦~ ♡",
    body: "休息一下，喝口水。"
  },
  restStart: {
    title: "休息开始啦~ ♡",
    body: "给大脑充会儿电。"
  },
  restComplete: {
    title: "休息结束啦~ ♡",
    body: "可以慢慢回到节奏里。"
  }
};
type PersistedAppSettings = Partial<
  Omit<AppSettings, "timer" | "avatar" | "background" | "reminder" | "theme" | "menuBar">
> & {
  timer?: Partial<AppSettings["timer"]>;
  avatar?: Partial<AppSettings["avatar"]>;
  background?: Partial<AppSettings["background"]>;
  reminder?: Partial<AppSettings["reminder"]>;
  theme?: Partial<AppSettings["theme"]>;
  menuBar?: Partial<AppSettings["menuBar"]>;
};

export const PROJECT_COLORS = ["#ec5b4f", "#74c8a3", "#f2c862", "#6aa4ce", "#ea6b72", "#9b7bd8", "#ef9f52", "#54b4b0"];
export const DEFAULT_PROJECT: ProjectItem = {
  id: DEFAULT_PROJECT_ID,
  name: "未分类",
  color: "#6aa4ce",
  archived: false
};
export const DEFAULT_QUICK_START_PRESETS: QuickStartPreset[] = [
  { id: "quick-reading", label: "读书", minutes: 25, projectId: "quick-reading", trackForest: true },
  { id: "quick-fitness", label: "健身", minutes: 15, projectId: "quick-fitness", trackForest: false },
  { id: "quick-writing", label: "写作", minutes: 25, projectId: "quick-writing", trackForest: true },
  { id: "quick-tidy", label: "整理", minutes: 10, projectId: "quick-tidy", trackForest: true }
];

export const defaultSettings: AppSettings = {
  timer: {
    focusMinutes: 25,
    restMinutes: 5,
    shortBreakMinutes: 5,
    longBreakMinutes: 15,
    longBreakInterval: 4,
    autoStartNext: false,
    startShortcut: "Ctrl+Alt+P"
  },
  avatar: {
    src: null,
    kind: "none"
  },
  background: {
    src: null,
    kind: "none",
    fit: "cover",
    opacity: 82,
    autoMatch: true,
    palette: null
  },
  reminder: {
    cornerMode: "top-right",
    soundEnabled: true,
    soundName: "Blow",
    copy: DEFAULT_REMINDER_COPY,
    durationSeconds: 14
  },
  theme: {
    mode: "cream",
    followSystem: true
  },
  menuBar: {
    enabled: true,
    treeStyle: "potted"
  },
  stickers: [],
  projects: [DEFAULT_PROJECT],
  activeProjectId: DEFAULT_PROJECT_ID,
  todos: [],
  activeTodoId: null,
  quickStartPresets: DEFAULT_QUICK_START_PRESETS,
  forestStats: {
    days: {}
  }
};

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && Boolean(window.__TAURI__ || window.__TAURI_INTERNALS__);
}

export function displayAvatarSrc(avatar: AvatarSettings): string | null {
  if (!avatar.src || avatar.kind !== "data-url") {
    return null;
  }

  return avatar.src;
}

export async function loadSettings(): Promise<AppSettings> {
  const localSettings = readLocalPersistedSettings();

  if (isTauriRuntime()) {
    try {
      const settings = await invoke<PersistedAppSettings>("load_settings");
      return mergeSettings(mergePersistedSettings(settings, localSettings));
    } catch (error) {
      console.warn("Falling back to local settings", error);
    }
  }

  return localSettings ? mergeSettings(localSettings) : defaultSettings;
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));

  if (isTauriRuntime()) {
    await invoke("save_settings", { settings });
  }
}

export async function showReminderWindow(
  placement: ToastPlacement,
  message: string,
  body: string,
  durationSeconds: number,
  actionLabel: string | null = null,
  actionEvent: string | null = null,
  secondaryActionLabel: string | null = null,
  secondaryActionEvent: string | null = null,
  persistent = false,
  tertiaryActionLabel: string | null = null,
  tertiaryActionEvent: string | null = null
): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }

  await invoke("show_reminder", {
    placement,
    message,
    body,
    durationSeconds,
    actionLabel,
    actionEvent,
    secondaryActionLabel,
    secondaryActionEvent,
    tertiaryActionLabel,
    tertiaryActionEvent,
    persistent
  });
}

export async function registerStartShortcut(shortcut: string): Promise<string> {
  if (!isTauriRuntime()) {
    return "";
  }

  return invoke<string>("register_start_shortcut", { shortcut });
}

export async function playReminderSound(soundName: ReminderSoundName): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }

  await invoke("play_system_sound", { soundName });
}

export async function updateTrayState(
  title: string,
  tooltip: string,
  iconBytes: number[],
  visible: boolean,
  debugInfo: TrayIconDebugInfo | null = null
): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }

  await invoke("update_tray_state", { title, tooltip, iconBytes, visible, debugInfo });
}

export async function minimizeMainWindow(): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }

  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const window = getCurrentWindow();
    await window.minimize();
    await window.hide();
  } catch (error) {
    console.warn("Window API minimize failed, falling back to command", error);
    await invoke("minimize_main_window");
  }
}

export async function startMainWindowDrag(): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }

  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().startDragging();
}

export async function tickFeedback(): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }

  await invoke("tick_feedback");
}

export function mergeSettings(input: PersistedAppSettings): AppSettings {
  const avatar = input.avatar?.kind === "data-url" ? input.avatar : defaultSettings.avatar;
  const background = normalizeBackground(input.background);
  const stickers = Array.isArray(input.stickers) ? input.stickers.filter(isStickerItem).slice(0, 24) : defaultSettings.stickers;
  const timer = {
    ...defaultSettings.timer,
    ...input.timer,
    focusMinutes: normalizeTimerMinutes(input.timer?.focusMinutes, defaultSettings.timer.focusMinutes, 60),
    restMinutes: normalizeTimerMinutes(input.timer?.restMinutes, defaultSettings.timer.restMinutes, 30),
    startShortcut: normalizeShortcut(input.timer?.startShortcut ?? defaultSettings.timer.startShortcut)
  };
  const reminder = {
    ...defaultSettings.reminder,
    ...input.reminder,
    cornerMode: normalizeCorner(input.reminder?.cornerMode),
    soundName: normalizeReminderSound(input.reminder?.soundName),
    copy: normalizeReminderCopy(input.reminder?.copy)
  };
  const theme = {
    ...defaultSettings.theme,
    ...input.theme,
    mode: normalizeTheme(input.theme?.mode),
    followSystem: normalizeFollowSystem(input.theme)
  };
  const menuBar = {
    ...defaultSettings.menuBar,
    ...input.menuBar,
    treeStyle: normalizeTreeStyle(input.menuBar?.treeStyle)
  };
  const projects = normalizeProjects(input.projects);
  const activeProjectId = normalizeActiveProject(input.activeProjectId, projects);
  const todos = normalizeTodos(input.todos);
  const activeTodoId = normalizeActiveTodo(input.activeTodoId, todos);
  const quickStartPresets = normalizeQuickStartPresets(input.quickStartPresets);
  const forestStats = normalizeForestStats(input.forestStats);

  return {
    timer,
    avatar: { ...defaultSettings.avatar, ...avatar },
    background,
    reminder,
    theme,
    menuBar,
    stickers,
    projects,
    activeProjectId,
    todos,
    activeTodoId,
    quickStartPresets,
    forestStats
  };
}

export function mergePersistedSettings(primary: PersistedAppSettings, fallback: PersistedAppSettings | null): PersistedAppSettings {
  if (!fallback) {
    return primary;
  }

  const merged: PersistedAppSettings = { ...primary };

  copyMissingPersistedField(merged, fallback, "background");
  copyMissingPersistedField(merged, fallback, "todos");
  copyMissingPersistedField(merged, fallback, "activeTodoId");
  copyMissingPersistedField(merged, fallback, "quickStartPresets");
  copyMissingPersistedField(merged, fallback, "forestStats");
  copyMissingPersistedField(merged, fallback, "stickers");
  copyMissingPersistedField(merged, fallback, "avatar");

  if (persistedArrayLength(fallback.projects) > persistedArrayLength(merged.projects)) {
    merged.projects = fallback.projects;
  }

  if ((!merged.activeProjectId || merged.activeProjectId === DEFAULT_PROJECT_ID) && fallback.activeProjectId && fallback.activeProjectId !== DEFAULT_PROJECT_ID) {
    merged.activeProjectId = fallback.activeProjectId;
  }

  return merged;
}

function readLocalPersistedSettings(): PersistedAppSettings | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as PersistedAppSettings;
  } catch (error) {
    console.warn("Could not parse local settings", error);
    return null;
  }
}

function copyMissingPersistedField<K extends keyof PersistedAppSettings>(target: PersistedAppSettings, fallback: PersistedAppSettings, key: K) {
  const fallbackValue = fallback[key];
  if (!persistedValueHasData(fallbackValue) || persistedValueHasData(target[key])) {
    return;
  }

  target[key] = fallbackValue as PersistedAppSettings[K];
}

function persistedArrayLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function persistedValueHasData(value: unknown): boolean {
  if (value === null || value === undefined) {
    return false;
  }

  if (Array.isArray(value)) {
    return value.length > 0;
  }

  if (typeof value === "object") {
    const objectValue = value as Record<string, unknown>;
    if (objectValue.kind === "none") {
      return false;
    }

    if (objectValue.days && typeof objectValue.days === "object") {
      return Object.keys(objectValue.days).length > 0;
    }

    return Object.keys(objectValue).length > 0;
  }

  if (typeof value === "string") {
    return value.trim().length > 0;
  }

  return Boolean(value);
}

function normalizeShortcut(shortcut: string) {
  const normalized = shortcut
    .replace(/CmdOrCtrl/g, "CommandOrControl")
    .replace(/Option/g, "Alt")
    .replace(/\bControl\b/g, "Ctrl")
    .replace(/Cmd/g, "Command");
  return normalized === "CommandOrControl+Alt+P" ? defaultSettings.timer.startShortcut : normalized;
}

function normalizeTimerMinutes(value: unknown, fallback: number, max: number): number {
  const numeric = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : fallback;
  return numeric >= 1 && numeric <= max ? numeric : fallback;
}

function normalizeCorner(corner: unknown): CornerMode {
  return corner === "top-left" || corner === "top-center" || corner === "top-right" ? corner : defaultSettings.reminder.cornerMode;
}

function normalizeReminderSound(soundName: unknown): ReminderSoundName {
  return typeof soundName === "string" && REMINDER_SOUND_OPTIONS.includes(soundName as ReminderSoundName)
    ? (soundName as ReminderSoundName)
    : defaultSettings.reminder.soundName;
}

function normalizeReminderCopy(copy: unknown): ReminderCopySettings {
  const input =
    copy && typeof copy === "object"
      ? (copy as Partial<Record<keyof ReminderCopySettings | "start", Partial<ReminderCopyItem>>>)
      : {};

  return {
    focusStart: normalizeReminderCopyItem(input.focusStart ?? input.start, DEFAULT_REMINDER_COPY.focusStart),
    focusComplete: normalizeReminderCopyItem(input.focusComplete, DEFAULT_REMINDER_COPY.focusComplete),
    restStart: normalizeReminderCopyItem(input.restStart, DEFAULT_REMINDER_COPY.restStart),
    restComplete: normalizeReminderCopyItem(input.restComplete, DEFAULT_REMINDER_COPY.restComplete)
  };
}

function normalizeReminderCopyItem(input: Partial<ReminderCopyItem> | undefined, fallback: ReminderCopyItem): ReminderCopyItem {
  return {
    title: normalizeReminderCopyText(input?.title, fallback.title),
    body: normalizeReminderCopyText(input?.body, fallback.body)
  };
}

function normalizeReminderCopyText(value: unknown, fallback: string): string {
  const normalized = typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, 48) : "";
  return normalized || fallback;
}

function normalizeTheme(theme: unknown): ThemeMode {
  return theme === "cream" || theme === "mint" || theme === "rose" || theme === "night" ? theme : defaultSettings.theme.mode;
}

function normalizeTreeStyle(style: unknown): TreeStyle {
  return style === "round" || style === "pixel" || style === "potted" || style === "pine" || style === "stamp"
    ? style
    : defaultSettings.menuBar.treeStyle;
}

function normalizeFollowSystem(theme: Partial<AppSettings["theme"]> | undefined): boolean {
  if ((theme as { mode?: unknown } | undefined)?.mode === "system") {
    return true;
  }

  return typeof theme?.followSystem === "boolean" ? theme.followSystem : defaultSettings.theme.followSystem;
}

function normalizeBackground(input: Partial<BackgroundSettings> | undefined): BackgroundSettings {
  const src = typeof input?.src === "string" && input.src.startsWith("data:image/") ? input.src : null;
  const kind = src ? "data-url" : "none";
  const palette = input?.palette && isBackgroundPalette(input.palette) ? input.palette : null;

  return {
    ...defaultSettings.background,
    src,
    kind,
    fit: input?.fit === "contain" ? "contain" : defaultSettings.background.fit,
    opacity: normalizeBackgroundOpacity(input?.opacity),
    autoMatch: typeof input?.autoMatch === "boolean" ? input.autoMatch : defaultSettings.background.autoMatch,
    palette: kind === "data-url" ? palette : null
  };
}

function normalizeBackgroundOpacity(value: unknown): number {
  const numeric = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : defaultSettings.background.opacity;
  return numeric >= 20 && numeric <= 100 ? numeric : defaultSettings.background.opacity;
}

function normalizeProjects(input: unknown): ProjectItem[] {
  const projects = Array.isArray(input) ? input.filter(isProjectItem).slice(0, 24) : [];
  const withDefault = projects.some((project) => project.id === DEFAULT_PROJECT_ID) ? projects : [DEFAULT_PROJECT, ...projects];

  return withDefault.map((project, index) => ({
    id: project.id,
    name: normalizeProjectName(project.name) || (project.id === DEFAULT_PROJECT_ID ? DEFAULT_PROJECT.name : `项目${index + 1}`),
    color: normalizeProjectColor(project.color, index),
    archived: project.id === DEFAULT_PROJECT_ID ? false : Boolean(project.archived)
  }));
}

function normalizeActiveProject(input: unknown, projects: ProjectItem[]): string {
  return typeof input === "string" && projects.some((project) => project.id === input && !project.archived) ? input : DEFAULT_PROJECT_ID;
}

function normalizeTodos(input: unknown): TodoItem[] {
  if (!Array.isArray(input)) {
    return defaultSettings.todos;
  }

  return input.filter(isTodoItem).slice(0, 80).map((todo, index) => ({
    id: todo.id,
    title: normalizeTodoTitle(todo.title),
    projectId: isEntityId(todo.projectId) ? todo.projectId : DEFAULT_PROJECT_ID,
    plannedMinutes: normalizeTimerMinutes(todo.plannedMinutes, defaultSettings.timer.focusMinutes, 180),
    order: normalizeCount(todo.order, index),
    completed: Boolean(todo.completed),
    focusSeconds: normalizeCount(todo.focusSeconds),
    treesCompleted: normalizeCount(todo.treesCompleted),
    createdAt: normalizeDateString(todo.createdAt) ?? new Date().toISOString(),
    ...(todo.completedAt && normalizeDateString(todo.completedAt) ? { completedAt: todo.completedAt } : {})
  }));
}

function normalizeActiveTodo(input: unknown, todos: TodoItem[]): string | null {
  return typeof input === "string" && todos.some((todo) => todo.id === input && !todo.completed) ? input : null;
}

function normalizeQuickStartPresets(input: unknown): QuickStartPreset[] {
  const presets = Array.isArray(input) ? input.filter(isQuickStartPreset).slice(0, 8) : [];
  return presets.length > 0
    ? presets.map((preset) => ({
        id: preset.id,
        label: normalizePresetLabel(preset.label),
        minutes: normalizeTimerMinutes(preset.minutes, 25, 60),
        projectId: isEntityId(preset.projectId) ? preset.projectId : DEFAULT_PROJECT_ID,
        trackForest: Boolean(preset.trackForest)
      }))
    : defaultSettings.quickStartPresets;
}

function normalizeProjectName(name: string): string {
  return name.trim().replace(/\s+/g, " ").slice(0, 12);
}

function normalizeTodoTitle(title: string): string {
  return title.trim().replace(/\s+/g, " ").slice(0, 40);
}

function normalizePresetLabel(label: string): string {
  return label.trim().replace(/\s+/g, " ").slice(0, 8) || "快速";
}

function normalizeProjectColor(color: string, index: number): string {
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color : PROJECT_COLORS[index % PROJECT_COLORS.length];
}

function normalizeCount(value: unknown, fallback = 0): number {
  return Math.max(0, Math.floor(Number.isFinite(Number(value)) ? Number(value) : fallback));
}

function normalizeDateString(value: unknown): string | null {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;
}

function isEntityId(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{1,48}$/.test(value);
}

function isProjectItem(value: unknown): value is ProjectItem {
  if (!value || typeof value !== "object") {
    return false;
  }

  const project = value as ProjectItem;
  return (
    isEntityId(project.id) &&
    typeof project.name === "string" &&
    typeof project.color === "string"
  );
}

function isTodoItem(value: unknown): value is TodoItem {
  if (!value || typeof value !== "object") {
    return false;
  }

  const todo = value as TodoItem;
  return isEntityId(todo.id) && typeof todo.title === "string" && normalizeTodoTitle(todo.title).length > 0;
}

function isQuickStartPreset(value: unknown): value is QuickStartPreset {
  if (!value || typeof value !== "object") {
    return false;
  }

  const preset = value as QuickStartPreset;
  return isEntityId(preset.id) && typeof preset.label === "string" && normalizePresetLabel(preset.label).length > 0;
}

function isStickerItem(value: unknown): value is StickerItem {
  if (!value || typeof value !== "object") {
    return false;
  }

  const sticker = value as StickerItem;
  return (
    typeof sticker.id === "string" &&
    typeof sticker.src === "string" &&
    sticker.src.startsWith("data:image/") &&
    Number.isFinite(sticker.x) &&
    Number.isFinite(sticker.y) &&
    Number.isFinite(sticker.size) &&
    Number.isFinite(sticker.rotation) &&
    typeof sticker.flipped === "boolean"
  );
}

function isBackgroundPalette(value: unknown): value is BackgroundSettings["palette"] {
  if (!value || typeof value !== "object") {
    return false;
  }

  const palette = value as Record<string, unknown>;
  return (
    typeof palette.accent === "string" &&
    typeof palette.accentSoft === "string" &&
    typeof palette.ink === "string" &&
    typeof palette.line === "string" &&
    typeof palette.cardBg === "string" &&
    typeof palette.panelBg === "string" &&
    typeof palette.controlBg === "string" &&
    typeof palette.overlay === "string" &&
    typeof palette.shadow === "string" &&
    typeof palette.isDark === "boolean"
  );
}
