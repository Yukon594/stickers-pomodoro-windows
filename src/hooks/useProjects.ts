import { useMemo, useState } from "react";
import { useSyncedRef } from "./useSyncedRef";
import { DEFAULT_PROJECT_ID } from "../lib/types";
import { PROJECT_COLORS } from "../lib/storage";
import { moveDailyForestProjectProgress } from "../lib/stats";
import type { AppSettings, ProjectItem } from "../lib/types";
import type { AppSettingsPatch } from "./useSettings";

export function useProjects(
  settings: AppSettings,
  settingsRef: { current: AppSettings },
  patchSettings: (patch: AppSettingsPatch) => void
) {
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [editingProjectName, setEditingProjectName] = useState("");
  const [colorEditingProjectId, setColorEditingProjectId] = useState<string | null>(null);
  const [pendingProjectTransfer, setPendingProjectTransfer, pendingProjectTransferRef] = useSyncedRef<{
    date: string;
    focusSeconds: number;
    treesCompleted: number;
  } | null>(null);

  const activeProjects = useMemo(
    () => settings.projects.filter((project) => !project.archived),
    [settings.projects]
  );
  const activeProject = useMemo(
    () =>
      activeProjects.find((project) => project.id === settings.activeProjectId) ??
      activeProjects.find((project) => project.id === DEFAULT_PROJECT_ID) ??
      settings.projects[0],
    [activeProjects, settings.activeProjectId, settings.projects]
  );

  function closeProjectMenu() {
    setProjectMenuOpen(false);
    setColorEditingProjectId(null);
    cancelRenameProject();
  }

  function movePendingProjectTransfer(projectId: string): boolean {
    const pending = pendingProjectTransferRef.current;
    if (!pending || projectId === DEFAULT_PROJECT_ID) {
      return false;
    }

    patchSettings({
      activeProjectId: projectId,
      forestStats: moveDailyForestProjectProgress(
        settingsRef.current.forestStats,
        pending.focusSeconds,
        pending.treesCompleted,
        pending.date,
        DEFAULT_PROJECT_ID,
        projectId
      )
    });
    setPendingProjectTransfer(null);
    return true;
  }

  function selectProject(projectId: string) {
    if (!movePendingProjectTransfer(projectId)) {
      patchSettings({ activeProjectId: projectId });
    }
    closeProjectMenu();
  }

  function createProject(name: string) {
    const trimmed = name.trim().replace(/\s+/g, " ").slice(0, 12);
    if (!trimmed) {
      return;
    }

    const project: ProjectItem = {
      id: `project-${Date.now().toString(36)}`,
      name: trimmed,
      color: PROJECT_COLORS[settings.projects.length % PROJECT_COLORS.length],
      archived: false
    };

    const pending = pendingProjectTransferRef.current;
    patchSettings({
      projects: [...settingsRef.current.projects, project],
      activeProjectId: project.id,
      forestStats: pending
        ? moveDailyForestProjectProgress(
            settingsRef.current.forestStats,
            pending.focusSeconds,
            pending.treesCompleted,
            pending.date,
            DEFAULT_PROJECT_ID,
            project.id
          )
        : undefined
    });
    if (pending) {
      setPendingProjectTransfer(null);
    }
  }

  function deleteProject(projectId: string) {
    if (projectId === DEFAULT_PROJECT_ID) {
      return;
    }

    patchSettings({
      projects: settingsRef.current.projects.map((project) =>
        project.id === projectId ? { ...project, archived: true } : project
      ),
      activeProjectId: settingsRef.current.activeProjectId === projectId ? DEFAULT_PROJECT_ID : settingsRef.current.activeProjectId
    });
    if (editingProjectId === projectId) {
      cancelRenameProject();
    }
  }

  function beginRenameProject(project: ProjectItem) {
    if (project.id === DEFAULT_PROJECT_ID) {
      return;
    }
    setColorEditingProjectId(null);
    setEditingProjectId(project.id);
    setEditingProjectName(project.name);
  }

  function cancelRenameProject() {
    setEditingProjectId(null);
    setEditingProjectName("");
  }

  function commitRenameProject(projectId: string) {
    const name = editingProjectName.trim().replace(/\s+/g, " ").slice(0, 12);
    if (!name || projectId === DEFAULT_PROJECT_ID) {
      cancelRenameProject();
      return;
    }

    patchSettings({
      projects: settingsRef.current.projects.map((project) =>
        project.id === projectId ? { ...project, name } : project
      )
    });
    cancelRenameProject();
  }

  function updateProjectColor(projectId: string, color: string) {
    patchSettings({
      projects: settingsRef.current.projects.map((project) =>
        project.id === projectId ? { ...project, color } : project
      )
    });
    setColorEditingProjectId(null);
  }

  return {
    projectMenuOpen,
    setProjectMenuOpen,
    newProjectName,
    setNewProjectName,
    editingProjectId,
    editingProjectName,
    setEditingProjectName,
    setEditingProjectId,
    colorEditingProjectId,
    setColorEditingProjectId,
    pendingProjectTransfer,
    pendingProjectTransferRef,
    activeProjects,
    activeProject,
    closeProjectMenu,
    selectProject,
    createProject,
    deleteProject,
    beginRenameProject,
    commitRenameProject,
    updateProjectColor,
    cancelRenameProject,
    setPendingProjectTransfer
  };
}
