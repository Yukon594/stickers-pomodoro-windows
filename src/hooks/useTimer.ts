import { useEffect, useRef } from "react";
import { useSyncedRef } from "./useSyncedRef";
import { durationForPhase } from "../lib/timer";
import type { AppSettings, CountdownRole, FocusOverride, Phase, TimerState } from "../lib/types";

interface UseTimerOptions {
  settingsRef: { current: AppSettings };
  onTick: (focusSeconds: number, treesCompleted: number) => void;
  onComplete: (completedFocusSessions: number, countdownRole: CountdownRole) => void;
}

export type { FocusOverride };

export function useTimer({ settingsRef, onTick, onComplete }: UseTimerOptions) {
  const [timer, setTimer, timerRef] = useSyncedRef<TimerState>({
    phase: "countdown",
    countdownRole: "focus",
    secondsLeft: durationForPhase("countdown", settingsRef.current.timer),
    isRunning: false,
    completedFocusSessions: 0,
    isComplete: false
  });

  const [focusOverride, setFocusOverride, focusOverrideRef] = useSyncedRef<FocusOverride | null>(null);
  const lastTimerTickAtRef = useRef<number | null>(null);

  function currentTimerDuration(timerState: TimerState): number {
    if (timerState.phase === "countdown" && timerState.countdownRole === "focus" && focusOverrideRef.current) {
      return focusOverrideRef.current.seconds;
    }
    return durationForPhase(timerState.phase, settingsRef.current.timer, timerState.countdownRole);
  }

  function currentTimerDurationFromRefs(timerState: TimerState): number {
    const override = focusOverrideRef.current;
    if (timerState.phase === "countdown" && timerState.countdownRole === "focus" && override) {
      return override.seconds;
    }
    return durationForPhase(timerState.phase, settingsRef.current.timer, timerState.countdownRole);
  }

  useEffect(() => {
    if (!timer.isRunning) {
      lastTimerTickAtRef.current = null;
      return;
    }

    lastTimerTickAtRef.current = Date.now();

    const applyElapsedTime = () => {
      const now = Date.now();
      const lastTickAt = lastTimerTickAtRef.current ?? now;
      const elapsedSeconds = Math.floor((now - lastTickAt) / 1000);

      if (elapsedSeconds <= 0) {
        return;
      }

      lastTimerTickAtRef.current = lastTickAt + elapsedSeconds * 1000;

      setTimer((current) => {
        if (!current.isRunning) {
          return current;
        }

        const currentSettings = settingsRef.current;

        if (current.phase === "countup") {
          const nextSeconds = current.secondsLeft + elapsedSeconds;
          const focusDuration = Math.max(60, currentSettings.timer.focusMinutes * 60);
          const completedTrees = Math.floor(nextSeconds / focusDuration) - Math.floor(current.secondsLeft / focusDuration);
          onTick(elapsedSeconds, completedTrees);
          return { ...current, secondsLeft: nextSeconds };
        }

        if (elapsedSeconds >= current.secondsLeft) {
          const completedFocusSessions =
            current.countdownRole === "focus" ? current.completedFocusSessions + 1 : current.completedFocusSessions;
          if (current.countdownRole === "focus") {
            onTick(current.secondsLeft, 1);
          }
          window.setTimeout(() => onComplete(completedFocusSessions, current.countdownRole), 0);
          return { ...current, secondsLeft: 0, isRunning: false, isComplete: true, completedFocusSessions };
        }

        if (current.countdownRole === "focus") {
          onTick(elapsedSeconds, 0);
        }
        return { ...current, secondsLeft: current.secondsLeft - elapsedSeconds };
      });
    };

    const id = window.setInterval(applyElapsedTime, 250);
    document.addEventListener("visibilitychange", applyElapsedTime);
    window.addEventListener("focus", applyElapsedTime);

    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", applyElapsedTime);
      window.removeEventListener("focus", applyElapsedTime);
    };
  }, [timer.isRunning, timer.countdownRole, timer.phase, onTick, onComplete, settingsRef, setTimer]);

  function toggleTimer() {
    const current = timerRef.current;
    const wasRunning = current.isRunning;
    const startRole: CountdownRole =
      current.phase === "countdown" && current.isComplete
        ? current.countdownRole === "focus"
          ? "rest"
          : "focus"
        : current.phase === "countdown"
          ? current.countdownRole
          : "focus";

    if (current.isComplete && current.phase === "countdown") {
      advanceCountdown(true);
    } else {
      setTimer((cur) => ({ ...cur, isRunning: !cur.isRunning }));
    }

    return { wasRunning, startRole };
  }

  function advanceCountdown(shouldRun: boolean) {
    const current = timerRef.current;
    const nextRole: CountdownRole = current.countdownRole === "focus" ? "rest" : "focus";
    setFocusOverride(null);
    setTimer((cur) => ({
      ...cur,
      countdownRole: nextRole,
      secondsLeft: durationForPhase("countdown", settingsRef.current.timer, nextRole),
      isRunning: shouldRun,
      isComplete: false
    }));
  }

  function resetTimer() {
    setTimer((current) => ({
      ...current,
      secondsLeft: currentTimerDuration(current),
      isRunning: false,
      isComplete: false
    }));
  }

  function skipPhase() {
    if (timerRef.current.phase === "countdown") {
      advanceCountdown(false);
    } else {
      resetTimer();
    }
  }

  function changePhase(phase: Phase, shouldRun = false) {
    setFocusOverride(null);
    setTimer((current) => ({
      ...current,
      phase,
      countdownRole: "focus",
      secondsLeft: durationForPhase(phase, settingsRef.current.timer, "focus"),
      isRunning: shouldRun,
      isComplete: false
    }));
  }

  function startRestCountdown() {
    setFocusOverride(null);
    setTimer((current) => ({
      ...current,
      phase: "countdown",
      countdownRole: "rest",
      secondsLeft: durationForPhase("countdown", settingsRef.current.timer, "rest"),
      isRunning: true,
      isComplete: false
    }));
  }

  function startFocusCountdown(overrideSeconds?: number, overridePresetId?: string) {
    const nextOverride = overrideSeconds && overridePresetId
      ? { seconds: overrideSeconds, presetId: overridePresetId, trackForest: true }
      : null;
    setFocusOverride(nextOverride);
    setTimer((current) => ({
      ...current,
      phase: "countdown",
      countdownRole: "focus",
      secondsLeft: nextOverride?.seconds ?? durationForPhase("countdown", settingsRef.current.timer, "focus"),
      isRunning: true,
      isComplete: false
    }));
  }

  function startQuickStart(seconds: number, presetId: string, trackForest: boolean) {
    setFocusOverride({ seconds, presetId, trackForest });
    setTimer((current) => ({
      ...current,
      phase: "countdown",
      countdownRole: "focus",
      secondsLeft: seconds,
      isRunning: true,
      isComplete: false
    }));
  }

  return {
    timer,
    timerRef,
    focusOverride,
    focusOverrideRef,
    currentTimerDuration,
    currentTimerDurationFromRefs,
    setFocusOverride,
    setTimer,
    toggleTimer,
    advanceCountdown,
    resetTimer,
    skipPhase,
    changePhase,
    startRestCountdown,
    startFocusCountdown,
    startQuickStart
  };
}
