import { formatDuration, todayKey } from "./stats";
import { durationForPhase, formatTime } from "./timer";
import type { AppSettings, TimerState, TrayIconDebugInfo, TreeStyle } from "./types";
import { isWindows } from "./platform";

export interface TrayForestState {
  title: string;
  tooltip: string;
  stage: number;
  iconVariant: "tree" | "rest-charge";
}

export const TREE_STYLE_OPTIONS: Array<{ value: TreeStyle; label: string }> = [
  { value: "round", label: "圆润幼苗" },
  { value: "pixel", label: "像素小树" },
  { value: "potted", label: "小盆栽" },
  { value: "pine", label: "松树剪影" },
  { value: "stamp", label: "手账印章" }
];

const TRAY_ICON_LOGICAL_SIZE = 18;
const TRAY_ICON_COLOR = isWindows() ? "#74c8a3" : "#fff";

export function buildTrayForestState(timer: TimerState, settings: AppSettings, countdownDurationOverride: number | null = null): TrayForestState {
  const todayStats = settings.forestStats.days[todayKey()] ?? { focusSeconds: 0, treesCompleted: 0 };
  const todayTrees = todayStats.treesCompleted;
  const todayFocus = formatDuration(todayStats.focusSeconds);
  const timeLabel = timer.isComplete ? "完成" : formatTime(timer.secondsLeft);
  const modeLabel = timer.phase === "countup" ? "正计时" : timer.countdownRole === "rest" ? "休息" : "专注";
  const titleLabel = `${timeLabel} · ${todayTrees}棵`;

  if (timer.phase === "countup") {
    const cycleSeconds = Math.max(60, settings.timer.focusMinutes * 60);
    const completedTrees = Math.floor(timer.secondsLeft / cycleSeconds);
    const cycleElapsed = timer.secondsLeft % cycleSeconds;

    return {
      title: titleLabel,
      tooltip: `贴纸番茄钟 · 正计时 · 本轮第 ${completedTrees + 1} 棵 · 今日 ${todayTrees} 棵 · ${todayFocus}`,
      stage: progressStage(cycleElapsed / cycleSeconds),
      iconVariant: "tree"
    };
  }

  const totalSeconds =
    countdownDurationOverride && countdownDurationOverride > 0
      ? countdownDurationOverride
      : durationForPhase("countdown", settings.timer, timer.countdownRole);
  const progress = timer.isComplete ? 1 : totalSeconds > 0 ? 1 - timer.secondsLeft / totalSeconds : 0;
  const iconVariant = timer.countdownRole === "rest" ? "rest-charge" : "tree";
  let stage = progressStage(progress);

  // Keep an actual tree silhouette visible while idle instead of the tiny sprout blob.
  if (iconVariant === "tree" && !timer.isRunning && !timer.isComplete) {
    stage = Math.max(settings.menuBar.treeStyle === "pixel" ? 2 : 1, stage);
  }

  return {
    title: titleLabel,
    tooltip: `贴纸番茄钟 · ${modeLabel} · 今日 ${todayTrees} 棵 · ${todayFocus}`,
    stage,
    iconVariant
  };
}

export function countdownStages(progress: number): number[] {
  const stage = progressStage(progress);
  return Array.from({ length: stage + 1 }, (_, index) => index);
}

export function countupStages(completedTrees: number, cycleProgress: number): number[] {
  const fullTrees = Math.min(5, Math.max(0, completedTrees));
  if (fullTrees >= 5) {
    return Array.from({ length: 5 }, () => 4);
  }

  return [
    ...Array.from({ length: fullTrees }, () => 4),
    progressStage(cycleProgress)
  ];
}

export function progressStage(progress: number): number {
  const safeProgress = Math.max(0, Math.min(1, progress));
  if (safeProgress >= 1) {
    return 4;
  }
  if (safeProgress >= 0.75) {
    return 3;
  }
  if (safeProgress >= 0.5) {
    return 2;
  }
  if (safeProgress >= 0.25) {
    return 1;
  }
  return 0;
}

export async function renderTrayForestIcon(
  stage: number,
  style: TreeStyle,
  iconVariant: TrayForestState["iconVariant"] = "tree"
): Promise<number[]> {
  const asset = await renderTrayForestIconAsset(stage, style, iconVariant);
  return asset.iconBytes;
}

export async function renderTrayForestIconAsset(
  stage: number,
  style: TreeStyle,
  iconVariant: TrayForestState["iconVariant"] = "tree"
): Promise<{ iconBytes: number[]; debugInfo: TrayIconDebugInfo }> {
  const canvas = document.createElement("canvas");
  const iconSize = TRAY_ICON_LOGICAL_SIZE;
  const scale = window.devicePixelRatio >= 2 ? 3 : 2;
  canvas.width = iconSize * scale;
  canvas.height = iconSize * scale;
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Tray icon canvas context unavailable");
  }

  context.scale(scale, scale);
  context.clearRect(0, 0, iconSize, iconSize);
  context.imageSmoothingEnabled = false;
  const safeStage = Math.max(0, Math.min(4, Math.floor(stage)));
  const image = await loadSvgImage(drawTrayIconSvg(safeStage, style, iconVariant));
  context.drawImage(image, 0, 0, iconSize, iconSize);
  const dataUrl = canvas.toDataURL("image/png");
  const base64 = dataUrl.split(",")[1];
  if (!base64) {
    throw new Error("Could not encode tray icon PNG");
  }

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  const iconBytes = Array.from(bytes);
  return {
    iconBytes,
    debugInfo: {
      source: "canvas-svg",
      phase: "render",
      logicalSize: iconSize,
      backingSize: canvas.width,
      scale,
      stage: safeStage,
      style,
      variant: iconVariant,
      renderState: "ok",
      template: !isWindows(),
      bytes: iconBytes.length,
      devicePixelRatio: window.devicePixelRatio || 1,
      userAgent: navigator.userAgent,
      runtime: window.__TAURI__ || window.__TAURI_INTERNALS__ ? "tauri" : "web"
    }
  };
}

export function drawTreePreviewSvg(stage: number, style: TreeStyle): string {
  const safeStage = Math.max(0, Math.min(4, Math.floor(stage)));
  return drawTrayIconSvg(safeStage, style, "tree");
}

export function drawTrayIconSvg(
  stage: number,
  style: TreeStyle,
  iconVariant: TrayForestState["iconVariant"] = "tree"
): string {
  const safeStage = Math.max(0, Math.min(4, Math.floor(stage)));
  const body = iconVariant === "rest-charge" ? restChargeSvgPath(safeStage) : treeSvgPath(safeStage, style);
  const rendering = style === "pixel" && iconVariant === "tree" ? ` shape-rendering="crispEdges"` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 18" aria-hidden="true" color="currentColor"${rendering}>${body}</svg>`;
}

function loadSvgImage(svg: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not render tray icon SVG"));
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.split("currentColor").join(TRAY_ICON_COLOR))}`;
  });
}

function treeSvgPath(stage: number, style: TreeStyle): string {
  if (style === "pixel") {
    const stages: Array<Array<[number, number, number, number]>> = [
      [
        [8, 10, 2, 4],
        [8, 7, 2, 3],
        [7, 8, 4, 1]
      ],
      [
        [8, 10, 2, 4],
        [8, 6, 2, 4],
        [6, 7, 6, 2]
      ],
      [
        [8, 9, 2, 6],
        [7, 5, 4, 4],
        [5, 6, 8, 2]
      ],
      [
        [8, 9, 2, 6],
        [7, 4, 4, 5],
        [5, 6, 8, 2]
      ],
      [
        [8, 9, 2, 6],
        [7, 4, 4, 5],
        [5, 6, 8, 2],
        [6, 3, 6, 1]
      ]
    ];
    const rects = stages[stage] ?? stages[0];
    return `<g fill="currentColor">${rects
      .map(([x, y, width, height]) => `<rect x="${x}" y="${y}" width="${width}" height="${height}"/>`)
      .join("")}</g>`;
  }
  if (style === "pine") {
    const stages = [
      `<rect fill="currentColor" x="8.35" y="9.4" width="1.3" height="4.8" rx="0.25"/><path fill="currentColor" d="M9 9.4c2.75-2.05 4.9-.75 5.6 1-2.6 1.2-4.85.55-5.6-1z"/>`,
      `<rect fill="currentColor" x="8.3" y="8.8" width="1.4" height="5.5" rx="0.25"/><path fill="currentColor" d="M9 8.85c2.9-2.15 5.25-.8 6 1.05-2.75 1.25-5.05.58-6-1.05zM9 10.2c-2.8-1.75-4.7-.45-5.5 1.25 2.6 1.1 4.75.45 5.5-1.25z"/>`,
      `<path fill="currentColor" d="M9 4.35l3.85 4.1h-2.05l3.45 4.05H3.75L7.2 8.45H5.15z"/><rect fill="currentColor" x="8.25" y="12.1" width="1.5" height="2.95" rx="0.25"/>`,
      `<path fill="currentColor" d="M9 3.1l4.35 4.6h-2.15l4.1 4.65h-2.95l3.45 3.65H2.2l3.45-3.65H2.7l4.1-4.65H4.65z"/><rect fill="currentColor" x="8.05" y="14.1" width="1.9" height="2" rx="0.25"/>`,
      `<path fill="currentColor" d="M9 2.15l4.75 4.9h-2.35l4.55 5h-3.25l3.85 4H1.45l3.85-4H2.05l4.55-5H4.25z"/><rect fill="currentColor" x="7.95" y="14.55" width="2.1" height="2.25" rx="0.25"/>`
    ];
    return stages[stage] ?? stages[0];
  }
  const isPotted = style === "potted";
  const baseline = isPotted ? 12.9 : 14.85;
  const trunkHeight = isPotted ? 2.5 + stage * 0.42 : 3.5 + stage * 0.7;
  const radius = (isPotted ? 1.65 : 2.05) + stage * (isPotted ? 0.52 : 0.62);
  const trunkTop = baseline - trunkHeight;
  const canopyY = Math.max(4.45, trunkTop - radius + (isPotted ? 0.45 : 0.65));
  const leaf = stage === 0
    ? `<ellipse fill="currentColor" cx="10.55" cy="${trunkTop - 0.85}" rx="2.15" ry="1.25" transform="rotate(-22 10.55 ${trunkTop - 0.85})"/>`
    : `<circle fill="currentColor" cx="9" cy="${canopyY}" r="${radius}"/><circle fill="currentColor" cx="${9 - radius * 0.72}" cy="${canopyY + radius * 0.55}" r="${radius * 0.58}"/><circle fill="currentColor" cx="${9 + radius * 0.72}" cy="${canopyY + radius * 0.55}" r="${radius * 0.58}"/>`;
  const pot = isPotted ? `<path fill="currentColor" d="M5.45 12.9h7.1l-1.25 3.15h-4.6z"/>` : "";
  const stamp = style === "stamp" ? `<path d="M4.2 15.15c2.35-2 7.25-2 9.6 0" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>` : "";
  return `${stamp}<rect fill="currentColor" x="8.2" y="${trunkTop}" width="1.6" height="${trunkHeight}" rx="0.35"/>${pot}${leaf}`;
}

function restChargeSvgPath(stage: number): string {
  const fillWidth = [0, 2.3, 4.7, 6.9, 8.6][stage];
  const fillX = 9 - fillWidth / 2;
  const fill = fillWidth > 0 ? `<rect fill="currentColor" x="${fillX}" y="6.35" width="${fillWidth}" height="4.3" rx="2.15"/>` : "";
  return `<g fill="none" stroke="currentColor" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round"><rect x="3.4" y="4.75" width="11.2" height="7.7" rx="3.85"/><path d="M6.1 15h5.8"/></g>${fill}`;
}
