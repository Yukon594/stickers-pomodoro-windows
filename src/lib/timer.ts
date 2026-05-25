import type { Corner, CornerMode, CountdownRole, Phase, TimerSettings } from "./types";

export const PHASE_LABELS: Record<Phase, string> = {
  countdown: "倒计时",
  countup: "正计时"
};

export const CORNERS: Corner[] = ["top-left", "top-center", "top-right"];

export function durationForPhase(phase: Phase, settings: TimerSettings, countdownRole: CountdownRole = "focus"): number {
  if (phase === "countup") {
    return 0;
  }

  const minutes = countdownRole === "rest" ? settings.restMinutes : settings.focusMinutes;
  return Math.max(1, Math.round(minutes)) * 60;
}

export function nextPhase(current: Phase, completedFocusSessions: number, settings: TimerSettings): Phase {
  return current === "countdown" ? "countup" : "countdown";
}

export function formatTime(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

export function resolveCorner(mode: CornerMode, previous: Corner | null, focusCount: number): Corner {
  if (CORNERS.includes(mode as Corner)) {
    return mode as Corner;
  }

  return "top-right";
}
