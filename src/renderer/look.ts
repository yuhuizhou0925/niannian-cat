// 猫的外观档案:颜色、花纹和少量体型参数。桌宠和外观工作室共用。

export type Pattern = 'solid' | 'tabby' | 'spots' | 'patches' | 'points' | 'ragdoll';

export interface CatLook {
  base: string; // 主毛色
  marking: string; // 花纹色 / 面罩色
  accent: string; // 第二花色(色块花纹用)
  white: string; // 白色部分
  eyes: string;
  nose: string;
  pattern: Pattern;
  belly: number; // 白肚皮范围 0..1
  socks: boolean; // 白手套
  muzzle: boolean; // 白嘴套
  fluff: number; // 尾巴大小
  ears: number; // 耳朵大小
  head: number; // 头大小
}

export const DEFAULT_LOOK: CatLook = {
  base: '#f0a04b',
  marking: '#c9702a',
  accent: '#3a3230',
  white: '#fff6e8',
  eyes: '#7fb23a',
  nose: '#f08a8a',
  pattern: 'tabby',
  belly: 0.5,
  socks: true,
  muzzle: true,
  fluff: 1,
  ears: 1,
  head: 1,
};

// 布偶双色:米色的背和体侧,白色的胸口、肚子和腿,眼周是浅褐色面罩,耳朵和尾巴更深
export const RAGDOLL: Partial<CatLook> = {
  base: '#ead8bf', marking: '#a08876', white: '#fdfbf7', eyes: '#5f7896', nose: '#e8989f',
  pattern: 'ragdoll', belly: 0.75, socks: true, muzzle: true,
};

export const PRESETS: { name: string; look: Partial<CatLook> }[] = [
  { name: '布偶', look: RAGDOLL },
  { name: '橘猫', look: { base: '#f0a04b', marking: '#c9702a', pattern: 'tabby', belly: 0.5, socks: true, muzzle: true, eyes: '#7fb23a' } },
  { name: '狸花', look: { base: '#a78c68', marking: '#40332a', pattern: 'tabby', belly: 0.25, socks: false, muzzle: true, eyes: '#c9b23a' } },
  { name: '奶牛', look: { base: '#2e2e36', marking: '#1c1c22', pattern: 'solid', belly: 0.85, socks: true, muzzle: true, eyes: '#e0b83a' } },
  { name: '三花', look: { base: '#fbf3e6', marking: '#e8943e', accent: '#35302e', pattern: 'patches', belly: 0.6, socks: true, muzzle: true, eyes: '#8fb84a' } },
  { name: '蓝猫', look: { base: '#8d97a8', marking: '#6f7889', pattern: 'solid', belly: 0, socks: false, muzzle: false, eyes: '#e8a23a' } },
  { name: '暹罗', look: { base: '#f1e5d0', marking: '#4d392b', pattern: 'points', belly: 0, socks: false, muzzle: false, eyes: '#4aa3e0' } },
];

export type RGB = [number, number, number];

export function hexToRgb(hex: string): RGB {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]: RGB): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

export function mix(a: string, b: string, t: number): string {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  return rgbToHex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
}

export const darken = (hex: string, amount: number) => mix(hex, '#1a1210', amount);
