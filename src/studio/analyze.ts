import { CatLook, Pattern, RGB, rgbToHex } from '../renderer/look';

// 从一张照片里估计猫的毛色和花纹。
// 思路:假设猫在画面中间,对中间区域的颜色做聚类;在画面边缘更常见的颜色当作背景丢掉。
// 这是启发式估计,结果需要用户在页面上确认和微调。

type Lab = [number, number, number];

const lin = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
};
const gam = (v: number) => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(Math.max(v, 0), 1 / 2.4) - 0.055);

function toLab(r: number, g: number, b: number): Lab {
  const R = lin(r), G = lin(g), B = lin(b);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function fromLab([L, a, b]: Lab): RGB {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    gam(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    gam(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    gam(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

const dist = (p: Lab, q: Lab) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
const chroma = (p: Lab) => Math.hypot(p[1], p[2]);

function kmeans(samples: Lab[], k: number): { center: Lab; count: number }[] {
  const sorted = [...samples].sort((p, q) => p[0] - q[0]);
  let centers: Lab[] = Array.from({ length: k }, (_, i) => [...sorted[Math.floor(((i + 0.5) / k) * sorted.length)]] as Lab);
  let counts = new Array(k).fill(0);
  for (let iter = 0; iter < 14; iter++) {
    const sums = centers.map(() => [0, 0, 0]);
    counts = new Array(k).fill(0);
    for (const p of samples) {
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < k; c++) {
        const d = dist(p, centers[c]);
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      counts[best]++;
      sums[best][0] += p[0];
      sums[best][1] += p[1];
      sums[best][2] += p[2];
    }
    centers = centers.map((c, i) => (counts[i] ? (sums[i].map((v) => v / counts[i]) as Lab) : c));
  }
  return centers.map((center, i) => ({ center, count: counts[i] }));
}

/** 卡通化:提高一点饱和度,让照片里发灰的毛色更干净 */
function cartoon(p: Lab): string {
  const boost = p[0] < 0.3 ? 1 : 1.2;
  return rgbToHex(fromLab([p[0], p[1] * boost, p[2] * boost]));
}

export interface Swatch {
  hex: string;
  share: number;
}

export interface Analysis {
  look: Partial<CatLook>;
  palette: Swatch[];
}

export function analyze(img: ImageData): Analysis {
  const { width: w, height: h, data } = img;
  const center: Lab[] = [];
  const border: Lab[] = [];
  const edge = Math.max(2, Math.round(Math.min(w, h) * 0.07));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (data[i + 3] < 128) continue;
      const nx = (x - w / 2) / (w * 0.34);
      const ny = (y - h / 2) / (h * 0.34);
      const inCenter = nx * nx + ny * ny < 1;
      const inBorder = x < edge || y < edge || x >= w - edge || y >= h - edge;
      if (!inCenter && !inBorder) continue;
      (inCenter ? center : border).push(toLab(data[i], data[i + 1], data[i + 2]));
    }
  }
  if (center.length < 50) return { look: {}, palette: [] };

  // 曝光校正:照片偏暗时白毛会发灰,按全图最亮的部分把亮度拉回来
  const allL = [...center, ...border].map((p) => p[0]).sort((a, b) => a - b);
  const gain = Math.min(1.4, Math.max(1, 0.93 / (allL[Math.floor(allL.length * 0.98)] || 1)));
  for (const p of center) p[0] *= gain;
  for (const p of border) p[0] *= gain;

  const clusters = kmeans(center, 5).map((c) => ({ ...c, share: c.count / center.length, border: 0 }));
  for (const p of border) {
    let best = -1;
    let bestD = 0.08;
    clusters.forEach((c, i) => {
      const d = dist(p, c.center);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    if (best >= 0) clusters[best].border += 1 / Math.max(1, border.length);
  }

  // 去掉背景色;如果去得太多(比如猫占满画面),就全部保留
  let kept = clusters.filter((c) => c.share >= 0.06 && c.share > c.border * 0.9);
  if (kept.reduce((s, c) => s + c.share, 0) < 0.3) kept = clusters.filter((c) => c.share >= 0.06);

  // 合并过于接近的颜色
  const merged: { center: Lab; share: number }[] = [];
  for (const c of [...kept].sort((p, q) => q.share - p.share)) {
    const near = merged.find((m) => dist(m.center, c.center) < 0.055);
    if (near) {
      const total = near.share + c.share;
      near.center = near.center.map((v, i) => (v * near.share + c.center[i] * c.share) / total) as Lab;
      near.share = total;
    } else {
      merged.push({ center: c.center, share: c.share });
    }
  }
  const total = merged.reduce((s, c) => s + c.share, 0) || 1;
  merged.forEach((c) => (c.share /= total));

  const isWhite = (p: Lab) => p[0] > 0.85 && chroma(p) < 0.05;
  const whites = merged.filter((c) => isWhite(c.center));
  const colored = merged.filter((c) => !isWhite(c.center));
  const whiteShare = whites.reduce((s, c) => s + c.share, 0);

  const look: Partial<CatLook> = {};
  const palette = merged.map((c) => ({ hex: cartoon(c.center), share: c.share }));

  if (whites.length) {
    const p = whites[0].center;
    look.white = rgbToHex(fromLab([Math.max(p[0], 0.96), p[1] * 0.6, p[2] * 0.6]));
  }
  if (!colored.length) {
    // 白猫
    look.base = look.white ?? '#fbf7f0';
    look.marking = '#e6ddd0';
    look.pattern = 'solid';
    look.belly = 0;
    look.socks = false;
    look.muzzle = false;
    return { look, palette };
  }

  /** 深色毛是细碎的条纹(返回值大)还是成片的色块(返回值小):看深色像素有多少紧挨着浅色 */
  const stripiness = (dark: Lab, light: Lab) => {
    const refs = [dark, light, ...whites.map((c) => c.center)];
    const label = (x: number, y: number) => {
      const i = (y * w + x) * 4;
      const p = toLab(data[i], data[i + 1], data[i + 2]);
      p[0] *= gain;
      let best = 0;
      for (let k = 1; k < refs.length; k++) if (dist(p, refs[k]) < dist(p, refs[best])) best = k;
      return dist(p, refs[best]) < 0.12 ? best : -1;
    };
    let darkCount = 0;
    let touching = 0;
    for (let y = Math.floor(h * 0.16); y < h * 0.84 - 2; y++) {
      for (let x = Math.floor(w * 0.16); x < w * 0.84 - 2; x++) {
        if (label(x, y) !== 0) continue;
        darkCount++;
        if (label(x + 2, y) > 0 || label(x, y + 2) > 0) touching++;
      }
    }
    return darkCount ? touching / darkCount : 0;
  };

  let base = colored[0];
  const others = colored.slice(1).filter((c) => c.share >= 0.1);
  let pattern: Pattern = 'solid';
  let marking: Lab | null = null;
  if (others.length) {
    const other = others.reduce((p, q) => (Math.abs(q.center[0] - base.center[0]) > Math.abs(p.center[0] - base.center[0]) ? q : p));
    const dAB = Math.hypot(other.center[1] - base.center[1], other.center[2] - base.center[2]);
    const dL = Math.abs(other.center[0] - base.center[0]);
    if (dAB > 0.07) {
      pattern = 'patches'; // 两种色相差很多,比如橘 + 黑
      marking = other.center;
    } else if (dL > 0.08) {
      pattern = 'tabby'; // 同一色系的深浅两色,当作条纹
      if (other.center[0] > base.center[0]) {
        marking = base.center;
        base = other;
      } else {
        marking = other.center;
      }
      // 深色成片而不是细条纹:当作重点色;同时白色很多就是布偶那种双色
      // 两色对比弱、颜色又不鲜艳(米色配浅褐),也按面罩处理,这是重点色猫的典型配色
      const muted = dL < 0.2 && chroma(base.center) < 0.07;
      if (muted || stripiness(marking, base.center) < 0.22) pattern = whiteShare > 0.2 ? 'ragdoll' : 'points';
    }
  }
  look.base = cartoon(base.center);
  look.marking = marking
    ? cartoon(marking)
    : rgbToHex(fromLab([base.center[0] * 0.78, base.center[1], base.center[2]]));
  look.pattern = pattern;
  if (pattern === 'patches') {
    look.accent = look.marking;
    if (whiteShare > 0.3 && look.white) {
      // 白底上的色块:白色当底色,两种有色毛当色块
      look.accent = look.marking;
      look.marking = look.base;
      look.base = look.white;
    }
  }
  look.belly = whiteShare > 0.08 ? Math.min(1, whiteShare * 1.8) : 0;
  look.socks = whiteShare > 0.12;
  look.muzzle = whiteShare > 0.15;
  return { look, palette };
}
