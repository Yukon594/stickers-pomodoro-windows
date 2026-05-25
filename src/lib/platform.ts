/** Detect if running on macOS. */
export function isMacOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad|iPod/.test(navigator.userAgent) ||
         /Mac|iPhone|iPad|iPod/.test(navigator.platform ?? "");
}

/** Detect if running on Windows. */
export function isWindows(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Win/.test(navigator.userAgent) ||
         /Win/.test(navigator.platform ?? "");
}

/** Platform-appropriate shortcut modifier display name. */
export function shortcutModifierName(): string {
  return isMacOS() ? "Option" : "Alt";
}

/** Font family for the current platform. */
export function platformFontFamily(): string {
  if (isMacOS()) {
    return `"Avenir Next Rounded", "Hiragino Maru Gothic ProN", "Yuanti SC", "PingFang SC", sans-serif`;
  }
  return `"Segoe UI Variable", "Segoe UI", "Microsoft YaHei", "Microsoft JhengHei", sans-serif`;
}
