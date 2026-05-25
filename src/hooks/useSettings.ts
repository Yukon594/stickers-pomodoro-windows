import { useEffect, useMemo, useRef, useState } from "react";
import { useSyncedRef } from "./useSyncedRef";
import { defaultSettings, displayAvatarSrc, loadSettings, saveSettings } from "../lib/storage";
import type { AppSettings } from "../lib/types";

export type AppSettingsPatch = {
  timer?: Partial<AppSettings["timer"]>;
  avatar?: Partial<AppSettings["avatar"]>;
  background?: Partial<AppSettings["background"]>;
  reminder?: Partial<AppSettings["reminder"]>;
  theme?: Partial<AppSettings["theme"]>;
  menuBar?: Partial<AppSettings["menuBar"]>;
  stickers?: AppSettings["stickers"];
  projects?: AppSettings["projects"];
  activeProjectId?: AppSettings["activeProjectId"];
  todos?: AppSettings["todos"];
  activeTodoId?: AppSettings["activeTodoId"];
  quickStartPresets?: AppSettings["quickStartPresets"];
  forestStats?: AppSettings["forestStats"];
};

export function useSettings() {
  const [settings, setSettings, settingsRef] = useSyncedRef<AppSettings>(defaultSettings);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const settingsLoadedRef = useRef(false);

  useEffect(() => {
    loadSettings().then((loaded) => {
      setSettings(loaded);
      settingsLoadedRef.current = true;
      setSettingsLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (!settingsLoadedRef.current) {
      return;
    }
    saveSettings(settings).catch((error) => console.warn("Could not save settings", error));
  }, [settings]);

  const avatarSrc = useMemo(() => displayAvatarSrc(settings.avatar), [settings.avatar]);

  function patchSettings(patch: AppSettingsPatch) {
    setSettings((current) => ({
      timer: { ...current.timer, ...patch.timer },
      avatar: { ...current.avatar, ...patch.avatar },
      background: { ...current.background, ...patch.background },
      reminder: { ...current.reminder, ...patch.reminder },
      theme: { ...current.theme, ...patch.theme },
      menuBar: { ...current.menuBar, ...patch.menuBar },
      stickers: patch.stickers ?? current.stickers,
      projects: patch.projects ?? current.projects,
      activeProjectId: patch.activeProjectId ?? current.activeProjectId,
      todos: patch.todos ?? current.todos,
      activeTodoId: patch.activeTodoId === undefined ? current.activeTodoId : patch.activeTodoId,
      quickStartPresets: patch.quickStartPresets ?? current.quickStartPresets,
      forestStats: patch.forestStats ?? current.forestStats
    }));
  }

  return { settings, settingsRef, settingsLoaded, patchSettings, avatarSrc };
}
