import { DEFAULT_PROJECT_ID, type DailyForestStats, type ForestStats, type ProjectForestStats } from "./types";

export type HeatmapMetric = "trees" | "focus";

export interface HeatmapDay {
  date: string;
  stats: DailyForestStats;
  level: number;
  isFuture: boolean;
}

export interface ForestSummary {
  focusSeconds: number;
  treesCompleted: number;
}

type PersistedDailyForestStats = Partial<Omit<DailyForestStats, "projects">> & {
  projects?: Record<string, Partial<ProjectForestStats>>;
};

type PersistedForestStats = {
  days?: Record<string, PersistedDailyForestStats>;
};

const EMPTY_DAY: DailyForestStats = {
  focusSeconds: 0,
  treesCompleted: 0,
  projects: {}
};

const EMPTY_PROJECT_STATS: ProjectForestStats = {
  focusSeconds: 0,
  treesCompleted: 0
};

export function todayKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function normalizeForestStats(input: PersistedForestStats | undefined): ForestStats {
  const days: ForestStats["days"] = {};

  if (!input?.days || typeof input.days !== "object") {
    return { days };
  }

  const cutoff = pruneCutoff();

  for (const [date, value] of Object.entries(input.days)) {
    if (!isDateKey(date) || !value || typeof value !== "object") {
      continue;
    }

    if (date < cutoff) {
      continue;
    }

    const focusSeconds = normalizeCount(value.focusSeconds);
    const treesCompleted = normalizeCount(value.treesCompleted);
    const projects = normalizeProjectStats(value.projects);
    days[date] = { focusSeconds, treesCompleted, projects };
  }

  return { days };
}

export function pruneOldForestStats(stats: ForestStats, maxAgeDays = 365): ForestStats {
  const cutoff = todayKey(new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000));

  const days: ForestStats["days"] = {};
  for (const [date, value] of Object.entries(stats.days)) {
    if (date >= cutoff) {
      days[date] = value;
    }
  }

  return { days };
}

function pruneCutoff(): string {
  return todayKey(new Date(Date.now() - 365 * 24 * 60 * 60 * 1000));
}

export function addDailyForestProgress(
  stats: ForestStats,
  focusSeconds: number,
  treesCompleted = 0,
  date = new Date(),
  projectId = DEFAULT_PROJECT_ID
): ForestStats {
  const key = todayKey(date);
  const current = stats.days[key] ?? EMPTY_DAY;
  const currentProject = current.projects[projectId] ?? EMPTY_PROJECT_STATS;
  const safeFocusSeconds = Math.max(0, Math.floor(focusSeconds));
  const safeTreesCompleted = Math.max(0, Math.floor(treesCompleted));

  return {
    days: {
      ...stats.days,
      [key]: {
        focusSeconds: current.focusSeconds + safeFocusSeconds,
        treesCompleted: current.treesCompleted + safeTreesCompleted,
        projects: {
          ...current.projects,
          [projectId]: {
            focusSeconds: currentProject.focusSeconds + safeFocusSeconds,
            treesCompleted: currentProject.treesCompleted + safeTreesCompleted
          }
        }
      }
    }
  };
}

export function moveDailyForestProjectProgress(
  stats: ForestStats,
  focusSeconds: number,
  treesCompleted: number,
  date: Date | string,
  fromProjectId = DEFAULT_PROJECT_ID,
  toProjectId: string
): ForestStats {
  if (!toProjectId || toProjectId === fromProjectId) {
    return stats;
  }

  const key = typeof date === "string" ? date : todayKey(date);
  const current = stats.days[key] ?? EMPTY_DAY;
  const fromProject = current.projects[fromProjectId] ?? EMPTY_PROJECT_STATS;
  const toProject = current.projects[toProjectId] ?? EMPTY_PROJECT_STATS;
  const requestedFocusSeconds = Math.max(0, Math.floor(focusSeconds));
  const requestedTreesCompleted = Math.max(0, Math.floor(treesCompleted));
  const movedFocusSeconds = Math.min(requestedFocusSeconds, fromProject.focusSeconds);
  const movedTreesCompleted = Math.min(requestedTreesCompleted, fromProject.treesCompleted);

  if (movedFocusSeconds <= 0 && movedTreesCompleted <= 0) {
    return stats;
  }

  return {
    days: {
      ...stats.days,
      [key]: {
        ...current,
        projects: {
          ...current.projects,
          [fromProjectId]: {
            focusSeconds: Math.max(0, fromProject.focusSeconds - movedFocusSeconds),
            treesCompleted: Math.max(0, fromProject.treesCompleted - movedTreesCompleted)
          },
          [toProjectId]: {
            focusSeconds: toProject.focusSeconds + movedFocusSeconds,
            treesCompleted: toProject.treesCompleted + movedTreesCompleted
          }
        }
      }
    }
  };
}

export function buildHeatmapWeeks(
  stats: ForestStats,
  metric: HeatmapMetric,
  today = new Date(),
  weekCount = 12,
  projectId: string | null = null
): HeatmapDay[][] {
  const start = startOfWeek(today);
  start.setDate(start.getDate() - (weekCount - 1) * 7);

  return Array.from({ length: weekCount }, (_, weekIndex) =>
    Array.from({ length: 7 }, (_, dayIndex) => {
      const date = new Date(start);
      date.setDate(start.getDate() + weekIndex * 7 + dayIndex);
      const key = todayKey(date);
      const dayStats = statsForProject(stats.days[key], projectId);

      return {
        date: key,
        stats: dayStats,
        level: date > endOfDay(today) ? 0 : heatmapLevel(dayStats, metric),
        isFuture: date > endOfDay(today)
      };
    })
  );
}

export function summarizeRange(stats: ForestStats, range: "day" | "week" | "month", today = new Date()): ForestSummary {
  return summarizeProjectRange(stats, range, today);
}

export function summarizeProjectRange(
  stats: ForestStats,
  range: "day" | "week" | "month",
  today = new Date(),
  projectId: string | null = null
): ForestSummary {
  const start = range === "day" ? startOfDay(today) : range === "week" ? startOfWeek(today) : startOfMonth(today);
  const end = endOfDay(today);

  return Object.entries(stats.days).reduce<ForestSummary>(
    (summary, [key, value]) => {
      const date = parseDateKey(key);
      if (!date || date < start || date > end) {
        return summary;
      }

      const statsValue = statsForProject(value, projectId);
      return {
        focusSeconds: summary.focusSeconds + statsValue.focusSeconds,
        treesCompleted: summary.treesCompleted + statsValue.treesCompleted
      };
    },
    { focusSeconds: 0, treesCompleted: 0 }
  );
}

export function heatmapLevel(stats: ProjectForestStats, metric: HeatmapMetric): number {
  if (stats.focusSeconds <= 0 && stats.treesCompleted <= 0) {
    return 0;
  }

  if (metric === "trees") {
    return clampLevel(stats.treesCompleted);
  }

  return focusLevel(stats.focusSeconds / 60);
}

export function formatDuration(seconds: number): string {
  const totalMinutes = Math.floor(Math.max(0, seconds) / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) {
    return `${minutes}分钟`;
  }

  return minutes === 0 ? `${hours}小时` : `${hours}小时${minutes}分钟`;
}

function focusLevel(minutes: number): number {
  if (minutes >= 100) {
    return 4;
  }
  if (minutes >= 50) {
    return 3;
  }
  if (minutes >= 25) {
    return 2;
  }
  return 1;
}

function clampLevel(value: number): number {
  if (value >= 5) {
    return 4;
  }
  if (value >= 3) {
    return 3;
  }
  if (value >= 1) {
    return 2;
  }
  return 1;
}

function normalizeProjectStats(input: unknown): Record<string, ProjectForestStats> {
  if (!input || typeof input !== "object") {
    return {};
  }

  return Object.entries(input).reduce<Record<string, ProjectForestStats>>((projects, [projectId, value]) => {
    if (!isProjectId(projectId) || !value || typeof value !== "object") {
      return projects;
    }

    const stats = value as Partial<ProjectForestStats>;
    projects[projectId] = {
      focusSeconds: normalizeCount(stats.focusSeconds),
      treesCompleted: normalizeCount(stats.treesCompleted)
    };
    return projects;
  }, {});
}

function statsForProject(day: DailyForestStats | undefined, projectId: string | null): DailyForestStats {
  if (!day || !projectId) {
    return day ?? EMPTY_DAY;
  }

  const stats = day.projects[projectId] ?? EMPTY_PROJECT_STATS;
  return {
    focusSeconds: stats.focusSeconds,
    treesCompleted: stats.treesCompleted,
    projects: {}
  };
}

function normalizeCount(value: unknown): number {
  return Math.max(0, Math.floor(Number(value) || 0));
}

function isProjectId(value: string): boolean {
  return /^[a-zA-Z0-9_-]{1,48}$/.test(value);
}

function isDateKey(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function parseDateKey(value: string): Date | null {
  if (!isDateKey(value)) {
    return null;
  }

  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function endOfDay(date: Date): Date {
  const end = startOfDay(date);
  end.setHours(23, 59, 59, 999);
  return end;
}

function startOfWeek(date: Date): Date {
  const start = startOfDay(date);
  start.setDate(start.getDate() - start.getDay());
  return start;
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}
