import { useState } from "react";
import type { AppSettings, StickerItem } from "../lib/types";
import type { AppSettingsPatch } from "./useSettings";

function createId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function useStickers(
  settings: AppSettings,
  settingsRef: { current: AppSettings },
  patchSettings: (patch: AppSettingsPatch) => void
) {
  const [stickerMode, setStickerMode] = useState(false);
  const [selectedStickerId, setSelectedStickerId] = useState<string | null>(null);

  function addSticker(src: string) {
    const sticker: StickerItem = {
      id: createId(),
      src,
      x: 22 + Math.random() * 46,
      y: 28 + Math.random() * 34,
      size: 74,
      rotation: Math.round(-8 + Math.random() * 16),
      flipped: false
    };

    patchSettings({ stickers: [...settingsRef.current.stickers, sticker] });
    setSelectedStickerId(sticker.id);
    setStickerMode(true);
  }

  function updateSticker(id: string, patch: Partial<StickerItem>) {
    patchSettings({
      stickers: settingsRef.current.stickers.map((sticker) =>
        sticker.id === id ? { ...sticker, ...patch } : sticker
      )
    });
  }

  function deleteSelectedSticker() {
    if (!selectedStickerId) {
      return;
    }
    patchSettings({
      stickers: settingsRef.current.stickers.filter((sticker) => sticker.id !== selectedStickerId)
    });
    setSelectedStickerId(null);
  }

  function rotateSelectedSticker() {
    const selected = settingsRef.current.stickers.find((sticker) => sticker.id === selectedStickerId);
    if (selected) {
      updateSticker(selected.id, { rotation: selected.rotation + 15 });
    }
  }

  function flipSelectedSticker() {
    const selected = settingsRef.current.stickers.find((sticker) => sticker.id === selectedStickerId);
    if (selected) {
      updateSticker(selected.id, { flipped: !selected.flipped });
    }
  }

  function moveSticker(event: React.PointerEvent<HTMLButtonElement>, sticker: StickerItem) {
    event.preventDefault();
    event.stopPropagation();
    setSelectedStickerId(sticker.id);
    setStickerMode(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function dragSticker(event: React.PointerEvent<HTMLButtonElement>, sticker: StickerItem, cardRef: { current: HTMLElement | null }) {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
      return;
    }

    const card = cardRef.current;
    if (!card) {
      return;
    }

    const rect = card.getBoundingClientRect();
    const x = clamp(((event.clientX - rect.left) / rect.width) * 100, 7, 93);
    const y = clamp(((event.clientY - rect.top) / rect.height) * 100, 9, 91);
    updateSticker(sticker.id, { x, y });
  }

  return {
    stickerMode,
    setStickerMode,
    selectedStickerId,
    setSelectedStickerId,
    addSticker,
    updateSticker,
    deleteSelectedSticker,
    rotateSelectedSticker,
    flipSelectedSticker,
    moveSticker,
    dragSticker
  };
}
