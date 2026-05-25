export type Phase = "countdown" | "countup";

export type Corner = "top-left" | "top-center" | "top-right";

export type CornerMode = Corner;

export type ToastPlacement = Corner;

export type CountdownRole = "focus" | "rest";

export interface FocusOverride {
  seconds: number;
  presetId: string;
  trackForest: boolean;
}

export type ThemeMode = "cream" | "mint" | "rose" | "night";

export type TreeStyle = "round" | "pixel" | "potted" | "pine" | "stamp";

export type ReminderSoundName =
  | "Basso"
  | "Blow"
  | "Bottle"
  | "Frog"
  | "Funk"
  | "Glass"
  | "Hero"
  | "Morse"
  | "Ping"
  | "Pop"
  | "Purr"
  | "Sosumi"
  | "Submarine"
  | "Tink";

export const DEFAULT_PROJECT_ID = "unclassified";

export interface StickerItem {
  id: string;
  src: string;
  x: number;
  y: number;
  size: number;
  rotation: number;
  flipped: boolean;
}

export interface TimerSettings {
  focusMinutes: number;
  restMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  longBreakInterval: number;
  autoStartNext: boolean;
  startShortcut: string;
}

export interface AvatarSettings {
  src: string | null;
  kind: "path" | "data-url" | "none";
}

export interface BackgroundPalette {
  accent: string;
  accentSoft: string;
  ink: string;
  line: string;
  cardBg: string;
  panelBg: string;
  controlBg: string;
  overlay: string;
  shadow: string;
  isDark: boolean;
}

export interface BackgroundSettings {
  src: string | null;
  kind: "data-url" | "none";
  fit: "cover" | "contain";
  opacity: number;
  autoMatch: boolean;
  palette: BackgroundPalette | null;
}

export interface ReminderSettings {
  cornerMode: CornerMode;
  soundEnabled: boolean;
  soundName: ReminderSoundName;
  durationSeconds: number;
  copy: ReminderCopySettings;
}

export interface ReminderCopyItem {
  title: string;
  body: string;
}

export interface ReminderCopySettings {
  focusStart: ReminderCopyItem;
  focusComplete: ReminderCopyItem;
  restStart: ReminderCopyItem;
  restComplete: ReminderCopyItem;
}

export interface ThemeSettings {
  mode: ThemeMode;
  followSystem: boolean;
}

export interface MenuBarSettings {
  enabled: boolean;
  treeStyle: TreeStyle;
}

export interface TrayIconDebugInfo {
  source: string;
  phase?: "render" | "invoke" | "setIcon" | "setVisible";
  attempt?: number;
  logicalSize: number;
  backingSize: number;
  scale: number;
  stage: number;
  style: TreeStyle;
  variant: "tree" | "rest-charge";
  renderState: "ok" | "failed";
  template: boolean;
  bytes: number;
  devicePixelRatio?: number;
  userAgent?: string;
  runtime?: "tauri" | "web";
  error?: string;
}

export interface ProjectItem {
  id: string;
  name: string;
  color: string;
  archived: boolean;
}

export interface TodoItem {
  id: string;
  title: string;
  projectId: string;
  plannedMinutes: number;
  order: number;
  completed: boolean;
  focusSeconds: number;
  treesCompleted: number;
  createdAt: string;
  completedAt?: string;
}

export interface QuickStartPreset {
  id: string;
  label: string;
  minutes: number;
  projectId: string;
  trackForest: boolean;
}

export interface ProjectForestStats {
  focusSeconds: number;
  treesCompleted: number;
}

export interface DailyForestStats extends ProjectForestStats {
  projects: Record<string, ProjectForestStats>;
}

export interface ForestStats {
  days: Record<string, DailyForestStats>;
}

export interface AppSettings {
  timer: TimerSettings;
  avatar: AvatarSettings;
  background: BackgroundSettings;
  reminder: ReminderSettings;
  theme: ThemeSettings;
  menuBar: MenuBarSettings;
  stickers: StickerItem[];
  projects: ProjectItem[];
  activeProjectId: string;
  todos: TodoItem[];
  activeTodoId: string | null;
  quickStartPresets: QuickStartPreset[];
  forestStats: ForestStats;
  closeToTray?: boolean;
}

export interface TimerState {
  phase: Phase;
  countdownRole: CountdownRole;
  secondsLeft: number;
  isRunning: boolean;
  completedFocusSessions: number;
  isComplete: boolean;
}
