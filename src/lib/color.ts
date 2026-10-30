/**
 * 专辑封面主色提取
 * ------------------------------------------------------------------
 * 通过 canvas 读取封面像素 → k-means 聚类 → 饱和度/亮度整型，
 * 得到一组适合做 Apple Music 式"氛围背景"的高饱和主色。
 * 网易云的图片域名的 CORS 不稳定，所以这里做了多级兜底：
 *   1. 直接 crossOrigin=anonymous 读取
 *   2. 走 wsrv.nl 图片代理（带 Access-Control-Allow-Origin: *）
 *   3. 全部失败 → 使用内置的兜底色板
 */

export type Palette = {
  /** 5 个主色，按饱和度从高到低 */
  colors: string[];
  /** 是否为偏暗封面 */
  dark: boolean;
  /** 颜色来源 */
  source: 'canvas' | 'proxy' | 'fallback';
};

export const FALLBACK_PALETTE: Palette = {
  colors: ['#b31b22', '#1e3d68', '#c8432a', '#7a2439', '#2a1b3d'],
  dark: true,
  source: 'fallback',
};

/* ------------------------------ 色彩工具 ------------------------------ */

export function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

export function rgbToHsl(r: number, g: number, b: number) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
        break;
      case g:
        h = ((b - r) / d + 2) * 60;
        break;
      default:
        h = ((r - g) / d + 4) * 60;
    }
  }
  return { h, s, l };
}

export function hslToHex(h: number, s: number, l: number) {
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const v = l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
    return Math.round(clamp(v, 0, 1) * 255)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

export function hexToRgb(hex: string) {
  const clean = hex.replace('#', '');
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean;
  const num = parseInt(full, 16);
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}

export function withAlpha(hex: string, alpha: number) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** 把封面主色拉成 UI 用的强调色：更亮、更饱和 */
export function accent(hex: string, lBoost = 0.16) {
  const { r, g, b } = hexToRgb(hex);
  const { h, s, l } = rgbToHsl(r, g, b);
  return hslToHex(h, clamp(s * 1.25, 0.55, 0.92), clamp(l + lBoost, 0.45, 0.72));
}

/* ------------------------------ 像素聚类 ------------------------------ */

type Vec = [number, number, number];

function kmeans(points: Vec[], k: number, iterations = 10) {
  if (points.length === 0) return [] as Vec[];
  const centers: Vec[] = [];
  const step = Math.max(1, Math.floor(points.length / k));
  for (let i = 0; i < k; i++) centers.push([...points[Math.min(points.length - 1, i * step)]] as Vec);

  let assignment = new Array(points.length).fill(0);
  for (let iter = 0; iter < iterations; iter++) {
    let moved = false;
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < centers.length; c++) {
        const dr = p[0] - centers[c][0];
        const dg = p[1] - centers[c][1];
        const db = p[2] - centers[c][2];
        const d = dr * dr + dg * dg + db * db;
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      if (assignment[i] !== best) {
        assignment[i] = best;
        moved = true;
      }
    }
    const sums = centers.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < points.length; i++) {
      const a = assignment[i];
      sums[a][0] += points[i][0];
      sums[a][1] += points[i][1];
      sums[a][2] += points[i][2];
      sums[a][3] += 1;
    }
    for (let c = 0; c < centers.length; c++) {
      if (sums[c][3] > 0) {
        centers[c] = [
          sums[c][0] / sums[c][3],
          sums[c][1] / sums[c][3],
          sums[c][2] / sums[c][3],
        ];
      }
    }
    if (!moved && iter > 2) break;
  }
  return centers;
}

function readPixels(img: HTMLImageElement, size: number): Vec[] | null {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, size, size);
  try {
    const { data } = ctx.getImageData(0, 0, size, size);
    const pts: Vec[] = [];
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 200) continue;
      pts.push([data[i], data[i + 1], data[i + 2]]);
    }
    return pts;
  } catch {
    return null;
  }
}

function loadimage(src: string, crossOrigin?: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    if (crossOrigin) img.crossOrigin = crossOrigin;
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`load failed: ${src}`));
    img.src = src;
  });
}

function paletteFromPixels(pts: Vec[], source: Palette['source']): Palette {
  const centers = kmeans(pts, 6, 12);
  const scored = centers
    .map((c) => {
      const { h, s, l } = rgbToHsl(c[0], c[1], c[2]);
      return { h, s, l, weight: s * 0.7 + (1 - Math.abs(l - 0.45)) * 0.3 };
    })
    .sort((a, b) => b.weight - a.weight);

  const colors = scored.slice(0, 5).map(({ h, s, l }) =>
    // 关键一步：把封面的颜色"提纯"，Apple Music 的背景比封面本身鲜艳得多
    hslToHex(h, clamp(s * 1.5 + 0.12, 0.42, 0.95), clamp(l * 0.95 + 0.04, 0.2, 0.6)),
  );

  const avgL = scored.reduce((acc, c) => acc + c.l, 0) / Math.max(1, scored.length);
  return { colors, dark: avgL < 0.5, source };
}

/** 主入口：传入任意图片地址，返回主色板 */
export async function extractPalette(imageUrl: string): Promise<Palette> {
  const candidates: Array<{ src: string; crossOrigin?: string; source: Palette['source'] }> = [
    { src: imageUrl, crossOrigin: 'anonymous', source: 'canvas' },
    {
      src: `https://wsrv.nl/?url=${encodeURIComponent(imageUrl)}&w=64&h=64&output=jpg`,
      crossOrigin: 'anonymous',
      source: 'proxy',
    },
  ];

  for (const candidate of candidates) {
    try {
      const img = await loadimage(candidate.src, candidate.crossOrigin);
      const pts = readPixels(img, 32);
      if (pts && pts.length > 24) return paletteFromPixels(pts, candidate.source);
    } catch {
      /* 继续尝试下一个来源 */
    }
  }
  return FALLBACK_PALETTE;
}
