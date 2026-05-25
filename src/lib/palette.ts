import type { BackgroundPalette } from "./types";

type Rgb = {
  r: number;
  g: number;
  b: number;
};

const SAMPLE_SIZE = 48;

export async function extractBackgroundPalette(src: string): Promise<BackgroundPalette> {
  const image = await loadImage(src);
  const canvas = document.createElement("canvas");
  const scale = Math.min(SAMPLE_SIZE / image.naturalWidth, SAMPLE_SIZE / image.naturalHeight, 1);
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));

  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    throw new Error("Canvas is unavailable");
  }

  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const samples: Rgb[] = [];

  for (let index = 0; index < pixels.length; index += 4) {
    const alpha = pixels[index + 3];
    if (alpha < 160) {
      continue;
    }

    const rgb = { r: pixels[index], g: pixels[index + 1], b: pixels[index + 2] };
    const saturation = getSaturation(rgb);
    const brightness = getLuminance(rgb);

    if (saturation > 0.08 && brightness > 0.08 && brightness < 0.94) {
      samples.push(rgb);
    }
  }

  const average = averageColor(samples.length ? samples : [{ r: 236, g: 91, b: 79 }]);
  const accent = tuneAccent(average);
  const isDark = getLuminance(average) < 0.44;

  return {
    accent: rgbToHex(accent),
    accentSoft: rgba(accent, isDark ? 0.24 : 0.2),
    ink: isDark ? "#fff6e7" : "#2b2724",
    line: isDark ? "#f2dec0" : "#2b2724",
    cardBg: isDark ? rgba({ r: 34, g: 31, b: 29 }, 0.62) : rgba({ r: 255, g: 250, b: 239 }, 0.56),
    panelBg: isDark ? rgba({ r: 34, g: 31, b: 29 }, 0.9) : rgba({ r: 255, g: 250, b: 239 }, 0.9),
    controlBg: isDark ? "#3a342f" : "#fffdf6",
    overlay: isDark ? "rgba(10, 9, 8, 0.28)" : "rgba(255, 247, 229, 0.18)",
    shadow: isDark ? "0 24px 70px rgba(0, 0, 0, 0.34)" : "0 24px 70px rgba(95, 54, 35, 0.2)",
    isDark
  };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not load background image"));
    image.src = src;
  });
}

function averageColor(samples: Rgb[]): Rgb {
  const total = samples.reduce(
    (sum, sample) => ({
      r: sum.r + sample.r,
      g: sum.g + sample.g,
      b: sum.b + sample.b
    }),
    { r: 0, g: 0, b: 0 }
  );

  return {
    r: Math.round(total.r / samples.length),
    g: Math.round(total.g / samples.length),
    b: Math.round(total.b / samples.length)
  };
}

function tuneAccent(color: Rgb): Rgb {
  const luminance = getLuminance(color);
  const factor = luminance < 0.32 ? 1.28 : luminance > 0.72 ? 0.82 : 1;
  return {
    r: clampColor(color.r * factor),
    g: clampColor(color.g * factor),
    b: clampColor(color.b * factor)
  };
}

function getSaturation(color: Rgb): number {
  const max = Math.max(color.r, color.g, color.b) / 255;
  const min = Math.min(color.r, color.g, color.b) / 255;
  return max === 0 ? 0 : (max - min) / max;
}

function getLuminance(color: Rgb): number {
  return (0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b) / 255;
}

function rgbToHex(color: Rgb): string {
  return `#${toHex(color.r)}${toHex(color.g)}${toHex(color.b)}`;
}

function toHex(value: number): string {
  return clampColor(value).toString(16).padStart(2, "0");
}

function rgba(color: Rgb, alpha: number): string {
  return `rgba(${clampColor(color.r)}, ${clampColor(color.g)}, ${clampColor(color.b)}, ${alpha})`;
}

function clampColor(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}
